/**
 * forge-6gv.8.1 (library-33) — `readBoundedLog`/`appendBoundedLog`: a
 * generic, guarded, per-key JSON-array log with bounded retention. Written
 * for the hook test-fire run history (`packages/library/bridge-studio-hooks-
 * test-fire.ts`), but domain-agnostic — `T` is opaque to this module.
 *
 * WHAT EACH TEST KILLS:
 *  - "absent -> []" kills a version that throws instead of treating a
 *    never-written log as empty.
 *  - "append then read round-trips, newest first" kills an implementation
 *    that appends to the END (oldest-first) or drops the entry entirely.
 *  - "bounded: never exceeds max" kills an unbounded append (the exact
 *    "bounded retention" property this module exists for).
 *  - "corrupt file reads as empty, never throws" kills a JSON.parse left
 *    unguarded.
 *  - "a rejected containment path returns null on append, [] on read" kills
 *    a version that throws past the guard instead of reporting refusal the
 *    same way `guardedWriteFile`/`guardedReadFile` already do.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readBoundedLog, appendBoundedLog, boundedLogSegments, truncateTail } from '../../bounded-log.ts';

const createdDirs: string[] = [];
function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bounded-log-'));
  createdDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

type Entry = { at: string; n: number };

describe('readBoundedLog', () => {
  it('a never-written log reads as [] (never a throw)', () => {
    const root = makeRoot();
    assert.deepEqual(readBoundedLog<Entry>(root, ['x.json']), []);
  });

  it('a corrupt (non-JSON) file reads as [] rather than throwing', () => {
    const root = makeRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'x.json'), 'not json{{{', 'utf8');
    assert.deepEqual(readBoundedLog<Entry>(root, ['x.json']), []);
  });

  it('a JSON file that is not an array reads as [], never a fabricated wrap', () => {
    const root = makeRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'x.json'), JSON.stringify({ not: 'an array' }), 'utf8');
    assert.deepEqual(readBoundedLog<Entry>(root, ['x.json']), []);
  });
});

describe('appendBoundedLog', () => {
  it('append then read round-trips, newest entry first', () => {
    const root = makeRoot();
    appendBoundedLog<Entry>(root, ['x.json'], { at: 'a', n: 1 }, 10);
    appendBoundedLog<Entry>(root, ['x.json'], { at: 'b', n: 2 }, 10);
    const log = readBoundedLog<Entry>(root, ['x.json']);
    assert.deepEqual(log, [{ at: 'b', n: 2 }, { at: 'a', n: 1 }]);
  });

  it('never holds more than max entries — the oldest falls off', () => {
    const root = makeRoot();
    for (let i = 0; i < 5; i++) appendBoundedLog<Entry>(root, ['x.json'], { at: `e${i}`, n: i }, 3);
    const log = readBoundedLog<Entry>(root, ['x.json']);
    assert.equal(log.length, 3, `expected exactly 3 entries (bounded), got ${log.length}`);
    assert.deepEqual(log.map((e) => e.n), [4, 3, 2], 'must keep the 3 NEWEST, dropping the oldest');
  });

  it('a rejected containment path (traversal segment) returns null, never throws', () => {
    const root = makeRoot();
    const result = appendBoundedLog<Entry>(root, ['..', 'escape.json'], { at: 'x', n: 1 }, 10);
    assert.equal(result, null);
  });
});

describe('boundedLogSegments', () => {
  it('builds [dir, "<id>.json"] — the one derivation every reader/writer shares', () => {
    assert.deepEqual(boundedLogSegments('_hook-test-fires', 'my-hook'), ['_hook-test-fires', 'my-hook.json']);
  });
});

describe('truncateTail', () => {
  it('leaves a short string unchanged', () => {
    assert.equal(truncateTail('ok', 10), 'ok');
  });

  it('truncates a long string to maxChars and appends a marker', () => {
    const result = truncateTail('a'.repeat(20), 10);
    assert.equal(result, `${'a'.repeat(10)}…(truncated)`);
  });
});
