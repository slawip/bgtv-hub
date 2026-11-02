'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSigner } = require('../lib/sign');

test('accepts a valid signature', () => {
  const { sign, verify } = createSigner('secret');
  assert.equal(verify('bnt1', 'https://a.test/x.ts', sign('bnt1', 'https://a.test/x.ts')), true);
});

test('rejects a changed URL, a different channel and bad input', () => {
  const { sign, verify } = createSigner('secret');
  const sig = sign('bnt1', 'https://a.test/x.ts');

  assert.equal(verify('bnt1', 'https://a.test/y.ts', sig), false);
  assert.equal(verify('nova', 'https://a.test/x.ts', sig), false);
  assert.equal(verify('bnt1', 'https://a.test/x.ts', 'short'), false);
  assert.equal(verify('bnt1', 'https://a.test/x.ts', undefined), false);
});

test('signatures differ between secrets and ephemeral is reported', () => {
  const a = createSigner('one');
  const b = createSigner('two');
  const c = createSigner('');

  assert.notEqual(a.sign('x', 'y'), b.sign('x', 'y'));
  assert.equal(a.ephemeral, false);
  assert.equal(c.ephemeral, true);
});
