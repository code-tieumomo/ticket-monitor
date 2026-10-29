const OpenAI = require('openai');
const config = require('./config');

let openaiClient = null;

/**
 * Returns the singleton instance of OpenAI client configured for Kira AI
 */
function getClient() {
  const apiKey = (config.kira && config.kira.apiKey) || (config.gemini && config.gemini.apiKey);
  if (!apiKey) {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      baseURL: (config.kira && config.kira.baseURL) || 'https://kiraai.vn/api/v1',
      apiKey: apiKey,
      timeout: 30000,
    });
  }
  return openaiClient;
}

/**
 * Check if Kira AI is enabled and has an API key configured
 */
function isAvailable() {
  const apiKey = (config.kira && config.kira.apiKey) || (config.gemini && config.gemini.apiKey);
  const enabled = (config.kira && config.kira.enabled !== undefined) ? config.kira.enabled : (config.gemini ? config.gemini.enabled : true);
  return Boolean(enabled && apiKey && apiKey.trim() !== '');
}

/**
 * System prompt instructing Kira AI how to filter badminton pickup games and extract details
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
- Bài tìm mua đồ thể thao.

ĐỊNH DẠNG TRẢ VỀ:
Bắt buộc trả về đúng định dạng JSON object hợp lệ.`;

/**
 * Safely extracts and parses JSON from AI response content
 */
function parseJsonResponse(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  let cleaned = rawText.trim();
  // Strip markdown code fences if present (e.g. ```json ... ```)
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Attempt to locate JSON boundary { ... }
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
      } catch {}
    }
    console.warn('[Kira AI] Không thể phân tích JSON từ phản hồi:', rawText.slice(0, 150));
    return null;
  }
}

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
 * Analyzes a single post or comment text with Kira AI
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
    
    const userPrompt = `Phân tích đối tượng sau theo các quy tắc kiểm tra kèo cầu lông:
${formatItemForPrompt(itemObj, 0)}

Bắt buộc trả về đúng định dạng JSON object sau:
{
  "isBadmintonMatch": boolean,
  "matchesTargetLocation": boolean,
  "locationCategory": "120_DINH_CONG" | "488_MINH_KHAI" | "TAN_MAI" | "OTHER",
  "venue": string,
  "time": string,
  "slots": string,
  "gender": string,
  "level": string,
  "shuttle": string,
  "fee": string,
  "contact": string,
  "notes": string,
  "summary": string,
  "confidence": "HIGH" | "MEDIUM" | "LOW",
  "reason": string
}`;

    let completion = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        completion = await client.chat.completions.create({
          model: config.kira.model,
          messages: [
            { role: 'system', content: SYSTEM_INSTRUCTION },
            { role: 'user', content: userPrompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1
        });
        if (completion && completion.choices && completion.choices[0]) break;
      } catch (callErr) {
        if (attempt < 2 && /503|429|timeout|ECONNRESET/i.test(callErr.message)) {
          await new Promise(r => setTimeout(r, 1500));
        } else {
          throw callErr;
        }
      }
    }

    if (!completion || !completion.choices || !completion.choices[0]) {
      return null;
    }

    const rawContent = completion.choices[0].message.content;
    return parseJsonResponse(rawContent);
  } catch (err) {
    console.warn(`[Kira AI] Lỗi phân tích bài viết:`, err.message);
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

    const prompt = `Hãy phân tích đồng thời danh sách ${items.length} bài viết/bình luận dưới đây để lọc kèo cầu lông.
LƯU Ý QUAN TRỌNG: Chỉ đánh dấu matchesTargetLocation = true và locationCategory thuộc (120_DINH_CONG, 488_MINH_KHAI, TAN_MAI) nếu sân thuộc đúng 3 khu vực này. Nếu sân ở bất kỳ nơi nào khác (như Lê Văn Thiêm, Thanh Xuân, Cầu Giấy, Hà Đông, Nguyễn Xiển...) thì matchesTargetLocation BẮT BUỘC là false và locationCategory = 'OTHER'.

Bắt buộc trả về đúng định dạng JSON:
{
  "results": [
    {
      "id": string,
      "isBadmintonMatch": boolean,
      "matchesTargetLocation": boolean,
      "locationCategory": "120_DINH_CONG" | "488_MINH_KHAI" | "TAN_MAI" | "OTHER",
      "venue": string,
      "time": string,
      "slots": string,
      "gender": string,
      "level": string,
      "shuttle": string,
      "fee": string,
      "contact": string,
      "notes": string,
      "summary": string,
      "confidence": "HIGH" | "MEDIUM" | "LOW",
      "reason": string
    }
  ]
}

Danh sách bài cần phân tích:
${formattedList}`;

    let completion = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        completion = await client.chat.completions.create({
          model: config.kira.model,
          messages: [
            { role: 'system', content: SYSTEM_INSTRUCTION },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1
        });
        if (completion && completion.choices && completion.choices[0]) break;
      } catch (callErr) {
        if (attempt < 2 && /503|429|timeout|ECONNRESET/i.test(callErr.message)) {
          await new Promise(r => setTimeout(r, 1500));
        } else {
          throw callErr;
        }
      }
    }

    if (!completion || !completion.choices || !completion.choices[0]) {
      return resultMap;
    }

    const rawContent = completion.choices[0].message.content;
    const parsed = parseJsonResponse(rawContent);

    if (parsed && Array.isArray(parsed.results)) {
      for (const res of parsed.results) {
        if (res && res.id) {
          resultMap.set(String(res.id), res);
        }
      }
    }
  } catch (err) {
    console.warn(`[Kira AI] Lỗi phân tích theo lô (${items.length} bài):`, err.message);
  }

  return resultMap;
}

/**
 * Converts Kira AI analysis result into formatted Telegram tags
 * @param {object} aiResult 
 * @returns {Array<string>}
 */
function formatAiTags(aiResult) {
  const tags = [];
  if (!aiResult) return tags;

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
 * Determines priority based on Kira AI analysis
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
  getClient,
  isAvailable,
  analyzeContent,
  analyzeBatch,
  formatAiTags,
  determineAiPriority,
  SYSTEM_INSTRUCTION
};
