'use strict';

// Pure helpers for working with HLS playlists (no network, easy to test).

function parseVariants(lines) {
  const variants = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!trimmed.startsWith('#EXT-X-STREAM-INF:')) continue;

    const bandwidthMatch = trimmed.match(/\bBANDWIDTH=(\d+)/i);
    const bandwidth = bandwidthMatch ? Number(bandwidthMatch[1]) : 0;

    let uriIndex = i + 1;
    while (uriIndex < lines.length && !lines[uriIndex].trim()) uriIndex++;

    if (uriIndex < lines.length && !lines[uriIndex].trim().startsWith('#')) {
      variants.push({ tagIndex: i, uriIndex, bandwidth });
    }
  }

  return variants;
}

function selectBest(variants) {
  return variants.reduce((highest, current) =>
    current.bandwidth > highest.bandwidth ? current : highest
  );
}

// For a master playlist, the absolute URL of its highest-bandwidth variant.
// Returns null for a media playlist.
function pickBestVariantUrl(content, baseUrl) {
  const lines = content.split(/\r?\n/);
  const variants = parseVariants(lines);

  if (variants.length === 0) return null;

  const best = selectBest(variants);

  try {
    return new URL(lines[best.uriIndex].trim(), baseUrl).href;
  } catch (_) {
    return null;
  }
}

// Turn a (possibly relative) URL into a signed URL on this bridge.
function makeProxyUrl(url, baseUrl, ctx) {
  let absolute;

  try {
    absolute = new URL(url, baseUrl).href;
  } catch (_) {
    return null;
  }

  const signature = ctx.sign(ctx.channelId, absolute);

  return (
    `${ctx.localBase}/proxy/${encodeURIComponent(ctx.channelId)}` +
    `?url=${encodeURIComponent(absolute)}&sig=${signature}`
  );
}

// Keep only the highest-bandwidth variant, then rewrite every URL to point
// at the bridge. ctx = { localBase, channelId, sign(channelId, url) }.
function rewritePlaylist(content, sourceUrl, ctx) {
  let lines = content.split(/\r?\n/);
  const variants = parseVariants(lines);

  if (variants.length > 1) {
    const best = selectBest(variants);
    const drop = new Set();

    for (const variant of variants) {
      if (variant !== best) {
        drop.add(variant.tagIndex);
        drop.add(variant.uriIndex);
      }
    }

    lines = lines.filter((_, index) => !drop.has(index));
  }

  return lines
    .map(line => {
      const trimmed = line.trim();

      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (match, uri) => {
          const proxied = makeProxyUrl(uri, sourceUrl, ctx);
          return proxied ? `URI="${proxied}"` : match;
        });
      }

      // A segment/variant line that cannot be resolved is dropped rather than
      // left pointing at the original (unproxied) address.
      return makeProxyUrl(trimmed, sourceUrl, ctx) || '';
    })
    .join('\n');
}

// Find the same resource (by file name, preferring the longest matching path
// suffix) inside a freshly fetched playlist. Returns an absolute URL or null.
function findResourceInPlaylist(content, baseUrl, originalPathname) {
  const originalParts = originalPathname.split('/').filter(Boolean);
  const originalName = originalParts[originalParts.length - 1];

  if (!originalName) return null;

  let best = null;
  let bestScore = -1;

  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();

    if (!line) continue;

    const candidates = line.startsWith('#')
      ? [...line.matchAll(/URI="([^"]+)"/g)].map(match => match[1])
      : [line];

    for (const candidate of candidates) {
      let url;

      try {
        url = new URL(candidate, baseUrl);
      } catch (_) {
        continue;
      }

      const parts = url.pathname.split('/').filter(Boolean);

      if (parts[parts.length - 1] !== originalName) continue;

      let score = 0;
      while (
        score < parts.length &&
        score < originalParts.length &&
        parts[parts.length - 1 - score] ===
          originalParts[originalParts.length - 1 - score]
      ) {
        score++;
      }

      if (score > bestScore) {
        best = url.href;
        bestScore = score;
      }
    }
  }

  return best;
}

function isPlaylist(target, contentType = '') {
  return (
    /\.m3u8$/i.test(target.pathname) ||
    contentType.toLowerCase().includes('mpegurl')
  );
}

module.exports = {
  parseVariants,
  pickBestVariantUrl,
  makeProxyUrl,
  rewritePlaylist,
  findResourceInPlaylist,
  isPlaylist
};
