'use strict';

const dns = require('dns').promises;
const ipaddr = require('ipaddr.js');

// Throws unless every address is a public unicast address.
// Returns the addresses in a normalised { address, family } form.
function normalizePublicAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) {
    throw new Error('Stream hostname did not resolve.');
  }

  return addresses.map(entry => {
    let parsed;

    try {
      parsed = ipaddr.process(entry.address);
    } catch (_) {
      throw new Error('Stream URL resolves to an invalid IP address.');
    }

    if (parsed.range() !== 'unicast') {
      throw new Error('Stream URL resolves to a non-public IP address.');
    }

    return {
      address: parsed.toString(),
      family: parsed.kind() === 'ipv4' ? 4 : 6
    };
  });
}

// A `lookup` function that only ever returns the pre-validated addresses.
// Node 20+ calls lookup with { all: true }, older code paths with a single
// address expected, so both forms are supported.
function makePinnedLookup(pinned) {
  return function pinnedLookup(_hostname, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    if (options && options.all) {
      return callback(null, pinned.map(entry => ({ ...entry })));
    }

    const wanted = options && options.family;
    const pick =
      wanted === 4 || wanted === 6
        ? pinned.find(entry => entry.family === wanted)
        : pinned[0];

    if (!pick) {
      return callback(new Error('No pinned address for the requested family.'));
    }

    callback(null, pick.address, pick.family);
  };
}

const defaultResolve = hostname =>
  dns.lookup(hostname, { all: true, verbatim: true });

// Validate a URL and pin its connection to verified public IPs.
async function getPublicLookup(target, resolve = defaultResolve) {
  if (
    !['https:', 'http:'].includes(target.protocol) ||
    !target.hostname ||
    target.username ||
    target.password
  ) {
    throw new Error('Invalid stream URL.');
  }

  const hostname = target.hostname.replace(/^\[|\]$/g, '');

  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname }]
    : await resolve(hostname);

  return makePinnedLookup(normalizePublicAddresses(addresses));
}

module.exports = {
  getPublicLookup,
  makePinnedLookup,
  normalizePublicAddresses
};
