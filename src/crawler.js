const { chromium } = require('playwright');
const crypto = require('crypto');
const fs = require('fs');
const config = require('./config');
const db = require('./database');
const { parseContent } = require('./parser');
const kira = require('./kira');
const { sendAlert, sendSystemAlert } = require('./telegram');

/**
 * Extracts numeric Facebook comment ID from URL
 */
function extractCommentId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const cid = u.searchParams.get('comment_id') || u.searchParams.get('reply_comment_id');
    if (cid) return cid;
  } catch {}
  const m = String(url).match(/[?&](?:comment_id|reply_comment_id)=(\d+)/);
  return m ? m[1] : null;
}

/**
 * Extracts Facebook post ID from various URL formats
 */
function extractPostId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const pcb = u.searchParams.get('set');
    if (pcb && pcb.startsWith('pcb.')) {
      return pcb.replace('pcb.', '').replace(/\D/g, '');
    }
    const fbid = u.searchParams.get('fbid');
    if (fbid) return fbid;
    const m = u.pathname.match(/\/(?:posts|permalink|p)\/([a-zA-Z0-9_-]+)/);
    if (m) return m[1];
  } catch {}
  const m = String(url).match(/\/(?:posts|permalink|p)\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

/**
 * Sanitizes Facebook URL by removing all ephemeral tracking parameters (__cft__, __tn__, ref, etc.)
 */
function cleanFacebookUrl(url, type = 'POST') {
  if (!url) return '';
  try {
    const u = new URL(url);
    if (type === 'COMMENT') {
      const cid = extractCommentId(url);
      if (cid) {
        return `${u.origin}${u.pathname}?comment_id=${cid}`;
      }
    }
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Generates an immutable content fingerprint to catch duplicates regardless of link format
 */
function generateContentFingerprint(groupId, type, authorName, text) {
  const normAuthor = (authorName || 'unknown').toLowerCase().replace(/\s+/g, ' ').trim();
  const normText = (text || '')
    .toLowerCase()
    .replace(/[\u0300-\u036f\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  const hash = crypto.createHash('sha256')
    .update(`${groupId}_${type}_${normAuthor}_${normText}`)
    .digest('hex');
  return `fp_${hash}`;
}

/**
 * Generates a stable unique identifier for posts & comments that NEVER changes on page reload
 */
function generateItemId(postUrl, type, groupId, authorName = '', text = '') {
  if (type === 'COMMENT') {
    const cid = extractCommentId(postUrl);
    if (cid) {
      return `fb_cmt_${cid}`;
    }
  } else {
    const pid = extractPostId(postUrl);
    if (pid) {
      return `fb_post_${pid}`;
    }
  }

  // Fallback to content fingerprint if URL doesn't contain a permanent ID
  return generateContentFingerprint(groupId, type, authorName, text);
}

function isCheckpointOrLoginPage(url, pageTitle, bodyText) {
  const lowerUrl = (url || '').toLowerCase();
  const lowerBody = (bodyText || '').toLowerCase();
  const lowerTitle = (pageTitle || '').toLowerCase();

  if (lowerUrl.includes('/checkpoint/') || lowerUrl.includes('/login.php')) {
    return true;
  }

  if (
    lowerTitle.includes('checkpoint') ||
    lowerTitle.includes('đăng nhập') ||
    lowerTitle.includes('log in') ||
    lowerBody.includes('xác nhận danh tính') ||
    lowerBody.includes('tài khoản của bạn đã bị khóa') ||
    lowerBody.includes('security check') ||
    lowerBody.includes('we locked your account')
  ) {
    return true;
  }

  return false;
}

/**
 * Filters out useless comments (bare phone numbers, bare prices like "40k", 1-word inbox spam)
 * @param {string} text 
 * @returns {boolean}
 */
function isActionableComment(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = text.trim();
  if (clean.length < 3) return false;

  const lower = clean.toLowerCase();

  // 1. Generic 1-word or useless spam
  if (/^(inbox|check\s*ib|rep\s*ib|ib|chấm|\.|hóng|up|quan\s*tâm|xin\s*giá|giá\s*sao|cho\s*xin\s*giá)$/i.test(lower)) {
    return false;
  }

  // 2. Reject bare prices like "35k", "65 cá" without any other clues
  if (/^\d+([.,]\d+)?\s*(k|cá|ca|đ|vnd|vnđ)?$/i.test(clean)) {
    return false;
  }

  // 3. Must contain at least one badminton clue
  const hasBadmintonClue = /(sân|san|cầu|cau|slot|ca\s*\d|đánh|danh|giao\s*lưu|gl\b|glcl|tuyển|tuyen|ghép|ghep|chân|bạn|mem|nam|nữ|tby|tb-|tb\+|tb\b|\by\b|\bk\b|\bc\b|vãng\s*lai|cố\s*định|định\s*công|minh\s*khai|tân\s*mai|maxping|120|488|tm\b|dc\b|mk\b)/i.test(lower);
  if (!hasBadmintonClue) {
    return false;
  }

  // 4. Reject bare contact drops without slot or court info (e.g. "0912345678 zalo", "ib số này nha")
  const digitsOnly = clean.replace(/\D/g, '');
  if (digitsOnly.length >= 9 && clean.length <= 30 && !/(sân|slot|ca|định\s*công|minh\s*khai|tân\s*mai|nam|nữ|tby|tb|k\b)/i.test(lower)) {
    return false;
  }

  return true;
}

function loadAndSanitizeStorageState(storagePath) {
  try {
    const raw = fs.readFileSync(storagePath, 'utf8');
    const state = JSON.parse(raw);
    let modified = false;

    if (Array.isArray(state.cookies)) {
      for (const c of state.cookies) {
        const s = String(c.sameSite || '').toLowerCase().trim();
        let validSameSite = 'Lax';
        if (s === 'no_restriction' || s === 'none') validSameSite = 'None';
        else if (s === 'strict') validSameSite = 'Strict';
        else validSameSite = 'Lax';

        if (c.sameSite !== validSameSite) {
          c.sameSite = validSameSite;
          modified = true;
        }
      }
    }

    if (modified) {
      fs.writeFileSync(storagePath, JSON.stringify(state, null, 2), 'utf8');
      console.log('[Crawler] Đã tự động chuẩn hóa thuộc tính sameSite trong cookies/fb-auth.json.');
    }

    return state;
  } catch (err) {
    console.warn('[Crawler] Cảnh báo khi làm sạch storageState:', err.message);
    return storagePath;
  }
}

/**
 * Runs a single crawl cycle through all configured Facebook groups
 */
async function runCrawlCycle() {
  const storagePath = config.paths.storageState;
  const hasStorageState = fs.existsSync(storagePath);

  if (!hasStorageState) {
    console.warn(`[Crawler] Không tìm thấy file session đăng nhập tại: ${storagePath}`);
    console.warn('[Crawler] Vui lòng chạy "npm run login" hoặc xuất cookie vào cookies/fb-auth.json trước.');
    return {
      success: false,
      reason: 'missing_storage_state'
    };
  }

  const storageState = loadAndSanitizeStorageState(storagePath);

  console.log(`[Crawler] Bắt đầu chu kỳ quét (${config.groups.length} nhóm)...`);

  let browser = null;
  let context = null;

  try {
    browser = await chromium.launch({
      headless: config.crawler.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-notifications',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    context = await browser.newContext({
      storageState: storageState,
      viewport: config.crawler.viewport,
      userAgent: config.crawler.userAgent,
      locale: 'vi-VN'
    });

    const page = await context.newPage();

    // Loop through each configured group
    for (const group of config.groups) {
      console.log(`\n🔍 [${group.id}] Đang mở nhóm: ${group.name} (${group.url})...`);

      try {
        await page.goto(group.url, {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        });

        // Check for Checkpoint or Session expiration
        const currentUrl = page.url();
        const pageTitle = await page.title();
        const bodySnippet = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 1000) : '');

        if (isCheckpointOrLoginPage(currentUrl, pageTitle, bodySnippet)) {
          const warnMsg = `Phát hiện Checkpoint/Yêu cầu đăng nhập lại tại URL: ${currentUrl}`;
          console.error(`🚨 [CHECKPOINT ALERT] ${warnMsg}`);
          await sendSystemAlert('Facebook Checkpoint Bị Kích Hoạt', warnMsg);
          // Stop immediately to avoid further suspicious activity
          return { success: false, reason: 'checkpoint_detected' };
        }

        // Helper to expand all "Xem thêm" / "See more" buttons on page
        const expandSeeMoreOnPage = async () => {
          await page.evaluate(() => {
            const candidates = Array.from(document.querySelectorAll('div[role="button"], span[role="button"], [role="button"], div[dir="auto"] span'));
            for (const el of candidates) {
              const text = (el.innerText || '').trim();
              if (/(?:xem\s*thêm|see\s*more)/i.test(text) && text.length < 35) {
                try {
                  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
                  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
                  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                  el.click();
                } catch {}
              }
            }
          });
        };

        // Progressive scrolling to load enough posts and expand hidden text ("Xem thêm")
        const scrollRounds = Math.min(Math.max(Math.ceil(config.crawler.maxPostsPerGroup / 4), 2), 6);
        for (let s = 0; s < scrollRounds; s++) {
          await expandSeeMoreOnPage();
          await page.evaluate(() => window.scrollBy(0, 2500));
          await page.waitForTimeout(1800);
        }

        // Final pass to expand any remaining collapsed posts before extracting items
        await expandSeeMoreOnPage();
        await page.waitForTimeout(1000);

        // Extract feed posts & comments
        const items = await page.evaluate((maxPosts) => {
          const results = [];
          const seen = new Set();
          const feed = document.querySelector('div[role="feed"]');
          
          // Get candidate post containers: either feed direct children or role="article"
          const candidateElements = feed 
            ? Array.from(feed.children) 
            : Array.from(document.querySelectorAll('div[role="article"], div[data-pagelet*="FeedUnit"]'));

          for (const container of candidateElements) {
            // Expand "Xem thêm" within this specific container if still collapsed
            const seeMoreBtns = container.querySelectorAll('div[role="button"], span[role="button"], [role="button"], span');
            for (const btn of seeMoreBtns) {
              const bText = (btn.innerText || '').trim();
              if (/(?:xem\s*thêm|see\s*more)/i.test(bText) && bText.length < 35) {
                try {
                  btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                  btn.click();
                } catch {}
              }
            }

            const fullText = (container.innerText || '').trim();
            if (fullText.length < 25) continue;
            
            // Skip feed header / sort dropdown wrapper
            if (fullText.includes('sắp xếp bảng feed') || (fullText.includes('Bài viết mới') && fullText.length < 80)) {
              continue;
            }

            // 1. Extract Author Name
            let author = 'Ẩn danh';
            const h = container.querySelector('h2, h3, h4');
            if (h && h.innerText) {
              author = h.innerText.split('\n')[0].trim();
            }
            if (author === 'Ẩn danh' || !author || /^facebook$/i.test(author)) {
              const uLink = container.querySelector('a[href*="/user/"], a[href*="profile.php"]');
              if (uLink && uLink.innerText) {
                author = uLink.innerText.split('\n')[0].trim();
              }
            }
            author = author.replace(/[\u0300-\u036f\u200b-\u200f\ufeff]/g, '').trim();

            // 2. Extract Post Permalink
            let postUrl = '';
            const postLinkElem = container.querySelector(
              'a[href*="/posts/"], a[href*="/permalink/"], a[href*="share/p/"], a[href*="set=pcb."]'
            );
            if (postLinkElem) {
              try {
                const u = new URL(postLinkElem.href);
                if (u.searchParams.has('set') && u.searchParams.get('set').startsWith('pcb.')) {
                  const pcbId = u.searchParams.get('set').replace('pcb.', '');
                  postUrl = `${u.origin}${u.pathname.split('/photo')[0]}/posts/${pcbId}/`;
                } else {
                  u.searchParams.delete('comment_id');
                  u.searchParams.delete('reply_comment_id');
                  u.searchParams.delete('__cft__');
                  u.searchParams.delete('__tn__');
                  u.searchParams.delete('ref');
                  postUrl = u.origin + u.pathname;
                }
              } catch {
                postUrl = postLinkElem.href;
              }
            }

            // 3. Extract Clean Post Text
            const lines = fullText
              .split('\n')
              .map(l => l.trim())
              .filter(l => {
                if (!l) return false;
                if (/^facebook$/i.test(l)) return false;
                if (/^[·•\-_*]$/.test(l)) return false;
                // Filter out Facebook anti-bot scrambled letters
                if (l.replace(/[\u0300-\u036f\u200b-\u200f\ufeff]/g, '').trim().length <= 1) return false;
                let lClean = l.replace(/[….]*\s*(?:xem\s*thêm|see\s*more)\s*$/i, '').trim();
                if (!lClean) return false;
                if (lClean === author) return false;
                if (/^(theo dõi|follow|đã chia sẻ bài viết|thích|like|bình luận|comment|chia sẻ|share|viết câu trả lời|viết bình luận)/i.test(lClean)) return false;
                if (/(?:xem\s*thêm|see\s*more)/i.test(lClean) && lClean.length < 25) return false;
                if (/^có thể là hình ảnh về/i.test(lClean)) return false;
                if (/^(khoảng\s*)?\d+\s*(giây|phút|giờ|ngày|tháng|h|m|s|min)\s*(trước)?$/i.test(lClean)) return false;
                if (/^trả lời$/i.test(lClean)) return false;
                return true;
              })
              .map(l => l.replace(/[….]*\s*(?:xem\s*thêm|see\s*more)\s*$/i, '').trim());

            const cleanPostText = lines.join('\n').trim();

            if (cleanPostText.length >= 10) {
              const dedupKey = `${author}_${cleanPostText.slice(0, 60)}`;
              if (!seen.has(dedupKey)) {
                seen.add(dedupKey);
                results.push({
                  type: 'POST',
                  authorName: author,
                  url: postUrl || window.location.href,
                  text: cleanPostText,
                  parentPostAuthor: null,
                  parentPostText: null,
                  parentPostUrl: null
                });
              }
            }

            // 4. Extract Comments within this container if present
            const commentLinks = Array.from(container.querySelectorAll('a[href*="comment_id"]'));
            for (const cl of commentLinks.slice(0, 5)) {
              let parent = cl.closest('div[role="article"]') || cl.parentElement;
              while (parent && parent !== container) {
                const pText = (parent.innerText || '').trim();
                if (pText.length > 10 && pText.length < 600) {
                  const cLines = pText.split('\n').map(l => l.trim()).filter(l => {
                    if (!l || /^facebook$/i.test(l) || /^[·•\-_*]$/.test(l)) return false;
                    if (/^(thích|like|trả lời|reply|chia sẻ|share|\d+\s*(phút|giờ|ngày|h|m))$/i.test(l)) return false;
                    return true;
                  });
                  if (cLines.length >= 2) {
                    const cAuthor = cLines[0].replace(/[\u0300-\u036f\u200b-\u200f\ufeff]/g, '').trim();
                    const cContent = cLines.slice(1).join('\n').trim();
                    if (cContent.length >= 5) {
                      const cKey = `comment_${cAuthor}_${cContent.slice(0, 40)}`;
                      if (!seen.has(cKey)) {
                        seen.add(cKey);
                        results.push({
                          type: 'COMMENT',
                          authorName: cAuthor,
                          url: cl.href,
                          text: cContent,
                          parentPostAuthor: author,
                          parentPostText: cleanPostText,
                          parentPostUrl: postUrl || window.location.href
                        });
                      }
                      break;
                    }
                  }
                }
                parent = parent.parentElement;
              }
            }

            if (results.length >= maxPosts * 2) break;
          }

          return results;
        }, config.crawler.maxPostsPerGroup);

        console.log(`  -> Tìm thấy ${items.length} bài viết/bình luận gần nhất.`);

        let matchedCount = 0;
        const candidateItems = [];

        // Step 1: Fast evaluation with Regex rules & comment pre-filter
        for (const item of items) {
          const cleanUrl = cleanFacebookUrl(item.url || group.url, item.type);
          const itemId = generateItemId(item.url, item.type, group.id, item.authorName, item.text);
          const fingerprint = generateContentFingerprint(group.id, item.type, item.authorName, item.text);

          // Dual-key deduplication: check canonical ID OR content fingerprint
          if (db.isExists(itemId, fingerprint)) {
            continue; // Already processed in past cycles
          }

          // Pre-filter: discard useless comments (bare phone numbers, bare prices like "40tr", vague spam)
          if (item.type === 'COMMENT' && !isActionableComment(item.text)) {
            db.insertItem({
              id: itemId,
              group_id: group.id,
              item_type: item.type,
              author_name: item.authorName,
              content: item.text.slice(0, 200),
              post_url: cleanUrl,
              tags: 'NON_MATCH',
              content_hash: fingerprint
            });
            continue;
          }

          // Preliminary regex analysis (for fast check and fallback)
          const regexAnalysis = parseContent(item.text, {
            parentPostText: item.parentPostText,
            parentPostAuthor: item.parentPostAuthor
          });

          candidateItems.push({
            ...item,
            id: itemId,
            cleanUrl,
            fingerprint,
            regexAnalysis
          });
        }

        // Step 2: Process candidate items with Kira AI (all items go through AI when available)
        if (candidateItems.length > 0) {
          if (kira.isAvailable()) {
            console.log(`  🤖 [Kira AI] Đang gửi ${candidateItems.length} bài mới qua AI để đánh giá và trích xuất dữ liệu chi tiết...`);
            const aiResults = await kira.analyzeBatch(candidateItems);

            for (const item of candidateItems) {
              const ai = aiResults.get(item.id);
              const regex = item.regexAnalysis;

              if (ai) {
                // Check if location matches: MUST be one of target categories OR verified by target regex
                const isTargetCategory = ['120_DINH_CONG', '488_MINH_KHAI', 'TAN_MAI'].includes(ai.locationCategory);
                const isLocationMatched = config.filterByTargetLocation
                  ? (isTargetCategory || (regex.matchesLocation && ai.locationCategory !== 'OTHER'))
                  : true;

                const isMatch = ai.isBadmintonMatch && isLocationMatched;

                if (isMatch) {
                  matchedCount++;
                  const mergedDetails = {
                    venue: ai.venue || regex.details?.venue,
                    time: ai.time || regex.details?.time,
                    slots: ai.slots || regex.details?.slots,
                    gender: ai.gender || regex.details?.gender,
                    level: ai.level || regex.details?.level,
                    shuttle: ai.shuttle || regex.details?.shuttle,
                    fee: ai.fee || regex.details?.fee,
                    contact: ai.contact || regex.details?.contact,
                    notes: ai.notes || regex.details?.notes
                  };

                  const aiTags = kira.formatAiTags({ ...ai, ...mergedDetails });
                  const priority = kira.determineAiPriority(ai);
                  const locationCat = ai.locationCategory || regex.venueCategory;

                  console.log(`  🎯 [KHỚP KÈO CẦU LÔNG - KIRA AI] [${item.type}] Bởi: ${item.authorName} | Sân: ${mergedDetails.venue || locationCat} | Trình độ: ${mergedDetails.level || 'N/A'} | Tags: ${aiTags.join(', ')}`);

                  // Save to database
                  db.insertItem({
                    id: item.id,
                    group_id: group.id,
                    item_type: item.type,
                    author_name: item.authorName,
                    content: item.text,
                    post_url: item.cleanUrl,
                    tags: aiTags,
                    content_hash: item.fingerprint
                  });

                  // Dispatch alert to Telegram with AI-parsed insights
                  await sendAlert({
                    groupName: group.name,
                    type: item.type,
                    authorName: item.authorName,
                    content: item.text,
                    url: item.cleanUrl,
                    tags: aiTags,
                    priority: priority,
                    aiSummary: ai.summary,
                    detectedBy: 'KIRA_AI',
                    parentPostText: item.parentPostText,
                    parentPostAuthor: item.parentPostAuthor,
                    details: mergedDetails,
                    locationCategory: locationCat
                  });
                } else {
                  // Non-match verified by AI
                  db.insertItem({
                    id: item.id,
                    group_id: group.id,
                    item_type: item.type,
                    author_name: item.authorName,
                    content: item.text.slice(0, 200),
                    post_url: item.cleanUrl,
                    tags: 'NON_MATCH',
                    content_hash: item.fingerprint
                  });
                }
              } else {
                // Fallback for this item if AI response was missing/errored
                if (regex.isMatch) {
                  matchedCount++;
                  console.log(`  🎯 [KHỚP KÈO CẦU LÔNG - REGEX FALLBACK] [${item.type}] Bởi: ${item.authorName} | Tags: ${regex.tags.join(', ')}`);

                  db.insertItem({
                    id: item.id,
                    group_id: group.id,
                    item_type: item.type,
                    author_name: item.authorName,
                    content: item.text,
                    post_url: item.cleanUrl,
                    tags: regex.tags,
                    content_hash: item.fingerprint
                  });

                  await sendAlert({
                    groupName: group.name,
                    type: item.type,
                    authorName: item.authorName,
                    content: item.text,
                    url: item.cleanUrl,
                    tags: regex.tags,
                    priority: regex.priority,
                    detectedBy: 'REGEX',
                    parentPostText: item.parentPostText,
                    parentPostAuthor: item.parentPostAuthor,
                    details: regex.details,
                    locationCategory: regex.venueCategory
                  });
                } else {
                  db.insertItem({
                    id: item.id,
                    group_id: group.id,
                    item_type: item.type,
                    author_name: item.authorName,
                    content: item.text.slice(0, 200),
                    post_url: item.cleanUrl,
                    tags: 'NON_MATCH',
                    content_hash: item.fingerprint
                  });
                }
              }
            }
          } else {
            // Kira AI not configured: evaluate entirely via Regex
            for (const item of candidateItems) {
              const regex = item.regexAnalysis;
              if (regex.isMatch) {
                matchedCount++;
                console.log(`  🎯 [KHỚP KÈO CẦU LÔNG - REGEX] [${item.type}] Bởi: ${item.authorName} | Tags: ${regex.tags.join(', ')}`);

                db.insertItem({
                  id: item.id,
                  group_id: group.id,
                  item_type: item.type,
                  author_name: item.authorName,
                  content: item.text,
                  post_url: item.cleanUrl,
                  tags: regex.tags,
                  content_hash: item.fingerprint
                });

                await sendAlert({
                  groupName: group.name,
                  type: item.type,
                  authorName: item.authorName,
                  content: item.text,
                  url: item.cleanUrl,
                  tags: regex.tags,
                  priority: regex.priority,
                  detectedBy: 'REGEX',
                  parentPostText: item.parentPostText,
                  parentPostAuthor: item.parentPostAuthor,
                  details: regex.details,
                  locationCategory: regex.venueCategory
                });
              } else {
                db.insertItem({
                  id: item.id,
                  group_id: group.id,
                  item_type: item.type,
                  author_name: item.authorName,
                  content: item.text.slice(0, 200),
                  post_url: item.cleanUrl,
                  tags: 'NON_MATCH',
                  content_hash: item.fingerprint
                });
              }
            }
          }
        }

        console.log(`  -> Xử lý xong: ${matchedCount} thông báo kèo cầu lông mới.`);

      } catch (groupErr) {
        console.error(`  ❌ Lỗi khi quét nhóm [${group.id}]:`, groupErr.message);
      }

      // Jitter delay between groups
      const groupDelay = Math.floor(
        Math.random() * (config.crawler.delayBetweenGroupsMaxMs - config.crawler.delayBetweenGroupsMinMs + 1)
      ) + config.crawler.delayBetweenGroupsMinMs;
      
      console.log(`  ⏳ Chờ ${Math.round(groupDelay / 1000)}s trước khi quét nhóm kế tiếp...`);
      await page.waitForTimeout(groupDelay);
    }

    return { success: true };

  } catch (err) {
    console.error('[Crawler] Lỗi chu kỳ crawl:', err.message);
    return { success: false, error: err.message };
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = {
  runCrawlCycle,
  generateItemId,
  generateContentFingerprint,
  cleanFacebookUrl,
  extractCommentId,
  extractPostId,
  isCheckpointOrLoginPage,
  isActionableComment
};
