/**
 * `gate.sh` — the campaign exit gate, generalised out of `_1.0/gate-M4.sh`.
 *
 * §15.37: a lane's local gate block is the CI job's list, not the subset it remembers.
 * `build-and-test` runs fifteen steps in order plus three run-lock jobs; knowledge ran 4 of 15
 * and lost a CI round-trip to markdownlint, library lost one to check-file-size by running only
 * `test:ui`, projects lost one to unused imports by not re-running `build`. So the gate does not
 * carry a list at all — it reads the `run:` lines out of the tree it is measuring.
 *
 * "The tree it is measuring" is the load-bearing half: `gate-M4.sh` hard-coded `/home/parso/forge`
 * for its helper tools and a single session's scratchpad for its logs, so it answered a different
 * question in each checkout (§15.148). Every path here is an argument.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const GATE = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh');

function gate(...args: string[]) {
  // T1 ruling 649. THIS FILE'S SUBJECT IS WHICH VARIABLES `gate.sh` EXPORTS, so
  // it must not inherit them. 639 gave `gate.sh` those exports; an outer
  // `gate.sh <worktree> <campaign>` therefore exports both before running
  // `npm test`, `spawnSync` here inherited that environment, and the
  // no-campaign case below asserted about ITS OWN CALLER rather than about the
  // gate it spawned — `gate.sh <worktree> _1.0` could never be green on its own
  // suite, while the file alone was 13/13.
  //
  // Fixed on the TEST side on purpose: a test that asserts an ABSENCE owns the
  // environment it asserts about. The alternative — teaching `gate.sh` which of
  // its steps are self-referential — would put knowledge of this test inside
  // the thing under test.
  //
  // The positive cases are unaffected: they pass a campaign, and `gate.sh`
  // exports both from `$CAMP` itself, so stripping the INHERITED pair cannot
  // hide an export the script actually makes.
  const { FORGE_SUITE_LOCK: _suite, FORGE_RUN_LOCK: _run, ...env } = process.env;
  const r = spawnSync('bash', [GATE, ...args], { encoding: 'utf8', env });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
/** A throwaway tree with its own ci.yml — the point is that the gate reads THIS one. */
function tree(ci: string) {
  const d = mkdtempSync(join(tmpdir(), 'gate-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), ci);
  return d;
}
/** The gate voids any verdict on a tree whose `@forge/kernel` resolves
 *  outside it (§15.13), so a fixture that wants to reach the STEP loop must
 *  own its install. */
function installedInPlace(d: string) {
  mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
  mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
  symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
}

const CI = `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Install
        run: npm ci
      - name: Build
        run: npm run build
      - name: Unit tests
        run: npm test
      - name: Guard
        run: node scripts/check-identity.mjs
      - name: A multi-line step
        run: |
          npm run stories -- --story smoke
          npm run stories -- --story proof
  deadpaths:
    runs-on: ubuntu-latest
    steps:
      - name: Dead paths
        run: npm run ui:deadpaths
`;

describe('gate.sh --list — the step list comes from the tree, never from memory', () => {
  test('lists the single-line run: steps of build-and-test, in order, and drops only `npm ci`', () => {
    const d = tree(CI);
    try {
      const r = gate('--list', d);

      assert.equal(r.status, 0, r.err);
      const runs = r.out.split('\n').filter((l) => l.startsWith('RUN ')).map((l) => l.slice(4));
      assert.deepEqual(runs, ['npm run build', 'npm test', 'node scripts/check-identity.mjs'], 'the job\'s own order, with the install step dropped — a worktree already has its install');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a multi-line `run: |` step is NAMED as not run, never silently dropped (§15.92)', () => {
    const d = tree(CI);
    try {
      const r = gate('--list', d);

      assert.match(r.out, /^SKIP .*multi-line/m, 'the gate says which step it is not running, and why');
      assert.match(r.out, /^SKIP .*npm ci/m, 'including the install it deliberately drops');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('steps of OTHER jobs are named as not run — they are the run-lock jobs a lane runs separately', () => {
    const d = tree(CI);
    try {
      const r = gate('--list', d);

      assert.match(r.out, /^OTHER JOB deadpaths: npm run ui:deadpaths — /m, 'the run-lock jobs are visible, and say where they belong');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  test('a tree with no ci.yml is a loud failure — a gate that finds no steps is not a green gate', () => {
    const d = mkdtempSync(join(tmpdir(), 'gate-empty-'));
    try {
      const r = gate('--list', d);

      assert.notEqual(r.status, 0);
      assert.match(r.err, /ci\.yml/, 'the failure names the file it could not read');
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe('gate.sh — a verdict about a tree is void unless it measured that tree', () => {
  test('BORROWED node_modules voids the verdict before a single gate runs (§15.13)', () => {
    const d = tree(CI);
    const other = mkdtempSync(join(tmpdir(), 'gate-other-'));
    try {
      mkdirSync(join(other, 'packages', 'kernel'), { recursive: true });
      mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
      symlinkSync(join(other, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));

      const r = gate(d);

      assert.notEqual(r.status, 0);
      assert.match(r.out + r.err, /BORROWED node_modules/, 'a tree running another tree\'s install measures the other tree');
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe('gate.sh — a step log belongs to the tree that produced it (bead 6.9)', () => {
  test('two trees gated into ONE campaign dir keep BOTH step logs — neither overwrites the other', () => {
    // The incident this pins, in one sentence: `$LOGS` is the campaign dir,
    // shared by every lane, and the step name derives from the COMMAND, so
    // four lanes gating at once all wrote `gate-npm-test.log`. On 2026-09-08
    // a lane read `# fail 10` out of that file seconds after its own gate
    // passed; the failures belonged to a sibling, and PR bodies across the
    // milestone had already quoted counts from this path as evidence.
    const campaign = mkdtempSync(join(tmpdir(), 'gate-camp-'));
    // A ci.yml whose only step is a command that always succeeds and writes
    // something identifiable, so each tree's log has provable provenance.
    const ciFor = (marker: string) => `name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Marker
        run: echo ${marker}
`;
    const a = tree(ciFor('TREE-A-RAN-HERE'));
    const b = tree(ciFor('TREE-B-RAN-HERE'));
    try {
      // Each tree needs an install that points at ITSELF, or the
      // borrowed-node_modules guard voids the verdict before any step runs
      // and no reports/ dir is ever created (that guard has its own test
      // above; here it would mask the thing under test).
      for (const d of [a, b]) installedInPlace(d);

      gate(a, campaign);
      gate(b, campaign);

      const logs = readdirSync(join(campaign, 'reports'));
      const forA = logs.filter((f) => f.includes(basename(a)));
      const forB = logs.filter((f) => f.includes(basename(b)));

      assert.ok(forA.length > 0, `no step log names tree A; got: ${logs.join(', ')}`);
      assert.ok(forB.length > 0, `no step log names tree B; got: ${logs.join(', ')}`);

      // The claim is not merely "two files exist" — it is that each one holds
      // ITS OWN tree's output. A shared name would leave one file holding the
      // last writer's bytes, which is exactly how the incident read as green.
      const bodyA = readFileSync(join(campaign, 'reports', forA[0]), 'utf8');
      const bodyB = readFileSync(join(campaign, 'reports', forB[0]), 'utf8');
      assert.match(bodyA, /TREE-A-RAN-HERE/, 'tree A\'s step log must hold tree A\'s output');
      assert.match(bodyB, /TREE-B-RAN-HERE/, 'tree B\'s step log must hold tree B\'s output');
      assert.doesNotMatch(bodyA, /TREE-B-RAN-HERE/, 'a sibling gate must not be able to write into this tree\'s log');
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
      rmSync(campaign, { recursive: true, force: true });
    }
  });

  test('no `.part` file survives a completed gate — the atomic rename always lands', () => {
    const campaign = mkdtempSync(join(tmpdir(), 'gate-camp-'));
    const d = tree(`name: CI
on: [push]
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Fails
        run: exit 3
`);
    try {
      installedInPlace(d);
      gate(d, campaign);
      const logs = readdirSync(join(campaign, 'reports'));
      // A FAILING step is the case that used to skip the rename in the first
      // draft of this fix: the log it points the reader at must exist.
      assert.deepEqual(logs.filter((f) => f.endsWith('.part')), [], `a .part file outlived the gate: ${logs.join(', ')}`);
      assert.ok(logs.some((f) => f.includes(basename(d))), 'the failing step log is still named for its tree');
    } finally {
      rmSync(d, { recursive: true, force: true });
      rmSync(campaign, { recursive: true, force: true });
    }
  });
});

// ── bead 6.9: an argument the gate does not understand must REFUSE ──────────
//
// MEASURED, and the measurement corrects this lane's own first-turn report.
// M6-C opened by reporting "`gate.sh --list` HANGS — killed at 20 s and at
// 120 s, printing nothing", and built a parallel gate wrapper on the strength
// of it. `--list` does not hang. The invocation was
//
//     gate.sh <worktree> <campaign-dir> --list
//
// with the flag LAST, and line 28 reads it only as `$1`. So `--list` landed in
// `$3`, was ignored in silence, and the FULL gate ran — a build, `npm test` and
// `test:ui`, which is what "hung" for 20 s and for 120 s. T1 reproduced the
// same shape from the main checkout ("exit 124 after 20 s, three header lines
// printed"): three header lines is the full gate STARTING.
//
// The defect is therefore real but it is not a hang. A tool that silently
// ignores an argument it does not understand, and answers with a ten-minute
// suite instead of an error, cannot be told apart from a tool that is broken —
// and the operator's next move is to work around a fault that was never there.
// Refusing costs one line; the misdiagnosis cost this lane a parallel gate.

describe('gate.sh — an argument it does not understand is refused, never ignored', () => {
  test('6.9: a trailing --list is REFUSED rather than silently running the whole gate', () => {
    const d = tree(CI);
    installedInPlace(d);
    const r = gate(d, join(d, 'camp'), '--list');
    assert.notEqual(r.status, 0, `it must not proceed. out: ${r.out}${r.err}`);
    assert.match(`${r.out}${r.err}`, /unexpected argument/i, `and it must say which one: ${r.out}${r.err}`);
    assert.doesNotMatch(`${r.out}${r.err}`, /npm run build/, 'it must not have started running steps');
  });

  test('6.9: any surplus argument is refused, not only a misplaced flag', () => {
    const d = tree(CI);
    installedInPlace(d);
    const r = gate(d, join(d, 'camp'), 'whatever');
    assert.notEqual(r.status, 0);
    assert.match(`${r.out}${r.err}`, /unexpected argument/i);
  });

  test('6.9 POSITIVE CONTROL: the two documented forms still work', () => {
    const d = tree(CI);
    installedInPlace(d);
    const listed = gate('--list', d);
    assert.equal(listed.status, 0, `--list first is the documented form: ${listed.err}`);
    assert.match(listed.out, /^RUN /m);
  });
});

/**
 * T1 ruling 639 / bead `forge-8vfn.7.6.13` — the gate names the campaign's locks
 * for the guard that refuses on them.
 *
 * `npm test` refuses while a story run holds the run-lock, and it learns WHICH
 * lock from `FORGE_RUN_LOCK`. The guard lives in the repo and a permanent
 * artifact never cites a path inside the campaign directory, so the caller that
 * KNOWS the campaign has to name it — and this is that caller, since `$CAMP` is
 * already its second argument.
 *
 * The step the assertions read is a real `run:` line in the fixture's own
 * ci.yml, so what is proven is that the EXPORT reaches a gate step's
 * environment — not that a variable was assigned somewhere in the script.
 */
const ENV_CI = `jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Record the lock env
        run: printenv FORGE_SUITE_LOCK FORGE_RUN_LOCK > lock-env.txt || echo "NEITHER SET" > lock-env.txt
`;

/** What the gate STEP saw, read from the tree it ran in. The gate prints only
 *  PASS/FAIL per step and sends stdout to its own log, so a test that read the
 *  gate's console would be asserting on the wrong stream. */
function lockEnvSeenBy(d: string): string {
  return readFileSync(join(d, 'lock-env.txt'), 'utf8');
}

test('639: a gate given a campaign exports BOTH lock names into its steps, derived from that campaign', () => {
  const d = tree(ENV_CI);
  installedInPlace(d);
  const camp = mkdtempSync(join(tmpdir(), 'camp-'));

  gate(d, camp);
  const seen = lockEnvSeenBy(d);

  assert.match(seen, new RegExp(`^${camp}/\\.suite-lock$`, 'm'), 'the suite lock must be named from the campaign argument');
  assert.match(seen, new RegExp(`^${camp}/\\.run-lock$`, 'm'), 'and the run lock with it');
  assert.equal(seen.includes('NEITHER SET'), false);
});

test('639: the paths are DERIVED, never literal — a different campaign yields different locks', () => {
  const d = tree(ENV_CI);
  installedInPlace(d);
  const campA = mkdtempSync(join(tmpdir(), 'campA-'));
  const campB = mkdtempSync(join(tmpdir(), 'campB-'));

  gate(d, campA);
  const seenA = lockEnvSeenBy(d);
  gate(d, campB);
  const seenB = lockEnvSeenBy(d);

  assert.match(seenA, new RegExp(`^${campA}/\\.run-lock$`, 'm'));
  assert.match(seenB, new RegExp(`^${campB}/\\.run-lock$`, 'm'));
  assert.equal(seenA.includes(campB), false, 'a hard-coded path would leak one campaign into the other run');
});

test('639: NO campaign exports nothing — the guard must reach its honest "not configured" line, not an empty lock', () => {
  const d = tree(ENV_CI);
  installedInPlace(d);

  gate(d);

  assert.match(lockEnvSeenBy(d), /NEITHER SET/, 'an empty FORGE_RUN_LOCK would be a lock nothing can hold — worse than an absent one');
});
