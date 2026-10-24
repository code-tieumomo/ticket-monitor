const path = require('path');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

function parseGroupUrls(envUrls) {
  if (!envUrls || !envUrls.trim()) {
    return [
      { id: 'group_1', name: 'Nhóm 1', url: 'https://www.facebook.com/groups/GROUP_ID_1?sorting_setting=CHRONOLOGICAL' },
      { id: 'group_2', name: 'Nhóm 2', url: 'https://www.facebook.com/groups/GROUP_ID_2?sorting_setting=CHRONOLOGICAL' },
      { id: 'group_3', name: 'Nhóm 3', url: 'https://www.facebook.com/groups/GROUP_ID_3?sorting_setting=CHRONOLOGICAL' },
      { id: 'group_4', name: 'Nhóm 4', url: 'https://www.facebook.com/groups/GROUP_ID_4?sorting_setting=CHRONOLOGICAL' },
    ];
  }

  return envUrls
    .split(',')
    .map(u => u.trim())
    .filter(Boolean)
    .map((url, idx) => {
      // Ensure sorting_setting=CHRONOLOGICAL is present for newest posts
      let finalUrl = url;
      if (!finalUrl.includes('sorting_setting=')) {
        finalUrl += (finalUrl.includes('?') ? '&' : '?') + 'sorting_setting=CHRONOLOGICAL';
      }
      return {
        id: `group_${idx + 1}`,
        name: `Nhóm ${idx + 1}`,
        url: finalUrl
      };
    });
}

const config = {
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
    enabled: process.env.ENABLE_GEMINI !== 'false',
    mode: process.env.GEMINI_MODE || 'smart', // 'smart' (AI checks non-matches to avoid missing tickets) | 'all' (AI checks everything)
  },
  paths: {
    storageState: path.resolve(process.cwd(), process.env.STORAGE_STATE_PATH || 'cookies/fb-auth.json'),
    dbPath: path.resolve(process.cwd(), process.env.DB_PATH || 'db/database.sqlite'),
  },
  crawler: {
    headless: process.env.HEADLESS === 'false' ? false : true,
    maxPostsPerGroup: parseInt(process.env.MAX_POSTS_PER_GROUP, 10) || 5,
    scanComments: process.env.SCAN_COMMENTS === 'false' ? false : true,
    baseIntervalSec: parseInt(process.env.POLL_BASE_INTERVAL_SEC, 10) || 90,
    jitterMinSec: parseInt(process.env.POLL_JITTER_MIN_SEC, 10) || 10,
    jitterMaxSec: parseInt(process.env.POLL_JITTER_MAX_SEC, 10) || 40,
    delayBetweenGroupsMinMs: parseInt(process.env.DELAY_BETWEEN_GROUPS_MIN_MS, 10) || 4000,
    delayBetweenGroupsMaxMs: parseInt(process.env.DELAY_BETWEEN_GROUPS_MAX_MS, 10) || 7000,
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
  groups: parseGroupUrls(process.env.FB_GROUP_URLS),
  rules: {
    // Intent: Sell / Pass / Resell
    sellActionRegex: /(pass|nhượng|nhuong|bán lại|ban lai|để lại|de lai|chia lại|chia lai|pass lại|pass lai|pass rẻ|nhượng lại|nhuong lai|nhượng vé|pass vé|pass gấp|nhượng gấp)/i,
    
    // Negative keywords: Buyer / Need ticket / Buying requests to ignore
    negativeRegex: /(cần mua|can mua|tìm mua|tim mua|thu mua|cần tìm|can tim|tìm vé|tim ve|mua vé|mua ve|mua lại|ai có.*pass|ai pass|inbox giá mua|tìm pass|can pass|cần pass không|bán cho mình|ai nhượng không|mua giúp)/i,
    
    // Ticket tiers
    ticketTierRegex: /(vip\s*[a-z0-9]*|svip\s*[a-z0-9]*|vvip\s*[a-z0-9]*|cat\s*[1-8]|ga\s*[1-5]|gold\s*[0-9]*|silver\s*[0-9]*|diamond\s*[0-9]*|platinum\s*[0-9]*|ruby\s*[0-9]*|bronze\s*[0-9]*|khu\s*[a-z0-9]+|standing|seated|fanzone|khán đài|khan dai)/i,
    
    // Performance day
    dayRegex: /(day\s*[1-4]|d[1-4]|ngày\s*[1-4]|ngay\s*[1-4]|\b\d{1,2}\/\d{1,2}\b)/i,
    
    // Escrow & direct meet guarantee hints
    escrowRegex: /(dẫn vào sân|dan vao san|vào sân mới|thanh toán sau|gdtg|trực tiếp|gdtt|check in xong|giao dịch trung gian|giao dịch trực tiếp)/i,
    
    // Price hints
    priceRegex: /(?:giá|gia|pass|nhượng)?\s*(\d+(?:[.,]\d+)?)\s*(tr|triệu|trieu|k|m|củ|cu)\b|(\d{1,3}(?:[.,]\d{3})+)\s*(?:đ|vnd|vnđ)?/i,
  }
};

module.exports = config;
