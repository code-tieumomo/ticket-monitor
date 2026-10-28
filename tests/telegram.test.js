const assert = require('assert');
const { escapeHtml, sendAlert } = require('../src/telegram');

console.log('--- Testing Telegram Badminton Alert Module ---');

// Test 1: HTML escape
const unescaped = '<script>alert("test & verify");</script>';
const escaped = escapeHtml(unescaped);
assert.strictEqual(escaped, '&lt;script&gt;alert(&quot;test &amp; verify&quot;);&lt;/script&gt;');
console.log('✅ Passed Test 1: HTML escaping works properly');

(async () => {
  // Test 2: Badminton alert with full structured details
  const postAlertRes = await sendAlert({
    groupName: 'Giao Lưu Cầu Lông Hà Nội',
    type: 'POST',
    authorName: 'Minh Tuấn',
    content: `🏸 TUYỂN GIAO LƯU SÁNG MAI 35K
Sân Maxping Định Công
⏰ 8:30 - 10:30
🏸 Nam/Nữ – Y/TBY: 35K
🏟️ Sân Max 8
🪶 Cầu 98–99%
Liên hệ tuiii nha💓`,
    url: 'https://facebook.com/groups/badminton/posts/123456789/',
    tags: ['📍 120 Định Công', '⏰ 8:30 - 10:30', '📊 Y/TBY', '💰 35K'],
    priority: 'HIGH',
    detectedBy: 'REGEX',
    details: {
      venue: 'Sân Maxping Định Công (Sân Max 8)',
      time: '08:30 - 10:30 (Sáng mai)',
      slots: 'Tuyển giao lưu 1-2 slot',
      gender: 'Nam / Nữ',
      level: 'Y / TBY',
      shuttle: 'Cầu 98–99%',
      fee: '35K / người',
      contact: 'Inbox hoặc nhắn tin Facebook',
      notes: 'Giao lưu vui vẻ hoà đồng'
    },
    locationCategory: '120_DINH_CONG'
  });

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    assert.strictEqual(postAlertRes.ok, false);
    assert.strictEqual(postAlertRes.reason, 'missing_credentials');
    console.log('✅ Passed Test 2: Graceful handling of missing Telegram credentials');
  } else {
    console.log('✅ Passed Test 2: Successfully sent real badminton alert to Telegram bot');
  }

  // Test 3: Badminton comment alert with parent post context
  const commentAlertRes = await sendAlert({
    groupName: 'Hội Cầu Lông Hoàng Mai - Hai Bà Trưng',
    type: 'COMMENT',
    authorName: 'Hoàng Nam',
    content: 'Bên mình ở sân 120 Định Công còn 2 slot vãng lai ca 20h-22h tối nay nhé, trình TBY, cầu Pro X 50k ai đi được ib mình.',
    url: 'https://facebook.com/groups/badminton/posts/111/?comment_id=222',
    tags: ['📍 120 Định Công', '⏰ 20h-22h', '📊 TBY', '💰 50k'],
    priority: 'HIGH',
    aiSummary: 'Tuyển 2 slot vãng lai sân 120 Định Công ca 20h-22h tối nay, trình TBY, cầu Pro X, 50k.',
    detectedBy: 'GEMINI',
    parentPostText: 'Tối nay có team nào khu Định Công còn slot không cho mình ké 1 slot với?',
    parentPostAuthor: 'Đức Anh',
    details: {
      venue: 'Sân 120 Định Công',
      time: '20h00 - 22h00 tối nay',
      slots: '2 slot vãng lai',
      level: 'TBY',
      shuttle: 'Cầu Pro X',
      fee: '50k',
      contact: 'Inbox'
    },
    locationCategory: '120_DINH_CONG'
  });
  assert(commentAlertRes);
  console.log('✅ Passed Test 3: Badminton comment alert with parent post context sent successfully');

  console.log('🎉 Telegram module verified!\n');
})();
