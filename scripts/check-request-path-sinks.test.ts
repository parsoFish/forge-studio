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
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  findReachableModules,
  countSinks,
  analyze,
  formatBaseline,
  parseBaseline,
  compareBaseline,
  runCheck,
} from './check-request-path-sinks.mjs';

// =============================================================================
// Group 1 — synthetic fixture tree
// =============================================================================

/** Build a minimal fixture repo: cli/ui-bridge.ts (the entry point) imports
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

function baselinePathFor(root) {
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

test('the real repository baseline passes clean (no new or grown request-path sinks)', () => {
  const code = runCheck({});
  assert.equal(code, 0);
});
