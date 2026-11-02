'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPublicLookup,
  normalizePublicAddresses
} = require('../lib/net-guard');

test('rejects loopback, private and link-local addresses', () => {
  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1'
  ]) {
    assert.throws(() => normalizePublicAddresses([{ address }]), /non-public/, address);
  }
});

test('rejects the whole host if any address is non-public', () => {
  assert.throws(() =>
    normalizePublicAddresses([{ address: '8.8.8.8' }, { address: '10.0.0.5' }])
  );
});

test('accepts public addresses', () => {
  const out = normalizePublicAddresses([
    { address: '8.8.8.8' },
    { address: '2001:4860:4860::8888' }
  ]);
  assert.deepEqual(out.map(entry => entry.family), [4, 6]);
});

test('pinned lookup supports both { all: true } and single-address calls', async () => {
  const lookup = await getPublicLookup(new URL('http://8.8.8.8/x'));

  await new Promise(resolve =>
    lookup('ignored', { all: true }, (err, list) => {
      assert.equal(err, null);
      assert.deepEqual(list, [{ address: '8.8.8.8', family: 4 }]);
      resolve();
    })
  );

  await new Promise(resolve =>
    lookup('ignored', {}, (err, address, family) => {
      assert.equal(err, null);
      assert.equal(address, '8.8.8.8');
      assert.equal(family, 4);
      resolve();
    })
  );
});

test('resolves hostnames through the injected resolver and validates them', async () => {
  const bad = () => Promise.resolve([{ address: '127.0.0.1', family: 4 }]);
  await assert.rejects(() => getPublicLookup(new URL('https://evil.test/'), bad), /non-public/);

  const good = () => Promise.resolve([{ address: '1.1.1.1', family: 4 }]);
  assert.equal(typeof (await getPublicLookup(new URL('https://ok.test/'), good)), 'function');
});

test('rejects non-http protocols and credentials in the URL', async () => {
  await assert.rejects(() => getPublicLookup(new URL('file:///etc/passwd')), /Invalid/);
  await assert.rejects(() => getPublicLookup(new URL('http://user:pw@8.8.8.8/')), /Invalid/);
});
