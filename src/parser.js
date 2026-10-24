const config = require('./config');

/**
 * Parses and analyzes Facebook post or comment text
 * @param {string} text Raw text of post or comment
 * @returns {object} Analysis result
 */
function parseContent(text) {
  if (!text || typeof text !== 'string') {
    return {
      isMatch: false,
      reason: 'empty_text',
      tags: [],
      priority: 'LOW',
      details: {}
    };
  }

  const cleanText = text.trim();
  const lowerText = cleanText.toLowerCase();

  // 1. Check Negative Keywords (Buyer intent: Cần mua, Tìm mua, etc.)
  // Handle edge-case: "cần pass", "cần nhượng", "cần bán" is a SELL action, NOT a buy action!
  const hasSellAction = config.rules.sellActionRegex.test(lowerText);
  const matchesNegative = config.rules.negativeRegex.test(lowerText);

  // If text matches negative keywords, verify it's not a positive seller saying "cần pass vé"
  if (matchesNegative) {
    const isSellerWithCan = /(cần|can)\s+(pass|nhượng|nhuong|bán|ban|để lại|de lai)/i.test(lowerText);
    const isAskingBuyer = /(ai pass|ai có.*pass|tìm mua|cần mua|thu mua|mua vé)/i.test(lowerText);

    if (!isSellerWithCan || isAskingBuyer) {
      return {
        isMatch: false,
        reason: 'negative_intent_buyer',
        tags: [],
        priority: 'LOW',
        details: {}
      };
    }
  }

  // 2. Must match at least one sell action
  if (!hasSellAction) {
    return {
      isMatch: false,
      reason: 'no_sell_action',
      tags: [],
      priority: 'LOW',
      details: {}
    };
  }

  // 3. Extract Ticket Tiers
  const tierMatch = cleanText.match(config.rules.ticketTierRegex);
  let tier = null;
  if (tierMatch) {
    tier = tierMatch[0].toUpperCase().replace(/\s+/g, ' ').replace(/([A-Z]+)(\d+)/g, '$1 $2');
  }

  // 4. Extract Performance Day
  const dayMatch = cleanText.match(config.rules.dayRegex);
  let day = null;
  if (dayMatch) {
    const rawDay = dayMatch[0];
    if (/^d\s*[1-4]$/i.test(rawDay)) {
      day = `Day ${rawDay.replace(/\D/g, '')}`;
    } else if (/^day\s*[1-4]$/i.test(rawDay)) {
      day = `Day ${rawDay.replace(/\D/g, '')}`;
    } else if (/^ng[aà]y\s*[1-4]$/i.test(rawDay)) {
      day = `Ngày ${rawDay.replace(/\D/g, '')}`;
    } else {
      day = rawDay;
    }
  }

  // 5. Extract Escrow / Safety Hints
  const escrowMatch = cleanText.match(config.rules.escrowRegex);
  const escrow = escrowMatch ? escrowMatch[0] : null;

  // 6. Extract Price Hints
  const priceMatch = cleanText.match(config.rules.priceRegex);
  let price = null;
  if (priceMatch) {
    price = priceMatch[0].trim();
  }

  // 7. General Ticket context check (e.g. mentions vé, ticket, slot, concert, tier, or day)
  const hasTicketContext = /(vé|ve|ticket|slot|ghế|ghe|seat|vào sân|vao san|sân|san|concert|show|cat|vip|ga|fanzone)/i.test(lowerText);

  // If there is no tier and no day and no ticket context, it might be unrelated goods (e.g. pass áo, pass đồ)
  if (!tier && !day && !hasTicketContext) {
    return {
      isMatch: false,
      reason: 'unrelated_goods',
      tags: [],
      priority: 'LOW',
      details: {}
    };
  }

  // 8. Build Tags
  const tags = ['🏷️ PASS VÉ'];
  if (tier) tags.push(`🎟️ ${tier}`);
  if (day) tags.push(`📅 ${day}`);
  if (price) tags.push(`💰 ${price}`);
  if (escrow) tags.push(`🛡️ ${escrow}`);

  // 9. Determine Priority
  let priority = 'NORMAL';
  if (escrow && (tier || day)) {
    priority = 'HIGH'; // Escrow / direct meet + clear tier = top priority
  } else if (!tier && !day) {
    priority = 'LOW';
  }

  return {
    isMatch: true,
    reason: 'matched',
    tags,
    priority,
    details: {
      tier,
      day,
      price,
      escrow
    }
  };
}

module.exports = { parseContent };
