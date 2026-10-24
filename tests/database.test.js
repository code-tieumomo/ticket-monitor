const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { DatabaseManager } = require('../src/database');

console.log('--- Testing Database Module ---');

const testDbPath = path.resolve(__dirname, 'test.sqlite');
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

const db = new DatabaseManager(testDbPath);

// Test 1: Insert new post
const testItem1 = {
  id: 'post_12345',
  group_id: 'group_test_1',
  item_type: 'POST',
  author_name: 'Nguyễn Văn A',
  content: 'Pass vé VIP 1 Day 1',
  post_url: 'https://facebook.com/groups/123/posts/12345',
  tags: ['🏷️ PASS VÉ', '🎟️ VIP 1']
};

db.insertItem(testItem1);
assert.strictEqual(db.isExists('post_12345'), true, 'Should find post_12345');
assert.strictEqual(db.isExists('non_existing_post'), false, 'Should not find unknown id');
console.log('✅ Passed Test 1: Insert and deduplication check');

// Test 2: Insert comment
const testItem2 = {
  id: 'comment_99999',
  group_id: 'group_test_1',
  item_type: 'COMMENT',
  author_name: 'Trần Thị B',
  content: 'Em còn dư 1 vé CAT 2 ai cần ib',
  post_url: 'https://facebook.com/groups/123/posts/12345?comment_id=99999',
  tags: ['🏷️ PASS VÉ', '🎟️ CAT 2']
};

db.insertItem(testItem2);
assert.strictEqual(db.isExists('comment_99999'), true, 'Should find comment_99999');
console.log('✅ Passed Test 2: Comment insertion');

// Test 3: Stats check
const stats = db.getStats();
assert.strictEqual(stats.total, 2, 'Total items should be 2');
assert.strictEqual(stats.posts, 1, 'Posts should be 1');
assert.strictEqual(stats.comments, 1, 'Comments should be 1');
console.log(`✅ Passed Test 3: Stats verification (engine: ${stats.engine}, total: ${stats.total})`);

// Test 4: Dual-key Deduplication (Content fingerprint check)
const { generateItemId, extractCommentId, extractPostId, cleanFacebookUrl, generateContentFingerprint } = require('../src/crawler');

// URL with random token in cycle 1
const cycle1Url = 'https://www.facebook.com/groups/266797734793271/posts/1818782592928103/?comment_id=1818829352923427&__cft__[0]=AZgQBhoNeKphZfZ30y&__tn__=R-R';
// URL with completely DIFFERENT random token in cycle 2
const cycle2Url = 'https://www.facebook.com/groups/266797734793271/posts/1818782592928103/?comment_id=1818829352923427&__cft__[0]=AZimp_pysemb3CB-Dmh&__tn__=R-R';

// 1. Both URLs must extract the exact same comment ID
assert.strictEqual(extractCommentId(cycle1Url), '1818829352923427');
assert.strictEqual(extractCommentId(cycle2Url), '1818829352923427');

// 2. Both URLs must generate the EXACT SAME canonical item ID
const id1 = generateItemId(cycle1Url, 'COMMENT', 'group_3', 'CharmingParrot9732', 'Pass lại cặp vé');
const id2 = generateItemId(cycle2Url, 'COMMENT', 'group_3', 'CharmingParrot9732', 'Pass lại cặp vé');
assert.strictEqual(id1, id2, 'Canonical item IDs must match despite different __cft__ tokens');
assert.strictEqual(id1, 'fb_cmt_1818829352923427');

// 3. Clean URL must strip __cft__ and __tn__
const cleanUrl = cleanFacebookUrl(cycle1Url, 'COMMENT');
assert.strictEqual(cleanUrl, 'https://www.facebook.com/groups/266797734793271/posts/1818782592928103/?comment_id=1818829352923427');

// 4. Test Post ID extraction
const postUrlWithTokens = 'https://www.facebook.com/groups/637308242499215/posts/1113421374887897/?__cft__[0]=AZrandom123&__tn__=%2CO%2CP-R';
assert.strictEqual(extractPostId(postUrlWithTokens), '1113421374887897');
assert.strictEqual(generateItemId(postUrlWithTokens, 'POST', 'group_2'), 'fb_post_1113421374887897');
assert.strictEqual(cleanFacebookUrl(postUrlWithTokens, 'POST'), 'https://www.facebook.com/groups/637308242499215/posts/1113421374887897/');

// 5. Database dual-key deduplication test
const fp = generateContentFingerprint('group_3', 'COMMENT', 'CharmingParrot9732', 'Pass lại cặp vé CAT 2 Day 2');
db.insertItem({
  id: id1,
  group_id: 'group_3',
  item_type: 'COMMENT',
  author_name: 'CharmingParrot9732',
  content: 'Pass lại cặp vé CAT 2 Day 2',
  post_url: cleanUrl,
  tags: 'PASS VÉ',
  content_hash: fp
});

// Should detect duplicate by ID
assert.strictEqual(db.isExists(id2, fp), true, 'Must detect duplicate in cycle 2');
// Should detect duplicate by content fingerprint even if ID was synthetic
assert.strictEqual(db.isExists('synthetic_new_id', fp), true, 'Must detect duplicate by content fingerprint');

console.log('✅ Passed Test 4: Canonical ID and Dual-key Deduplication across crawl cycles');

// Cleanup
db.close();
if (fs.existsSync(testDbPath)) {
  fs.unlinkSync(testDbPath);
}

console.log('🎉 All Database tests passed successfully!\n');
