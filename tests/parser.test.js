const assert = require('assert');
const { parseContent, detectTargetVenue } = require('../src/parser');

console.log('--- Testing Badminton Parser Module ---');

// Test Case 1: Real-world User Example 4 - Sân Maxping Định Công
{
  const text = `🏸 TUYỂN GIAO LƯU SÁNG MAI 35K
Sân Maxping Định Công
⏰ 8:30 - 10:30
🏸 Nam/Nữ – Y/TBY: 35K
🏟️ Sân Max 8
🪶 Cầu 98–99%
Liên hệ tuiii nha💓`;

  const res = parseContent(text);
  assert.strictEqual(res.isMatch, true, 'Must match Sân Maxping Định Công');
  assert.strictEqual(res.matchesLocation, true, 'Location matches target venues');
  assert.strictEqual(res.venueCategory, '120_DINH_CONG', 'Must identify as 120_DINH_CONG category');
  assert(res.details.time.includes('8:30'), 'Should extract time 8:30 - 10:30');
  assert(res.details.level.includes('Y/TBY'), 'Should extract level Y/TBY');
  assert(res.details.fee.includes('35K') || res.details.fee.includes('35k'), 'Should extract fee 35k');
  assert(res.details.shuttle.includes('98'), 'Should extract shuttle 98–99%');
  console.log('✅ Passed Test Case 1: Real-world User Example (Sân Maxping Định Công)');
}

// Test Case 2: Teencode 120 dc & 120 Định Công
{
  const text = 'Tối nay 120 dc ca 20h-22h thiếu 2 chân vãng lai trình TB-, cầu Ba Sao 50k ai vào được ib mình';
  const res = parseContent(text);
  assert.strictEqual(res.isMatch, true, 'Must match 120 dc');
  assert.strictEqual(res.venueCategory, '120_DINH_CONG');
  assert.strictEqual(res.priority, 'HIGH', 'Tối nay should be HIGH priority');
  console.log('✅ Passed Test Case 2: Teencode 120 dc');
}

// Test Case 3: Sân 488 Minh Khai and 488 mk
{
  const text = 'Tìm 1 bạn nam giao lưu cầu lông sân 488 Minh Khai lúc 19h-21h tối T5, cầu Hải Yến, share bill';
  const res = parseContent(text);
  assert.strictEqual(res.isMatch, true, 'Must match 488 Minh Khai');
  assert.strictEqual(res.venueCategory, '488_MINH_KHAI');
  assert(res.tags.some(t => t.includes('488 Minh Khai')));
  console.log('✅ Passed Test Case 3: Sân 488 Minh Khai');
}

// Test Case 4: Sân Tân Mai & sân tm
{
  const text = 'CLB giao lưu sân Tân Mai sáng CN 8h-10h tuyển thêm nam nữ trình Y/TBY, cầu TC 77';
  const res = parseContent(text);
  assert.strictEqual(res.isMatch, true, 'Must match Sân Tân Mai');
  assert.strictEqual(res.venueCategory, 'TAN_MAI');
  console.log('✅ Passed Test Case 4: Sân Tân Mai');
}

// Test Case 5: Real-world User Example 1 & 2 - Non-target location (Nguyễn Xiển)
{
  const text = `sẵn 3 nam 4 nữ tìm thêm 1 mảnh ghép cuối ca 0-2h bmc ng xiển
nam tb- tb 65 cá
đánh cầu pro X`;

  const res = parseContent(text);
  assert.strictEqual(res.isBadminton, true, 'Must recognize as badminton pickup game');
  assert.strictEqual(res.matchesLocation, false, 'Must NOT match target locations (is at Nguyễn Xiển)');
  assert.strictEqual(res.isMatch, false, 'Should not alert when filterByTargetLocation is on');
  console.log('✅ Passed Test Case 5: Non-target venue correctly filtered (BMC Nguyễn Xiển)');
}

// Test Case 6: Pure equipment sale (Pass vợt Yonex)
{
  const text = 'Pass vợt Yonex Astrox 88D Pro chính hãng 99% giá 2tr5 tại Hà Nội';
  const res = parseContent(text);
  assert.strictEqual(res.isMatch, false, 'Should ignore pure equipment sale');
  assert.strictEqual(res.reason, 'equipment_only');
  console.log('✅ Passed Test Case 6: Reject pure racket selling post');
}

// Test Case 7: Actionable Comment under parent post
{
  const parentPost = 'Tối nay ai biết khu vực Hoàng Mai/Hai Bà Trưng có sân nào còn slot ko ạ?';
  const commentText = 'Sân 120 Định Công bên mình còn 2 slot ca 20-22h nhé b ơi, cầu TC77 40k!';
  const res = parseContent(commentText, { parentPostText: parentPost });
  assert.strictEqual(res.isMatch, true, 'Actionable comment offering slot at 120 Dinh Cong matches');
  assert.strictEqual(res.venueCategory, '120_DINH_CONG');
  console.log('✅ Passed Test Case 7: Actionable comment offering slot at target venue');
}

// Test Case 8: Empty or invalid input
{
  assert.strictEqual(parseContent(null).isMatch, false);
  assert.strictEqual(parseContent('').isMatch, false);
  console.log('✅ Passed Test Case 8: Handle empty inputs safely');
}

// Test Case 9: User's Maxping 120 Định Công example (Ensure level is never falsely parsed as 'c')
{
  const textTruncated = `TUYỂN GẤP 2SL GIAO LƯU SÁNG MAI T6 30/10
SÂN Maxping 120 Định công
Thời gian: 8:30-10:30`;
  const resTrunc = parseContent(textTruncated);
  assert.notStrictEqual(resTrunc.details.level, 'c', 'Must not match "c" from "Định công"');

  const textFull = `TUYỂN GẤP 2SL GIAO LƯU SÁNG MAI T6 30/10
SÂN Maxping 120 Định công
⏰Thời gian: 8:30-10:30
🏸Trình: Tby ,Tb-
Sân sẵn nữ
Cầu 3sao proX
Nữ 50 nam 65
Liên hệ mess ạ😗`;
  const resFull = parseContent(textFull);
  assert.strictEqual(resFull.isMatch, true);
  assert(resFull.details.level.includes('Tby'), 'Level must extract Tby');
  assert(resFull.details.slots.includes('2'), 'Slots must extract 2');
  assert.strictEqual(resFull.venueCategory, '120_DINH_CONG');
  console.log('✅ Passed Test Case 9: User Maxping 120 Định Công example correctly parsed');
}

console.log('🎉 All Badminton Parser tests passed successfully!\n');
