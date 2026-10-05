/**
 * The one emergency halt record (D-03): `<queueRoot>/halt.json` present =
 * halted, absent = not. An unreadable record reads as halted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { haltPath, readHalt, releaseHalt, writeHalt } from '../../halt.ts';

function withQueue(fn: (queueRoot: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'forge-halt-'));
  const queueRoot = join(dir, '_queue');
  mkdirSync(queueRoot, { recursive: true });
  try {
    fn(queueRoot);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('haltPath: <queueRoot>/halt.json', () => {
  assert.equal(haltPath('/q'), '/q/halt.json');
});

test('readHalt: an absent record is not halted (null)', () => {
  withQueue((q) => assert.equal(readHalt(q), null));
});

test('readHalt: a missing queue root is not halted either', () => {
  assert.equal(readHalt(join(tmpdir(), 'forge-halt-no-such-root-xyz')), null);
});

test('writeHalt: writes { since, actor } atomically and readHalt returns it', () => {
  withQueue((q) => {
    const rec = writeHalt(q, 'operator');
    assert.equal(rec.actor, 'operator');
    assert.ok(typeof rec.since === 'string' && !Number.isNaN(Date.parse(rec.since)));
    assert.deepEqual(readHalt(q), rec);
    assert.deepEqual(JSON.parse(readFileSync(haltPath(q), 'utf8')), rec);
    assert.deepEqual(readdirSync(q), ['halt.json'], 'no tmp file is left behind');
  });
});

test('writeHalt: a second press keeps the first since (idempotent)', () => {
  withQueue((q) => {
    writeFileSync(haltPath(q), JSON.stringify({ since: '2026-01-01T00:00:00.000Z', actor: 'operator' }));
    const again = writeHalt(q, 'someone-else');
    assert.deepEqual(again, { since: '2026-01-01T00:00:00.000Z', actor: 'operator' });
    assert.equal(JSON.parse(readFileSync(haltPath(q), 'utf8')).since, '2026-01-01T00:00:00.000Z');
  });
});

test('readHalt: an unparseable record reads as halted with null since/actor (fail closed)', () => {
  withQueue((q) => {
    writeFileSync(haltPath(q), '{not json');
    assert.deepEqual(readHalt(q), { since: null, actor: null });
  });
});

test('readHalt: a parseable record of the wrong shape reads as halted', () => {
  withQueue((q) => {
    writeFileSync(haltPath(q), JSON.stringify(['x']));
    assert.deepEqual(readHalt(q), { since: null, actor: null });
  });
});

test('writeHalt over a corrupt record replaces it with a valid one', () => {
  withQueue((q) => {
    writeFileSync(haltPath(q), 'garbage');
    const rec = writeHalt(q, 'operator');
    assert.ok(rec.since !== null);
    assert.deepEqual(readHalt(q), rec);
  });
});

test('releaseHalt: removes the record; absent is a no-op', () => {
  withQueue((q) => {
    writeHalt(q, 'operator');
    releaseHalt(q);
    assert.equal(readHalt(q), null);
    assert.doesNotThrow(() => releaseHalt(q));
  });
});
