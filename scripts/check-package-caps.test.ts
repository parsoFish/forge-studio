/**
 * check-package-caps.test.ts — TDD contract for the per-package LOC cap gate
 * (scripts/check-package-caps.mjs), bead forge-8vfn.5.18.
 *
 * The incident this closes (ledger rulings 48 / 51 / 72 / 75 / 82 / 88 / 94):
 * QUARRY.md has carried a ratified cap per package since M2 and NOTHING
 * enforced it. Every raise so far was priced by hand, three lanes measured
 * "prod LOC" three different ways (a `!.test.ts !.md` grep counts .yaml and
 * .json; the bare NOT_PRODUCTION regex counts them too), and sessions breached
 * its cap on main unnoticed for a whole carve because the per-FILE cap was
 * watched while the per-PACKAGE total was quoted from session open.
 *
 * Ruling 94 fixes the formula by REUSE, not restatement: the measurement is
 * `productionFiles()` from check-owner.mjs — the repo's one encoded definition
 * of "a production file" — so the cap gate and the ownership gate can never
 * disagree about what they are counting.
 *
 * Discipline (immutable-gates): every green below names the wrong
 * implementation it kills, and each formula control plants a real file in a
 * synthetic git repo and asserts its exact effect on the count, so a
 * re-implementation that "looks right" cannot pass.
 *
 * RUN: node --test --experimental-strip-types scripts/check-package-caps.test.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { measurePackages } from './check-package-caps.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = join(ROOT, 'scripts/check-package-caps.mjs');

function run(args: string[] = []): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync('node', [CHECKER, ...args], { cwd: ROOT, encoding: 'utf8' }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function measured(): Record<string, { lines: number; cap: number | null }> {
  return JSON.parse(run(['--json']).out).packages;
}

const TEN_LINES = `${Array.from({ length: 10 }, (_, i) => `export const l${i} = ${i};`).join('\n')}\n`;

/**
 * The formula controls run against a SYNTHETIC git repo, never the live tree.
 *
 * The first draft of this file planted its probes into `packages/flows/` and
 * the full suite caught it: `check-boundaries.test.ts` shells
 * dependency-cruiser at the same live tree from a parallel process and died
 * with `ENOENT ... __cap_probe__.ts` mid-delete. That is known-flake #6's root
 * cause exactly, and §15.93's rule — a guard self-test plants its own fixture
 * tree rather than writing into a production path.
 */
const SCRATCH: string[] = [];
after(() => { for (const d of SCRATCH) rmSync(d, { recursive: true, force: true }); });

function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'cap-probe-'));
  SCRATCH.push(root);
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root });
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), body);
  }
  return root;
}

/** flows' measured lines in a synthetic repo holding exactly `files`. */
function flowsLines(files: Record<string, string>): number {
  return measurePackages(repoWith(files)).get('flows') ?? 0;
}

const BASE = { 'packages/flows/real.ts': TEN_LINES };

// =============================================================================
// The gate itself
// =============================================================================

test('the real repository is within every ratified cap', () => {
  const { code, out } = run();
  assert.equal(code, 0, out);
  assert.match(out, /check-package-caps: PASS/);
});

test('it prints its own formula, so a reader never has to find it elsewhere', () => {
  // Kills: a gate whose number cannot be reproduced from its own output. The
  // campaign tool that priced these caps lives in a gitignored directory a
  // permanent artifact may not cite, so the guard must state the rule itself.
  const { out } = run();
  assert.match(out, /productionFiles\(\)/, 'the output names the function that defines the file set');
  assert.match(out, /check-owner\.mjs/, 'and where that function lives');
});

test('every package with a QUARRY cap is measured, and every measured package has a cap', () => {
  // Kills: a gate that silently skips a package (the sessions failure mode —
  // watched per-file, unwatched per-package) or invents a cap for one QUARRY
  // does not name.
  const pkgs = measured();
  const names = Object.keys(pkgs).sort();
  assert.deepEqual(
    names,
    ['agents', 'contracts', 'factory', 'flows', 'kernel', 'knowledge', 'library', 'projects', 'sessions'],
    'all nine packages accounted for',
  );
  for (const [name, row] of Object.entries(pkgs)) {
    assert.equal(typeof row.lines, 'number', `${name} has a measured line count`);
    assert.ok(row.cap !== null && row.cap > 0, `${name} has a ratified cap parsed from QUARRY.md`);
  }
});

// =============================================================================
// The formula controls (ruling 94) — planted files in a synthetic git repo
// =============================================================================

test('the baseline synthetic repo measures exactly its one production file', () => {
  assert.equal(flowsLines(BASE), 10, 'ten lines of production code read as ten');
});

test('control 1: a test-fixtures/ file does NOT move the count', () => {
  // Kills: a re-implementation that filters only on `.test.ts` and therefore
  // charges a package for its fixtures.
  assert.equal(flowsLines({ ...BASE, 'packages/flows/tests/unit/test-fixtures/big.ts': TEN_LINES }), 10);
});

test('control 2: a .yaml does NOT move the count', () => {
  // Kills: the `!.test.ts !.md` grep three lanes each wrote by hand, which
  // counts .yaml and .json and reads 20–96 lines high.
  assert.equal(flowsLines({ ...BASE, 'packages/flows/data.yaml': TEN_LINES }), 10);
});

test('control 3: a .ts DOES move the count, by exactly its line count', () => {
  // The positive control: if planting real production code does not move the
  // number, the gate is measuring nothing at all.
  assert.equal(flowsLines({ ...BASE, 'packages/flows/more.ts': TEN_LINES }), 20);
});

test('control 4: a .test.ts does NOT move the count', () => {
  assert.equal(flowsLines({ ...BASE, 'packages/flows/more.test.ts': TEN_LINES }), 10);
});

test('control 5: an untracked-but-not-ignored file IS counted (--others --exclude-standard)', () => {
  // The controls above never `git add`, so they already prove the --others
  // half; this names it, because a re-implementation using plain `git
  // ls-files` would read every one of them as zero.
  assert.ok(flowsLines(BASE) > 0, 'a file that is not yet committed still counts');
});

// =============================================================================
// The failure branch — a gate whose red is untested is not a gate
// =============================================================================

test('it FAILS on a cap breach, naming the package, the measured number and the cap', () => {
  // Kills: a gate that computes correctly and then reports PASS regardless —
  // the shape that let three caps be re-seeded with nothing watching.
  const { code, out } = run(['--cap-override', 'flows=1']);
  assert.equal(code, 1, `a package over its cap must fail — got exit 0:\n${out}`);
  assert.match(out, /flows/, 'the offending package is named');
  assert.match(out, /\b1\b/, 'the cap it breached is named');
  assert.match(out, /check-package-caps: FAIL/);
});

test('an unparseable cap override is rejected rather than silently ignored', () => {
  // Kills: an override that fails open — the flag exists for this test, and a
  // typo in it must not read as "no override, everything passes".
  const { code, out } = run(['--cap-override', 'flows']);
  assert.equal(code, 1, `a malformed override must fail — got exit 0:\n${out}`);
  assert.match(out, /--cap-override/);
});

test('an override naming a package that does not exist is rejected', () => {
  const { code, out } = run(['--cap-override', 'nosuchpkg=1']);
  assert.equal(code, 1, `an override for an unknown package must fail — got exit 0:\n${out}`);
  assert.match(out, /nosuchpkg/);
});
