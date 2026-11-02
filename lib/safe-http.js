'use strict';

const axios = require('axios');
const config = require('./config');
const { getPublicLookup } = require('./net-guard');

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

// GET a URL while validating every redirect destination.
// The result has an extra `finalUrl` property.
async function safeAxiosGet(url, options = {}) {
  let target = new URL(url);

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
    const lookup = await getPublicLookup(target);

    const response = await axios.get(target.href, {
      ...options,
      headers: options.headers || config.UPSTREAM_HEADERS,
      lookup,
      proxy: false,
      maxRedirects: 0,
      validateStatus: status =>
        (status >= 200 && status < 300) || REDIRECT_CODES.has(status)
    });

    if (!REDIRECT_CODES.has(response.status)) {
      response.finalUrl = target.href;
      return response;
    }

    const location = response.headers.location;

    if (response.data && typeof response.data.destroy === 'function') {
      response.data.destroy();
    }

    if (!location) {
      throw new Error('Redirect response has no destination.');
    }

    if (attempt === MAX_REDIRECTS) {
      throw new Error('Too many stream redirects.');
    }

    target = new URL(location, target);
  }

  throw new Error('Too many stream redirects.');
}

module.exports = { safeAxiosGet };
