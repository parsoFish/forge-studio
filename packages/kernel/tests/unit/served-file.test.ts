import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { contentTypeByExtension, resolveByteRange, guardedByteReader } from '../../served-file.ts';

test('contentTypeByExtension: case-insensitive, leaf-only, undefined when unknown', () => {
  assert.equal(contentTypeByExtension('a/b/clip.WEBM'), 'video/webm');
  assert.equal(contentTypeByExtension('.capture/x.out'), undefined);
  assert.equal(contentTypeByExtension('noext'), undefined);
  assert.equal(contentTypeByExtension('.json'), undefined, 'a dotfile has no extension');
  assert.equal(contentTypeByExtension('x.constructor'), undefined, 'prototype keys are not extensions');
  assert.equal(contentTypeByExtension('x.__proto__'), undefined);
});

test('resolveByteRange: single ranges resolve, clamp and reject per RFC 9110', () => {
  assert.deepEqual(resolveByteRange(undefined, 10), { kind: 'full' });
  assert.deepEqual(resolveByteRange('bytes=2-4', 10), { kind: 'partial', start: 2, end: 4 });
  assert.deepEqual(resolveByteRange('bytes=2-', 10), { kind: 'partial', start: 2, end: 9 });
  assert.deepEqual(resolveByteRange('bytes=0-99', 10), { kind: 'partial', start: 0, end: 9 });
  assert.deepEqual(resolveByteRange('bytes=-3', 10), { kind: 'partial', start: 7, end: 9 });
  assert.deepEqual(resolveByteRange('bytes=-30', 10), { kind: 'partial', start: 0, end: 9 });
  assert.deepEqual(resolveByteRange('bytes=10-', 10), { kind: 'unsatisfiable' });
  assert.deepEqual(resolveByteRange('bytes=-0', 10), { kind: 'unsatisfiable' });
  assert.deepEqual(resolveByteRange('bytes=0-', 0), { kind: 'unsatisfiable' }, 'empty file has no satisfiable range');
  assert.deepEqual(resolveByteRange('bytes=99999999999999999999-', 10), { kind: 'unsatisfiable' });
  for (const bad of ['bytes=0-1,3-4', 'bytes=', 'bytes=-', 'bytes=5-2', 'bytes=a-b', 'items=0-1', '', 'bytes=0-1-2']) {
    assert.deepEqual(resolveByteRange(bad, 10), { kind: 'full' }, bad);
  }
});

test('guardedByteReader: bytes and slices, refuses symlink / directory / absent', async () => {
  const root = mkdtempSync(join(tmpdir(), 'byte-reader-'));
  const outside = mkdtempSync(join(tmpdir(), 'byte-reader-out-'));
  try {
    const data = Buffer.from([0, 255, 128, 7, 200]);
    mkdirSync(join(root, 'd'));
    writeFileSync(join(root, 'd', 'f.bin'), data);
    writeFileSync(join(outside, 'secret'), data);
    symlinkSync(join(outside, 'secret'), join(root, 'd', 'link'), 'file');
    const r = guardedByteReader(root, ['d', 'f.bin']);
    assert.ok(r);
    assert.equal(r.size, 5);
    const read = async (s: ReturnType<typeof r.open>) => {
      const chunks: Buffer[] = [];
      for await (const c of s) chunks.push(c as Buffer);
      return Buffer.concat(chunks);
    };
    assert.ok((await read(r.open())).equals(data));
    assert.ok((await read(r.open({ start: 1, end: 2 }))).equals(data.subarray(1, 3)));
    assert.equal(guardedByteReader(root, ['d', 'link']), null);
    assert.equal(guardedByteReader(root, ['d']), null, 'a directory is not a file');
    assert.equal(guardedByteReader(root, ['d', 'nope']), null);
    assert.equal(guardedByteReader(root, ['..', 'x']), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});
