'use strict';

// Find the .m3u8 URL in a channel page.
// Returns { url, fallback } or null. `fallback` is true when only the loose
// pattern matched, which usually means the page layout changed.
function extractStreamUrl(html) {
  const text = String(html)
    .replace(/\\u0026/gi, '&')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');

  const primary = text.match(
    /file:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/
  );
  if (primary) return { url: primary[1], fallback: false };

  const loose = text.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/);
  if (loose) return { url: loose[1], fallback: true };

  return null;
}

module.exports = { extractStreamUrl };
