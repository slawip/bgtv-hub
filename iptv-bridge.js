'use strict';

const express = require('express');
const { pipeline } = require('stream');
const config = require('./lib/config');
const hls = require('./lib/hls');
const { createSigner } = require('./lib/sign');
const { safeAxiosGet } = require('./lib/safe-http');
const { resolveOrigin } = require('./lib/origin');
const {
  getCatalog,
  getChannelById,
  getStream,
  CHANNEL_ID_RE
} = require('./scraper');

const PORT = Number(process.env.BRIDGE_PORT) || 7001;
const ID_PREFIX = 'bgtv_';

const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20000;
const IDLE_TIMEOUT_MS = 30000;

const signer = createSigner(config.PROXY_SECRET);

const app = express();
app.disable('x-powered-by');

const getLocalBase = req => resolveOrigin(req, PORT);

const makeCtx = (req, channelId) => ({
  localBase: getLocalBase(req),
  channelId,
  sign: signer.sign
});

// Safe to place inside a quoted M3U attribute or a title line.
const clean = value => String(value || '').replace(/[\r\n"]/g, ' ').trim();

// Logos saved by the addon use a __host__ placeholder. Point those at the
// addon when its address is known, otherwise leave the logo out.
function resolveLogo(logo) {
  if (!logo) return '';

  if (logo.includes('http://__host__')) {
    return config.ADDON_BASE_URL
      ? clean(logo.replace('http://__host__', config.ADDON_BASE_URL))
      : '';
  }

  return clean(logo);
}

const fetchText = url =>
  safeAxiosGet(url, {
    responseType: 'text',
    transformResponse: [data => data],
    timeout: REQUEST_TIMEOUT_MS,
    maxContentLength: MAX_PLAYLIST_BYTES
  });

// Read a stream into a string, refusing anything over `limit` bytes.
async function readCapped(stream, limit) {
  const chunks = [];
  let size = 0;

  for await (const chunk of stream) {
    size += chunk.length;

    if (size > limit) {
      stream.destroy();
      throw new Error('Playlist is too large.');
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

// Destroy a stream that stops delivering data for `ms` milliseconds.
function guardIdle(stream, ms) {
  let timer;

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => stream.destroy(new Error('Upstream stream stalled.')),
      ms
    );
  };

  arm();
  stream.on('data', arm);
  stream.on('close', () => clearTimeout(timer));
}

// Find the same resource again after the stream URL has been refreshed.
async function findFreshResource(channelId, originalTarget) {
  const freshPlaylistUrl = await getStream(channelId, { force: true });

  if (!freshPlaylistUrl) {
    throw new Error('Could not resolve a fresh stream URL.');
  }

  if (/\.m3u8$/i.test(originalTarget.pathname)) {
    return freshPlaylistUrl;
  }

  let response = await fetchText(freshPlaylistUrl);

  // A master playlist lists variants, not segments: follow the best variant.
  const variantUrl = hls.pickBestVariantUrl(response.data, response.finalUrl);

  if (variantUrl) {
    response = await fetchText(variantUrl);
  }

  const match = hls.findResourceInPlaylist(
    response.data,
    response.finalUrl,
    originalTarget.pathname
  );

  if (!match) {
    throw new Error('The original segment is no longer in the refreshed playlist.');
  }

  return match;
}

app.get('/healthz', (_req, res) => res.type('text/plain').send('ok'));

// Export the channel list as M3U.
app.get('/playlist.m3u', async (req, res) => {
  try {
    const channels = await getCatalog();
    const localBase = getLocalBase(req);

    const entries = channels.map(channel => {
      const id = channel.id.replace(/^bgtv_/, '');

      return (
        `#EXTINF:-1 tvg-logo="${resolveLogo(channel.logo)}" group-title="Bulgarian TV",${clean(channel.name)}\n` +
        `${localBase}/play/${encodeURIComponent(id)}`
      );
    });

    res.set('Cache-Control', 'no-cache');
    res.type('application/x-mpegURL');
    res.send('#EXTM3U\n' + entries.join('\n') + '\n');
  } catch (err) {
    console.error('Playlist error:', err.message);
    res.status(502).send('Could not load the BGTV channel list.');
  }
});

// Resolve a BGTV channel and return its rewritten HLS playlist.
app.get('/play/:id', async (req, res) => {
  const id = req.params.id;

  if (!CHANNEL_ID_RE.test(id)) {
    return res.status(400).send('Invalid channel ID');
  }

  try {
    if (!(await getChannelById(ID_PREFIX + id))) {
      return res.status(404).send('Unknown channel.');
    }

    const streamUrl = await getStream(id);

    if (!streamUrl) {
      return res.status(502).send('Could not resolve this channel.');
    }

    const response = await fetchText(streamUrl);

    const playlist = hls.rewritePlaylist(
      response.data,
      response.finalUrl,
      makeCtx(req, id)
    );

    res.set('Cache-Control', 'no-store');
    res.type('application/vnd.apple.mpegurl').send(playlist);
  } catch (err) {
    console.error('Playback error:', err.message);

    if (!res.headersSent && !res.destroyed) {
      res.status(502).send('Could not load the channel stream.');
    }
  }
});

// Proxy HLS playlists and segments. Only URLs signed by this bridge are
// accepted, with one authentication refresh retry.
app.get('/proxy/:id', async (req, res) => {
  const channelId = req.params.id;

  if (!CHANNEL_ID_RE.test(channelId)) {
    return res.status(400).send('Invalid channel ID');
  }

  const rawUrl = req.query.url;

  if (
    typeof rawUrl !== 'string' ||
    !signer.verify(channelId, rawUrl, req.query.sig)
  ) {
    return res.status(403).send('Forbidden');
  }

  const controller = new AbortController();
  let clientGone = false;

  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true;
      controller.abort();
    }
  });

  // Identity encoding keeps Content-Length valid for forwarded segments.
  const upstreamHeaders = {
    ...config.UPSTREAM_HEADERS,
    'Accept-Encoding': 'identity'
  };

  if (typeof req.headers.range === 'string') {
    upstreamHeaders.Range = req.headers.range;
  }

  const open = href =>
    safeAxiosGet(href, {
      responseType: 'stream',
      timeout: REQUEST_TIMEOUT_MS,
      signal: controller.signal,
      headers: upstreamHeaders
    });

  try {
    let target = new URL(rawUrl);
    let response;

    try {
      response = await open(target.href);
    } catch (err) {
      const status = err.response?.status;

      if (clientGone || controller.signal.aborted) return;

      if (status !== 401 && status !== 403) throw err;

      if (err.response?.data?.destroy) err.response.data.destroy();

      console.log(
        `Authentication rejected for ${channelId} (HTTP ${status}). Refreshing stream URL.`
      );

      const refreshedUrl = await findFreshResource(channelId, target);

      if (clientGone) return;

      response = await open(refreshedUrl);

      console.log(`Stream refresh retry succeeded for ${channelId}.`);
    }

    target = new URL(response.finalUrl);

    if (clientGone || res.destroyed) {
      response.data.destroy();
      return;
    }

    const contentType = response.headers['content-type'] || '';

    if (hls.isPlaylist(target, contentType)) {
      const content = await readCapped(response.data, MAX_PLAYLIST_BYTES);

      if (clientGone || res.destroyed) return;

      const rewritten = hls.rewritePlaylist(
        content,
        target.href,
        makeCtx(req, channelId)
      );

      res.set('Cache-Control', 'no-store');
      res.type('application/vnd.apple.mpegurl').send(rewritten);
      return;
    }

    res.status(response.status);

    for (const name of [
      'content-type',
      'content-length',
      'content-range',
      'accept-ranges'
    ]) {
      if (response.headers[name]) res.set(name, response.headers[name]);
    }

    guardIdle(response.data, IDLE_TIMEOUT_MS);

    pipeline(response.data, res, err => {
      if (!err) return;

      if (
        clientGone ||
        controller.signal.aborted ||
        err.code === 'ERR_STREAM_PREMATURE_CLOSE'
      ) {
        return;
      }

      console.error('Stream delivery error:', err.message);
    });
  } catch (err) {
    if (clientGone || controller.signal.aborted) return;

    console.error('Proxy error:', err.message);

    if (!res.headersSent && !res.destroyed) {
      res.status(502).send('Stream proxy failed.');
    } else if (!res.destroyed) {
      res.destroy(err);
    }
  }
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`IPTV bridge running on port ${PORT}`);
    console.log(`Playlist: http://YOUR-PC-IP:${PORT}/playlist.m3u`);

    if (signer.ephemeral) {
      console.log('PROXY_SECRET is not set: using a random secret for this run.');
    }
  });
}

module.exports = { app };
