'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.seirsanduk.online';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Referer': BASE_URL + '/',
};

const LOCAL_IMG_DIR = path.join(__dirname, 'public', 'images', 'tvlogo');
const LOCAL_IMG_BASE = 'http://__host__/images/tvlogo';

const CACHE_FILE = path.join(__dirname, 'catalog-cache.json');
const CACHE_TTL = 60 * 60 * 1000;

let catalogCache = null;
let cacheTimestamp = 0;
let refreshPromise = null;

function imageUrl(src) {
  if (!src) return null;

  const filename = path.basename(src);

  if (fs.existsSync(path.join(LOCAL_IMG_DIR, filename))) {
    return `${LOCAL_IMG_BASE}/${filename}`;
  }

  return src.startsWith('http')
    ? src
    : `${BASE_URL}/${src.replace(/^\//, '')}`;
}

function loadDiskCache() {
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));

    if (!Array.isArray(data.channels) || data.channels.length === 0) {
      return false;
    }

    catalogCache = data.channels;
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
  const tempFile = `${CACHE_FILE}.tmp`;

  try {
    fs.writeFileSync(tempFile, JSON.stringify({
      timestamp: Date.now(),
      channels,
    }));

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
  });

  const $ = cheerio.load(resp.data);
  const channels = [];
  const seen = new Set();

  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const img = $(el).find('img');

    if (!img.length) return;

    const idMatch = href.match(/[?&]id=([^&]+)/);
    if (!idMatch) return;

    const channelId = decodeURIComponent(idMatch[1]);

    if (!channelId || channelId === 'index.php') return;

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
      logo: poster,
    });
  });

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
    catalogCache &&
    Date.now() - cacheTimestamp < CACHE_TTL;

  if (cacheIsFresh) {
    return catalogCache;
  }

  if (!refreshPromise) {
    refreshPromise = refreshCatalog()
      .catch(err => {
        console.error('Catalogue refresh failed:', err.message);

        if (catalogCache && catalogCache.length > 0) {
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

async function getStream(channelId) {
  const url = `${BASE_URL}/?id=${encodeURIComponent(channelId)}`;

  const resp = await axios.get(url, {
    headers: HEADERS,
    timeout: 15000,
  });

  const html = resp.data;

  const match = html.match(/file:\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/);
  if (match) return match[1];

  const fallback = html.match(/['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/);
  if (fallback) return fallback[1];

  return null;
}

loadDiskCache();

module.exports = {
  getCatalog,
  getChannelById,
  getStream,
};
