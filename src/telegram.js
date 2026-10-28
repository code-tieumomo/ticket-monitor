const config = require('./config');

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cleanContentForTelegram(content = '') {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => {
      if (!line) return false;
      if (/^facebook$/i.test(line)) return false;
      if (/^[·•\-]$/.test(line)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

/**
 * Sends a badminton match alert message to Telegram
 * @param {object} param0 
 */
async function sendAlert({
  groupName = 'Nhóm Facebook',
  type = 'POST',
  authorName = 'Ẩn danh',
  content = '',
  url = '',
  tags = [],
  priority = 'NORMAL',
  aiSummary = null,
  detectedBy = 'REGEX',
  parentPostText = null,
  parentPostAuthor = null,
  details = {},
  locationCategory = null
}) {
  const { botToken, chatId } = config.telegram;

  if (!botToken || !chatId) {
    console.warn('[Telegram] Chưa cấu hình TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID trong .env. Bỏ qua gửi tin nhắn.');
    console.log(`[Preview Alert] [${groupName}][${type}] Tags: ${tags.join(', ')} | URL: ${url}`);
    return { ok: false, reason: 'missing_credentials' };
  }

  const cleaned = cleanContentForTelegram(content);
  const shortContent = cleaned.length > 500 ? cleaned.slice(0, 497) + '...' : cleaned;
  const isHighPriority = priority === 'HIGH';
  const isAiDetected = detectedBy === 'GEMINI';
  const isComment = type === 'COMMENT';
  const headerIcon = isHighPriority ? '🔥🏸' : '🏸✨';
  const priorityTag = isHighPriority ? ' [GẤP / HÔM NAY]' : '';

  // Location display
  let locationLabel = '';
  if (locationCategory === '120_DINH_CONG' || (details && details.venue && /định công|maxping/i.test(details.venue))) {
    locationLabel = ' [120 Định Công]';
  } else if (locationCategory === '488_MINH_KHAI' || (details && details.venue && /minh khai/i.test(details.venue))) {
    locationLabel = ' [488 Minh Khai]';
  } else if (locationCategory === 'TAN_MAI' || (details && details.venue && /tân mai|tm\b/i.test(details.venue))) {
    locationLabel = ' [Tân Mai]';
  }

  const typeLabel = isComment ? '💬 Bình luận' : '📝 Bài viết';
  const authorLabel = isComment ? '👤 <b>Người bình luận:</b>' : '👤 <b>Người đăng:</b>';

  const messageLines = [
    `${headerIcon} <b>KÈO GIAO LƯU CẦU LÔNG MỚI!</b>${locationLabel}${priorityTag}`,
    `📌 <b>Nhóm:</b> ${escapeHtml(groupName)} | <b>Loại:</b> ${typeLabel}`,
    `${authorLabel} ${escapeHtml(authorName)}`,
    ``
  ];

  if (isComment && parentPostText) {
    const cleanParent = cleanContentForTelegram(parentPostText);
    const shortParent = cleanParent.length > 180 ? cleanParent.slice(0, 177) + '...' : cleanParent;
    const authorSnippet = parentPostAuthor ? ` (bởi ${escapeHtml(parentPostAuthor)})` : '';
    messageLines.push(
      `📝 <b>Bài viết gốc:</b> <i>&quot;${escapeHtml(shortParent)}&quot;${authorSnippet}</i>`,
      ``
    );
  }

  // Key Badminton Information extracted for instant reading
  const d = details || {};
  const infoLines = [];
  if (d.venue) infoLines.push(`📍 <b>Sân:</b> ${escapeHtml(d.venue)}`);
  if (d.time) infoLines.push(`⏰ <b>Giờ chơi:</b> ${escapeHtml(d.time)}`);
  if (d.slots) infoLines.push(`👥 <b>Số lượng:</b> ${escapeHtml(d.slots)}`);
  if (d.gender) infoLines.push(`🚻 <b>Giới tính:</b> ${escapeHtml(d.gender)}`);
  if (d.level) infoLines.push(`📊 <b>Trình độ:</b> ${escapeHtml(d.level)}`);
  if (d.shuttle) infoLines.push(`🪶 <b>Loại cầu:</b> ${escapeHtml(d.shuttle)}`);
  if (d.fee) infoLines.push(`💰 <b>Chi phí:</b> ${escapeHtml(d.fee)}`);
  if (d.contact) infoLines.push(`📞 <b>Liên hệ:</b> ${escapeHtml(d.contact)}`);
  if (d.notes) infoLines.push(`📝 <b>Ghi chú:</b> ${escapeHtml(d.notes)}`);

  if (infoLines.length > 0) {
    messageLines.push(...infoLines);
    messageLines.push(``);
  }

  if (aiSummary) {
    messageLines.push(`💡 <b>AI Tóm tắt:</b> <i>${escapeHtml(aiSummary)}</i>`, ``);
  }

  const contentHeader = isComment ? `💬 <b>Nội dung bình luận:</b>` : `📋 <b>Nội dung bài đăng:</b>`;
  const linkLabel = isComment ? `👉 BẤM VÀO ĐÂY ĐỂ XEM BÌNH LUẬN TRÊN FACEBOOK` : `👉 BẤM VÀO ĐÂY ĐỂ MỞ BÀI ĐĂNG TRÊN FACEBOOK`;

  messageLines.push(
    contentHeader,
    `<code>${escapeHtml(shortContent)}</code>`,
    ``,
    `🔗 <a href="${url}"><b>${linkLabel}</b></a>`
  );

  const htmlMessage = messageLines.join('\n');

  return await postToTelegram(botToken, chatId, htmlMessage, true);
}

/**
 * Sends system/checkpoint alert to Telegram
 */
async function sendSystemAlert(title, detail) {
  const { botToken, chatId } = config.telegram;
  if (!botToken || !chatId) {
    console.warn(`[System Alert - ${title}]: ${detail}`);
    return;
  }

  const message = [
    `⚠️ <b>CẢNH BÁO HỆ THỐNG: ${escapeHtml(title)}</b>`,
    ``,
    `${escapeHtml(detail)}`,
    ``,
    `⏰ Thời gian: ${new Date().toLocaleString('vi-VN')}`
  ].join('\n');

  return await postToTelegram(botToken, chatId, message, true);
}

/**
 * Low-level HTTP POST to Telegram Bot API with HTML fallback to Plaintext
 */
async function postToTelegram(botToken, chatId, messageText, useHtml = true) {
  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;

  const payload = {
    chat_id: chatId,
    text: messageText,
    parse_mode: useHtml ? 'HTML' : undefined,
    disable_web_page_preview: false
  };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!result.ok) {
      // If HTML entity parsing fails, retry with plain text so notification is never dropped
      if (useHtml && result.description && result.description.includes('can\'t parse entities')) {
        console.warn('[Telegram] HTML parse error, retrying with plain text...');
        return await postToTelegram(botToken, chatId, messageText.replace(/<[^>]*>/g, ''), false);
      }
      console.error('[Telegram API Error]:', result.description);
      return { ok: false, error: result.description };
    }

    return { ok: true, result };
  } catch (err) {
    console.error('[Telegram Network Error]:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  sendAlert,
  sendSystemAlert,
  postToTelegram,
  escapeHtml
};
