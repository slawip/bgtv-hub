'use strict';

const path = require('path');

const stripSlash = value => String(value || '').trim().replace(/\/+$/, '');

const SOURCE_URL =
  stripSlash(process.env.SOURCE_URL) || 'https://www.seirsanduk.online';

module.exports = {
  // Site the channel list and streams are scraped from.
  SOURCE_URL,

  // Where the catalogue cache is stored.
  DATA_DIR: process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(__dirname, '..'),

  // Public address of THIS service (set it when running behind a reverse proxy).
  PUBLIC_BASE_URL: stripSlash(process.env.PUBLIC_BASE_URL),

  // Bridge only: address players can use to reach the addon (for local logos).
  ADDON_BASE_URL: stripSlash(process.env.ADDON_BASE_URL),

  // Addon only: address players can use to reach the bridge.
  BRIDGE_URL: stripSlash(process.env.BRIDGE_URL),

  // Bridge only: secret used to sign proxy URLs. Random per run when empty.
  PROXY_SECRET: process.env.PROXY_SECRET || '',

  UPSTREAM_HEADERS: {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    Referer: SOURCE_URL + '/'
  }
};
