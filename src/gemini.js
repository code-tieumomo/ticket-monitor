const { GoogleGenAI, Type } = require('@google/genai');
const config = require('./config');

let aiClient = null;

/**
 * Returns the singleton instance of GoogleGenAI client
 */
function getClient() {
  if (!config.gemini.apiKey) {
    return null;
  }
  if (!aiClient) {
    aiClient = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  }
  return aiClient;
}

/**
 * Check if Gemini is enabled and has an API key configured
 */
function isAvailable() {
  return Boolean(config.gemini.enabled && config.gemini.apiKey && config.gemini.apiKey.trim() !== '');
}

/**
 * System prompt instructing Gemini how to filter ticket pass posts/comments in Vietnamese Facebook groups
 */
const SYSTEM_INSTRUCTION = `Bạn là hệ thống AI phân tích thông minh chuyên giám sát các bài đăng và bình luận trong các hội nhóm Facebook về concert, show âm nhạc (ví dụ: G-Dragon, Anh Trai Say Hi, Blackpink, Born Pink, concert Kpop/Vpop...).

NHIỆM VỤ CỦA BẠN:
Xác định chính xác xem nội dung có phải là người đang BÁN / PASS / NHƯỢNG / ĐỂ LẠI vé concert hay không, và thông tin đó có THẬT SỰ CẦN THIẾT & HỮU ÍCH để người mua quyết định mua vé hay không.

QUY TẮC ĐẶC BIỆT DÀNH CHO BÌNH LUẬN (COMMENT) - CỰC KỲ QUAN TRỌNG:
Một bình luận CHỈ ĐƯỢC COI LÀ PASS VÉ (isTicketPass = true) khi thỏa mãn TẤT CẢ các tiêu chí sau:
1. BÌNH LUẬN PHẢI CUNG CẤP THÔNG TIN VÉ CỤ THỂ, HỮU ÍCH CHO NGƯỜI MUA:
   - Bình luận phải nêu rõ ít nhất một trong các thông tin cụ thể: Hạng vé (CAT 1-8, VIP, GA, Stand, Seat...), hoặc Ngày diễn (Day 1, Day 2...), hoặc Số lượng/vị trí vé (ví dụ: "còn 1 cặp cat 2 hàng f", "mình dư 1 vé vip d1", "còn 2 slot fanzone", "pass lại vé khán đài b").
   - Người mua đọc bình luận phải biết được người này đang có vé gì để cân nhắc mua.
2. PHỐI HỢP VỚI NGỮ CẢNH BÀI VIẾT GỐC (PARENT POST):
   - Nếu bài viết gốc là người ĐI TÌM MUA VÉ (ví dụ: "Cần mua vé GD Day 2..."), và bình luận là người CHÀO BÁN VÉ CỤ THỂ (có hạng vé, ngày, số lượng) -> CHẤP NHẬN (isTicketPass = true).
   - Nếu bài viết gốc KHÔNG liên quan đến concert âm nhạc -> BỎ QUA MỌI BÌNH LUẬN BÊN DƯỚI (isTicketPass = false).
3. TUYỆT ĐỐI BỎ QUA (isTicketPass = false) CÁC LOẠI BÌNH LUẬN SAU:
   - Bình luận CHỈ ĐỂ LẠI SỐ ĐIỆN THOẠI hoặc ZALO mà KHÔNG CÓ THÔNG TIN VÉ CỤ THỂ (ví dụ: "0912345678", "ib zalo 09...", "liên hệ sđt e...", "chấm sđt"). Đây là spam hoặc mập mờ, KHÔNG hữu ích cho người mua.
   - Bình luận CHỈ GIỤC INBOX hoặc TRẢ LỜI CHUNG CHUNG (ví dụ: "check ib", "inbox mình", "rep ib", "chấm", "mình có ib nhé", "e có nhắn tin") mà KHÔNG nói rõ vé gì, hạng gì, ngày nào.
   - Bình luận CHỈ NÊU MỖI GIÁ TIỀN hoặc con số cộc lốc (ví dụ: "40tr", "40 triệu", "3tr", "1tr5", "giá sao", "xin giá").
   - Bình luận HỎI MUA VÉ hoặc hỏi thăm người đăng bài (ví dụ: "vé còn ko b", "giá bn vậy", "d1 hay d2").

QUY TẮC CHUNG CHO BÀI VIẾT (POST):
1. CHẤP NHẬN (isTicketPass = true):
   - Người đăng muốn bán lại, pass, nhượng lại vé concert, slot vào sân.
   - Nhận diện cả văn phong tự nhiên: "nhả vé", "nhả lại 2 slot", "thừa 1 vé", "dư 1 vé ai cần ib", "mình bận ko đi đc nhượng lại", "pass lỗ", "pass gốc", "để lại giá yêu thương"...
2. BỎ QUA (isTicketPass = false):
   - Người ĐI MUA, TÌM MUA vé (ví dụ: "cần mua vé", "tìm mua", "ai có pass không", "thu mua vé").
   - Pass đồ cá nhân KHÔNG PHẢI VÉ (áo concert, lightstick, banner, photocard...).
   - Bài cảnh báo lừa đảo (phốt scammer) mà không bán vé.
   - Bài chia sẻ cảm xúc, khoe vé, tìm bạn đi chung.

3. ĐỘ TIN CẬY (confidence):
   - "HIGH": Rõ ràng là pass vé có thông tin hạng vé/ngày/phương thức.
   - "MEDIUM": Ngữ cảnh ngầm hiểu là pass vé cụ thể, nhưng ít chi tiết.
   - "LOW": Khá mơ hồ hoặc không chắc chắn.`;

/**
 * JSON Schema for analyzing a single post/comment
 */
const SINGLE_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isTicketPass: {
      type: Type.BOOLEAN,
      description: 'True CHỈ KHI bài viết/bình luận thật sự bán/pass vé VÀ có thông tin vé cụ thể hữu ích cho người mua. Nếu là bình luận chỉ có SĐT, Zalo, giục inbox, hoặc giá tiền cộc lốc thì PHẢI để false.'
    },
    confidence: {
      type: Type.STRING,
      description: 'HIGH, MEDIUM, hoặc LOW'
    },
    ticketType: {
      type: Type.STRING,
      description: 'Hạng vé (ví dụ: CAT 1, VIP, GA 2, Fanzone...) hoặc để trống nếu không rõ'
    },
    eventDay: {
      type: Type.STRING,
      description: 'Ngày diễn (ví dụ: Day 1, Day 2, 25/10...) hoặc để trống nếu không rõ'
    },
    price: {
      type: Type.STRING,
      description: 'Giá vé hoặc giá thương lượng nếu có'
    },
    quantity: {
      type: Type.STRING,
      description: 'Số lượng vé (ví dụ: 1 vé, 2 vé, 1 cặp)'
    },
    transactionMethod: {
      type: Type.STRING,
      description: 'Phương thức giao dịch (ví dụ: GDTT, GDTG, trực tiếp, dẫn vào sân)'
    },
    summary: {
      type: Type.STRING,
      description: 'Tóm tắt ngắn gọn 1 câu tiếng Việt (ví dụ: Pass 2 vé CAT 4 Day 1 giá gốc GDTT tại HN)'
    },
    reason: {
      type: Type.STRING,
      description: 'Lý do ngắn gọn tại sao đây là bài pass vé hoặc không phải'
    }
  },
  required: ['isTicketPass', 'confidence', 'summary']
};

/**
 * JSON Schema for analyzing a batch of posts/comments in 1 call
 */
const BATCH_ITEMS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    results: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          id: {
            type: Type.STRING,
            description: 'ID của bài viết/bình luận tương ứng được gửi vào'
          },
          isTicketPass: {
            type: Type.BOOLEAN,
            description: 'True CHỈ KHI bài viết/bình luận thật sự bán/pass vé VÀ có thông tin vé cụ thể hữu ích cho người mua. Nếu là bình luận chỉ có SĐT, Zalo, giục inbox, hoặc giá tiền cộc lốc thì PHẢI để false.'
          },
          confidence: {
            type: Type.STRING,
            description: 'HIGH, MEDIUM, hoặc LOW'
          },
          ticketType: {
            type: Type.STRING,
            description: 'Hạng vé (ví dụ: CAT 1, VIP, GA 2...) hoặc để trống'
          },
          eventDay: {
            type: Type.STRING,
            description: 'Ngày diễn (ví dụ: Day 1, Day 2...) hoặc để trống'
          },
          price: {
            type: Type.STRING,
            description: 'Giá vé nếu có đề cập'
          },
          quantity: {
            type: Type.STRING,
            description: 'Số lượng vé (ví dụ: 1 vé, 2 vé)'
          },
          transactionMethod: {
            type: Type.STRING,
            description: 'Phương thức giao dịch (GDTT, GDTG, trực tiếp...)'
          },
          summary: {
            type: Type.STRING,
            description: 'Tóm tắt ngắn gọn 1 câu tiếng Việt'
          },
          reason: {
            type: Type.STRING,
            description: 'Lý do xác định'
          }
        },
        required: ['id', 'isTicketPass', 'confidence', 'summary']
      }
    }
  },
  required: ['results']
};

/**
 * Formats an item into a structured prompt with parent post context
 */
function formatItemForPrompt(item, index = 0) {
  const cleanContent = (item.text || '').slice(0, 500);
  let text = `--- BÀI [${index + 1}] (ID: "${item.id}") ---\n`;
  text += `Loại: ${item.type === 'COMMENT' ? 'BÌNH LUẬN (COMMENT)' : 'BÀI VIẾT (POST)'}\n`;
  text += `Người đăng: ${item.authorName || 'Ẩn danh'}\n`;

  if (item.type === 'COMMENT') {
    if (item.parentPostText) {
      const parentSnippet = item.parentPostText.slice(0, 300);
      text += `Ngữ cảnh bài viết gốc được bình luận vào:\n`;
      text += `  - Tác giả bài gốc: ${item.parentPostAuthor || 'Ẩn danh'}\n`;
      text += `  - Nội dung bài gốc: """${parentSnippet}"""\n`;
    }
    text += `Nội dung bình luận:\n"""${cleanContent}"""\n`;
  } else {
    text += `Nội dung bài viết:\n"""${cleanContent}"""\n`;
  }

  return text;
}

/**
 * Analyzes a single post or comment text with Gemini
 * @param {string} text 
 * @param {object} meta Optional metadata { type, authorName, parentPostText, parentPostAuthor }
 * @returns {Promise<object|null>}
 */
async function analyzeContent(text, meta = {}) {
  if (!isAvailable()) {
    return null;
  }

  const client = getClient();
  if (!client) return null;

  try {
    const itemObj = {
      id: meta.id || 'single_item',
      text,
      type: meta.type || 'POST',
      authorName: meta.authorName || 'Ẩn danh',
      parentPostText: meta.parentPostText,
      parentPostAuthor: meta.parentPostAuthor
    };
    const prompt = `Phân tích đối tượng sau theo các quy tắc nghiêm ngặt:\n\n${formatItemForPrompt(itemObj, 0)}`;

    const response = await client.models.generateContent({
      model: config.gemini.model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseJsonSchema: SINGLE_ITEM_SCHEMA,
        abortSignal: AbortSignal.timeout(12000)
      }
    });

    const parsed = JSON.parse(response.text);
    return parsed;
  } catch (err) {
    console.warn(`[Gemini AI] Lỗi phân tích bài viết:`, err.message);
    return null;
  }
}

/**
 * Analyzes a batch of posts or comments in a single API call for maximum speed and cost efficiency
 * @param {Array<{id: string, text: string, type: string, authorName: string, parentPostText?: string, parentPostAuthor?: string}>} items 
 * @returns {Promise<Map<string, object>>} Map from itemId to analysis result
 */
async function analyzeBatch(items = []) {
  const resultMap = new Map();
  if (!items || items.length === 0 || !isAvailable()) {
    return resultMap;
  }

  const client = getClient();
  if (!client) return resultMap;

  try {
    const formattedList = items.map((item, index) => formatItemForPrompt(item, index)).join('\n');

    const prompt = `Hãy phân tích đồng thời danh sách ${items.length} bài viết/bình luận dưới đây và trả về mảng kết quả tương ứng với từng ID:\n\n${formattedList}`;

    const response = await client.models.generateContent({
      model: config.gemini.model,
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: 'application/json',
        responseJsonSchema: BATCH_ITEMS_SCHEMA,
        abortSignal: AbortSignal.timeout(20000)
      }
    });

    const parsed = JSON.parse(response.text);
    if (parsed && Array.isArray(parsed.results)) {
      for (const res of parsed.results) {
        if (res && res.id) {
          resultMap.set(String(res.id), res);
        }
      }
    }
  } catch (err) {
    console.warn(`[Gemini AI] Lỗi phân tích theo lô (${items.length} bài):`, err.message);
  }

  return resultMap;
}

/**
 * Converts Gemini analysis result into formatted Telegram tags
 * @param {object} aiResult 
 * @returns {Array<string>}
 */
function formatAiTags(aiResult) {
  const tags = ['🏷️ PASS VÉ [AI]'];

  if (aiResult.ticketType) {
    tags.push(`🎟️ ${aiResult.ticketType.toUpperCase()}`);
  }
  if (aiResult.eventDay) {
    tags.push(`📅 ${aiResult.eventDay}`);
  }
  if (aiResult.quantity) {
    tags.push(`🔢 ${aiResult.quantity}`);
  }
  if (aiResult.price) {
    tags.push(`💰 ${aiResult.price}`);
  }
  if (aiResult.transactionMethod) {
    tags.push(`🛡️ ${aiResult.transactionMethod}`);
  }

  return tags;
}

/**
 * Determines priority based on Gemini AI analysis
 * @param {object} aiResult 
 * @returns {string} 'HIGH' | 'NORMAL'
 */
function determineAiPriority(aiResult) {
  if (!aiResult) return 'NORMAL';
  const method = (aiResult.transactionMethod || '').toLowerCase();
  const type = (aiResult.ticketType || '').toLowerCase();

  // Escrow or direct meetup or VIP ticket -> HIGH priority
  if (
    method.includes('gdtt') ||
    method.includes('trực tiếp') ||
    method.includes('gdtg') ||
    method.includes('trung gian') ||
    method.includes('dẫn vào') ||
    type.includes('vip') ||
    type.includes('svip')
  ) {
    return 'HIGH';
  }

  return 'NORMAL';
}

module.exports = {
  isAvailable,
  analyzeContent,
  analyzeBatch,
  formatAiTags,
  determineAiPriority,
  SYSTEM_INSTRUCTION,
  SINGLE_ITEM_SCHEMA,
  BATCH_ITEMS_SCHEMA
};
