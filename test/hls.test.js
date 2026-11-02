'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const hls = require('../lib/hls');

const ctx = {
  localBase: 'http://bridge.test',
  channelId: 'bnt1',
  sign: (channelId, url) => `sig${channelId}${url.length}`
};

const proxied = url =>
  `http://bridge.test/proxy/bnt1?url=${encodeURIComponent(url)}&sig=sigbnt1${url.length}`;

test('keeps only the highest-bandwidth variant of a master playlist', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=500000',
    'low/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=2000000',
    'high/index.m3u8',
    ''
  ].join('\n');

  const out = hls.rewritePlaylist(master, 'https://cdn.test/live/master.m3u8', ctx);

  assert.ok(out.includes(proxied('https://cdn.test/live/high/index.m3u8')));
  assert.ok(!out.includes('low'));
  assert.ok(!out.includes('500000'));
});

test('rewrites relative segment lines and URI attributes', () => {
  const media = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    '#EXTINF:4,',
    'seg1.ts',
    ''
  ].join('\n');

  const out = hls.rewritePlaylist(media, 'https://cdn.test/live/media.m3u8', ctx);

  assert.ok(out.includes(`URI="${proxied('https://cdn.test/live/key.bin')}"`));
  assert.ok(out.split('\n').includes(proxied('https://cdn.test/live/seg1.ts')));
});

test('keeps absolute URLs on their own host', () => {
  const out = hls.rewritePlaylist(
    '#EXTM3U\n#EXTINF:4,\nhttps://other.test/a/seg.ts\n',
    'https://cdn.test/live/media.m3u8',
    ctx
  );

  assert.ok(out.includes(proxied('https://other.test/a/seg.ts')));
});

test('pickBestVariantUrl handles master and media playlists', () => {
  const master =
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\na.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=9\nb.m3u8\n';

  assert.equal(
    hls.pickBestVariantUrl(master, 'https://cdn.test/x/master.m3u8'),
    'https://cdn.test/x/b.m3u8'
  );
  assert.equal(
    hls.pickBestVariantUrl('#EXTM3U\n#EXTINF:4,\nseg.ts\n', 'https://cdn.test/'),
    null
  );
});

test('findResourceInPlaylist prefers the longest matching path suffix', () => {
  const playlist = '#EXTM3U\n#EXTINF:4,\na/seg1.ts\n#EXTINF:4,\nb/seg1.ts\n';

  assert.equal(
    hls.findResourceInPlaylist(playlist, 'https://cdn.test/x/', '/live/b/seg1.ts'),
    'https://cdn.test/x/b/seg1.ts'
  );
});

test('findResourceInPlaylist returns null when the resource is gone', () => {
  assert.equal(
    hls.findResourceInPlaylist('#EXTM3U\n#EXTINF:4,\nother.ts\n', 'https://cdn.test/', '/live/seg1.ts'),
    null
  );
});

test('isPlaylist checks extension and content type', () => {
  assert.equal(hls.isPlaylist(new URL('https://a.test/x.m3u8')), true);
  assert.equal(hls.isPlaylist(new URL('https://a.test/x'), 'application/vnd.apple.mpegurl'), true);
  assert.equal(hls.isPlaylist(new URL('https://a.test/x.ts'), 'video/mp2t'), false);
});
