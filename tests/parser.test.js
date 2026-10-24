const assert = require('assert');
const { parseContent } = require('../src/parser');

console.log('--- Testing Parser Module ---');

// Test Case 1: Standard seller with VIP and Day 1
{
  const text = 'Mình pass lại 2 vé VIP 1 Day 1 concert Anh Trai Say Hi giá gốc, giao dịch trực tiếp tại HN.';
  const res = parseContent(text);
  assert.strictEqual(res.isMatch, true, 'Should match standard pass VIP');
  assert.strictEqual(res.priority, 'HIGH', 'Should be HIGH priority due to escrow/direct meet + VIP');
  assert(res.tags.some(t => t.includes('VIP 1')), 'Should extract VIP 1');
  assert(res.tags.some(t => t.includes('Day 1')), 'Should extract Day 1');
  console.log('✅ Passed Test Case 1: Standard seller VIP Day 1');
}

// Test Case 2: Negative intent (Buyer seeking ticket)
{
  const text = 'Cần mua 2 vé CAT 2 Day 2 ai có pass ib mình nhé!';
  const res = parseContent(text);
  assert.strictEqual(res.isMatch, false, 'Should ignore buyer post');
  assert.strictEqual(res.reason, 'negative_intent_buyer');
  console.log('✅ Passed Test Case 2: Reject buyer looking for tickets');
}

// Test Case 3: Negative intent with "ai pass không"
{
  const text = 'Ai pass vé CAT 3 giá rẻ không ạ, tìm vé gấp!';
  const res = parseContent(text);
  assert.strictEqual(res.isMatch, false, 'Should ignore "ai pass" asking buyer');
  console.log('✅ Passed Test Case 3: Reject "ai pass vé"');
}

// Test Case 4: Seller using "Cần pass"
{
  const text = 'Cần pass gấp 1 vé GA 1 ngày 2, dẫn vào sân mới nhận tiền. Giá 1tr5';
  const res = parseContent(text);
  assert.strictEqual(res.isMatch, true, 'Should recognize "cần pass" as seller');
  assert(res.tags.some(t => t.includes('GA 1')), 'Should extract GA 1');
  assert(res.tags.some(t => t.includes('dẫn vào sân')), 'Should extract escrow hint');
  console.log('✅ Passed Test Case 4: Seller with "cần pass gấp"');
}

// Test Case 5: Seller with CAT 4 and price
{
  const text = 'Nhượng lại vé CAT 4 D1 giá 800k gdtg';
  const res = parseContent(text);
  assert.strictEqual(res.isMatch, true, 'Should match nhượng vé');
  assert(res.tags.some(t => t.includes('CAT 4')), 'Should extract CAT 4');
  console.log('✅ Passed Test Case 5: Seller CAT 4');
}

// Test Case 6: Unrelated goods (e.g. passing clothes)
{
  const text = 'Mình pass lại chiếc áo thun Zara size M giá 200k ai lấy ib';
  const res = parseContent(text);
  assert.strictEqual(res.isMatch, false, 'Should ignore unrelated goods without ticket context');
  console.log('✅ Passed Test Case 6: Ignore unrelated goods');
}

// Test Case 7: Real-world concert ticket format: Gold7Day2
{
  const text = 'Mình pass cặp vé Gold7Day2 hàng H4-5';
  const res = parseContent(text);
  assert.strictEqual(res.isMatch, true, 'Should match Gold7Day2 ticket');
  assert(res.tags.some(t => t.includes('GOLD 7')), 'Should extract GOLD 7');
  assert(res.tags.some(t => t.includes('Day 2')), 'Should extract Day 2');
  console.log('✅ Passed Test Case 7: Real-world ticket Gold7Day2');
}

// Test Case 7: Empty or invalid input
{
  assert.strictEqual(parseContent(null).isMatch, false);
  assert.strictEqual(parseContent('').isMatch, false);
  console.log('✅ Passed Test Case 7: Handle empty inputs');
}

console.log('🎉 All Parser tests passed successfully!\n');
