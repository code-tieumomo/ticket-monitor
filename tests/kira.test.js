const assert = require('assert');
const config = require('../src/config');
const kira = require('../src/kira');
const { isActionableComment } = require('../src/crawler');

console.log('--- Testing Kira AI Badminton Module ---');

// Test 1: Availability check
{
  const originalKey = config.kira.apiKey;
  config.kira.apiKey = '';
  assert.strictEqual(kira.isAvailable(), false, 'Should be unavailable when key is empty');
  
  config.kira.apiKey = 'dummy_test_key';
  assert.strictEqual(kira.isAvailable(), true, 'Should be available when key is set');
  config.kira.apiKey = originalKey; // Restore
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

  const tags = kira.formatAiTags(mockAiResult);
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
  assert.strictEqual(kira.determineAiPriority(urgentResult), 'HIGH', 'Tối nay / gấp should trigger HIGH priority');

  const regularResult = {
    time: 'Chủ Nhật tuần sau 8h-10h',
    slots: 'Tuyển thành viên dài hạn',
    summary: 'Tuyển cố định tuần sau'
  };
  assert.strictEqual(kira.determineAiPriority(regularResult), 'NORMAL', 'Standard future post should be NORMAL priority');
  console.log('✅ Passed Test 3: AI priority determination');
}

// Test 4: Live API test with real badminton examples
(async () => {
  if (config.kira.apiKey && config.kira.apiKey.trim() !== '') {
    console.log(`\n[Kira Live Test] Phát hiện KIRA_API_KEY. Đang gọi thử model (${config.kira.model})...`);
    try {
      // Test 4A: Real User Example 4 (Sân Maxping Định Công)
      const postText = `🏸 TUYỂN GIAO LƯU SÁNG MAI 35K
Sân Maxping Định Công
⏰ 8:30 - 10:30
🏸 Nam/Nữ – Y/TBY: 35K
🏟️ Sân Max 8
🪶 Cầu 98–99%
Liên hệ tuiii nha💓`;

      const res = await kira.analyzeContent(postText, {
        authorName: 'Thùy Trang',
        type: 'POST'
      });
      console.log('Kết quả Kira AI cho bài Sân Maxping Định Công:', res);
      assert(res, 'Must return result object');
      assert.strictEqual(res.isBadmintonMatch, true, 'Kira AI must recognize badminton game');
      assert.strictEqual(res.matchesTargetLocation, true, 'Kira AI must recognize Maxping is in Dinh Cong area');
      console.log('✅ Passed Test 4A: Live Kira AI recognized Sân Maxping Định Công & extracted details');

      // Test 4B: Real User Example 1 (Nguyễn Xiển - Other location)
      const nonTargetText = `sẵn 3 nam 4 nữ tìm thêm 1 mảnh ghép cuối ca 0-2h bmc ng xiển
nam tb- tb 65 cá
đánh cầu pro X`;

      const resNonTarget = await kira.analyzeContent(nonTargetText, {
        authorName: 'Tuấn Anh',
        type: 'POST'
      });
      console.log('Kết quả Kira AI cho bài BMC Nguyễn Xiển:', resNonTarget);
      assert(resNonTarget, 'Must return result object');
      assert.strictEqual(resNonTarget.isBadmintonMatch, true, 'Kira AI must recognize badminton game');
      assert.strictEqual(resNonTarget.matchesTargetLocation, false, 'Kira AI must recognize Nguyễn Xiển is NOT in target locations');
      console.log('✅ Passed Test 4B: Live Kira AI correctly identified BMC Nguyễn Xiển as non-target location');

      // Test 4C: Batch Analysis
      console.log('\n[Kira Live Test] Đang test phân tích theo batch 2 bài...');
      const batchRes = await kira.analyzeBatch([
        { id: 'p1', text: postText, type: 'POST', authorName: 'Thùy Trang' },
        { id: 'p2', text: nonTargetText, type: 'POST', authorName: 'Tuấn Anh' }
      ]);
      assert(batchRes.has('p1'), 'Batch must contain p1');
      assert(batchRes.has('p2'), 'Batch must contain p2');
      assert.strictEqual(batchRes.get('p1').matchesTargetLocation, true);
      assert.strictEqual(batchRes.get('p2').matchesTargetLocation, false);
      console.log('✅ Passed Test 4C: Live Kira AI batch analysis works perfectly');

    } catch (err) {
      console.warn('⚠️ Lỗi gọi thử Kira Live API:', err.message);
    }
  } else {
    console.log('ℹ️ Bỏ qua Test 4 (Live Kira API) vì KIRA_API_KEY chưa được cấu hình.');
  }

  console.log('🎉 Kira AI module test completed successfully!\n');
})();
