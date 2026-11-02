'use strict';

const express = require('express');
const path = require('path');
const { addonBuilder } = require('stremio-addon-sdk');
const getRouter = require('stremio-addon-sdk/src/getRouter');
const pkg = require('./package.json');
const config = require('./lib/config');
const { resolveOrigin } = require('./lib/origin');
const {
  getCatalog,
  getChannelById,
  getStream,
  CHANNEL_ID_RE
} = require('./scraper');

const PORT = Number(process.env.PORT) || 7000;
const ID_PREFIX = 'bgtv_';

const manifest = {
  // Unique ID so this fork does not clash with the original BGTV addon.
  id: 'com.slawip.bgtv-hub',
  version: pkg.version,
  name: 'BGTV Hub',
  description: 'Bulgarian live TV with OwnTV IPTV bridge',
  logo: 'http://__host__/images/logo.png',
  types: ['tv'],
  catalogs: [{ type: 'tv', id: 'bg_tv', name: 'BGTV Hub' }],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: [ID_PREFIX]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id }) => {
  if (type !== 'tv' || id !== 'bg_tv') return { metas: [] };

  try {
    const metas = await getCatalog();
    return { metas, cacheMaxAge: 60 * 60 };
  } catch (err) {
    console.error('Catalog error:', err.message);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== 'tv' || !id.startsWith(ID_PREFIX)) return { meta: null };

  try {
    const channel = await getChannelById(id);

    if (!channel) return { meta: null };

    return {
      meta: {
        id: channel.id,
        type: 'tv',
        name: channel.name,
        poster: channel.poster,
        posterShape: 'square',
        background: channel.background,
        logo: channel.logo,
        description: `Watch ${channel.name} live.`
      },
      cacheMaxAge: 60 * 60
    };
  } catch (err) {
    console.error('Meta error:', err.message);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== 'tv' || !id.startsWith(ID_PREFIX)) return { streams: [] };

  const channelId = id.slice(ID_PREFIX.length);

  if (!CHANNEL_ID_RE.test(channelId)) return { streams: [] };

  const streams = [];

  // The bridge handles the Referer header, HLS rewriting and URL refresh, so
  // it is offered first when it is configured.
  if (config.BRIDGE_URL) {
    streams.push({
      title: 'Live Stream (bridge)',
      url: `${config.BRIDGE_URL}/play/${encodeURIComponent(channelId)}`
    });
  }

  try {
    const url = await getStream(channelId);

    if (url) {
      streams.push({
        title: 'Live Stream (direct)',
        url,
        behaviorHints: {
          notWebReady: true,
          proxyHeaders: {
            request: { Referer: config.SOURCE_URL + '/' }
          }
        }
      });
    }
  } catch (err) {
    console.error('Stream error:', err.message);
  }

  // Stream URLs expire, so clients must not cache them.
  return { streams, cacheMaxAge: 0 };
});

const addonRouter = getRouter(builder.getInterface());

const app = express();
app.disable('x-powered-by');

app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

// Rewrite the __host__ placeholder in JSON responses to the real address.
// The SDK uses res.end() directly, so it is intercepted there. This lets image
// URLs work from any device (localhost, LAN IP, domain).
app.use((req, res, next) => {
  const origin = resolveOrigin(req, PORT);
  const originalEnd = res.end.bind(res);

  res.end = (data, encoding, callback) => {
    const contentType = res.getHeader('Content-Type') || '';

    if (
      String(contentType).includes('application/json') &&
      typeof data === 'string' &&
      data.includes('__host__')
    ) {
      data = data.replaceAll('http://__host__', origin);

      // The body length changed, so any length set earlier is now wrong.
      if (!res.headersSent) res.removeHeader('Content-Length');
    }

    return originalEnd(data, encoding, callback);
  };

  next();
});

// Static assets, including the landing page (public/index.html) at "/".
app.use(express.static(path.join(__dirname, 'public')));

// Addon routes (/manifest.json, /catalog/..., /meta/..., /stream/...)
app.use(addonRouter);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Addon running at http://localhost:${PORT}`);
    console.log(`Manifest: http://localhost:${PORT}/manifest.json`);
  });
}

module.exports = { app };
