/**
 * check-raw-fs-guarded.allowlist.test.ts — the audited-residual ledger's OWN
 * contract (scripts/check-raw-fs-guarded.allowlist.mjs): the STRUCTURAL row
 * shape (every row names a file, an anchor, a substantive reason and a real
 * sink — C4/C5) AND, since bead forge-mlk moved `applyAllowlist` itself into
 * this module, its BEHAVIORAL contract too (suppress / reason-required /
 * mistargeted / stale / ambiguous / count — groups B and H, moved here
 * verbatim from check-raw-fs-guarded.test.ts). The scanner's OWN contract —
 * the def-use walk, the live repo gate — stays in check-raw-fs-guarded.test.ts.
 *
 * `RAW_FS_SINKS` still comes from the guard: the sink vocabulary is the
 * scanner's, and a row is well-formed only against the sinks the scanner knows.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ALLOWLIST, applyAllowlist } from './check-raw-fs-guarded.allowlist.mjs';
import { RAW_FS_SINKS } from './check-raw-fs-guarded.mjs';

test('C4: every real allowlist row is well-formed (file, anchor, a reason, and an audited sink)', () => {
  // A structural integrity gate on the allowlist itself — a row with no reason
  // or no sink identity is not an audited residual, it is a silent skip.
  //
  // Bead 5.49: `&& ALLOWLIST.length > 0` forbade ever emptying the audited list.
  // Bead forge-mlk: `anchor` (not `line`) is the actual matching key — `line`
  // is now display-only, so it is checked for TYPE but is never part of the
  // content-key contract this test enforces.
  assert.ok(Array.isArray(ALLOWLIST));
  for (const a of ALLOWLIST) {
    assert.equal(typeof a.file, 'string');
    assert.equal(typeof a.line, 'number');
    assert.ok(typeof a.anchor === 'string' && a.anchor.includes('::'), `row ${a.file} (anchor "${a.anchor}") needs a well-formed anchor (enclosingFn::path)`);
    if (a.count !== undefined) assert.ok(Number.isInteger(a.count) && a.count > 1, `row ${a.file} anchor="${a.anchor}" has a non-trivial count field (${a.count}) — omit count entirely for the default budget of 1`);
    assert.ok(a.reason && a.reason.trim().length > 20, `row ${a.file} anchor="${a.anchor}" needs a substantive reason`);
    const sinks = a.sinks ?? (a.sink ? [a.sink] : []);
    assert.ok(sinks.length > 0, `row ${a.file} anchor="${a.anchor}" must name the audited sink(s)`);
    for (const s of sinks) assert.ok(RAW_FS_SINKS.includes(s), `row ${a.file} anchor="${a.anchor}" names non-sink "${s}"`);
  }
});

test('C5 (bead forge-mlk): no two DIFFERENT allowlist rows collide on the same {file, anchor} — a content-key collision must be visible at authoring time, not just at scan time', () => {
  const seen = new Map();
  for (const a of ALLOWLIST) {
    const k = `${a.file}\u0000${a.anchor}`;
    assert.ok(!seen.has(k), `rows collide on the SAME key (${a.file}, anchor="${a.anchor}") — merge them into one row (with an explicit \`count\` if the anchor is genuinely audited at more than one location)`);
    seen.set(k, a);
  }
});

// =============================================================================
// Group B — the suppression/staleness contract (bead forge-mlk: CONTENT-keyed
// — {file, anchor}, anchor = enclosing-function-name::normalized-path-expr —
// never {file, line}. A row's `line` is carried for display only; changing
// it alone must never affect matching (H1 pins exactly this).
// =============================================================================

/** A synthetic tainted finding, as analyzeModule would emit it (anchor
 *  included — analyzeModule always sets one; a fixture that omits it would
 *  test a shape applyAllowlist never actually sees). */
const taintedFinding = (file = 'cli/ui-bridge.ts', line = 42, sink = 'writeFileSync', anchor = 'handleSave::join(projectsRoot, body.project, \'x.json\')') => ({
  file, line, sink, anchor, path: `join(projectsRoot, body.project, 'x.json')`, kind: 'tainted',
  why: 'request/project-derived path via "body.project" reaches raw writeFileSync unguarded',
});

test('B1: a finding with no allowlist entry is KEPT (fails the build)', () => {
  const { kept, suppressed } = applyAllowlist([taintedFinding()], []);
  assert.equal(kept.length, 1);
  assert.equal(suppressed.length, 0);
});

test('B2: a finding with a valid, reasoned allowlist entry (file+anchor+sink) is suppressed', () => {
  const f = taintedFinding();
  const { kept, suppressed } = applyAllowlist([f], [
    { file: f.file, line: f.line, anchor: f.anchor, sink: f.sink, reason: 'AUDITED: trusted-constant residual, boolean probe' },
  ]);
  assert.equal(kept.length, 0);
  assert.equal(suppressed.length, 1);
  assert.match(suppressed[0].reason, /AUDITED/);
});

test('B3: an allowlist entry with an empty reason does NOT suppress (never a silent skip)', () => {
  const f = taintedFinding();
  const { kept, suppressed } = applyAllowlist([f], [{ file: f.file, line: f.line, anchor: f.anchor, sink: f.sink, reason: '   ' }]);
  assert.equal(suppressed.length, 0);
  assert.equal(kept.length, 1);
  assert.match(kept[0].why, /NO REASON/);
});

test('B4: a MISTARGETED entry (the anchor matches but the recorded sink does not) does NOT suppress', () => {
  // Kills: an anchor-only match that would silently bless whatever sink is
  // actually at that anchor after an unrelated edit changed it.
  const f = taintedFinding('cli/ui-bridge.ts', 42, 'writeFileSync');
  const { kept, suppressed, mistargeted } = applyAllowlist([f], [
    { file: f.file, line: f.line, anchor: f.anchor, sink: 'existsSync', reason: 'AUDITED: was a boolean probe here' },
  ]);
  assert.equal(suppressed.length, 0);
  assert.equal(kept.length, 1);
  assert.equal(mistargeted.length, 1);
});

test('B4b: a `sinks` array entry suppresses ANY listed sink at that anchor', () => {
  const a = taintedFinding('cli/bridge-studio-writes.ts', 919, 'existsSync', 'handleWrites::p');
  const b = { ...taintedFinding('cli/bridge-studio-writes.ts', 919, 'mkdirSync', 'handleWrites::p'), kind: 'tainted' };
  const { kept, suppressed } = applyAllowlist([a, b], [
    { file: 'cli/bridge-studio-writes.ts', line: 919, anchor: 'handleWrites::p', sinks: ['existsSync', 'mkdirSync'], reason: 'AUDITED: both ride the same containment proof' },
  ]);
  assert.equal(kept.length, 0);
  assert.equal(suppressed.length, 2);
});

test('B5: an allowlist entry matching NO finding is STALE (reported, never fails)', () => {
  const { kept, stale } = applyAllowlist([], [
    { file: 'cli/ui-bridge.ts', line: 99999, anchor: 'gone::nowhere', sink: 'existsSync', reason: 'AUDITED: a residual that has since been fixed/moved' },
  ]);
  assert.equal(kept.length, 0, 'a stale entry cannot create a failure');
  assert.equal(stale.length, 1);
});

// -----------------------------------------------------------------------
// Group H — the CONTENT-KEY itself (bead forge-mlk). H1/H2 are the bead's
// own named red fixtures; H3/H4 pin the ambiguity/count design the
// {file,line}->{file,anchor} swap required (an anchor collision must be a
// NAMED error, never a silent double-suppress or a silently-widened budget).
// -----------------------------------------------------------------------

test('H1 (RED under the OLD {file,line} key, GREEN under the anchor key): a row survives its line shifting by N when the audited STATEMENT is unchanged', () => {
  // Kills: reverting the key back to {file,line} — see the mutation note
  // below. The row below names line 42; the finding it must still suppress
  // sits at line 55 (+13, as an unrelated insertion above it would cause) —
  // same function, same sink, same path expression, byte-identical.
  const shifted = taintedFinding('cli/ui-bridge.ts', 55, 'writeFileSync', 'handleSave::join(projectsRoot, body.project, \'x.json\')');
  const row = { file: 'cli/ui-bridge.ts', line: 42, anchor: 'handleSave::join(projectsRoot, body.project, \'x.json\')', sink: 'writeFileSync', reason: 'AUDITED: trusted-constant residual, boolean probe' };
  const { kept, suppressed, stale } = applyAllowlist([shifted], [row]);
  assert.equal(suppressed.length, 1, 'content-keyed: line drift alone does not stale the row');
  assert.equal(kept.length, 0);
  assert.equal(stale.length, 0);
  // MUTATION PROOF (inline, not a separate revert-the-source-and-rerun step —
  // this IS the swap-the-fix twin): keying by {file,line} INSTEAD of
  // {file,anchor} is exactly what this test kills. Prove it here: the OLD
  // key would find no row at (file, 55) and keep the finding.
  const oldKeyed = new Map([[`${row.file}:${row.line}`, row]]);
  const oldLookup = oldKeyed.get(`${shifted.file}:${shifted.line}`);
  assert.equal(oldLookup, undefined, 'the line-keyed lookup the old scheme used would miss this row entirely (STALE, finding KEPT) — the anchor key is the fix');
});

test('H2 (RED): a row goes STALE when the audited STATEMENT changes, even at the SAME line/anchor text the row still names', () => {
  // The audit no longer covers the new code — content-keying must not paper
  // over a changed expression just because it landed at a familiar spot.
  const row = { file: 'cli/ui-bridge.ts', line: 42, anchor: 'handleSave::join(projectsRoot, body.project, \'x.json\')', sink: 'writeFileSync', reason: 'AUDITED: trusted-constant residual, boolean probe' };
  const changed = taintedFinding('cli/ui-bridge.ts', 42, 'writeFileSync', 'handleSave::join(projectsRoot, body.projectId, \'x.json\')');
  const { kept, suppressed, stale } = applyAllowlist([changed], [row]);
  assert.equal(suppressed.length, 0, 'a different path expression is a DIFFERENT anchor — not suppressed');
  assert.equal(kept.length, 1);
  assert.equal(stale.length, 1, 'the row now suppresses nothing — reported stale, not silently dropped');
});

test('H3 (RED): an anchor matching findings at TWO DISTINCT, unrelated lines is AMBIGUOUS — a named error, both findings KEPT (fails closed)', () => {
  // Kills: a row that (accidentally or not) absorbs a second, un-audited
  // occurrence of an identical statement elsewhere in the same function —
  // the exact silent-widening the fold-allowlist's own docstring discloses
  // as a KNOWN limit; this ledger is stricter by design (bead forge-mlk).
  const a = taintedFinding('cli/ui-bridge.ts', 10, 'writeFileSync', 'handle::p');
  const b = taintedFinding('cli/ui-bridge.ts', 20, 'writeFileSync', 'handle::p');
  const row = { file: 'cli/ui-bridge.ts', line: 10, anchor: 'handle::p', sink: 'writeFileSync', reason: 'AUDITED: single occurrence audited here' };
  const { kept, suppressed, ambiguous } = applyAllowlist([a, b], [row]);
  assert.equal(suppressed.length, 0);
  assert.equal(kept.length, 2, 'both findings fail closed while the anchor is ambiguous');
  assert.equal(ambiguous.length, 2, 'one ambiguous-outcome record per affected finding');
  assert.match(kept[0].why, /ambiguous/i);
});

test('H4: a row with an explicit `count` budget covers that many DISTINCT locations under ONE anchor — a genuinely recurring audited fact, not silent widening', () => {
  // Precedent: PROJECTS_ROOT_FOLD_ALLOWLIST's own `count`. Real case this
  // models: a two-path sink's source+dest sharing a token (renameSync(p, p))
  // or the same binding read in two branches of one function.
  const a = taintedFinding('cli/ui-bridge.ts', 10, 'writeFileSync', 'handle::p');
  const b = taintedFinding('cli/ui-bridge.ts', 20, 'writeFileSync', 'handle::p');
  const row = { file: 'cli/ui-bridge.ts', line: 10, anchor: 'handle::p', sink: 'writeFileSync', count: 2, reason: 'AUDITED: same binding, read at both call sites' };
  const { kept, suppressed, ambiguous } = applyAllowlist([a, b], [row]);
  assert.equal(ambiguous.length, 0);
  assert.equal(suppressed.length, 2);
  assert.equal(kept.length, 0);
  // a THIRD occurrence pushes distinct-line count (3) past the declared
  // budget (2) — the WHOLE group fails closed (no partial pick of "which 2
  // were the audited ones"), same fail-closed posture as the bare (no
  // `count`) ambiguous case above.
  const c = taintedFinding('cli/ui-bridge.ts', 30, 'writeFileSync', 'handle::p');
  const over = applyAllowlist([a, b, c], [row]);
  assert.equal(over.ambiguous.length, 3, 'a fresh, un-audited occurrence beyond the declared count is still ambiguous, never silently absorbed');
  assert.equal(over.kept.length, 3);
});
