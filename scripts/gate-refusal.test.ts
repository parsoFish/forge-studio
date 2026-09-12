/**
 * How `gate.sh` CLASSIFIES a step's outcome — split from `gate.test.ts` when
 * 7.6.100's second-guard door took that file past the 800-line cap (§0).
 * SPLIT, NEVER BASELINE (492).
 *
 * THE SEAM IS CLASSIFICATION, not convenience. Everything left in
 * `gate.test.ts` asks WHAT THE GATE MEASURED — the step list comes from the
 * tree, a verdict is void unless it measured that tree, a log belongs to the
 * tree that produced it, the pin block's counts and skew. Everything here asks
 * WHAT THE GATE CALLED IT: a step that never ran is REFUSED and not FAIL, its
 * reason is lifted onto the line by name rather than by position, and a step
 * that ran and went red is still FAIL.
 *
 * That distinction is the whole of ruling 699 and the reason these tests exist
 * at all, so it is the line the file splits on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const GATE = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'gate.sh');

/** 649: this file must not inherit the lock vars, or an outer gate's exports
 *  would decide what the inner one measures. */
function gate(...args: string[]) {
  const { FORGE_SUITE_LOCK: _suite, FORGE_RUN_LOCK: _run, ...env } = process.env;
  const r = spawnSync('bash', [GATE, ...args], { encoding: 'utf8', env });
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function tree(ci: string) {
  const d = mkdtempSync(join(tmpdir(), 'gate-refusal-tree-'));
  mkdirSync(join(d, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(d, '.github', 'workflows', 'ci.yml'), ci);
  return d;
}

/** The gate voids any verdict on a tree whose `@forge/kernel` resolves outside
 *  it (§15.13), so a fixture that wants to reach the steps must own its install. */
function installedInPlace(d: string) {
  mkdirSync(join(d, 'packages', 'kernel'), { recursive: true });
  mkdirSync(join(d, 'node_modules', '@forge'), { recursive: true });
  symlinkSync(join(d, 'packages', 'kernel'), join(d, 'node_modules', '@forge', 'kernel'));
}

function campWithPin(parent: string, treeDir: string, counts: string | null) {
  const camp = join(parent, 'camp');
  mkdirSync(join(camp, 'gate-manifests'), { recursive: true });
  writeFileSync(join(treeDir, 'pinned.txt'), 'pinned\n');
  const sum = spawnSync('sha256sum', ['pinned.txt'], { cwd: treeDir, encoding: 'utf8' }).stdout;
  writeFileSync(join(camp, 'gate-manifests', 'X.sha256'), sum);
  if (counts !== null) writeFileSync(join(camp, 'gate-manifests', 'X.counts'), counts);
  return camp;
}

// COPIED from `gate.test.ts`, not retyped. The first cut of this split rewrote
// both from memory and `FAILING_CI` came out as `node fail.mjs` — so the door
// asserting `^FAIL  node -e` failed against correct code. A fixture rebuilt from
// a description of itself is the same error as a test written from a sentence
// (§15.497), one level down.
const REFUSING_CI = `jobs:
  build-and-test:
    steps:
      - name: Refused by the lock guard
        run: node refuse.mjs
`;
const FAILING_CI = `jobs:
  build-and-test:
    steps:
      - name: A real failure
        run: node -e "process.exit(1)"
`;

function gitTreeWithHistory(ci: string): { dir: string; first: string; head: string } {
  const dir = tree(ci);
  const git = (...a: string[]) => spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
  git('init', '-q', '-b', 'work');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'fixture');
  writeFileSync(join(dir, 'first.txt'), 'first\n');
  git('add', '-A'); git('commit', '-qm', 'first');
  const first = (git('rev-parse', 'HEAD').stdout ?? '').trim();
  writeFileSync(join(dir, 'second.txt'), 'second\n');
  git('add', '-A'); git('commit', '-qm', 'second');
  const head = (git('rev-parse', 'HEAD').stdout ?? '').trim();
  return { dir, first, head };
}

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

/**
 * 7.6.100: THE SECOND GUARD'S MARKER, and the reason this door exists at all.
 *
 * The reason-extraction above matched the literal `[test-guard]` — the only
 * guard that existed when it was written. `build-guard` writes `[build-guard]`,
 * so the REFUSED line would have carried an EMPTY reason for it: exactly the
 * defect recorded three paragraphs up ("the first draft read LINE 1 and printed
 * an empty reason"), recurring one guard later, in the file whose subject is not
 * being silent.
 *
 * The property was never "the test guard's line" — it is "the line the guard
 * wrote". Matching the marker SHAPE `[<name>-guard]` is what makes that general,
 * and this door is what stops the third guard rediscovering it.
 */
test('7.6.100: a BUILD refused by its lock guard carries its reason onto the line too', () => {
  const { dir, head } = gitTreeWithHistory(REFUSING_CI);
  installedInPlace(dir);
  writeFileSync(join(dir, 'refuse.mjs'), [
    "console.error('> forge@0.9.0 prebuild');",
    "console.error('> node scripts/build-guard.mjs');",
    "console.error('');",
    "console.error('[build-guard] WAITED-OUT .run-lock 1800s — pid 4242 (cwd /elsewhere). Nothing was held while waiting; this build did not run and this is NOT a red.');",
    'process.exit(75);',
  ].join('\n'));
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'refused-build-')), dir, `paths=1 head=${head}\n`);

  const out = gate(dir, camp).out;

  assert.match(out, /^REFUSED {2}node refuse\.mjs/m, 'a build that never started is REFUSED, not FAIL');
  assert.doesNotMatch(out, /^FAIL {2}node refuse\.mjs/m);
  assert.match(
    out, /^REFUSED {2}node refuse\.mjs {2}\(\d+s\) — WAITED-OUT \.run-lock/m,
    'the SECOND guard\'s reason must reach the line as well — a literal [test-guard] match prints nothing here',
  );
  assert.match(out, /pid 4242 \(cwd \/elsewhere\)/, 'including the holder, so the reader knows who to wait for');
});

test('699: an ordinary failing step is still FAIL with rc 1 — the distinction only helps if it is one', () => {
  const { dir, head } = gitTreeWithHistory(FAILING_CI);
  installedInPlace(dir);
  const camp = campWithPin(mkdtempSync(join(tmpdir(), 'realfail-')), dir, `paths=1 head=${head}\n`);

  const r = gate(dir, camp);

  assert.match(r.out, /^FAIL {2}node -e/m, 'a step that ran and lost is a failure');
  assert.notEqual(r.status, 3, 'and must never borrow the refusal code');
});
