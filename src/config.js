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
  kira: {
    baseURL: process.env.KIRA_BASE_URL || 'https://kiraai.vn/api/v1',
    apiKey: process.env.KIRA_API_KEY || 'kira_05998b609d5de73f5aaf084cfe1ac209',
    model: process.env.KIRA_MODEL || 'kira-2.5-flash',
    enabled: process.env.ENABLE_KIRA !== 'false' && process.env.ENABLE_AI !== 'false',
    mode: process.env.KIRA_MODE || process.env.AI_MODE || 'smart', // 'smart' (AI checks to extract info & avoid missing matches) | 'all'
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    enabled: process.env.ENABLE_GEMINI !== 'false',
    mode: process.env.GEMINI_MODE || 'smart',
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
  filterByTargetLocation: process.env.FILTER_BY_TARGET_LOCATION !== 'false', // Default true: filter 120 Dinh Cong, 488 Minh Khai, Tan Mai
  targetVenues: [
    {
      id: '120_DINH_CONG',
      name: 'Sân 120 Định Công / Maxping',
      displayTag: '📍 120 Định Công',
      // Handles 120 định công, 120 dc, 120dc, maxping, maxping định công, sân định công, etc.
      regex: /(120\s*(?:định\s*công|dinh\s*cong|đc|dc)|maxping|max\s*ping|(?:sân|san|khu|khu\s*vực)\s*(?:định\s*công|dinh\s*cong|đc|dc)|nhà\s*thi\s*đấu\s*định\s*công|ntđ\s*định\s*công|ntd\s*dinh\s*cong|\bđịnh\s*công\b|\bdinh\s*cong\b)/i
    },
    {
      id: '488_MINH_KHAI',
      name: 'Sân 488 Minh Khai',
      displayTag: '📍 488 Minh Khai',
      // Handles 488 minh khai, 488 mk, 488mk, sân minh khai, sân mk, etc.
      regex: /(488\s*(?:minh\s*khai|minhkhai|mk)|(?:sân|san|khu|khu\s*vực)\s*(?:488|minh\s*khai|minhkhai|mk)|\bminh\s*khai\b|\bminhkhai\b)/i
    },
    {
      id: 'TAN_MAI',
      name: 'Sân Tân Mai',
      displayTag: '📍 Tân Mai',
      // Handles tân mai, tan mai, sân tân mai, sân tm, đền lừ, etc.
      regex: /(tân\s*mai|tan\s*mai|(?:sân|san|khu|khu\s*vực)\s*(?:tm|tân\s*mai|tan\s*mai)|trường\s*tân\s*mai|đền\s*lừ|den\s*lu)/i
    }
  ],
  rules: {
    // Intent: Recruitment / Looking for players / Friendly match / Joining games
    badmintonActionRegex: /(tuyển|tuyen|tìm|tim|cần|can|ghép|ghep|thiếu|thieu|giao\s*lưu|giao\s*luu|\bgl\b|\bglcl\b|vãng\s*lai|vang\s*lai|cố\s*định|co\s*dinh|mảnh\s*ghép|manh\s*ghep|\bslot\b|chân\s*cầu|chân\s*đánh|bạn\s*chơi|bạn\s*đánh|thành\s*viên|đánh\s*cùng|chơi\s*cùng|tham\s*gia|lập\s*team|rủ\s*đánh|mở\s*rộng\s*quy\s*mô)/i,

    // Badminton Context: Court, birdie, rackets, sessions, etc.
    badmintonContextRegex: /(cầu\s*lông|cau\s*long|sân|san\b|ca\s*\d|slot|\bvợt\b|vot\b|\bcầu\b|cau\b|set|séc|đánh\s*đôi|đơn|nam\s*nữ|tby|tb-|tb\+|tb\b|\b65\s*cá\b|\bpro\s*x\b|tc\s*77)/i,

    // Pure equipment sales/repair to ignore (unless there's an actual match recruitment)
    equipmentOnlyRegex: /^(?:(?:pass|bán|thanh\s*lý|mua|cần\s*mua|căng\s*cước|đan|sửa|hàn)\s*(?:vợt|giày|áo|quần|túi|bao\s*vợt|balo|cước|quấn\s*cán|yonex|lining|victor|mizuno))/i,

    // Badminton skill level:
    // With prefix (trình/level/rank...): can match any level specification like Tby, Tb-, C, K, Y, TB...
    // Without prefix: only matches unambiguous multi-char terms (y/tby, tby, tb-, tb+, tb, trung bình, khá, yếu) - NEVER isolated single letters (c, k, y)
    levelRegex: /(?:trình\s*độ|trình|level|rank|trinh\s*do)\s*[:\-–]?\s*([a-zA-Z0-9\s/+\-,±–]+?)(?=\n|$|,|\.|!|🏸|⏰|💰)|(\b(?:y\/tby|tby\s*[-–]\s*tb\+?|yếu|trung\s*bình\s*yếu|trung\s*bình|khá|tb[-+±]?|tby)\b)/i,

    // Time & Playing hours: e.g. 20h-22h, 20h00-22h00, 8:30 - 10:30, ca 0-2h, sáng mai, tối T2-T4...
    timeRegex: /(\b(?:\d{1,2}h(?:\d{2})?|\d{1,2}:\d{2})\s*(?:-|đến|to|–)\s*(?:\d{1,2}h(?:\d{2})?|\d{1,2}:\d{2})\b|\bca\s*\d{1,2}(?:h)?\s*[-–]\s*\d{1,2}(?:h)?\b|(?:sáng|trưa|chiều|tối|đêm)\s*(?:nay|mai|kia|\b(?:t[2-7]|cn|thứ\s*[2-7]|chủ\s*nhật)\b)|(?:thứ\s*[2-7]|chủ\s*nhật|t[2-7])\s*[-–]\s*(?:thứ\s*[2-7]|t[2-7])\s*(?:hàng\s*tuần)?)/i,

    // Shuttlecock type: Pro X, TC 77, Hải Yến, Ba Sao, Thành Công, 98-99%, etc.
    shuttleRegex: /(?:cầu|cau)\s*[:\-–]?\s*([a-zA-Z0-9\s%–-]+?(?=\n|$|,|\.|–|!|📱|🏸|⏰|💰))|(?:cầu\s*(?:pro\s*x|tc\s*77|tc77|hải\s*yến|thành\s*công|ba\s*sao|vina\s*star|lht|98\s*[-–]\s*99%|98%|99%))|(?:pro\s*x|tc\s*77|tc77)/i,

    // Cost / Fee: 35k, 65 cá, 50k, chia sân, etc.
    feeRegex: /(\d+\s*(?:k|cá|ca|nghìn|ngàn|đ|vnd|vnđ)\b|chia\s*sân|share\s*bill|tiền\s*sân\s*\+\s*cầu)/i,

    // Gender breakdown
    genderRegex: /(full\s*nữ|nam\s*\/?\s*nữ|nam|nữ)/i,

    // Slots needed / available
    slotsRegex: /(sẵn\s*\d+\s*nam\s*\d+\s*nữ|\d+\s*(?:nam|nữ)|(?:tìm|tuyển|cần|thiếu)\s*(?:thêm\s*)?(\d+)\s*(?:mảnh\s*ghép|slot|sl|người|bạn|thành\s*viên|vãng\s*lai|chân|cố\s*định)|(\d+)\s*(?:slot|sl|mảnh\s*ghép|vãng\s*lai|cố\s*định))/i,

    // Contact info: SĐT, Zalo, Inbox
    contactRegex: /(?:zalo|sđt|sdt|liên\s*hệ|lh|hotline|call)\s*[:\-–]?\s*(\d{9,11})|(\b0[35789]\d{8}\b)|(?:inbox|ib\s*(?:em|mình|tui)?)/i
  }
};

module.exports = config;
