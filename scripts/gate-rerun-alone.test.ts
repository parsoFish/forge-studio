/**
 * `gate.sh` performs its own ALONE-RERUN proof — `forge-8vfn.7.6.89`.
 *
 * `merge-slot.sh`'s waiver condition (7.6.86(i)) needs an `ALONE-RERUN <test>
 * k/k` line in the gate log before a single red step can be waived, but that
 * line used to be APPENDED BY THE LANE — a claim a lane can type without doing
 * the rerun. This file doors the replacement: `gate.sh` itself runs the named
 * file `k` (3) times, alone, in the same checkout, through
 * `gate-rerun-alone.sh`, and writes its OWN line — never touching its own
 * `GATE_SH_EXIT` in the process, because a waiver is the merge slot's decision
 * and not this tool's to grant itself.
 *
 * FIXTURES USE `.mjs`, NOT `.test.ts`. These trees have no `package.json`, so
 * Node's module-type detection would fall back to CommonJS for a bare `.ts`
 * file and reject `import` — `.mjs` is unambiguous regardless. The bead is
 * about ONE failing step and a rerun of the file it names; the extension is
 * not part of what it proves.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh',
);

const RUNNER = 'node --test --experimental-strip-types';

const ALWAYS_RED = `
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('always red — fixture for gate-rerun-alone.test.ts', () => {
  assert.fail('deliberately red, every invocation');
});
`;
const ALWAYS_GREEN = `
import { test } from 'node:test';
test('always green — fixture for gate-rerun-alone.test.ts', () => {});
`;
// Fails the FIRST time it runs (the main step), then passes every time after
// (the alone-rerun) — the shape a real flaky-in-context, clean-alone test has.
const RED_ONCE_THEN_GREEN = `
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
test('red exactly once, then green when rerun alone', () => {
  if (!existsSync('.probe-ran')) {
    writeFileSync('.probe-ran', '1');
    assert.fail('first invocation only — simulates a step that failed once in the full run');
  }
});
`;

function ciWithSteps(runs: string[]): string {
  const steps = runs
    .map((r, i) => `      - name: Step ${i + 1}\n        run: ${r}\n`)
    .join('');
  return `name: CI\non: [push]\njobs:\n  build-and-test:\n    runs-on: ubuntu-latest\n    steps:\n${steps}`;
}

function tree(runs: string[], files: Record<string, string>): string {
  const d = mkdtempSync(join(tmpdir(), 'gate-rerun-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), ciWithSteps(runs));
  mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
  mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
  symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
  for (const [path, body] of Object.entries(files)) writeFileSync(join(d, path), body);
  return d;
}
const camp = () => mkdtempSync(join(tmpdir(), 'gate-rerun-camp-'));

// `NODE_TEST_CONTEXT` STRIPPED, NEVER INHERITED. This file's own subject is a
// gate.sh that runs `node --test` on FIXTURE files — a nested test runner —
// and when this file itself runs under `node --test` (the house convention;
// see COMMON), node sets `NODE_TEST_CONTEXT=child-v8` in ITS OWN process.env.
// Measured: a fixture spawned this way exits 0 with EMPTY stdout regardless
// of whether its tests actually pass — the inherited var makes the nested
// runner behave as a CHILD of a parent harness that does not exist here, and
// it silently defers its verdict instead of reporting one. Every ALWAYS_RED
// fixture in this file read as PASS until this was stripped; a genuinely
// passing fixture was never affected, which is why it looked like only some
// doors were red.
function gate(d: string, c: string, extra: Record<string, string>) {
  const { NODE_TEST_CONTEXT: _ntc, ...rest } = process.env;
  const r = spawnSync('bash', [GATE, d, c], { encoding: 'utf8', env: { ...rest, ...extra } });
  return { out: r.stdout ?? '', status: r.status };
}

describe('forge-8vfn.7.6.89 — the alone-rerun is gate.sh\'s own act, never a lane\'s claim', () => {
  test('single red step, clean when rerun alone: ALONE-RERUN <file> k/k, exit code untouched', () => {
    const d = tree([`${RUNNER} probe.mjs`], { 'probe.mjs': RED_ONCE_THEN_GREEN });
    const c = camp();

    const r = gate(d, c, { GATE_RERUN_ALONE: 'probe.mjs' });

    assert.match(r.out, /^ALONE-RERUN probe\.mjs 3\/3$/m, `expected a clean k/k line: ${r.out}`);
    assert.match(
      r.out,
      /^GATE_SH_EXIT=1$/m,
      `the rerun must not change the verdict — the original step still failed: ${r.out}`,
    );

    rmSync(d, { recursive: true, force: true });
    rmSync(c, { recursive: true, force: true });
  });

  test('single red step, still red alone: ALONE-RERUN <file> j/k FAILED', () => {
    const d = tree([`${RUNNER} probe.mjs`], { 'probe.mjs': ALWAYS_RED });
    const c = camp();

    const r = gate(d, c, { GATE_RERUN_ALONE: 'probe.mjs' });

    assert.match(r.out, /^ALONE-RERUN probe\.mjs 0\/3 FAILED$/m, `expected every rerun to fail too: ${r.out}`);

    rmSync(d, { recursive: true, force: true });
    rmSync(c, { recursive: true, force: true });
  });

  test('REFUSED: zero failed steps proves nothing to waive', () => {
    const d = tree([`${RUNNER} probe.mjs`], { 'probe.mjs': ALWAYS_GREEN });
    const c = camp();

    const r = gate(d, c, { GATE_RERUN_ALONE: 'probe.mjs' });

    assert.match(
      r.out,
      /^ALONE-RERUN probe\.mjs REFUSED — 0 step\(s\) failed, not exactly one$/m,
      `a green run has nothing to rerun: ${r.out}`,
    );

    rmSync(d, { recursive: true, force: true });
    rmSync(c, { recursive: true, force: true });
  });

  test('REFUSED: two failed steps cannot be pinned to the one this run is about', () => {
    const d = tree(
      [`${RUNNER} a.mjs`, `${RUNNER} b.mjs`],
      { 'a.mjs': ALWAYS_RED, 'b.mjs': ALWAYS_RED },
    );
    const c = camp();

    const r = gate(d, c, { GATE_RERUN_ALONE: 'a.mjs' });

    assert.match(
      r.out,
      /^ALONE-RERUN a\.mjs REFUSED — 2 step\(s\) failed, not exactly one$/m,
      `two red steps must refuse rather than guess which one 'a.mjs' means: ${r.out}`,
    );

    rmSync(d, { recursive: true, force: true });
    rmSync(c, { recursive: true, force: true });
  });

  test('REFUSED: the single failing step does not cover the named file', () => {
    const d = tree([`${RUNNER} a.mjs`], { 'a.mjs': ALWAYS_RED, 'b.mjs': ALWAYS_GREEN });
    const c = camp();

    const r = gate(d, c, { GATE_RERUN_ALONE: 'b.mjs' });

    assert.match(
      r.out,
      /^ALONE-RERUN b\.mjs REFUSED — the single failing step's command does not cover b\.mjs/m,
      `the failing step's own command named 'a.mjs', not 'b.mjs': ${r.out}`,
    );

    rmSync(d, { recursive: true, force: true });
    rmSync(c, { recursive: true, force: true });
  });

  test('no GATE_RERUN_ALONE named: the section is silent, same as before this bead', () => {
    const d = tree([`${RUNNER} probe.mjs`], { 'probe.mjs': ALWAYS_RED });
    const c = camp();

    const r = gate(d, c, {});

    assert.doesNotMatch(r.out, /ALONE-RERUN/, `unset GATE_RERUN_ALONE must run no rerun at all: ${r.out}`);

    rmSync(d, { recursive: true, force: true });
    rmSync(c, { recursive: true, force: true });
  });

  // M7 findings row 76a. `eval "$cmd"` runs every gate step inside THIS
  // script's own shell, so a caller that exports GATE_RERUN_ALONE for
  // gate.sh's own alone-rerun purposes was handing that control var to every
  // step it runs too — including `npm test`, whose own process spawns the
  // NESTED gate.sh fixtures above and inherited the ambient var as if each
  // fixture invocation had asked for it itself. Measured: with
  // GATE_RERUN_ALONE exported in the invoking shell, `npm test` goes red at
  // this very file's "no GATE_RERUN_ALONE named" case, because the var was
  // never gate.sh's to leak. The step's command here records its OWN
  // environment with a plain `env`, never a fixture that could disagree with
  // what gate.sh actually exec'd.
  test('GATE_RERUN_ALONE is scrubbed from every step\'s own environment', () => {
    const d = tree(['env > env-dump.txt'], {});
    const c = camp();

    const r = gate(d, c, { GATE_RERUN_ALONE: 'probe.mjs' });

    const dumped = readFileSync(join(d, 'env-dump.txt'), 'utf8');
    assert.doesNotMatch(
      dumped,
      /^GATE_RERUN_ALONE=/m,
      `gate.sh's own control var leaked into the step's environment: ${r.out}\n---env---\n${dumped}`,
    );

    rmSync(d, { recursive: true, force: true });
    rmSync(c, { recursive: true, force: true });
  });
});
