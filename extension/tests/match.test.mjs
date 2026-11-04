#!/usr/bin/env node
// Burn site-matching tests. No dependencies; run with:
//   node tests/match.test.mjs
import assert from 'node:assert/strict';
import '../src/shared/constants.js';
import '../src/shared/match.js';

const { isBlocked, findMatchingEntry, parseEntry } = globalThis.BurnMatch;
const defaults = globalThis.BurnConstants.DEFAULT_BLOCKED_SITES;

const blockedCases = [
  ['https://www.tiktok.com/', 'tiktok.com'],
  ['https://www.tiktok.com/@user/video/123', 'tiktok.com'],
  ['https://m.tiktok.com/', 'tiktok.com'],
  ['https://tiktok.com/', 'tiktok.com'],
  ['https://www.instagram.com/', 'instagram.com'],
  ['https://m.instagram.com/p/abc/', 'instagram.com'],
  ['https://x.com/home', 'x.com'],
  ['https://mobile.x.com/', 'x.com'],
  ['https://youtube.com/shorts', 'youtube.com/shorts'],
  ['https://youtube.com/shorts/', 'youtube.com/shorts'],
  ['https://youtube.com/shorts/abc', 'youtube.com/shorts'],
  ['https://www.youtube.com/shorts/abc?feature=share', 'youtube.com/shorts'],
  ['https://m.youtube.com/shorts/xyz', 'youtube.com/shorts'],
  ['https://m.reddit.com/r/test', 'reddit.com'],
  ['https://www.reddit.com/', 'reddit.com'],
  ['https://old.reddit.com/r/test/', 'reddit.com']
];

const allowedCases = [
  'https://nottiktok.com/',
  'https://tiktok.com.evil.com/',
  'https://eviltiktok.com/',
  'https://youtube.com/',
  'https://youtube.com/watch?v=abc',
  'https://www.youtube.com/watch?v=abc',
  'https://www.youtube.com/feed/subscriptions',
  'https://notreddit.com/',
  'https://reddit.com.evil.com/',
  'https://example.com/',
  'https://myx.com/',
  'not a url',
  ''
];

let count = 0;
for (const [url, expectedEntry] of blockedCases) {
  assert.equal(isBlocked(url, defaults), true, `expected BLOCKED: ${url}`);
  assert.equal(findMatchingEntry(url, defaults), expectedEntry, `expected entry ${expectedEntry} for ${url}`);
  count += 2;
}
for (const url of allowedCases) {
  assert.equal(isBlocked(url, defaults), false, `expected ALLOWED: ${url}`);
  count += 1;
}

// Entry parsing tolerates schemes, casing, ports, queries and trailing dots.
assert.deepEqual(parseEntry('https://YouTube.com/shorts/'), { host: 'youtube.com', path: '/shorts', raw: 'https://YouTube.com/shorts/' });
assert.deepEqual(parseEntry('tiktok.com.').host, 'tiktok.com');
assert.deepEqual(parseEntry('example.com:8080/path').host, 'example.com');
assert.equal(parseEntry(''), null);
assert.equal(parseEntry('   '), null);
assert.equal(parseEntry(null), null);
count += 6;

assert.equal(isBlocked('https://www.tiktok.com/', []), false);
assert.equal(isBlocked('https://www.tiktok.com/', null), false);
assert.equal(isBlocked('https://www.tiktok.com/', ['not a host!!']), false);
count += 3;

// Subdomain boundary: suffix matches only on a dot boundary.
assert.equal(isBlocked('https://sub.www.tiktok.com/', ['tiktok.com']), true);
assert.equal(isBlocked('https://faketiktok.com/', ['tiktok.com']), false);
count += 2;

console.log(`All match tests passed (${count} assertions).`);
