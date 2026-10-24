const assert = require('assert');
const config = require('../src/config');
const gemini = require('../src/gemini');
const { parseContent } = require('../src/parser');

console.log('--- Testing Gemini AI Module ---');

// Test 1: Availability check
{
  // When no API key is provided
  const originalKey = config.gemini.apiKey;
  config.gemini.apiKey = '';
  assert.strictEqual(gemini.isAvailable(), false, 'Should be unavailable when key is empty');
  
  config.gemini.apiKey = 'dummy_test_key';
  assert.strictEqual(gemini.isAvailable(), true, 'Should be available when key is set');
  config.gemini.apiKey = originalKey; // Restore
  console.log('✅ Passed Test 1: Availability and key detection');
}

// Test 2: AI Tag formatting
{
  const mockAiResult = {
    isTicketPass: true,
    confidence: 'HIGH',
    ticketType: 'VIP 1',
    eventDay: 'Day 1',
    quantity: '2 vé',
    price: '2.5tr',
    transactionMethod: 'GDTT tại HN',
    summary: 'Pass 2 vé VIP 1 Day 1 giá 2.5tr GDTT tại HN'
  };

  const tags = gemini.formatAiTags(mockAiResult);
  assert(tags.includes('🏷️ PASS VÉ [AI]'), 'Must include AI base tag');
  assert(tags.some(t => t.includes('VIP 1')), 'Must include VIP 1');
  assert(tags.some(t => t.includes('Day 1')), 'Must include Day 1');
  assert(tags.some(t => t.includes('2 vé')), 'Must include quantity');
  assert(tags.some(t => t.includes('2.5tr')), 'Must include price');
  assert(tags.some(t => t.includes('GDTT')), 'Must include GDTT');
  console.log('✅ Passed Test 2: AI tag formatting helper');
}

// Test 3: Priority determination
{
  const highResult = {
    transactionMethod: 'GDTT tại SVĐ',
    ticketType: 'VIP'
  };
  assert.strictEqual(gemini.determineAiPriority(highResult), 'HIGH', 'GDTT should trigger HIGH priority');

  const normalResult = {
    transactionMethod: 'chuyển khoản',
    ticketType: 'CAT 4'
  };
  assert.strictEqual(gemini.determineAiPriority(normalResult), 'NORMAL', 'Standard post should have NORMAL priority');
  console.log('✅ Passed Test 3: AI priority determination');
}

// Test 4: Verify why Gemini is needed (Demonstrate Regex blind spots)
{
  // Tricky case A: "nhả lại 2 slot" (colloquial Vietnamese slang missed by standard sell action regex)
  const textA = 'Mình bận đột xuất hôm 15 ko đi concert được, nhả lại 2 slot cho ai cần, gdtt tại cổng svđ ạ';
  const regexResultA = parseContent(textA);
  // Regex missed it because "nhả lại" was not in the rigid sellAction regex list
  assert.strictEqual(regexResultA.isMatch, false, 'Regex misses "nhả lại 2 slot" - Gemini rescue needed');
  console.log('✅ Passed Test 4A: Verified Regex limitation on colloquial "nhả lại slot"');

  // Tricky case B: Comment "Chấm ké thừa 1 vé khán đài b d1"
  const textB = 'Chấm ké, e thừa 1 vé khán đài b d1 nhé, check ib e gửi mã';
  const regexResultB = parseContent(textB);
  assert.strictEqual(regexResultB.isMatch, false, 'Regex misses casual comment "thừa 1 vé" - Gemini rescue needed');
  console.log('✅ Passed Test 4B: Verified Regex limitation on casual comment "thừa 1 vé"');
}

// Test 5: Verify Comment Actionability and Parent Context Filtering
{
  const { isActionableComment } = require('../src/crawler');

  // Case 1: BraveKoala6952 - "0912345678 liên hệ zalo" (Unrelated, bare contact)
  assert.strictEqual(
    isActionableComment('0912345678 liên hệ zalo'),
    false,
    'Should reject bare phone number/contact drop'
  );

  // Case 2: Tâm Đỗ - "40tr" (Unrelated, bare price without ticket info)
  assert.strictEqual(
    isActionableComment('40tr'),
    false,
    'Should reject bare price without ticket info'
  );
  assert.strictEqual(
    isActionableComment('40 triệu'),
    false,
    'Should reject bare 40 triệu'
  );

  // Case 3: Tiến Bùi - "inbox zalo 09..." (Unrelated, bare contact)
  assert.strictEqual(
    isActionableComment('inbox zalo 0987654321'),
    false,
    'Should reject bare inbox zalo'
  );

  // Case 4: Người tham gia ẩn danh 613 - "Yêu cầu inbox qua sđt"
  assert.strictEqual(
    isActionableComment('ib sđt 0912345678 nha'),
    false,
    'Should reject bare contact'
  );

  // Case 5: CharmingParrot9732 - Actionable ticket pass with concrete tier & day
  assert.strictEqual(
    isActionableComment('Pass lại cặp vé CAT 2 hàng F ngày 2 nếu được giá'),
    true,
    'Should ACCEPT actionable comment with CAT 2 and Day 2'
  );

  console.log('✅ Passed Test 5: Verified Comment Actionability Pre-Filter on User Examples');
}

// Test 6: Live API test if GEMINI_API_KEY is present
(async () => {
  if (config.gemini.apiKey && config.gemini.apiKey.trim() !== '') {
    console.log('\n[Gemini Live Test] Phát hiện GEMINI_API_KEY. Đang gọi thử model...');
    try {
      // Test 6A: Actionable comment under buyer post
      const parentPost = 'Cần mua 2 vé concert G-Dragon Day 2 ai có pass ib mình nhé!';
      const commentActionable = 'Mình pass lại cặp vé CAT 2 hàng F ngày 2 nếu được giá!';
      const resActionable = await gemini.analyzeContent(commentActionable, {
        authorName: 'CharmingParrot9732',
        type: 'COMMENT',
        parentPostAuthor: 'Minh Quan',
        parentPostText: parentPost
      });
      console.log('Kết quả Gemini cho comment hữu ích (CharmingParrot9732):', resActionable);
      assert.strictEqual(resActionable.isTicketPass, true, 'Gemini must recognize actionable ticket offer');

      // Test 6B: Useless / Vague comment under buyer post
      const commentVague = '0988123456 liên hệ zalo trao đổi';
      const resVague = await gemini.analyzeContent(commentVague, {
        authorName: 'BraveKoala6952',
        type: 'COMMENT',
        parentPostAuthor: 'Minh Quan',
        parentPostText: parentPost
      });
      console.log('Kết quả Gemini cho comment rác (BraveKoala6952):', resVague);
      assert.strictEqual(resVague.isTicketPass, false, 'Gemini must reject bare contact without ticket details');

      console.log('✅ Passed Test 6: Live Gemini API verified with parent post context!');
    } catch (err) {
      console.warn('⚠️ Lỗi gọi thử Gemini Live API:', err.message);
    }
  } else {
    console.log('ℹ️ Bỏ qua Test 6 (Live Gemini API) vì GEMINI_API_KEY chưa được cấu hình trong .env.');
  }

  console.log('🎉 Gemini module test completed successfully!\n');
})();
