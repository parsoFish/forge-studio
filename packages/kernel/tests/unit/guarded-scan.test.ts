/**
 * forge-8vfn.5.16 (M7-C U2, T2 review of `95cb287f`) — `guardedMtime`,
 * `selectRecentEntries` and `guardedReadFileTail` moved DOWN from
 * `packages/library` into kernel so every rank ≥ 1 package can share one
 * mechanism for a request-path scan that must not open every entry on disk.
 * These tests moved with the code (the `selectRecentEntries` cases were
 * previously `selectRecentCycles` in
 * `packages/library/tests/unit/hook-fire-summary.test.ts`); two new suites
 * (`guardedMtime`, `guardedReadFileTail`) give the two guarded fs
 * primitives direct coverage they only had indirectly (via a route
 * integration test) before this move.
 *
 * WHAT EACH TEST KILLS:
 *  - `guardedMtime`: "a real entry returns its real mtime" kills a stub
 *    that always returns `null`. "a rejected/absent entry returns null,
 *    never a fabricated value" kills a fallback that guesses `0` or `-1`
 *    instead of an honest "unknown".
 *  - `selectRecentEntries`: "keeps only the newest max" kills returning
 *    everything, or slicing before sorting. "a null mtimeOf sorts last"
 *    kills prioritising an unknown-age entry over a known one.
 *  - `guardedReadFileTail`: "reads the whole file when smaller than
 *    maxBytes" kills always truncating. "reads only the last maxBytes of a
 *    larger file" kills an unbounded read masquerading as bounded. "absent
 *    -> null" kills a fabricated empty-string success.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { guardedMtime, selectRecentEntries, guardedReadFileTail } from '../../guarded-scan.ts';

const createdDirs: string[] = [];
function makeRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

describe('guardedMtime', () => {
  it('a real entry returns its real mtime (a positive, finite number)', () => {
    const root = makeRoot('guarded-mtime-real-');
    mkdirSync(join(root, 'cycle-a'));
    const mtime = guardedMtime(root, ['cycle-a']);
    assert.equal(typeof mtime, 'number');
    assert.ok(Number.isFinite(mtime));
    assert.ok(mtime! > 0);
  });

  it('an absent entry returns null, never a fabricated value', () => {
    const root = makeRoot('guarded-mtime-absent-');
    assert.equal(guardedMtime(root, ['does-not-exist']), null);
  });

  it('a rejected segment (path traversal) returns null', () => {
    const root = makeRoot('guarded-mtime-reject-');
    assert.equal(guardedMtime(root, ['..', 'escape']), null);
  });
});

describe('selectRecentEntries', () => {
  it('keeps only the newest `max` entries, by the injected mtimeOf', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const mtimeOf = (id: string): number => ({ a: 1, b: 5, c: 3, d: 4, e: 2 })[id]!;
    assert.deepEqual(selectRecentEntries(ids, mtimeOf, 3), ['b', 'd', 'c']);
  });

  it('an entry whose mtimeOf returns null sorts LAST, never prioritised over a known age', () => {
    const ids = ['known-old', 'unknown', 'known-new'];
    const mtimeOf = (id: string): number | null => (id === 'unknown' ? null : id === 'known-new' ? 100 : 1);
    assert.deepEqual(selectRecentEntries(ids, mtimeOf, 3), ['known-new', 'known-old', 'unknown']);
  });

  it('max >= entries.length returns everything, still sorted newest-first', () => {
    const ids = ['old', 'new'];
    const mtimeOf = (id: string): number => (id === 'new' ? 100 : 1);
    assert.deepEqual(selectRecentEntries(ids, mtimeOf, 50), ['new', 'old']);
  });
});

describe('guardedReadFileTail', () => {
  it('reads the whole file when it is smaller than maxBytes', () => {
    const root = makeRoot('guarded-tail-whole-');
    writeFileSync(join(root, 'events.jsonl'), 'line-one\nline-two\n', 'utf8');
    assert.equal(guardedReadFileTail(root, ['events.jsonl'], 1024), 'line-one\nline-two\n');
  });

  it('reads only the LAST maxBytes of a file larger than the bound', () => {
    const root = makeRoot('guarded-tail-bounded-');
    const body = 'x'.repeat(100) + 'THE-TAIL';
    writeFileSync(join(root, 'events.jsonl'), body, 'utf8');
    const tail = guardedReadFileTail(root, ['events.jsonl'], 8);
    assert.equal(tail, 'THE-TAIL', `expected exactly the last 8 bytes, got ${JSON.stringify(tail)}`);
  });

  it('an absent file returns null, never a fabricated empty string', () => {
    const root = makeRoot('guarded-tail-absent-');
    assert.equal(guardedReadFileTail(root, ['does-not-exist.jsonl'], 1024), null);
  });

  it('an empty file returns the empty string, distinct from absent (null)', () => {
    const root = makeRoot('guarded-tail-empty-');
    writeFileSync(join(root, 'events.jsonl'), '', 'utf8');
    assert.equal(guardedReadFileTail(root, ['events.jsonl'], 1024), '');
  });
});
