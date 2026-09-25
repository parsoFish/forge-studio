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
  countDocClassifications,
  runCheck,
} from './check-request-path-sinks.mjs';
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

test('M7 row 25: a DECREASED count (stale-HIGH baseline) FAILS — tighten is no longer silent', () => {
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

    // Now drop back to one call — nothing else changes. A stale-HIGH row like
    // this ("pr.ts execFileSync baselined 5, real 2") passed forever before
    // this fix, because tighten was informational-only.
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

    const { rows } = analyze(root);
    const baselineRows = parseBaseline(readFileSync(baselinePath, 'utf8'));
    const { failures, tighten } = compareBaseline(rows, baselineRows);
    assert.equal(failures.length, 0);
    assert.ok(tighten.some((t) => t.file === 'orchestrator/reached.ts' && t.sink === 'writeFileSync'));

    let err = '';
    const origErr = console.error;
    console.error = (...args: unknown[]) => { err += args.join(' ') + '\n'; };
    let code;
    try {
      code = runCheck({ root, baselinePath });
    } finally {
      console.error = origErr;
    }
    assert.equal(code, 1, 'a stale-HIGH baseline row must FAIL, not pass forever (M7 findings row 25)');
    assert.match(err, /orchestrator\/reached\.ts writeFileSync:\s*baseline 2 -> now 1/, 'the exact figure must be printed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('M7 row 25: --write is the one-command fix for a stale-HIGH row', () => {
  const root = makeFixture();
  const baselinePath = baselinePathFor(root);
  try {
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
    assert.equal(runCheck({ root, baselinePath }), 1, 'precondition: stale row currently fails');
    assert.equal(runCheck({ root, baselinePath, write: true }), 0, '--write must resolve it (tighten never needs doc backing)');
    assert.equal(runCheck({ root, baselinePath }), 0, 'and the check must now pass clean');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('M7 row 25: --write REFUSES to raise an undocumented row — never-raise-without-doc-backing', () => {
  const root = makeFixture();
  const baselinePath = baselinePathFor(root);
  const docPath = join(root, 'docs/reference/request-path-sinks.md');
  try {
    mkdirSync(dirname(docPath), { recursive: true });
    writeFileSync(docPath, '# empty doc — nothing classified yet\n');
    runCheck({ root, baselinePath, docPath, write: true });

    // Grow a row without ever touching the doc.
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

    const before = readFileSync(baselinePath, 'utf8');
    const code = runCheck({ root, baselinePath, docPath, write: true });
    assert.equal(code, 1, '--write must refuse an undocumented grown row rather than silently raising the baseline');
    assert.equal(readFileSync(baselinePath, 'utf8'), before, 'the baseline file must be untouched on refusal');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('M7 row 25: --write ACCEPTS a grown row once the doc classifies the file', () => {
  const root = makeFixture();
  const baselinePath = baselinePathFor(root);
  const docPath = join(root, 'docs/reference/request-path-sinks.md');
  try {
    mkdirSync(dirname(docPath), { recursive: true });
    writeFileSync(docPath, '# empty doc\n');
    runCheck({ root, baselinePath, docPath, write: true });

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
    // Now classify it.
    writeFileSync(docPath, '| orchestrator/reached.ts | writeFileSync 1 -> 2 | classified | guarded [read] |\n');

    assert.equal(runCheck({ root, baselinePath, docPath, write: true }), 0);
    assert.equal(runCheck({ root, baselinePath, docPath }), 0);
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
// forge-8vfn.5.19 — sink matching must resolve to a real node:fs /
// node:child_process import, not just a bare name match; and --write must not
// silently absorb rows it did not intend to touch.
//
// Measured repro from the bead: a local `const exec = executors[kind] ??
// historical: execUnknown` in orchestrator/phases/executor-table.ts was reported as a
// NEW 'exec' sink, purely because its name matched. Had a lane run --write
// there, a fake sink would have entered the baseline permanently.
// =============================================================================

test('8vfn.5.19: a local function sharing a sink name is NOT counted (never imported from node:fs)', () => {
  const root = makeFixture();
  try {
    writeFileSync(
      join(root, 'orchestrator/reached.ts'),
      [
        'function existsSync(p) { return p.length > 0; }', // shadows the sink name; not from node:fs
        'export function readReached() {',
        "  return existsSync('/tmp/out');",
        '}',
        '',
      ].join('\n')
    );
    const { rows } = analyze(root);
    assert.ok(
      !rows.some((r) => r.file === 'orchestrator/reached.ts' && r.sink === 'existsSync'),
      'a local existsSync never imported from node:fs must not be counted as the sink'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('8vfn.5.19: a name destructured off a local object is NOT counted (not node:fs)', () => {
  const root = makeFixture();
  try {
    writeFileSync(
      join(root, 'orchestrator/reached.ts'),
      [
        "const obj = { readFileSync: () => 'stub' };",
        'const { readFileSync } = obj;',
        'export function readReached() {',
        "  return readFileSync('/tmp/out');",
        '}',
        '',
      ].join('\n')
    );
    const { rows } = analyze(root);
    assert.ok(
      !rows.some((r) => r.file === 'orchestrator/reached.ts' && r.sink === 'readFileSync'),
      'readFileSync destructured off a local object, never imported from node:fs, must not count'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('8vfn.5.19: a real node:fs import is still counted (no regression)', () => {
  const root = makeFixture();
  try {
    // historical: makeFixture's orchestrator/reached.ts already imports existsSync/writeFileSync from node:fs.
    const { rows } = analyze(root);
    assert.ok(rows.some((r) => r.file === 'orchestrator/reached.ts' && r.sink === 'existsSync'));
    assert.ok(rows.some((r) => r.file === 'orchestrator/reached.ts' && r.sink === 'writeFileSync'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('8vfn.5.19: an ALIASED node:fs import is still counted under its canonical sink name', () => {
  const root = makeFixture();
  try {
    writeFileSync(
      join(root, 'orchestrator/reached.ts'),
      [
        "import { readFileSync as rf } from 'node:fs';",
        'export function readReached() {',
        "  return rf('/tmp/out');",
        '}',
        '',
      ].join('\n')
    );
    const { rows } = analyze(root);
    const row = rows.find((r) => r.file === 'orchestrator/reached.ts' && r.sink === 'readFileSync');
    assert.ok(row, 'an aliased import of a real node:fs sink must still be counted under its canonical name');
    assert.equal(row.count, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('8vfn.5.19: --write PRINTS every row it changes (the "silent absorption" defect)', () => {
  const root = makeFixture();
  const baselinePath = baselinePathFor(root);
  try {
    // Baseline with TWO writeFileSync calls.
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

    // Shrink back to one call — nothing about existsSync changed, only
    // writeFileSync's count did. historical: bead repro: "cli/brain-lint.ts existsSync
    // 22->20 ... rewrote rows nothing had touched" — --write regenerating the
    // WHOLE baseline silently, with no record of what moved.
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

    let out = '';
    const origLog = console.log;
    console.log = (...args: unknown[]) => { out += args.join(' ') + '\n'; };
    try {
      runCheck({ root, baselinePath, write: true });
    } finally {
      console.log = origLog;
    }
    assert.match(
      out,
      /orchestrator\/reached\.ts writeFileSync:\s*2\s*->\s*1/,
      '--write must print the exact row it is changing, not just a summary count (bead forge-8vfn.5.19)'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// =============================================================================
// Doc-derived classification counts — replaces docs/reference/request-path-
// sinks.md's hand-maintained Summary table (a top-of-file conflict every PR
// touched, on top of the append-at-the-end every PR also did — lane C hit it
// 6x in one day). The checker now derives the count from the doc's own
// classified table rows and prints it; nothing in the doc asserts a number
// that can drift from what is actually written there.
// =============================================================================

test('countDocClassifications: buckets rows by their own class cell, ignores the header', () => {
  const md = [
    '| file:line | op | field | class | evidence |',
    '|---|---|---|---|---|',
    '| a.ts:1 | x | y | guarded `[exec]` | z |',
    '| b.ts:1 | x | y | unguarded | z |',
    "| c.ts:1 | x | y | accidentally-safe `[read]` | z |",
    "| d.ts:1 | x | y | `accidentally-safe` -> **not request-derived** `[read]` | z |",
    '| e.ts:1 | x | y | not request-derived `[read]` | z |',
  ].join('\n');
  const counts = countDocClassifications(md);
  assert.equal(counts.totalRows, 5, 'the header/separator rows must not be counted as classified rows');
  assert.equal(counts.byClass.guarded, 1);
  assert.equal(counts.byClass.unguarded, 1);
  assert.equal(counts.byClass.accidentallySafe, 1);
  assert.equal(counts.byClass.notRequestDerived, 2);
  assert.equal(counts.byMarker.exec, 1);
  assert.equal(counts.byMarker.read, 3);
});

test('doc census: runCheck prints a doc-derived classification count, never a hand-typed one', () => {
  const root = makeFixture();
  const baselinePath = baselinePathFor(root);
  const docPath = join(root, 'docs/reference/request-path-sinks.md');
  try {
    mkdirSync(dirname(docPath), { recursive: true });
    writeFileSync(
      docPath,
      ['| file:line | op | field | class | evidence |', '|---|---|---|---|---|', '| a.ts:1 | x | y | guarded `[exec]` | z |'].join('\n')
    );
    let out = '';
    const origLog = console.log;
    console.log = (...args: unknown[]) => { out += args.join(' ') + '\n'; };
    try {
      runCheck({ root, baselinePath, docPath, write: true });
    } finally {
      console.log = origLog;
    }
    assert.match(out, /doc census.*1 classified row/i, 'runCheck must print a doc-derived count, computed live from docPath');
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

