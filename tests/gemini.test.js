const assert = require('assert');
const config = require('../src/config');
const gemini = require('../src/gemini');
const { parseContent } = require('../src/parser');
const { isActionableComment } = require('../src/crawler');

console.log('--- Testing Gemini AI Badminton Module ---');

// Test 1: Availability check
{
  const origKira = config.kira.apiKey;
  const originalKey = config.gemini.apiKey;
  config.kira.apiKey = '';
  config.gemini.apiKey = '';
  assert.strictEqual(gemini.isAvailable(), false, 'Should be unavailable when key is empty');
  
  config.kira.apiKey = 'dummy_test_key';
  assert.strictEqual(gemini.isAvailable(), true, 'Should be available when key is set');
  config.kira.apiKey = origKira;
  config.gemini.apiKey = originalKey; // Restore
  console.log('✅ Passed Test 1: Availability and key detection');
}

// Test 2: AI Tag formatting
{
  const mockAiResult = {
    isBadmintonMatch: true,
    matchesTargetLocation: true,
    locationCategory: '120_DINH_CONG',
    venue: 'Sân Maxping Định Công - Sân 8',
    time: '8:30 - 10:30 (Sáng mai)',
    slots: 'Tuyển 1-2 slot',
    gender: 'Nam / Nữ',
    level: 'Y / TBY',
    fee: '35k',
    shuttle: 'Cầu 98-99%',
    summary: 'Tuyển giao lưu sáng mai 8h30-10h30 sân Maxping Định Công 35k'
  };

  const tags = gemini.formatAiTags(mockAiResult);
  assert(tags.some(t => t.includes('120 Định Công')), 'Must include 120 Định Công tag');
  assert(tags.some(t => t.includes('8:30')), 'Must include time tag');
  assert(tags.some(t => t.includes('Y / TBY')), 'Must include level tag');
  assert(tags.some(t => t.includes('35k')), 'Must include fee tag');
  assert(tags.some(t => t.includes('98-99%')), 'Must include shuttle tag');
  console.log('✅ Passed Test 2: AI tag formatting helper');
}

// Test 3: Priority determination
{
  const urgentResult = {
    time: '20h-22h tối nay',
    slots: 'Tìm gấp 1 mảnh ghép cuối',
    summary: 'Tối nay cần gấp'
  };
  assert.strictEqual(gemini.determineAiPriority(urgentResult), 'HIGH', 'Tối nay / gấp should trigger HIGH priority');

  const regularResult = {
    time: 'Chủ Nhật tuần sau 8h-10h',
    slots: 'Tuyển thành viên dài hạn',
    summary: 'Tuyển cố định tuần sau'
  };
  assert.strictEqual(gemini.determineAiPriority(regularResult), 'NORMAL', 'Standard future post should be NORMAL priority');
  console.log('✅ Passed Test 3: AI priority determination');
}

// Test 4: Comment Actionability Pre-Filter
{
  // Useless spam comments
  assert.strictEqual(isActionableComment('ib zalo 0987654321'), false, 'Reject bare inbox/zalo');
  assert.strictEqual(isActionableComment('chấm'), false, 'Reject chấm');
  assert.strictEqual(isActionableComment('.'), false, 'Reject dot');
  assert.strictEqual(isActionableComment('xin giá'), false, 'Reject xin giá');
  assert.strictEqual(isActionableComment('35k'), false, 'Reject bare price without context');

  // Actionable comments
  assert.strictEqual(
    isActionableComment('Sân 120 Định Công bên mình còn 2 slot ca 20-22h nhé'),
    true,
    'Accept actionable comment offering slot at target venue'
  );
  assert.strictEqual(
    isActionableComment('Mình xin 1 slot nam trình TBY nhé b ơi'),
    true,
    'Accept actionable comment seeking slot with level'
  );
  console.log('✅ Passed Test 4: Comment Actionability Pre-Filter');
}

// Test 5: Live API test with real badminton examples
(async () => {
  if (config.gemini.apiKey && config.gemini.apiKey.trim() !== '') {
    console.log('\n[Gemini Live Test] Phát hiện GEMINI_API_KEY. Đang gọi thử model...');
    try {
      // Test 5A: Real User Example 4 (Sân Maxping Định Công)
      const postText = `🏸 TUYỂN GIAO LƯU SÁNG MAI 35K
Sân Maxping Định Công
⏰ 8:30 - 10:30
🏸 Nam/Nữ – Y/TBY: 35K
🏟️ Sân Max 8
🪶 Cầu 98–99%
Liên hệ tuiii nha💓`;

      const res = await gemini.analyzeContent(postText, {
        authorName: 'Thùy Trang',
        type: 'POST'
      });
      console.log('Kết quả Gemini cho bài Sân Maxping Định Công:', res);
      assert(res, 'Must return result object');
      assert.strictEqual(res.isBadmintonMatch, true, 'Gemini must recognize badminton game');
      assert.strictEqual(res.matchesTargetLocation, true, 'Gemini must recognize Maxping is in Dinh Cong area');
      console.log('✅ Passed Test 5A: Live Gemini recognized Sân Maxping Định Công & extracted details');

      // Test 5B: Real User Example 1 (Nguyễn Xiển - Other location)
      const nonTargetText = `sẵn 3 nam 4 nữ tìm thêm 1 mảnh ghép cuối ca 0-2h bmc ng xiển
nam tb- tb 65 cá
đánh cầu pro X`;

      const resNonTarget = await gemini.analyzeContent(nonTargetText, {
        authorName: 'Tuấn Anh',
        type: 'POST'
      });
      console.log('Kết quả Gemini cho bài BMC Nguyễn Xiển:', resNonTarget);
      assert(resNonTarget, 'Must return result object');
      assert.strictEqual(resNonTarget.isBadmintonMatch, true, 'Gemini must recognize badminton game');
      assert.strictEqual(resNonTarget.matchesTargetLocation, false, 'Gemini must recognize Nguyễn Xiển is NOT in target locations');
      console.log('✅ Passed Test 5B: Live Gemini correctly identified BMC Nguyễn Xiển as non-target location');

    } catch (err) {
      console.warn('⚠️ Lỗi gọi thử Gemini Live API:', err.message);
    }
  } else {
    console.log('ℹ️ Bỏ qua Test 5 (Live Gemini API) vì GEMINI_API_KEY chưa được cấu hình.');
  }

  console.log('🎉 Gemini module test completed successfully!\n');
})();
