import assert from 'node:assert/strict';
import { test } from 'node:test';

import { decodeUrlPart, MalformedUrlEncodingError } from '../../index.ts';

test('decodeUrlPart: a plain and an escaped value decode', () => {
  assert.equal(decodeUrlPart('abc-123'), 'abc-123');
  assert.equal(decodeUrlPart('a%20b%2Fc'), 'a b/c');
  assert.equal(decodeUrlPart(''), '');
});

test('decodeUrlPart: a valid multi-byte sequence decodes', () => {
  assert.equal(decodeUrlPart('%E0%A4%A8'), 'न');
  assert.equal(decodeUrlPart('%F0%9F%98%80'), '\u{1F600}');
});

for (const bad of ['%E0%A4%A', '%', '%zz', 'ok%', '%C0%AF-']) {
  test(`decodeUrlPart: malformed ${JSON.stringify(bad)} throws the named error`, () => {
    assert.throws(
      () => decodeUrlPart(bad),
      (err: unknown) => err instanceof MalformedUrlEncodingError
        && err.name === 'MalformedUrlEncodingError'
        && err.message === `malformed percent-encoding in request URL: ${JSON.stringify(bad)}`,
    );
  });
}

test('decodeUrlPart: the message quotes at most an 80-character prefix', () => {
  const long = '%' + 'a'.repeat(200);
  assert.throws(
    () => decodeUrlPart(long),
    (err: unknown) => err instanceof Error && err.message === `malformed percent-encoding in request URL: ${JSON.stringify(long.slice(0, 80))}`,
  );
});
