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
 * System prompt instructing Gemini how to filter badminton pickup games and extract details
 */
const SYSTEM_INSTRUCTION = `Bạn là hệ thống AI phân tích thông minh chuyên giám sát các bài đăng và bình luận trong các hội nhóm Facebook giao lưu cầu lông tại Hà Nội.

NHIỆM VỤ CỦA BẠN:
1. Xác định xem nội dung có phải là bài đăng/bình luận TÌM NGƯỜI CHƠI CẦU LÔNG CÙNG (tuyển slot, tuyển vãng lai, tuyển cố định, ghép team, giao lưu cầu lông, thiếu chân, tìm bạn đánh cùng, pass lại giờ sân cầu lông...) hay không.
2. KIỂM TRA ĐỊA ĐIỂM / SÂN CẦU LÔNG (CỰC KỲ QUAN TRỌNG):
   Chỉ chấp nhận các bài có sân chơi thuộc đúng 3 khu vực sân mục tiêu sau:
   - Sân 120 Định Công / Sân Maxping Định Công (category: "120_DINH_CONG") - bao gồm teencode: 120 dc, 120dc, maxping, maxping định công, sân định công, ntđ định công...
   - Sân 488 Minh Khai (category: "488_MINH_KHAI") - bao gồm: 488 minh khai, 488 mk, 488mk, sân minh khai, sân 488...
   - Sân Tân Mai (category: "TAN_MAI") - bao gồm: tân mai, tan mai, sân tân mai, sân tm, trường tân mai, đền lừ...
   * QUY TẮC BẮT BUỘC: 
     - Tất cả các sân ở khu vực/quận khác (như Lê Văn Thiêm, Thanh Xuân, Cầu Giấy, Hà Đông, Đống Đa, Nam Từ Liêm, Tây Hồ, Long Biên...) hoặc bài không nêu rõ sân BẮT BUỘC gán locationCategory = "OTHER" và matchesTargetLocation = false.
     - KHÔNG mở rộng ra các quận lân cận. Chỉ chấp nhận đúng 3 cụm sân trên.
3. TRÍCH XUẤT CÀNG NHIỀU THÔNG TIN HỮU ÍCH CÀNG TỐT:
   - Sân / Địa điểm (venue): Tên sân cụ thể (ví dụ: Sân Maxping Định Công - Sân 8).
   - Thời gian (time): Giờ chơi, ca chơi, ngày chơi (ví dụ: 8:30 - 10:30 sáng mai, ca 20h-22h tối T2-T4 hàng tuần).
   - Số lượng người (slots): Cần tuyển thêm bao nhiêu người, sẵn có bao nhiêu (ví dụ: Cần 1 mảnh ghép / Sẵn 3 nam 4 nữ).
   - Giới tính (gender): Nam, Nữ, Nam/Nữ, Full nữ, v.v.
   - Trình độ (level): Y (Yếu), TBY (Trung bình yếu), TB (Trung bình), TB-, TB+, K (Khá), C (Cao)...
   - Loại cầu (shuttle): Pro X, TC 77, Ba Sao, Hải Yến, Cầu 98-99%, v.v.
   - Chi phí (fee): 35k, 65 cá (= 65.000đ), 50k, chia sân, v.v.
   - Liên hệ (contact): SĐT, Zalo, Inbox.
   - Ghi chú (notes): Vibe nhóm (ví dụ: vui vẻ hoà đồng, không drama, cố định...).
   - Tóm tắt (summary): 1 câu tóm tắt súc tích tiếng Việt đầy đủ thông tin cốt lõi.

QUY TẮC CHO BÌNH LUẬN (COMMENT):
- BỎ QUA các bình luận rác / cộc lốc / spam: chỉ có SĐT/Zalo ("0912...", "ib zalo"), chỉ giục inbox ("ib", "check ib", "chấm", "."), chỉ hỏi giá cộc lốc ("giá sao", "xin giá").
- CHẤP NHẬN bình luận cung cấp thông tin hữu ích: người vào chào slot ở các sân mục tiêu (ví dụ: "Bên mình còn 2 slot ca 20-22h sân 120 Định Công nhé...") hoặc người xin slot cụ thể phối hợp với ngữ cảnh bài gốc.

QUY TẮC LOẠI TRỪ (isBadmintonMatch = false):
- Bài đăng thuần túy bán đồ, thanh lý vợt, giày, quần áo, túi bao vợt, nhận căng cước / đan vợt mà KHÔNG tuyển người chơi.
- Bài tìm mua đồ thể thao.`;

/**
 * JSON Schema for analyzing a single post/comment
 */
const SINGLE_ITEM_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    isBadmintonMatch: {
      type: Type.BOOLEAN,
      description: 'True nếu bài đăng/bình luận tìm người chơi cầu lông cùng, tuyển slot giao lưu, ghép team hoặc pass giờ sân'
    },
    matchesTargetLocation: {
      type: Type.BOOLEAN,
      description: 'True nếu sân/địa điểm chơi là sân 120 Định Công / Maxping Định Công, 488 Minh Khai, hoặc Tân Mai (kể cả viết tắt/teencode). False nếu là sân ở khu vực khác (như Nguyễn Xiển, Cầu Giấy...) hoặc không rõ.'
    },
    locationCategory: {
      type: Type.STRING,
      description: '120_DINH_CONG | 488_MINH_KHAI | TAN_MAI | OTHER'
    },
    venue: {
      type: Type.STRING,
      description: 'Tên sân/địa chỉ cụ thể (ví dụ: Sân Maxping Định Công - Sân 8)'
    },
    time: {
      type: Type.STRING,
      description: 'Thời gian / ca chơi / ngày (ví dụ: 08:30 - 10:30 sáng mai, ca 20h-22h tối T2-T4)'
    },
    slots: {
      type: Type.STRING,
      description: 'Số lượng người cần tuyển hoặc sẵn có (ví dụ: Tìm thêm 1 mảnh ghép, Sẵn 3 nam 4 nữ)'
    },
    gender: {
      type: Type.STRING,
      description: 'Giới tính (ví dụ: Nam/Nữ, Nam, Nữ, Full nữ...)'
    },
    level: {
      type: Type.STRING,
      description: 'Trình độ (ví dụ: Y/TBY, Nam: TBY-TB+, TB-, v.v.)'
    },
    shuttle: {
      type: Type.STRING,
      description: 'Loại cầu (ví dụ: Pro X, TC 77, 98-99%, Hải Yến...)'
    },
    fee: {
      type: Type.STRING,
      description: 'Chi phí (ví dụ: 35k, 65 cá, chia sân...)'
    },
    contact: {
      type: Type.STRING,
      description: 'Thông tin liên hệ: Zalo/SĐT/Inbox'
    },
    notes: {
      type: Type.STRING,
      description: 'Ghi chú thêm về nhóm (ví dụ: Vui vẻ, không drama, cố định...)'
    },
    summary: {
      type: Type.STRING,
      description: 'Tóm tắt ngắn gọn 1 câu tiếng Việt đầy đủ thông tin chính'
    },
    confidence: {
      type: Type.STRING,
      description: 'HIGH, MEDIUM, hoặc LOW'
    },
    reason: {
      type: Type.STRING,
      description: 'Lý do xác định'
    }
  },
  required: ['isBadmintonMatch', 'matchesTargetLocation', 'summary', 'confidence']
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
          isBadmintonMatch: {
            type: Type.BOOLEAN,
            description: 'True nếu bài đăng/bình luận tìm người chơi cầu lông cùng'
          },
          matchesTargetLocation: {
            type: Type.BOOLEAN,
            description: 'True nếu sân chơi CHÍNH XÁC là 1 trong 3 sân: 120 Định Công/Maxping, 488 Minh Khai, hoặc Tân Mai. BẮT BUỘC trả về False nếu sân ở khu vực khác (như Phúc Long Lê Văn Thiêm, Cầu Giấy, Nguyễn Xiển...) hoặc không rõ.'
          },
          locationCategory: {
            type: Type.STRING,
            description: '120_DINH_CONG | 488_MINH_KHAI | TAN_MAI | OTHER (Tất cả sân ở nơi khác bắt buộc là OTHER)'
          },
          venue: {
            type: Type.STRING,
            description: 'Tên sân/địa chỉ'
          },
          time: {
            type: Type.STRING,
            description: 'Thời gian / ca chơi'
          },
          slots: {
            type: Type.STRING,
            description: 'Số lượng người tuyển/sẵn có'
          },
          gender: {
            type: Type.STRING,
            description: 'Giới tính'
          },
          level: {
            type: Type.STRING,
            description: 'Trình độ (Y, TBY, TB, K, C...)'
          },
          shuttle: {
            type: Type.STRING,
            description: 'Loại cầu'
          },
          fee: {
            type: Type.STRING,
            description: 'Chi phí'
          },
          contact: {
            type: Type.STRING,
            description: 'Liên hệ'
          },
          notes: {
            type: Type.STRING,
            description: 'Ghi chú'
          },
          summary: {
            type: Type.STRING,
            description: 'Tóm tắt 1 câu tiếng Việt'
          },
          confidence: {
            type: Type.STRING,
            description: 'HIGH, MEDIUM, hoặc LOW'
          },
          reason: {
            type: Type.STRING,
            description: 'Lý do'
          }
        },
        required: ['id', 'isBadmintonMatch', 'matchesTargetLocation', 'summary', 'confidence']
      }
    }
  },
  required: ['results']
};

/**
 * Formats an item into a structured prompt with parent post context
 */
function formatItemForPrompt(item, index = 0) {
  const cleanContent = (item.text || '').slice(0, 600);
  let text = `--- BÀI [${index + 1}] (ID: "${item.id}") ---\n`;
  text += `Loại: ${item.type === 'COMMENT' ? 'BÌNH LUẬN (COMMENT)' : 'BÀI VIẾT (POST)'}\n`;
  text += `Người đăng: ${item.authorName || 'Ẩn danh'}\n`;

  if (item.type === 'COMMENT') {
    if (item.parentPostText) {
      const parentSnippet = item.parentPostText.slice(0, 350);
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
    const prompt = `Phân tích đối tượng sau theo các quy tắc kiểm tra kèo cầu lông:\n\n${formatItemForPrompt(itemObj, 0)}`;

    let response = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await client.models.generateContent({
          model: config.gemini.model,
          contents: prompt,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseJsonSchema: SINGLE_ITEM_SCHEMA,
            abortSignal: AbortSignal.timeout(15000)
          }
        });
        if (response) break;
      } catch (callErr) {
        if (attempt < 2 && /503|429/i.test(callErr.message)) {
          await new Promise(r => setTimeout(r, 1500));
        } else {
          throw callErr;
        }
      }
    }

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

    const prompt = `Hãy phân tích đồng thời danh sách ${items.length} bài viết/bình luận dưới đây để lọc kèo cầu lông. Lưu ý: Chỉ đánh dấu matchesTargetLocation = true và locationCategory thuộc (120_DINH_CONG, 488_MINH_KHAI, TAN_MAI) nếu sân thuộc đúng 3 khu vực này. Nếu sân ở bất kỳ nơi nào khác (như Lê Văn Thiêm, Thanh Xuân, Cầu Giấy, Hà Đông...) thì matchesTargetLocation BẮT BUỘC là false và locationCategory = 'OTHER':\n\n${formattedList}`;

    let response = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        response = await client.models.generateContent({
          model: config.gemini.model,
          contents: prompt,
          config: {
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseJsonSchema: BATCH_ITEMS_SCHEMA,
            abortSignal: AbortSignal.timeout(25000)
          }
        });
        if (response) break;
      } catch (callErr) {
        if (attempt < 2 && /503|429/i.test(callErr.message)) {
          await new Promise(r => setTimeout(r, 1500));
        } else {
          throw callErr;
        }
      }
    }

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
  const tags = [];

  if (aiResult.locationCategory === '120_DINH_CONG') {
    tags.push('📍 120 Định Công');
  } else if (aiResult.locationCategory === '488_MINH_KHAI') {
    tags.push('📍 488 Minh Khai');
  } else if (aiResult.locationCategory === 'TAN_MAI') {
    tags.push('📍 Tân Mai');
  } else if (aiResult.venue) {
    tags.push(`📍 ${aiResult.venue.slice(0, 25)}`);
  } else {
    tags.push('🏸 CẦU LÔNG');
  }

  if (aiResult.time) tags.push(`⏰ ${aiResult.time.slice(0, 20)}`);
  if (aiResult.level) tags.push(`📊 ${aiResult.level.slice(0, 18)}`);
  if (aiResult.fee) tags.push(`💰 ${aiResult.fee}`);
  if (aiResult.shuttle) tags.push(`🪶 ${aiResult.shuttle.slice(0, 16)}`);
  if (aiResult.slots) tags.push(`👥 ${aiResult.slots.slice(0, 18)}`);

  return tags;
}

/**
 * Determines priority based on Gemini AI analysis
 * @param {object} aiResult 
 * @returns {string} 'HIGH' | 'NORMAL'
 */
function determineAiPriority(aiResult) {
  if (!aiResult) return 'NORMAL';
  const text = `${aiResult.time || ''} ${aiResult.slots || ''} ${aiResult.summary || ''}`.toLowerCase();
  if (text.includes('tối nay') || text.includes('sáng mai') || text.includes('gấp') || text.includes('cuối')) {
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

