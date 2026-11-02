'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractStreamUrl } = require('../lib/extract');

test('finds the primary file: pattern', () => {
  const html = `player.setup({ file: "https://cdn.test/live/a.m3u8?t=1" });`;
  assert.deepEqual(extractStreamUrl(html), {
    url: 'https://cdn.test/live/a.m3u8?t=1',
    fallback: false
  });
});

test('unescapes JS and HTML escapes', () => {
  const html = String.raw`file: 'https:\/\/cdn.test\/a.m3u8?x=1&amp;y=2'`;
  assert.equal(extractStreamUrl(html).url, 'https://cdn.test/a.m3u8?x=1&y=2');
});

test('flags the loose fallback match', () => {
  const found = extractStreamUrl(`var src = 'https://cdn.test/b.m3u8';`);
  assert.equal(found.url, 'https://cdn.test/b.m3u8');
  assert.equal(found.fallback, true);
});

test('returns null when there is no stream', () => {
  assert.equal(extractStreamUrl('<html>nothing here</html>'), null);
});
