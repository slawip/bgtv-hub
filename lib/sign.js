'use strict';

const crypto = require('crypto');

// Signs proxy URLs so the bridge only fetches URLs it generated itself.
function createSigner(secret) {
  const key = secret || crypto.randomBytes(32).toString('hex');

  const sign = (channelId, url) =>
    crypto
      .createHmac('sha256', key)
      .update(`${channelId}\n${url}`)
      .digest('hex');

  const verify = (channelId, url, signature) => {
    if (typeof signature !== 'string') return false;

    const expected = Buffer.from(sign(channelId, url));
    const actual = Buffer.from(signature);

    return (
      actual.length === expected.length &&
      crypto.timingSafeEqual(actual, expected)
    );
  };

  return { sign, verify, ephemeral: !secret };
}

module.exports = { createSigner };
