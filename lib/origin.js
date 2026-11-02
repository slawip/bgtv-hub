'use strict';

const config = require('./config');

const HOST_RE =
  /^[A-Za-z0-9.-]+(:\d{1,5})?$|^\[[0-9A-Fa-f:.]+\](:\d{1,5})?$/;

// Work out the address clients use to reach this service.
// PUBLIC_BASE_URL wins; otherwise the Host header is used, but only if it
// looks like a plain host[:port], so it can never inject odd characters.
function resolveOrigin(req, fallbackPort) {
  if (config.PUBLIC_BASE_URL) return config.PUBLIC_BASE_URL;

  const hostHeader = req.headers.host || '';
  const host = HOST_RE.test(hostHeader)
    ? hostHeader
    : `localhost:${fallbackPort}`;
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';

  return `${proto}://${host}`;
}

module.exports = { resolveOrigin };
