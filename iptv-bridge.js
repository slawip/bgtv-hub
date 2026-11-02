'use strict';

const express = require('express');
const axios = require('axios');
const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');
const { pipeline } = require('stream');
const { getCatalog, getStream } = require('./scraper');

const app = express();
const PORT = 7001;
const SOURCE = 'https://www.seirsanduk.online/';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  Referer: SOURCE
};

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;

// Validate a URL and pin its connection to a verified public IP.
async function getPublicLookup(target) {
  if (
    !['https:', 'http:'].includes(target.protocol) ||
    !target.hostname ||
    target.username ||
    target.password
  ) {
    throw new Error('Invalid stream URL.');
  }

  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  let addresses;

  if (ipaddr.isValid(hostname)) {
    const address = ipaddr.process(hostname);
    addresses = [{
      address: address.toString(),
      family: address.kind() === 'ipv4' ? 4 : 6
    }];
  } else {
    addresses = await dns.lookup(hostname, {
      all: true,
      verbatim: true
    });
  }

  if (!addresses.length) {
    throw new Error('Stream hostname did not resolve.');
  }

  // Reject the hostname if ANY resolved address is non-public.
  for (const entry of addresses) {
    const address = ipaddr.process(entry.address);

    if (address.range() !== 'unicast') {
      throw new Error('Stream URL resolves to a non-public IP address.');
    }
  }

  // Pin the connection to one of the addresses we just validated.
  const selected = addresses[0];

  return (_hostname, _options, callback) => {
    callback(null, selected.address, selected.family);
  };
}

// Make an HTTP request while validating every redirect destination.
async function safeAxiosGet(url, options = {}) {
  let target = new URL(url);

  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt++) {
    const lookup = await getPublicLookup(target);

    const response = await axios.get(target.href, {
      ...options,
      headers: options.headers || HEADERS,
      lookup,
      proxy: false,
      maxRedirects: 0,
      validateStatus: status =>
        (status >= 200 && status < 300) ||
        REDIRECT_CODES.has(status)
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

function makeProxyUrl(url, baseUrl, localBase, channelId) {
  const absoluteUrl = new URL(url, baseUrl).href;

  return `${localBase}/proxy/${encodeURIComponent(channelId)}?url=${encodeURIComponent(absoluteUrl)}`;
}

// Select the highest-bandwidth HLS variant, then rewrite its URLs.
function rewritePlaylist(content, sourceUrl, localBase, channelId) {
  const lines = content.split(/\r?\n/);
  const variants = [];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!trimmed.startsWith('#EXT-X-STREAM-INF:')) {
      continue;
    }

    const bandwidthMatch = trimmed.match(/\bBANDWIDTH=(\d+)/i);
    const bandwidth = bandwidthMatch
      ? Number(bandwidthMatch[1])
      : 0;

    let uriIndex = i + 1;

    while (uriIndex < lines.length && !lines[uriIndex].trim()) {
      uriIndex++;
    }

    if (
      uriIndex < lines.length &&
      !lines[uriIndex].trim().startsWith('#')
    ) {
      variants.push({
        tagIndex: i,
        uriIndex,
        bandwidth
      });
    }
  }

  if (variants.length > 1) {
    const best = variants.reduce((highest, current) =>
      current.bandwidth > highest.bandwidth ? current : highest
    );

    const linesToRemove = new Set();

    for (const variant of variants) {
      if (variant !== best) {
        linesToRemove.add(variant.tagIndex);
        linesToRemove.add(variant.uriIndex);
      }
    }

    content = lines
      .filter((_, index) => !linesToRemove.has(index))
      .join('\n');
  }

  return content.split(/\r?\n/).map(line => {
    const trimmed = line.trim();

    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) =>
        `URI="${makeProxyUrl(uri, sourceUrl, localBase, channelId)}"`
      );
    }

    return makeProxyUrl(trimmed, sourceUrl, localBase, channelId);
  }).join('\n');
}

function getLocalBase(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function isPlaylist(target, contentType = '') {
  return /\.m3u8$/i.test(target.pathname) ||
    contentType.toLowerCase().includes('mpegurl');
}

// Find the same resource in a newly resolved playlist.
async function findFreshResource(channelId, originalTarget) {
  const freshPlaylistUrl = await getStream(channelId);

  if (!freshPlaylistUrl) {
    throw new Error('Could not resolve a fresh stream URL.');
  }

  if (/\.m3u8$/i.test(originalTarget.pathname)) {
    return freshPlaylistUrl;
  }

  const response = await safeAxiosGet(freshPlaylistUrl, {
    responseType: 'text',
    transformResponse: [data => data],
    timeout: 15000
  });

  const originalName = originalTarget.pathname.split('/').pop();
  const lines = response.data.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const candidates = [];

    if (trimmed.startsWith('#')) {
      const matches = [...trimmed.matchAll(/URI="([^"]+)"/g)];
      for (const match of matches) candidates.push(match[1]);
    } else {
      candidates.push(trimmed);
    }

    for (const candidate of candidates) {
      try {
        const candidateUrl = new URL(candidate, response.finalUrl);
        const candidateName = candidateUrl.pathname.split('/').pop();

        if (candidateName === originalName) {
          return candidateUrl.href;
        }
      } catch (_) {}
    }
  }

  throw new Error('The original segment is no longer in the refreshed playlist.');
}

// Export the channel list as M3U.
app.get('/playlist.m3u', async (req, res) => {
  try {
    const channels = await getCatalog();
    const localBase = getLocalBase(req);

    const entries = channels.map(channel => {
      const id = channel.id.replace(/^bgtv_/, '');
      const logo = channel.logo || '';
      const name = channel.name.replace(/[\r\n"]/g, ' ');

      return (
        `#EXTINF:-1 tvg-logo="${logo}" group-title="Bulgarian TV",${name}\n` +
        `${localBase}/play/${encodeURIComponent(id)}`
      );
    });

    res.type('application/x-mpegURL');
    res.send('#EXTM3U\n' + entries.join('\n') + '\n');
  } catch (err) {
    console.error('Playlist error:', err.message);
    res.status(502).send('Could not load the BGTV channel list.');
  }
});

// Resolve a BGTV channel and return its rewritten HLS playlist.
app.get('/play/:id', async (req, res) => {
  try {
    const id = req.params.id;

    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
      return res.status(400).send('Invalid channel ID');
    }

    const streamUrl = await getStream(id);

    if (!streamUrl) {
      return res.status(502).send('Could not resolve this channel.');
    }

    const response = await safeAxiosGet(streamUrl, {
      responseType: 'text',
      transformResponse: [data => data],
      timeout: 20000
    });

    const playlist = rewritePlaylist(
      response.data,
      response.finalUrl,
      getLocalBase(req),
      id
    );

    res.type('application/vnd.apple.mpegurl').send(playlist);
  } catch (err) {
    console.error('Playback error:', err.message);

    if (!res.headersSent && !res.destroyed) {
      res.status(502).send('Could not load the channel stream.');
    }
  }
});

// Proxy HLS playlists and segments, with one authentication refresh retry.
app.get('/proxy/:id', async (req, res) => {
  const channelId = req.params.id;
  const controller = new AbortController();
  let clientDisconnected = false;

  if (!/^[a-zA-Z0-9_-]+$/.test(channelId)) {
    return res.status(400).send('Invalid channel ID');
  }

  const abortUpstream = () => {
    if (!res.writableEnded && !clientDisconnected) {
      clientDisconnected = true;
      controller.abort();
    }
  };

  req.on('aborted', abortUpstream);

  res.on('close', () => {
    if (!res.writableEnded) abortUpstream();
  });

  try {
    if (typeof req.query.url !== 'string') {
      return res.status(400).send('Invalid stream URL');
    }

    let target = new URL(req.query.url);

    let response;

    try {
      response = await safeAxiosGet(target.href, {
        responseType: 'stream',
        timeout: 20000,
        signal: controller.signal
      });
      target = new URL(response.finalUrl);
    } catch (err) {
      const status = err.response?.status;

      if (clientDisconnected || controller.signal.aborted) return;

      if (status !== 401 && status !== 403) throw err;

      if (err.response?.data?.destroy) {
        err.response.data.destroy();
      }

      console.log(
        `Authentication rejected for ${channelId} (HTTP ${status}). Refreshing stream URL.`
      );

      const refreshedUrl = await findFreshResource(channelId, target);

      if (clientDisconnected || controller.signal.aborted) return;

      target = new URL(refreshedUrl);

      response = await safeAxiosGet(target.href, {
        responseType: 'stream',
        timeout: 20000,
        signal: controller.signal
      });
      target = new URL(response.finalUrl);

      console.log(`Stream refresh retry succeeded for ${channelId}.`);
    }

    if (clientDisconnected || res.destroyed) {
      response.data.destroy();
      return;
    }

    const contentType = response.headers['content-type'] || '';

    if (isPlaylist(target, contentType)) {
      const chunks = [];

      for await (const chunk of response.data) {
        chunks.push(chunk);
      }

      if (clientDisconnected || res.destroyed) return;

      const content = Buffer.concat(chunks).toString('utf8');

      const rewritten = rewritePlaylist(
        content,
        target.href,
        getLocalBase(req),
        channelId
      );

      res.type('application/vnd.apple.mpegurl').send(rewritten);
      return;
    }

    if (contentType) {
      res.set('Content-Type', contentType);
    }

    pipeline(response.data, res, err => {
      if (!err) return;

      if (
        clientDisconnected ||
        controller.signal.aborted ||
        err.code === 'ERR_STREAM_PREMATURE_CLOSE'
      ) {
        return;
      }

      console.error('Stream delivery error:', err.message);
    });

  } catch (err) {
    if (clientDisconnected || controller.signal.aborted) return;

    console.error('Proxy error:', err.message);

    if (!res.headersSent && !res.destroyed) {
      res.status(502).send('Stream proxy failed.');
    } else if (!res.destroyed) {
      res.destroy(err);
    }
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`IPTV bridge running on port ${PORT}`);
  console.log(`Playlist: http://YOUR-PC-IP:${PORT}/playlist.m3u`);
});
