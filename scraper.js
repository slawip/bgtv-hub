
'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const config = require('./lib/config');
const { extractStreamUrl } = require('./lib/extract');

const BASE_URL = config.SOURCE_URL;
const HEADERS = config.UPSTREAM_HEADERS;

// Shared by the addon and the bridge so both accept exactly the same IDs.
const CHANNEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const LOCAL_IMG_DIR = path.join(__dirname, 'public', 'images', 'tvlogo');
const LOCAL_IMG_BASE = 'http://__host__/images/tvlogo';

const CACHE_FILE = path.join(config.DATA_DIR, 'catalog-cache.json');
const CACHE_TTL = 60 * 60 * 1000;
const RETRY_BACKOFF = 5 * 60 * 1000;

const STREAM_TTL = 30 * 1000;
const STREAM_CACHE_MAX = 500;
const MAX_PAGE_BYTES = 2 * 1024 * 1024;

let catalogCache = null;
let cacheTimestamp = 0;
let nextRetryAt = 0;
let refreshPromise = null;

const streamCache = new Map();

function imageUrl(src) {
  if (!src) return null;

  const filename = path.basename(src);

  if (fs.existsSync(path.join(LOCAL_IMG_DIR, filename))) {
    return `${LOCAL_IMG_BASE}/${filename}`;
  }

  try {
    return new URL(src, BASE_URL + '/').href;
  } catch (_) {
    return null;
  }
}

function isValidCatalogId(id) {
  return CHANNEL_ID_RE.test(String(id).replace(/^bgtv_/, ''));
}

function loadDiskCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

    if (!Array.isArray(data.channels)) return false;

    const channels = data.channels.filter(
      channel => channel && isValidCatalogId(channel.id)
    );

    if (channels.length === 0) return false;

    catalogCache = channels;
    cacheTimestamp = Number(data.timestamp) || 0;

    console.log(`Loaded ${catalogCache.length} cached channels from disk.`);
    return true;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Catalogue cache read error:', err.message);
    }

    return false;
  }
}

function saveDiskCache(channels) {
  // UUID prevents collisions when the addon and bridge share one cache directory.
  const tempFile = `${CACHE_FILE}.${process.pid}.${randomUUID()}.tmp`;

  try {
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });

    fs.writeFileSync(
      tempFile,
      JSON.stringify({ timestamp: Date.now(), channels })
    );

    fs.renameSync(tempFile, CACHE_FILE);
  } catch (err) {
    console.error('Catalogue cache write error:', err.message);

    try {
      fs.unlinkSync(tempFile);
    } catch (_) {}
  }
}

async function refreshCatalog() {
  const resp = await axios.get(BASE_URL + '/', {
    headers: HEADERS,
    timeout: 15000,
    maxContentLength: MAX_PAGE_BYTES
  });

  const $ = cheerio.load(resp.data);
  const channels = [];
  const seen = new Set();
  const skipped = [];

  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const img = $(el).find('img');

    if (!img.length) return;

    const idMatch = href.match(/[?&]id=([^&]+)/);
    if (!idMatch) return;

    let channelId;

    try {
      channelId = decodeURIComponent(idMatch[1]);
    } catch (_) {
      return;
    }

    // The source's home page links to itself as index.php; not a channel.
    if (!channelId || channelId === 'index.php') return;

    if (!CHANNEL_ID_RE.test(channelId)) {
      skipped.push(channelId);
      return;
    }

    const id = 'bgtv_' + channelId;

    if (seen.has(id)) return;
    seen.add(id);

    const name = $(el).text().trim();
    const thumb = img.attr('src') || '';
    const poster = imageUrl(thumb);

    channels.push({
      id,
      type: 'tv',
      name: name || channelId,
      poster,
      posterShape: 'square',
      background: poster,
      logo: poster
    });
  });

  if (skipped.length > 0) {
    console.warn(
      `Skipped ${skipped.length} channel(s) with unsupported IDs: ${skipped.join(', ')}`
    );
  }

  if (channels.length === 0) {
    throw new Error('Source returned an empty channel catalogue.');
  }

  catalogCache = channels;
  cacheTimestamp = Date.now();
  saveDiskCache(channels);

  console.log(`Catalogue refreshed: ${channels.length} channels.`);
  return channels;
}

async function getCatalog() {
  if (!catalogCache) {
    loadDiskCache();
  }

  const cacheIsFresh =
    catalogCache && Date.now() - cacheTimestamp < CACHE_TTL;

  if (cacheIsFresh) {
    return catalogCache;
  }

  // The source recently failed: keep serving the old list instead of waiting
  // on another failing request for every call.
  if (catalogCache && Date.now() < nextRetryAt) {
    return catalogCache;
  }

  if (!refreshPromise) {
    refreshPromise = refreshCatalog()
      .then(channels => {
        nextRetryAt = 0;
        return channels;
      })
      .catch(err => {
        console.error('Catalogue refresh failed:', err.message);

        if (catalogCache && catalogCache.length > 0) {
          nextRetryAt = Date.now() + RETRY_BACKOFF;
          console.log('Serving previous cached catalogue.');
          return catalogCache;
        }

        throw err;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

async function getChannelById(id) {
  const channels = await getCatalog();
  return channels.find(channel => channel.id === id) || null;
}

async function fetchStreamUrl(channelId) {
  const resp = await axios.get(`${BASE_URL}/?id=${encodeURIComponent(channelId)}`, {
    headers: HEADERS,
    timeout: 15000,
    maxContentLength: MAX_PAGE_BYTES,
    responseType: 'text',
    transformResponse: [data => data]
  });

  const found = extractStreamUrl(resp.data);

  if (!found) return null;

  if (found.fallback) {
    console.warn(
      `Stream for ${channelId} matched only the fallback pattern; the source page layout may have changed.`
    );
  }

  return found.url;
}

// Resolve a channel's current stream URL. Results are cached for a short time
// and concurrent calls share one request. Pass { force: true } to skip the
// cache (used when a stream URL has just been rejected).
async function getStream(channelId, { force = false } = {}) {
  if (!CHANNEL_ID_RE.test(String(channelId))) return null;

  const hit = streamCache.get(channelId);

  if (!force && hit && hit.expires > Date.now()) {
    return hit.promise;
  }

  if (streamCache.size >= STREAM_CACHE_MAX) {
    streamCache.delete(streamCache.keys().next().value);
  }

  const entry = {
    promise: fetchStreamUrl(channelId),
    expires: Date.now() + STREAM_TTL
  };

  streamCache.set(channelId, entry);

  entry.promise.catch(() => {
    if (streamCache.get(channelId) === entry) {
      streamCache.delete(channelId);
    }
  });

  return entry.promise;
}

loadDiskCache();

module.exports = {
  getCatalog,
  getChannelById,
  getStream,
  CHANNEL_ID_RE
};
