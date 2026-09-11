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

/**
 * Bead `forge-e8dn` — the campaign dir is RESOLVED, or the gate REFUSES.
 *
 * MEASURED on M6-A's own gates, twice, before anyone noticed. `gate.sh` took
 * `$CAMP` as `$2` and never resolved it, so a relative argument — which reads
 * perfectly naturally from inside a worktree — quietly meant three different
 * wrong things at once, and the gate still printed a full verdict and exited 0:
 *
 *   1. `$CAMP/gate-manifests` did not exist, so the whole pins section was
 *      skipped with NO output. Two full gates reported PASS rows for 20 steps
 *      and checked zero pins. That contradicts this script's own contract,
 *      thirteen lines into it: "What it does not run, it NAMES (§15.92 — a
 *      check whose negative result is indistinguishable from 'nothing to
 *      report' is not a check)". It names SKIP for `npm ci` and OTHER JOB for
 *      every run-lock job; pins were the one thing it dropped in silence.
 *
 *   2. `FORGE_SUITE_LOCK`/`FORGE_RUN_LOCK` pointed INSIDE the worktree at paths
 *      nothing ever creates, and `lock-guard.mjs` reads a missing lock as
 *      "nobody is running" — right for a real lock path, wrong for a fabricated
 *      one. The suite then ran outside BOTH campaign locks believing it held
 *      them, and collided with a sibling lane's gate twice.
 *
 *   3. `mkdir -p "$LOGS"` MINTED `<worktree>/_1.0/reports/` and wrote every
 *      step log there. `_1.0` is gitignored, so `git status` reported a clean
 *      tree over it (§15.374).
 *
 * §15.375: `lanes.sh`, ten lines away in the same skill directory, already
 * resolves `camp`, `prompt` and `cwd` to absolute before using any of them, and
 * says why — "a relative path passed both and launched a promptless session —
 * $0.00, 0 context, an empty box, twice" (bead `forge-uowf`, §15.60). This is
 * not a novel failure; it is a known one that did not travel between two files
 * in the same folder.
 */

/** `gate()` with a chosen cwd — a relative argument has no meaning without one. */
function gateFrom(cwd: string, ...args: string[]) {
  const { FORGE_SUITE_LOCK: _suite, FORGE_RUN_LOCK: _run, ...env } = process.env;
  const r = spawnSync('bash', [GATE, ...args], { encoding: 'utf8', env, cwd });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** A campaign dir with one real manifest, so the pins section has something to report. */
function campWithManifest(parent: string, name: string, treeDir: string) {
  const camp = join(parent, name);
  mkdirSync(join(camp, 'gate-manifests'), { recursive: true });
  writeFileSync(join(treeDir, 'pinned.txt'), 'pinned\n');
  const sum = spawnSync('sha256sum', ['pinned.txt'], { encoding: 'utf8', cwd: treeDir }).stdout ?? '';
  writeFileSync(join(camp, 'gate-manifests', 'TEST.sha256'), sum);
  return camp;
}

test('forge-e8dn: a RELATIVE campaign dir is resolved to absolute — the locks it names are absolute too', () => {
  const d = tree(ENV_CI);
  installedInPlace(d);
  const parent = mkdtempSync(join(tmpdir(), 'rel-'));
  const camp = campWithManifest(parent, 'camp', d);

  // Spawned FROM `parent`, so `camp` is a relative argument with a real meaning.
  const r = gateFrom(parent, d, 'camp');

  assert.notEqual(r.status, 2, `a resolvable relative dir must not be refused — got: ${r.err}`);
  const seen = lockEnvSeenBy(d);
  assert.match(seen, new RegExp(`^${camp}/\\.suite-lock$`, 'm'), 'the suite lock must be ABSOLUTE — a relative one points inside the worktree at a path nothing creates, and the guard reads that as "nobody is running"');
  assert.match(seen, new RegExp(`^${camp}/\\.run-lock$`, 'm'), 'and the run lock with it');
  assert.equal(seen.includes('NEITHER SET'), false);
});

test('forge-e8dn: a relative campaign dir still gets its PINS CHECKED — the silent skip is the whole defect', () => {
  const d = tree(ENV_CI);
  installedInPlace(d);
  const parent = mkdtempSync(join(tmpdir(), 'relpin-'));
  campWithManifest(parent, 'camp', d);

  const out = gateFrom(parent, d, 'camp').out;

  assert.match(out, /== pins ==/, 'the pins section must run');
  assert.match(out, /TEST\.sha256: 0 FAILED of 1/, 'and actually verify the manifest, not merely print a header');
});

test('forge-e8dn: a relative campaign dir does NOT mint a campaign dir inside the worktree', () => {
  const d = tree(ENV_CI);
  installedInPlace(d);
  const parent = mkdtempSync(join(tmpdir(), 'relmint-'));
  campWithManifest(parent, 'camp', d);

  gateFrom(parent, d, 'camp');

  assert.equal(
    readdirSync(d).includes('camp'), false,
    'the logs belong to the CAMPAIGN; a stray copy under the worktree is invisible to git status because _1.0 is gitignored (§15.374)',
  );
});

test('forge-e8dn: a campaign dir that does not resolve is REFUSED, never half-applied', () => {
  const d = tree(ENV_CI);
  installedInPlace(d);

  const r = gate(d, join(tmpdir(), `no-such-campaign-${process.pid}`));

  assert.equal(r.status, 2, 'the `:31` rule — REFUSE what it does not understand — applies to a path as much as to a flag');
  assert.match(r.err, /campaign dir/i, 'and the refusal names what was wrong');
});

test('forge-e8dn: a campaign with no gate-manifests/ NAMES the skip, the way SKIP and OTHER JOB are named', () => {
  const d = tree(ENV_CI);
  installedInPlace(d);
  const camp = mkdtempSync(join(tmpdir(), 'nomanifests-'));

  const out = gate(d, camp).out;

  assert.match(out, /== pins ==/, 'the section appears even when there is nothing to check');
  assert.match(out, /SKIP.*gate-manifests/, 'a check that did not run must be indistinguishable from nothing — §15.92 is this script\'s own line 13');
});

test('forge-e8dn: NO campaign argument still names the skip — a gate outside a campaign is a real use', () => {
  const d = tree(ENV_CI);
  installedInPlace(d);

  const out = gate(d).out;

  assert.match(out, /== pins ==/);
  assert.match(out, /SKIP.*no campaign/i, 'nothing to check, said out loud rather than omitted');
});

/**
 * Bead `forge-e8dn` follow-on (T1 ruling 679) — A COUNT ONLY WHEN THE
 * COMPARISON MEANS SOMETHING.
 *
 * MEASURED. My gate printed `M6-C.sha256: 13 FAILED of 198` and I reported it
 * to T1 and to M6-C as C's drift. It was not. C's tree was 0 FAILED / 0
 * MISSING. The 13 was the distance between MY tree and the sha C's manifest
 * pins: my base was `99ea89ee`, C's #644 landed at `eb46e4c2` after it, and
 * seven of the nine were one merge of skew — four files that did not exist in
 * my checkout yet and three that #644 had edited.
 *
 * C's general form, §15.381, credited to C: "a manifest hashed against any
 * other tree measures the distance between the trees, which is exactly what a
 * manifest is not for."
 *
 * So this is `forge-e8dn`'s class one step along. That one said NOTHING when it
 * checked nothing; this one says `N FAILED` when it checked something other
 * than what the reader assumes. Both are numbers that read as findings.
 *
 * THE THIRD BRANCH IS THE ONE THAT MATTERS. Three of the campaign's eight
 * `.counts` files carry `head=` (`M6-C`, `M6-D`, `M6-T1`); the rest carry `pin=`
 * only or are free prose. A check keyed on `head=` that stayed QUIET for the
 * other five would rebuild the exact defect it is fixing, five times over — so
 * a manifest whose counts cannot answer "which sha?" gets its count AND a named
 * caveat, never a silent one.
 */

/** A fixture campaign: one manifest over one pinned file, plus its counts. */
function campWithPin(parent: string, treeDir: string, counts: string | null) {
  const camp = join(parent, 'camp');
  mkdirSync(join(camp, 'gate-manifests'), { recursive: true });
  writeFileSync(join(treeDir, 'pinned.txt'), 'pinned\n');
  const sum = spawnSync('sha256sum', ['pinned.txt'], { encoding: 'utf8', cwd: treeDir }).stdout ?? '';
  writeFileSync(join(camp, 'gate-manifests', 'FIX.sha256'), sum);
  if (counts !== null) writeFileSync(join(camp, 'gate-manifests', 'FIX.counts'), counts);
  return camp;
}

/** A real git tree, because the check compares against the tree's own HEAD. */
function gitTree(ci: string): { dir: string; head: string } {
  const d = tree(ci);
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'gate@test');
  git('config', 'user.name', 'gate');
  git('add', '-A');
  git('commit', '-qm', 'fixture');
  return { dir: d, head: (git('rev-parse', 'HEAD').stdout ?? '').trim() };
}

test('679/684: a tree AT the pinned sha reports the count and names the sha it verified at', () => {
  const { dir, head } = gitTree(CI);
  installedInPlace(dir);
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'skew-ok-')), dir, `paths=1 head=${head}\n`);

  const out = gate(dir, camp).out;

  assert.match(out, /FIX\.sha256: 0 FAILED of 1/);
  assert.match(out, /last verified at/, 'the line says WHICH sha the count belongs to — that is the whole fix');
  assert.doesNotMatch(out, /skew:/, 'no skew to report');
});

test('679/684: a CLEAN count from a tree ahead of the pin is a real verification, not tree-distance', () => {
  // Ruling 684, correcting this block's first draft. `sha256sum -c` verifies
  // HASHES: 0 FAILED from a tree ahead of the pin means the pinned bytes still
  // hold HERE. The first draft printed SKIPPED on any skew and threw that real
  // verification away along with the ambiguous case.
  const { dir } = gitTree(CI);
  installedInPlace(dir);
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'skew-clean-')), dir, 'paths=1 head=deadbeefdeadbeef\n');

  const out = gate(dir, camp).out;

  assert.match(out, /FIX\.sha256: 0 FAILED of 1/, 'the verification stands and must be printed');
  assert.doesNotMatch(out, /SKIPPED/, 'skew does not invalidate a clean count');
  assert.doesNotMatch(out, /skew:/, 'and there is nothing ambiguous to warn about');
  assert.match(out, /last verified at deadbeefdeadbeef/, 'but the reader is told which sha it was last verified at');
});

test('679/684: a NON-ZERO count across skew is the ambiguous one, and says how to resolve it', () => {
  // A FAILED line can be real drift or a file the pin simply predates. That is
  // exactly what cost a round when `M6-C: 13 FAILED of 198` went upward as a
  // sibling lane's drift from a tree one merge behind.
  const { dir } = gitTree(CI);
  installedInPlace(dir);
  const parent = mkdtempSync(join(tmpdir(), 'skew-fail-'));
  const camp = campWithPin(parent, dir, 'paths=1 head=deadbeefdeadbeef\n');
  writeFileSync(join(dir, 'pinned.txt'), 'CHANGED since the pin\n');

  const out = gate(dir, camp).out;

  assert.match(out, /FIX\.sha256: 1 FAILED of 1/, 'the number is still reported');
  assert.match(out, /skew:/, 'but a non-zero count across skew cannot be read as drift on its own');
  assert.match(out, /reconcile from a tree at deadbeefdeadbeef or later/, 'and the reader is told what to do about it');
});

test('679/684: a manifest whose counts cannot say WHICH sha gets its count AND a named caveat', () => {
  const { dir } = gitTree(CI);
  installedInPlace(dir);
  // Free prose — the shape `M6-A.counts` and `M6-B.counts` actually carried.
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'skew-prose-')), dir, 'measured in /somewhere at fa45d7c8\n');

  const out = gate(dir, camp).out;

  assert.match(out, /FIX\.sha256: 0 FAILED of 1/, 'the count is still the best available answer');
  assert.match(out, /skew unknown/, 'silence here would rebuild the defect eleven manifests over — only 3 of 14 counts carry head=');
});

test('679/684: NO counts file at all is the same named caveat, not a silent pass', () => {
  const { dir } = gitTree(CI);
  installedInPlace(dir);
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'skew-none-')), dir, null);

  const out = gate(dir, camp).out;

  assert.match(out, /FIX\.sha256: 0 FAILED of 1/);
  assert.match(out, /skew unknown/, 'an absent counts file answers the question no better than a prose one');
});

/**
 * T1 ruling 693(ii), §15.388 — THE PIN BLOCK FEEDS THE RC.
 *
 * MEASURED by D and verified in the tool: `gate.sh` exits on its STEP LIST only
 * (`exit $fail`). The pin block prints beside that rc and never touches it. D's
 * gate on `d7d8dba9` was **rc=0, 20/20, with `M6-T1.sha256: 2 FAILED of 14` in
 * the same log**, and the merge precondition recorded green over two failing
 * pins. "A check that runs and is not read is a check that never ran."
 *
 * So an undeclared pin failure now fails the gate. A lane that KNOWS a pin will
 * fail — its own amendment, or a sibling re-pin it will reconcile — declares it
 * with `--expect-pin-fail <manifest>[:<path>]`, the same shape the campaign's
 * `pin-precheck.sh` takes.
 *
 * THE SKEW TEST IS AN ANCESTRY QUESTION, NOT A STRING ONE (M6-C's finding,
 * verified against this very tree before the fix: HEAD `82bb8bf4` is a
 * DESCENDANT of pin `df473067`, so it contains every pinned commit and can
 * answer perfectly — and the prefix match called it skew). With the rc riding
 * on this, a prefix match would refuse a lane one commit ahead and hand it
 * advice it has already followed: "reconcile from a tree at X or later" to a
 * tree that IS at X or later.
 */

/** A ci.yml whose one step exits 75 — what the lock guard now does when refused.
 *
 *  The step runs a FILE, not an inline `node -e`, and that is load-bearing: the
 *  gate echoes `$cmd` verbatim onto the REFUSED line, so a command containing
 *  the holder text would satisfy an assertion about the holder whether or not
 *  the extraction worked at all. The first version of this fixture did exactly
 *  that and its assertion was vacuous — it passed under a mutation that put the
 *  extraction back to reading line 1. Keeping the message OUT of the command is
 *  what makes the extracted reason the only place it can come from.
 *
 *  The banner lines matter too: npm writes `> forge@0.9.0 pretest` first in a
 *  real log, and the guard's line is the fifth. */
const REFUSING_CI = `jobs:
  build-and-test:
    steps:
      - name: Refused by the lock guard
        run: node refuse.mjs
`;

/** A ci.yml whose one step genuinely fails, so the distinction can be shown to be one. */
const FAILING_CI = `jobs:
  build-and-test:
    steps:
      - name: A real failure
        run: node -e "process.exit(1)"
`;

/** A git fixture whose HEAD is a real descendant of an earlier commit. */
function gitTreeWithHistory(ci: string): { dir: string; first: string; head: string } {
  const d = tree(ci);
  const git = (...a: string[]) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'gate@test');
  git('config', 'user.name', 'gate');
  git('add', '-A');
  git('commit', '-qm', 'first');
  const first = (git('rev-parse', 'HEAD').stdout ?? '').trim();
  writeFileSync(join(d, 'later.txt'), 'a later commit\n');
  git('add', '-A');
  git('commit', '-qm', 'second');
  return { dir: d, first, head: (git('rev-parse', 'HEAD').stdout ?? '').trim() };
}

// WHY THESE ASSERT ON THE VERDICT LINES AND NOT ON `status`. A synthetic tree
// can never exit 0: `prod-lines.mjs` refuses it with "this is not a forge
// checkout" (no `scripts/check-owner.mjs`), so the rc is 1 for reasons that
// have nothing to do with pins. Asserting `status === 0` here would be pinning
// the fixture's incompleteness, and asserting `status !== 0` would pass whether
// or not the pin block contributed anything at all. The `UNDECLARED:` /
// `declared:` lines ARE the pin block's contribution to `fail`, so they are
// what these pin — and the one rc fact worth having is covered below, where a
// gate that differs ONLY in the declaration must differ in its verdict lines.

test('693(ii): an UNDECLARED pin failure is named as such — this is what now feeds the rc', () => {
  const { dir, head } = gitTreeWithHistory(CI);
  installedInPlace(dir);
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'rc-undecl-')), dir, `paths=1 head=${head}\n`);
  writeFileSync(join(dir, 'pinned.txt'), 'CHANGED\n');

  const out = gate(dir, camp).out;

  assert.match(out, /FIX\.sha256: 1 FAILED of 1/, 'it still says what failed');
  assert.match(out, /UNDECLARED: FIX:pinned\.txt/, 'and names the path, so `fail=1` is traceable to a file rather than a count');
});

test('693(ii): the SAME gate with the failure DECLARED reports it declared, and nothing undeclared', () => {
  const { dir, head } = gitTreeWithHistory(CI);
  installedInPlace(dir);
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'rc-decl-')), dir, `paths=1 head=${head}\n`);
  writeFileSync(join(dir, 'pinned.txt'), 'CHANGED\n');

  const out = gate(dir, camp, '--expect-pin-fail', 'FIX:pinned.txt').out;

  assert.match(out, /declared: FIX:pinned\.txt/, 'a lane that accounts for its own amendment says so');
  assert.doesNotMatch(out, /UNDECLARED:/, 'and nothing is left to fail the gate');
  assert.match(out, /FIX\.sha256: 1 FAILED of 1/, 'the count is still printed — declaring is not hiding');
});

test('693(ii): a clean pin block declares nothing and flags nothing', () => {
  const { dir, head } = gitTreeWithHistory(CI);
  installedInPlace(dir);
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'rc-clean-')), dir, `paths=1 head=${head}\n`);

  const out = gate(dir, camp).out;

  assert.match(out, /FIX\.sha256: 0 FAILED of 1/);
  assert.doesNotMatch(out, /UNDECLARED:/, 'nothing failed, so nothing may feed the rc');
});

test('693(ii)/M6-C: a DESCENDANT of the pinned sha is not skew — it contains every pinned commit', () => {
  const { dir, first } = gitTreeWithHistory(CI);
  installedInPlace(dir);
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'rc-desc-')), dir, `paths=1 head=${first}\n`);
  writeFileSync(join(dir, 'pinned.txt'), 'CHANGED\n');

  const out = gate(dir, camp).out;

  // The prefix match this replaces printed the skew line here and, with the rc
  // riding on it, would have told a lane one commit ahead to reconcile from a
  // tree it is already ahead of.
  assert.doesNotMatch(out, /skew:/, 'a descendant can answer the question, so the count is real');
  assert.match(out, /UNDECLARED: FIX:pinned\.txt/, 'and a real, undeclared failure must reach the rc');
});

test('693(ii)/M6-C: a DIVERGENT tree still reports skew, and contributes NOTHING to the rc', () => {
  const { dir } = gitTreeWithHistory(CI);
  installedInPlace(dir);
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'rc-div-')), dir, 'paths=1 head=deadbeefdeadbeef\n');
  writeFileSync(join(dir, 'pinned.txt'), 'CHANGED\n');

  const out = gate(dir, camp).out;

  assert.match(out, /skew:/, 'the manifest pins a commit this tree does not contain');
  assert.doesNotMatch(out, /UNDECLARED:/, 'an UNREADABLE count must not fail a gate — the lane cannot act on it from here (§15.381)');
});

test('693(ii): an unrecognised flag is still REFUSED, not silently ignored (bead 8vfn.6.9)', () => {
  const { dir, head } = gitTreeWithHistory(CI);
  installedInPlace(dir);
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'rc-bad-')), dir, `paths=1 head=${head}\n`);

  const r = gate(dir, camp, '--expect-pin-fale', 'FIX:pinned.txt');

  assert.equal(r.status, 2, 'a typo in a flag that gates a merge must not read as "no expectations declared"');
  assert.match(r.err, /--expect-pin-fale/, 'and the refusal names what it did not understand');
});

/**
 * T1 ruling 699 — A REFUSAL IS NOT A FAILURE.
 *
 * MEASURED by M6-C, three times in one night, and by me three times today:
 * `gate.sh` holds `.suite-lock` while its `npm test` step is refused by the
 * 7.6.13 guard because a sibling's story run holds `.run-lock`. The gate records
 *
 *     FAIL  npm test  (0s)
 *
 * which is indistinguishable from a suite that ran and went red. That is §15.92
 * one layer up: the guard is careful to name its holder, and the layer above
 * flattens that into the same word it uses for a real failure. Every time it
 * happened I had to open the step log to learn nothing had run.
 *
 * So the refusal carries a DISTINCT exit code — 75, `EX_TEMPFAIL`, the
 * conventional "try again later" — and `gate.sh` records the step as `REFUSED`
 * with the holder, in the same `SKIP` / `OTHER JOB` idiom it already uses for
 * what it did not run, and exits 3 rather than 1.
 */

test('699: a step REFUSED by the lock guard is not recorded as FAIL', () => {
  const { dir, head } = gitTreeWithHistory(REFUSING_CI);
  installedInPlace(dir);
  writeFileSync(join(dir, 'refuse.mjs'), [
    "console.error('> forge@0.9.0 pretest');",
    "console.error('> node scripts/test-guard.mjs');",
    "console.error('');",
    "console.error('[test-guard] refusing to start the test suite: a story run holds .run-lock — pid 1 (cwd /elsewhere)');",
    'process.exit(75);',
  ].join('\n'));
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'refused-')), dir, `paths=1 head=${head}\n`);

  const out = gate(dir, camp).out;

  // COLUMN 0, per 699's addendum: the rc is necessary and not sufficient,
  // because every merge precondition reads the LOG and a refused gate still
  // prints a pin block. `^REFUSED ` has to be as greppable as `^FAIL `.
  assert.match(out, /^REFUSED {2}node refuse\.mjs/m, 'a refusal must not wear the same word as a failure, and must be findable at column 0');
  assert.doesNotMatch(out, /^FAIL {2}node refuse\.mjs/m, 'and must not be counted as one');
  assert.match(out, /holds \.run-lock — pid 1 \(cwd \/elsewhere\)/, 'the holder travels onto the step line, so no reader opens the log to learn nothing ran');
  assert.match(out, /^REFUSED {2}node refuse\.mjs {2}\(\d+s\) — refusing to start/m, 'the reason is EXTRACTED onto the line — found by name, since npm\'s banner is line 1 and the guard\'s line is the fifth');
  // `status` is not asserted here for the reason given above the pin tests: a
  // synthetic tree cannot exit 0, `prod-lines.mjs` refuses it as "not a forge
  // checkout", and a real failure outranks a refusal by design — so the rc
  // would be 1 for reasons unrelated to the refusal. The line IS the contract.
});

test('699: an ordinary failing step is still FAIL with rc 1 — the distinction only helps if it is one', () => {
  const { dir, head } = gitTreeWithHistory(FAILING_CI);
  installedInPlace(dir);
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'realfail-')), dir, `paths=1 head=${head}\n`);

  const r = gate(dir, camp);

  assert.match(r.out, /^FAIL {2}node -e/m, 'a step that ran and lost is a failure');
  assert.notEqual(r.status, 3, 'and must never borrow the refusal code');
});
