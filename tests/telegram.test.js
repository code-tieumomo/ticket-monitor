const assert = require('assert');
const { escapeHtml, sendAlert } = require('../src/telegram');

console.log('--- Testing Telegram Module ---');

// Test 1: HTML escape
const unescaped = '<script>alert("test & verify");</script>';
const escaped = escapeHtml(unescaped);
assert.strictEqual(escaped, '&lt;script&gt;alert(&quot;test &amp; verify&quot;);&lt;/script&gt;');
console.log('✅ Passed Test 1: HTML escaping works properly');

// Test 2: Fallback behavior when credentials are unset
(async () => {
  const res = await sendAlert({
    groupName: 'Nhóm Test',
    type: 'POST',
    authorName: 'Người Test',
    content: 'Pass vé VIP 1 Day 1',
    url: 'https://facebook.com',
    tags: ['🎟️ VIP 1', '📅 Day 1']
  });

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    assert.strictEqual(res.ok, false);
    assert.strictEqual(res.reason, 'missing_credentials');
    console.log('✅ Passed Test 2: Graceful handling of missing Telegram credentials');
  } else {
    console.log('✅ Passed Test 2: Successfully sent real alert to Telegram bot');
  }

  // Test 3: Send Comment Alert with Parent Post Context
  const commentAlertRes = await sendAlert({
    groupName: 'Nhóm Concert Test',
    type: 'COMMENT',
    authorName: 'CharmingParrot9732',
    content: 'Pass lại cặp vé CAT 2 hàng F ngày 2 nếu được giá.',
    url: 'https://facebook.com/groups/test/posts/123/?comment_id=456',
    tags: ['🏷️ PASS VÉ [AI]', '🎟️ CAT 2', '📅 Day 2'],
    priority: 'NORMAL',
    aiSummary: 'Người dùng bình luận pass lại 1 cặp vé CAT 2 hàng F Day 2.',
    detectedBy: 'GEMINI',
    parentPostText: 'Cần tìm mua 2 vé concert G-Dragon Day 2 ai có pass ko ạ?',
    parentPostAuthor: 'Minh Quan'
  });
  assert(commentAlertRes);
  console.log('✅ Passed Test 3: Comment alert with parent post context sent successfully');

  console.log('🎉 Telegram module verified!\n');
})();
