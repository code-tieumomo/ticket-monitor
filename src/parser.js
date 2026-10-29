const config = require('./config');

/**
 * Normalizes Vietnamese text by removing extra spaces and special diacritics where helpful
 */
function normalizeText(text = '') {
  return text
    .toLowerCase()
    .replace(/[\u200b-\u200f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Identifies if text matches any of the target badminton venues
 * @param {string} text 
 * @returns {{ matched: boolean, venue: object|null, matchedString: string|null }}
 */
function detectTargetVenue(text) {
  if (!text) return { matched: false, venue: null, matchedString: null };

  for (const venue of config.targetVenues) {
    const match = text.match(venue.regex);
    if (match) {
      return {
        matched: true,
        venue,
        matchedString: match[0]
      };
    }
  }

  return { matched: false, venue: null, matchedString: null };
}

/**
 * Extracts specific badminton venue name from text
 */
function extractVenueName(text, targetVenueObj = null) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  
  // Look for line mentioning sân, địa chỉ, maxping, định công, minh khai, tân mai
  const venueLine = lines.find(l => /(?:sân|san|địa\s*chỉ|dia\s*chi|maxping|120\s*định\s*công|488\s*minh\s*khai|tân\s*mai)/i.test(l));
  if (venueLine) {
    let clean = venueLine.replace(/^[🏸📍🏟️]*\s*(địa\s*chỉ|sân|san)\s*[:\-–]?\s*/i, '').trim();
    // If court number line exists (e.g. Sân Max 8 or Sân số 2)
    const courtNumLine = lines.find(l => /(?:sân|san)\s*(?:max\s*)?\d+/i.test(l) && l !== venueLine);
    if (courtNumLine) {
      const courtNum = courtNumLine.replace(/^[🏟️🏸]*\s*/i, '').trim();
      clean = `${clean} (${courtNum})`;
    }
    return clean;
  }

  if (targetVenueObj) {
    return targetVenueObj.name;
  }

  return null;
}

/**
 * Extracts detailed badminton parameters from text
 * @param {string} text 
 * @param {object} venueMatch 
 * @returns {object} Extracted parameters
 */
function extractBadmintonDetails(text, venueMatch = null) {
  const details = {
    venue: null,
    time: null,
    slots: null,
    gender: null,
    level: null,
    shuttle: null,
    fee: null,
    contact: null,
    notes: null
  };

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // 1. Venue
  details.venue = extractVenueName(text, venueMatch ? venueMatch.venue : null);

  // 2. Time / Ca chơi / Lịch
  let timeStr = null;
  const iconLine = lines.find(l => /⏰/.test(l));
  if (iconLine) {
    timeStr = iconLine.replace(/^[⏰🏸📍🏟️]*\s*(thời\s*gian|giờ\s*chơi|ca)?\s*[:\-–]?\s*/i, '').trim();
  } else {
    const dedicatedLine = lines.find(l => /^(?:thời\s*gian|giờ\s*chơi|ca\s*\d)\s*[:\-–]/i.test(l));
    if (dedicatedLine) {
      timeStr = dedicatedLine.replace(/^(?:thời\s*gian|giờ\s*chơi|ca\s*\d)\s*[:\-–]?\s*/i, '').trim();
    } else {
      const timePatternMatch = text.match(/(\b(?:\d{1,2}h(?:\d{2})?|\d{1,2}:\d{2})\s*[-–]\s*(?:\d{1,2}h(?:\d{2})?|\d{1,2}:\d{2})\b|\bca\s*\d{1,2}(?:h)?\s*[-–]\s*\d{1,2}(?:h)?\b)/i);
      if (timePatternMatch) {
        timeStr = timePatternMatch[0].trim();
      }
    }
  }

  const dayMatch = text.match(/\b(sáng\s*mai|tối\s*nay|chiều\s*nay|trưa\s*nay|tối\s*mai|sáng\s*cn|t[2-7]\s*[-–]\s*t[2-7]\s*(?:hàng\s*tuần)?|chủ\s*nhật\s*ngày\s*\d{1,2}\/\d{1,2}(?:\/\d{4})?)\b/i);
  if (dayMatch && timeStr && !timeStr.toLowerCase().includes(dayMatch[0].toLowerCase())) {
    timeStr = `${timeStr} (${dayMatch[0]})`;
  }
  details.time = timeStr;

  // 3. Level (Trình độ)
  const levelLines = lines.filter(l => /(?:y\/tby|tby\b|tb[-+±]?\b|💕.*y|👱🏻.*tb|trình|level|rank|trung\s*bình)/i.test(l) && !/(sân|địa\s*chỉ|chịu\s*được)/i.test(l));
  if (levelLines.length > 0) {
    details.level = levelLines
      .map(l => l.replace(/^[💕👱🏻♂️🏸*•-]*\s*/i, '').replace(/:\s*\d+\s*k/i, '').trim())
      .filter(Boolean)
      .join(' | ');
  } else {
    const lm = text.match(config.rules.levelRegex);
    if (lm) {
      const val = (lm[1] || lm[2] || lm[0]).trim();
      // Guard against false positive single letters or venue names
      if (val && !/^(?:sân|định|công|minh|khai|tân|mai|c|k|y)$/i.test(val)) {
        details.level = val;
      }
    }
  }

  // 4. Shuttlecock (Loại cầu)
  const shuttleLine = lines.find(l => /(?:🪶|đánh\s*cầu|cầu\s*[:\-–]?)\s*(?:pro\s*x|tc|hải\s*yến|thành\s*công|ba\s*sao|98|vina|lht|[a-z0-9]+)/i.test(l) && !/cầu\s*lông/i.test(l));
  if (shuttleLine) {
    details.shuttle = shuttleLine.replace(/^[🪶*•-]*\s*(đánh\s*)?/i, '').trim();
  } else {
    const sm = text.match(config.rules.shuttleRegex);
    if (sm) details.shuttle = sm[0].trim();
  }

  // 5. Fee (Chi phí)
  const feeMatch = text.match(config.rules.feeRegex);
  if (feeMatch) {
    details.fee = feeMatch[0].trim();
  }

  // 6. Slots (Số lượng người)
  const slotLine = lines.find(l => /(sẵn\s*\d|tìm\s*(?:thêm)?\s*\d|tuyển\s*(?:thêm\s*)?\d|mảnh\s*ghép|thiếu\s*(?:nhân\s*lực|\d)|cần\s*\d|\d+\s*(?:slot|sl)\b)/i.test(l));
  if (slotLine) {
    const slotMatch = slotLine.match(/(?:tìm|tuyển|cần|thiếu|sẵn)\s*(?:thêm\s*)?\d+\s*(?:slot|sl|mảnh\s*ghép|người|chân|vãng\s*lai)?|\d+\s*(?:slot|sl)\b/i);
    details.slots = slotMatch ? slotMatch[0].trim() : slotLine.replace(/^[🌸🏸*•-]*\s*/i, '').trim();
  } else {
    const slm = text.match(config.rules.slotsRegex);
    if (slm) details.slots = slm[0].trim();
  }

  // 7. Gender (Giới tính)
  const genderMatch = text.match(config.rules.genderRegex);
  if (genderMatch) {
    details.gender = genderMatch[0].trim();
  }

  // 8. Contact
  const contactLine = lines.find(l => /(zalo|sđt|sdt|liên\s*hệ|hotline|ib\s*em|inbox|nhắn\s*tin)/i.test(l));
  if (contactLine) {
    details.contact = contactLine.replace(/^(?:📲|📱)?\s*/g, '').trim();
  } else {
    const cm = text.match(config.rules.contactRegex);
    if (cm) details.contact = cm[0].trim();
  }

  return details;
}

/**
 * Parses and analyzes Facebook post or comment text for Badminton pickup matches
 * @param {string} text Raw text of post or comment
 * @param {object} meta Optional metadata (e.g. parentPostText)
 * @returns {object} Analysis result
 */
function parseContent(text, meta = {}) {
  if (!text || typeof text !== 'string') {
    return {
      isMatch: false,
      isBadminton: false,
      matchesLocation: false,
      reason: 'empty_text',
      tags: [],
      priority: 'LOW',
      details: {}
    };
  }

  const cleanText = text.trim();
  const lowerText = cleanText.toLowerCase();

  // Combine with parent post text if this is a comment
  const combinedText = meta.parentPostText 
    ? `${meta.parentPostText}\n\n[Bình luận]: ${cleanText}` 
    : cleanText;
  const lowerCombined = combinedText.toLowerCase();

  // 1. Check for pure equipment sales without game intent
  const isEquipmentOnly = config.rules.equipmentOnlyRegex.test(lowerText) && 
    !/(tuyển|giao lưu|slot|đánh cùng|sân)/i.test(lowerText);
  if (isEquipmentOnly) {
    return {
      isMatch: false,
      isBadminton: false,
      matchesLocation: false,
      reason: 'equipment_only',
      tags: [],
      priority: 'LOW',
      details: {}
    };
  }

  // 2. Check Badminton context & intent
  const hasBadmintonAction = config.rules.badmintonActionRegex.test(lowerCombined);
  const hasBadmintonContext = config.rules.badmintonContextRegex.test(lowerCombined);
  const isBadminton = hasBadmintonAction || hasBadmintonContext;

  if (!isBadminton) {
    return {
      isMatch: false,
      isBadminton: false,
      matchesLocation: false,
      reason: 'no_badminton_context',
      tags: [],
      priority: 'LOW',
      details: {}
    };
  }

  // 3. Location detection (120 Định Công, 488 Minh Khai, Tân Mai)
  // Check both current item text and combined text
  let venueMatch = detectTargetVenue(cleanText);
  if (!venueMatch.matched && meta.parentPostText) {
    venueMatch = detectTargetVenue(meta.parentPostText);
  }

  const matchesLocation = venueMatch.matched;
  const details = extractBadmintonDetails(cleanText, venueMatch);

  // 4. Decision: If filterByTargetLocation is on, we only match if venue matches target
  const isMatch = config.filterByTargetLocation ? matchesLocation : isBadminton;

  // 5. Build informative Tags
  const tags = [];
  if (venueMatch.matched && venueMatch.venue) {
    tags.push(venueMatch.venue.displayTag);
  } else if (details.venue) {
    tags.push(`📍 ${details.venue.slice(0, 25)}`);
  } else {
    tags.push('🏸 CẦU LÔNG');
  }

  if (details.time) {
    tags.push(`⏰ ${details.time.slice(0, 20)}`);
  }
  if (details.level) {
    tags.push(`📊 ${details.level.slice(0, 18)}`);
  }
  if (details.fee) {
    tags.push(`💰 ${details.fee}`);
  }
  if (details.shuttle) {
    tags.push(`🪶 ${details.shuttle.slice(0, 16)}`);
  }

  // 6. Priority: HIGH if urgent / happening today or tonight, or clearly at target venue
  let priority = 'NORMAL';
  if (matchesLocation && /(tối nay|sáng mai|chiều nay|gấp|thiếu 1|mảnh ghép cuối)/i.test(lowerText)) {
    priority = 'HIGH';
  }

  return {
    isMatch,
    isBadminton,
    matchesLocation,
    venueCategory: venueMatch.matched && venueMatch.venue ? venueMatch.venue.id : null,
    reason: isMatch ? 'matched' : (isBadminton ? 'unmatched_location' : 'no_badminton_context'),
    tags,
    priority,
    details
  };
}

module.exports = {
  parseContent,
  detectTargetVenue,
  extractVenueName,
  extractBadmintonDetails,
  normalizeText
};

