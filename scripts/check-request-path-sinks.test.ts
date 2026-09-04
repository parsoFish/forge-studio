/**
 * check-request-path-sinks.test.ts — TDD contract for
 * scripts/check-request-path-sinks.mjs (SEC-03 WI-4, no-new-unguarded-sinks
 * ratchet).
 *
 * Group 1 exercises the reachability walker and the ratchet comparison
 * against a synthetic TEMP FIXTURE TREE (mkdtempSync) — never the real repo
 * — so every case here is deterministic and independent of what forge's own
 * code currently looks like.
 *
 * Group 2 is the CI-enforced gate: it runs the REAL check against the real
 * repository (via the exported runCheck(), no subprocess) and asserts it
 * currently passes clean.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  findReachableModules,
  listEntryModules,
  DISPATCH_ENTRY_MODULES,
  countSinks,
  analyze,
  formatBaseline,
  parseBaseline,
  compareBaseline,
  runCheck,
} from './check-request-path-sinks.mjs';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Namespace import (NOT a named import) so probing a not-yet-built export
// yields `undefined` rather than an ESM link-time SyntaxError that would take
// the whole file down — see the SEC-04 caller-count group at the bottom.
import * as ratchet from './check-request-path-sinks.mjs';

// =============================================================================
// Group 1 — synthetic fixture tree
// =============================================================================

/** Build a minimal fixture repo: apps/forge/ui-bridge.ts (the entry point) imports
 *  orchestrator/reached.ts. orchestrator/unreached.ts exists on disk but is
 *  never imported by anything reachable. Returns the fixture root; caller is
 *  responsible for cleanup via rmSync. */
function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'sinks-fixture-'));
  mkdirSync(join(root, 'cli'), { recursive: true });
  mkdirSync(join(root, 'orchestrator'), { recursive: true });

  writeFileSync(
    join(root, 'cli/ui-bridge.ts'),
    [
      "import { readReached } from '../orchestrator/reached.ts';",
      'export function handle() { return readReached(); }',
      '',
    ].join('\n')
  );

  writeFileSync(
    join(root, 'orchestrator/reached.ts'),
    [
      "import { existsSync, writeFileSync } from 'node:fs';",
      'export function readReached() {',
      "  writeFileSync('/tmp/out', 'x');",
      "  return existsSync('/tmp/out');",
      '}',
      '',
    ].join('\n')
  );

  // Sink present, but NOT reachable from any bridge entry module.
  writeFileSync(
    join(root, 'orchestrator/unreached.ts'),
    [
      "import { readFileSync } from 'node:fs';",
      "export function readUnreached() { return readFileSync('/tmp/other'); }",
      '',
    ].join('\n')
  );

  // A bridge-*.ts entry that is a *.test.ts must NOT be treated as an entry.
  writeFileSync(join(root, 'cli/bridge-ignored.test.ts'), "import { unlinkSync } from 'node:fs';\nunlinkSync('/tmp/z');\n");

  return root;
}

function baselinePathFor(root: string): string {
  return join(root, 'baseline.txt');
}

test('reachability: entry module and its transitive relative import are both reachable', () => {
  const root = makeFixture();
  try {
    const reachable = findReachableModules(root);
    assert.ok(reachable.includes('cli/ui-bridge.ts'));
    assert.ok(reachable.includes('orchestrator/reached.ts'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('reachability: a *.test.ts file is never treated as an entry module', () => {
  const root = makeFixture();
  try {
    const reachable = findReachableModules(root);
    assert.ok(!reachable.includes('cli/bridge-ignored.test.ts'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sink in a module NOT reachable from any bridge entry is NOT counted', () => {
  const root = makeFixture();
  try {
    const { reachable, rows } = analyze(root);
    assert.ok(!reachable.includes('orchestrator/unreached.ts'));
    assert.ok(!rows.some((r) => r.file === 'orchestrator/unreached.ts'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a sink becomes reachable when an import is added, and IS then counted', () => {
  const root = makeFixture();
  try {
    let { rows } = analyze(root);
    assert.ok(!rows.some((r) => r.file === 'orchestrator/unreached.ts'));

    // Wire orchestrator/reached.ts to also import orchestrator/unreached.ts.
    writeFileSync(
      join(root, 'orchestrator/reached.ts'),
      [
        "import { existsSync, writeFileSync } from 'node:fs';",
        "import { readUnreached } from './unreached.ts';",
        'export function readReached() {',
        "  writeFileSync('/tmp/out', 'x');",
        '  readUnreached();',
        "  return existsSync('/tmp/out');",
        '}',
        '',
      ].join('\n')
    );

    ({ rows } = analyze(root));
    const row = rows.find((r) => r.file === 'orchestrator/unreached.ts' && r.sink === 'readFileSync');
    assert.ok(row, 'orchestrator/unreached.ts readFileSync should now be counted');
    assert.equal(row.count, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('comment filter: a sink-shaped call on a commented-out line is not counted', () => {
  const root = makeFixture();
  try {
    writeFileSync(
      join(root, 'orchestrator/reached.ts'),
      [
        "import { existsSync, writeFileSync } from 'node:fs';",
        'export function readReached() {',
        "  // writeFileSync('/tmp/should-not-count', 'x');",
        "  writeFileSync('/tmp/out', 'x');",
        "  return existsSync('/tmp/out');",
        '}',
        '',
      ].join('\n')
    );
    const { rows } = analyze(root);
    const row = rows.find((r) => r.file === 'orchestrator/reached.ts' && r.sink === 'writeFileSync');
    assert.ok(row, 'orchestrator/reached.ts writeFileSync should be counted');
    assert.equal(row.count, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ratchet: a NEW (file, sink) pair not present in the baseline FAILS', () => {
  const root = makeFixture();
  const baselinePath = baselinePathFor(root);
  try {
    // Baseline captured BEFORE reached.ts calls existsSync.
    const baselineRows = countSinks(root, findReachableModules(root)).filter((r) => r.sink !== 'existsSync');
    writeFileSync(baselinePath, formatBaseline(baselineRows));

    const code = runCheck({ root, baselinePath });
    assert.equal(code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ratchet: an INCREASED count for an existing pair FAILS', () => {
  const root = makeFixture();
  const baselinePath = baselinePathFor(root);
  try {
    runCheck({ root, baselinePath, write: true });
    assert.equal(runCheck({ root, baselinePath }), 0, 'sanity: unchanged tree passes right after --write');

    writeFileSync(
      join(root, 'orchestrator/reached.ts'),
      [
        "import { existsSync, writeFileSync } from 'node:fs';",
        'export function readReached() {',
        "  writeFileSync('/tmp/out', 'x');",
        "  writeFileSync('/tmp/out2', 'y');", // second call: count goes 1 -> 2
        "  return existsSync('/tmp/out');",
        '}',
        '',
      ].join('\n')
    );

    const code = runCheck({ root, baselinePath });
    assert.equal(code, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ratchet: a DECREASED count PASSES and is reported as tightenable (never fails)', () => {
  const root = makeFixture();
  const baselinePath = baselinePathFor(root);
  try {
    // Baseline has TWO writeFileSync calls.
    writeFileSync(
      join(root, 'orchestrator/reached.ts'),
      [
        "import { existsSync, writeFileSync } from 'node:fs';",
        'export function readReached() {',
        "  writeFileSync('/tmp/out', 'x');",
        "  writeFileSync('/tmp/out2', 'y');",
        "  return existsSync('/tmp/out');",
        '}',
        '',
      ].join('\n')
    );
    runCheck({ root, baselinePath, write: true });

    // Now drop back to one call.
    writeFileSync(
      join(root, 'orchestrator/reached.ts'),
      [
        "import { existsSync, writeFileSync } from 'node:fs';",
        'export function readReached() {',
        "  writeFileSync('/tmp/out', 'x');",
        "  return existsSync('/tmp/out');",
        '}',
        '',
      ].join('\n')
    );

    const code = runCheck({ root, baselinePath });
    assert.equal(code, 0);

    const { rows } = analyze(root);
    const baselineRows = parseBaseline(readFileSync(baselinePath, 'utf8'));
    const { failures, tighten } = compareBaseline(rows, baselineRows);
    assert.equal(failures.length, 0);
    assert.ok(tighten.some((t) => t.file === 'orchestrator/reached.ts' && t.sink === 'writeFileSync'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('ratchet: an unchanged tree PASSES with no failures and no tighten notices', () => {
  const root = makeFixture();
  const baselinePath = baselinePathFor(root);
  try {
    runCheck({ root, baselinePath, write: true });
    const { rows } = analyze(root);
    const baselineRows = countSinks(root, findReachableModules(root));
    const { failures, tighten } = compareBaseline(rows, baselineRows);
    assert.equal(failures.length, 0);
    assert.equal(tighten.length, 0);
    assert.equal(runCheck({ root, baselinePath }), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--write regenerates the baseline file and a subsequent check passes', () => {
  const root = makeFixture();
  const baselinePath = baselinePathFor(root);
  try {
    const writeCode = runCheck({ root, baselinePath, write: true });
    assert.equal(writeCode, 0);
    const checkCode = runCheck({ root, baselinePath });
    assert.equal(checkCode, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// =============================================================================
// Group 2 — CI-enforced gate: the REAL check against the REAL repository
// =============================================================================

// =============================================================================
// The entry derivation (beads forge-8vfn.5.34 and 5.48)
//
// The seed used to be "every ui-bridge.ts / bridge-*.ts under cli/". That is a
// hand-written tree name, and two things follow from it: the M4 host carve
// moves the host to apps/forge/ and would have emptied the seed silently (the
// lint fails only on GROWTH, so 605 rows -> 0 reads PASS), and a module that
// receives request-derived input but that no bridge module imports -- a CLI
// dispatch entry -- is invisible no matter how many sinks it grows.
// =============================================================================

test('5.34: the seed follows the host into apps/forge/ — a carve cannot empty it', () => {
  // Kills: the pre-fix derivation, which reads only cli/ and would return []
  // for this tree, blinding the whole lint while still reporting PASS.
  const root = mkdtempSync(join(tmpdir(), 'sinks-carve-'));
  try {
    mkdirSync(join(root, 'apps/forge'), { recursive: true });
    mkdirSync(join(root, 'cli'), { recursive: true });
    writeFileSync(join(root, 'cli/preflight.ts'), 'export const x = 1;\n');
    writeFileSync(join(root, 'apps/forge/ui-bridge.ts'), 'export function handle() { return 1; }\n');
    assert.deepEqual(listEntryModules(root), ['apps/forge/ui-bridge.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('5.34: a package that carves its routes is picked up with no edit to this script', () => {
  // Kills: a scan list naming packages by hand — the shape that left
  // dry-bridge-coverage blind to a carved packages/agents/routes.ts.
  const root = mkdtempSync(join(tmpdir(), 'sinks-routes-'));
  try {
    mkdirSync(join(root, 'packages/newpkg'), { recursive: true });
    writeFileSync(join(root, 'packages/newpkg/routes.ts'), 'export const routes = [];\n');
    assert.deepEqual(listEntryModules(root), ['packages/newpkg/routes.ts']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('5.34: an entirely hostless tree yields an EMPTY seed — the caller must be able to see that', () => {
  // The honest failure branch. An empty seed is not an error here; it is a
  // fact the guard's own test asserts against the real repo (below), so a
  // blinded scan can never look like a clean one.
  const root = mkdtempSync(join(tmpdir(), 'sinks-empty-'));
  try {
    mkdirSync(join(root, 'cli'), { recursive: true });
    assert.deepEqual(listEntryModules(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('5.34: the REAL repository seed is non-empty and holds the host, every carved route table, and the dispatch entries', () => {
  const seed = listEntryModules(REPO_ROOT);
  assert.ok(seed.length > 0, 'an empty seed on the real repo means this lint is scanning nothing');
  assert.ok(seed.some((m) => m.endsWith('ui-bridge.ts')), 'the bridge host is seeded');
  assert.ok(seed.some((m) => /^packages\/[^/]+\/routes\.ts$/.test(m)), 'carved route tables are seeded');
  for (const m of DISPATCH_ENTRY_MODULES) {
    assert.ok(seed.includes(m), `declared dispatch entry ${m} is seeded`);
  }
});

test('5.48: the two sibling lints share ONE scope — every declared dispatch entry is reachable here', () => {
  // The bead itself. check-raw-fs-guarded audited these four modules while
  // this lint could not see them, so a planted sink in agent-run.ts fired on
  // one lint and not the other on the same line. Measured before the fix:
  // four of that script's thirty EXPLICIT_MODULES were unreachable from this
  // walk. Kills: a fix that adds agent-run.ts alone and leaves the class open.
  const reachable = new Set(findReachableModules(REPO_ROOT));
  for (const m of DISPATCH_ENTRY_MODULES) {
    assert.ok(reachable.has(m), `${m} must be reachable from the shared entry seed`);
  }
  assert.ok(reachable.has('packages/agents/agent-run.ts'), 'bead 5.48\'s named module specifically');
});

test('the real repository baseline passes clean (no new or grown request-path sinks)', () => {
  const code = runCheck({});
  assert.equal(code, 0);
});

test('the real repository census is LIVE — the walk reached modules AND found sinks', () => {
  // Ruling 103. LIVENESS, not a floor on the debt this ratchet removes (bead
  // 5.49's distinction): sink rows are a census of fs calls on the request
  // path, and the product cannot serve a request without them, so unlike a
  // violation baseline this can never legitimately reach zero.
  //
  // The gap it closes: `runCheck` fails on GROWTH only. If the WALK breaks
  // while the seed survives — a resolver change, an import form the walker
  // stops following, an existsSync filter that stops matching after a move —
  // rows go to 0, the runtime reports PASS, and the test above still sees exit
  // code 0. The seed-level assertion two tests up cannot see that, because the
  // seed is exactly what is still fine.
  const { reachable, rows } = analyze(REPO_ROOT);
  assert.ok(reachable.length > 0, 'the walk reached no modules — this lint is scanning nothing');
  assert.ok(rows.length > 0, 'the walk found no sinks — a broken walker reads exactly like a clean tree');
});

// =============================================================================
// Group 3 — SEC-04 caller-count dimension (the systemic hole this ratchet has)
//
// The ratchet keys on (file, RAW-SINK, count). A NEW file that only *calls* an
// already-unguarded shared function in a DIFFERENT module — e.g.
// `readSessionStatus(join(root, reqProject, sid))` — introduces the exact SEC-04
// defect while emitting ZERO raw-sink rows of its own, so the ratchet stays
// green. bd forge-ebj step 2 asks for a caller-count dimension: count callers of
// a designated set of unguarded functions (readSessionStatus / writeSessionStatus
// and the bare-join builders architectSessionDir / instructionsSessionDir /
// projectBrainSessionDir / demoSessionDir), and fail when a NEW reachable caller
// appears.
//
// Both tests below are RED on the current (unfixed) script and go GREEN once the
// caller-count dimension is built.
// =============================================================================

/** Fixture: apps/forge/ui-bridge.ts (entry) imports a def module that DEFINES the
 *  designated shared fns (with real raw sinks tracked in ITS file), and also
 *  imports a `new-caller.ts` that does NOT exist yet (addNewCaller plants it).
 *  Returns the fixture root. */
function makeCallerFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'sinks-caller-fixture-'));
  mkdirSync(join(root, 'cli'), { recursive: true });
  mkdirSync(join(root, 'orchestrator'), { recursive: true });

  // Entry: import edges only (re-export lines carry no `(` → never counted as
  // callers themselves). The '../orchestrator/new-caller.ts' target is absent at
  // baseline time; the walker skips missing targets, so it is NOT baselined.
  writeFileSync(
    join(root, 'cli/ui-bridge.ts'),
    [
      "import { readSessionStatus, instructionsSessionDir } from '../orchestrator/session-def.ts';",
      "import { handleNew } from '../orchestrator/new-caller.ts';",
      'export { readSessionStatus, instructionsSessionDir, handleNew };',
      '',
    ].join('\n')
  );

  // The def module: DEFINES the designated fns; its raw fs sinks (existsSync,
  // readFileSync) are the tracked rows that populate the baseline.
  writeFileSync(
    join(root, 'orchestrator/session-def.ts'),
    [
      "import { existsSync, readFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      'export function instructionsSessionDir(projectRoot, sessionId) {',
      "  return join(projectRoot, '_instructions', sessionId);",
      '}',
      'export function readSessionStatus(sessionDir) {',
      "  const p = join(sessionDir, 'status.json');",
      '  if (!existsSync(p)) return null;',
      "  return JSON.parse(readFileSync(p, 'utf8'));",
      '}',
      '',
    ].join('\n')
  );

  return root;
}

/** Plant the NEW reachable caller: it CALLS the designated `readSessionStatus`
 *  on a bare-joined request-derived path, but has NO raw fs sink of its own
 *  (`readSessionStatus` and `join` are not in SINK_NAMES). */
function addNewCaller(root: string): void {
  writeFileSync(
    join(root, 'orchestrator/new-caller.ts'),
    [
      "import { readSessionStatus } from './session-def.ts';",
      "import { join } from 'node:path';",
      'export function handleNew(root, reqProject, sid) {',
      '  return readSessionStatus(join(root, reqProject, sid));',
      '}',
      '',
    ].join('\n')
  );
}

test('caller-count ratchet: a NEW file that only CALLS a designated unguarded fn (no raw sink of its own) FAILS', () => {
  const root = makeCallerFixture();
  const baselinePath = join(root, 'baseline.txt');
  try {
    // Baseline captured while only the entry + def module exist (new caller absent).
    assert.equal(runCheck({ root, baselinePath, write: true }), 0);
    assert.equal(runCheck({ root, baselinePath }), 0, 'sanity: clean immediately after --write');

    addNewCaller(root);

    // --- preconditions FIRST (false-negative discipline) ---
    const reachable = findReachableModules(root);
    assert.ok(
      reachable.includes('orchestrator/new-caller.ts'),
      'the new caller must be reachable from the bridge entry',
    );
    const { rows } = analyze(root);
    assert.ok(
      !rows.some((r) => r.file === 'orchestrator/new-caller.ts'),
      'the new caller must emit NO per-file raw-sink row — so a FAIL cannot come from an accidental raw sink, only from the caller-count dimension',
    );
    assert.ok(
      rows.some((r) => r.file === 'orchestrator/session-def.ts'),
      'fixture sanity: the def module contributes tracked raw-sink rows to the baseline',
    );

    // The caller-count dimension must trip exit 1. RED today: the ratchet only
    // keys on per-file raw sinks; the new caller has none, so runCheck returns 0.
    assert.equal(
      runCheck({ root, baselinePath }),
      1,
      'a new reachable caller of a designated unguarded fn must fail the ratchet (caller-count dimension not yet built)',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('caller-count ratchet: the designated-unguarded-fn registry is present and complete', () => {
  // Probed via the namespace import: undefined today (the export does not exist)
  // → RED. The registry must name readSessionStatus/writeSessionStatus AND the
  // four bare-join session-dir builders (bd forge-ebj step 2 + fix-plan).
  const designated = (ratchet as Record<string, unknown>).DESIGNATED_UNGUARDED_FUNCTIONS;
  assert.ok(
    designated,
    'expected a DESIGNATED_UNGUARDED_FUNCTIONS export naming the shared fns whose callers the ratchet must count',
  );
  const names = new Set<string>(
    Array.isArray(designated)
      ? (designated as string[])
      : Object.keys(designated as Record<string, unknown>),
  );
  for (const fn of [
    'readSessionStatus',
    'writeSessionStatus',
    'architectSessionDir',
    'instructionsSessionDir',
    'projectBrainSessionDir',
    'demoSessionDir',
  ]) {
    assert.ok(names.has(fn), `DESIGNATED_UNGUARDED_FUNCTIONS must designate ${fn}`);
  }
});
