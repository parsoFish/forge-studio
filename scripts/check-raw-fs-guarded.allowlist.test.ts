/**
 * check-raw-fs-guarded.allowlist.test.ts — the STRUCTURAL ROW CONTRACT for the
 * audited-residual ledger (scripts/check-raw-fs-guarded.allowlist.mjs).
 *
 * Ruling 106 extracted the data out of the guard; this test travelled with it,
 * verbatim, because it asserts a property of the ROWS (every row names a file,
 * a line, a substantive reason and a real sink), not of the scanner. The
 * guard's own contract — the def-use walk, suppression, staleness, the live
 * repo gate — stays in check-raw-fs-guarded.test.ts.
 *
 * `RAW_FS_SINKS` still comes from the guard: the sink vocabulary is the
 * scanner's, and a row is well-formed only against the sinks the scanner knows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ALLOWLIST } from './check-raw-fs-guarded.allowlist.mjs';
import { RAW_FS_SINKS } from './check-raw-fs-guarded.mjs';

test('C4: every real allowlist row is well-formed (file, line, a reason, and an audited sink)', () => {
  // A structural integrity gate on the allowlist itself — a row with no reason
  // or no sink identity is not an audited residual, it is a silent skip.
  //
  // Bead 5.49: `&& ALLOWLIST.length > 0` forbade ever emptying the audited list.
  assert.ok(Array.isArray(ALLOWLIST));
  for (const a of ALLOWLIST) {
    assert.equal(typeof a.file, 'string');
    assert.equal(typeof a.line, 'number');
    assert.ok(a.reason && a.reason.trim().length > 20, `row ${a.file}:${a.line} needs a substantive reason`);
    const sinks = a.sinks ?? (a.sink ? [a.sink] : []);
    assert.ok(sinks.length > 0, `row ${a.file}:${a.line} must name the audited sink(s)`);
    for (const s of sinks) assert.ok(RAW_FS_SINKS.includes(s), `row ${a.file}:${a.line} names non-sink "${s}"`);
  }
});
