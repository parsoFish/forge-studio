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
 * implementation it kills, and each of the three formula controls is a
 * PLANTED file whose effect on the count is asserted, so a re-implementation
 * that "looks right" cannot pass.
 *
 * RUN: node --test --experimental-strip-types scripts/check-package-caps.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Plant a file, run the body, always remove the file. */
function withPlanted(rel: string, contents: string, body: () => void): void {
  const abs = join(ROOT, rel);
  const dir = dirname(abs);
  const dirExisted = existsSync(dir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, contents);
  try {
    body();
  } finally {
    rmSync(abs, { force: true });
    if (!dirExisted) rmSync(dir, { recursive: true, force: true });
  }
}

const TEN_LINES = `${Array.from({ length: 10 }, (_, i) => `export const l${i} = ${i};`).join('\n')}\n`;

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
// The three formula controls (ruling 94) — each is a PLANTED file
// =============================================================================

test('control 1: a planted test-fixtures/ file does NOT move the count', () => {
  // Kills: a re-implementation that filters only on `.test.ts` and therefore
  // charges a package for its fixtures.
  const before = measured().flows.lines;
  withPlanted('packages/flows/tests/unit/test-fixtures/__cap_probe__.ts', TEN_LINES, () => {
    assert.equal(measured().flows.lines, before, 'a test-fixtures/ file is not production');
  });
  assert.equal(measured().flows.lines, before, 'and the probe left no residue');
});

test('control 2: a planted .yaml does NOT move the count', () => {
  // Kills: the `!.test.ts !.md` grep three lanes each wrote by hand, which
  // counts .yaml and .json and reads 20–96 lines high.
  const before = measured().flows.lines;
  withPlanted('packages/flows/__cap_probe__.yaml', TEN_LINES, () => {
    assert.equal(measured().flows.lines, before, 'a non-CODE extension is not production');
  });
});

test('control 3: a planted .ts DOES move the count, by exactly its line count', () => {
  // The positive control: if planting real production code does not move the
  // number, the gate is measuring nothing at all.
  const before = measured().flows.lines;
  withPlanted('packages/flows/__cap_probe__.ts', TEN_LINES, () => {
    assert.equal(measured().flows.lines, before + 10, 'a .ts file is production, counted line for line');
  });
  assert.equal(measured().flows.lines, before, 'and the probe left no residue');
});

test('control 4: a planted .test.ts does NOT move the count', () => {
  const before = measured().flows.lines;
  withPlanted('packages/flows/__cap_probe__.test.ts', TEN_LINES, () => {
    assert.equal(measured().flows.lines, before, 'a test file is not production');
  });
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
