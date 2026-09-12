/**
 * The door for `with-locks.sh` — `forge-8vfn.7.6.83`.
 *
 * Every lane takes `.suite-lock` (heavy jobs) and `.run-lock` (costed runs), and
 * every lane hand-rolled the ordering. The same defect arrived three ways in one
 * day: a launcher waited for the suite-lock OUTSIDE the run-lock it held; a gate
 * job did it with the locks swapped two hours after the first fix; and the
 * post-merge family took the suite-lock and never waited for the run-lock at all
 * while running `npm test`, which refuses while a story run holds it.
 *
 * EVERY TEST USES ITS OWN CAMPAIGN DIR. Measured the hard way while writing
 * this: a smoke test against the real `_1.0` reported "still held" and the
 * holder turned out to be a sibling lane's gate. A door that shares a lock with
 * live lanes tests the campaign's timing, not this file.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'with-locks.sh',
);

function camp(): string {
  const d = mkdtempSync(join(tmpdir(), 'with-locks-'));
  writeFileSync(join(d, '.suite-lock'), '');
  writeFileSync(join(d, '.run-lock'), '');
  return d;
}
const run = (...args: string[]) => spawnSync('bash', [SCRIPT, ...args], { encoding: 'utf8' });

/** Hold one lock from outside, the way a sibling lane would. */
function holdLock(campDir: string, name: string, seconds = 30): ChildProcess {
  const child = spawn('flock', [join(campDir, name), 'sleep', String(seconds)], { stdio: 'ignore' });
  // `flock` needs a moment to actually acquire before the test races it.
  spawnSync('sleep', ['0.3']);
  return child;
}
/** Can this lock be taken right now? */
const takeable = (campDir: string, name: string) =>
  spawnSync('flock', ['-w', '1', join(campDir, name), 'true']).status === 0;

describe('with-locks.sh — one ratified order, bounded, and the lock it lost is named', () => {
  test('ORDER: suite-lock first, run-lock inside it', () => {
    const d = camp();
    const holder = holdLock(d, '.run-lock');
    try {
      const r = run(d, 'both', '--wait-secs', '1', '--', 'echo', 'never');
      // It got the suite-lock (announced) and then failed on the run-lock. That
      // ordering is the whole contract: a caller that took them the other way
      // round is the defect this file exists to remove.
      assert.match(r.stdout, /\.suite-lock taken/);
      assert.doesNotMatch(r.stdout, /never/);
      assert.equal(r.status, 72, r.stdout + r.stderr);
    } finally { holder.kill(); rmSync(d, { recursive: true, force: true }); }
  });

  test('a bounded wait exits with the lock NAMED, not a generic 1', () => {
    const d = camp();
    const holder = holdLock(d, '.suite-lock');
    try {
      const r = run(d, 'both', '--wait-secs', '1', '--', 'echo', 'never');
      assert.equal(r.status, 71, r.stdout + r.stderr);
      assert.match(r.stderr, /TIMED OUT after 1s waiting for \.suite-lock/);
      // A caller retrying blind cannot tell which of two waits it lost, and the
      // two have different remedies — so the message names the lock and, when it
      // can, the holder.
      assert.match(r.stderr, /held by:/);
    } finally { holder.kill(); rmSync(d, { recursive: true, force: true }); }
  });

  test('THE SIBLING IS NOT STARVED: a lock it holds is released when the other wait times out', () => {
    const d = camp();
    const holder = holdLock(d, '.run-lock');
    try {
      const r = run(d, 'both', '--wait-secs', '1', '--', 'sleep', '30');
      assert.equal(r.status, 72);
      // It held the suite-lock while waiting for the run-lock. Having lost, it
      // must not still be holding the suite-lock — that is how one lane's failed
      // wait becomes every other lane's outage.
      assert.equal(takeable(d, '.suite-lock'), true, 'the suite-lock was still held after the run-lock wait failed');
    } finally { holder.kill(); rmSync(d, { recursive: true, force: true }); }
  });

  test('SIGTERM releases promptly — the command never inherits the lock descriptors', async () => {
    const d = camp();
    const child = spawn('bash', [SCRIPT, d, 'suite', '--', 'sleep', '30'], { stdio: 'ignore' });
    try {
      await new Promise((r) => setTimeout(r, 600));
      assert.equal(takeable(d, '.suite-lock'), false, 'precondition: the wrapper should hold it');
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 600));
      // `exec 8>` opens a descriptor a child INHERITS, and an inherited fd keeps
      // the lock alive after the wrapper dies — the holder becomes a `sleep`
      // with no row naming this script, which is worse than not trapping at all.
      // The command is run with both descriptors closed, so this is takeable.
      assert.equal(takeable(d, '.suite-lock'), true, 'a child inherited the lock descriptor');
    } finally { child.kill('SIGKILL'); rmSync(d, { recursive: true, force: true }); }
  });

  test('the command runs with the locks held, and its exit code is this script’s', () => {
    const d = camp();
    try {
      const ok = run(d, 'both', '--', 'bash', '-c', 'exit 0');
      assert.equal(ok.status, 0, ok.stdout + ok.stderr);
      assert.match(ok.stdout, /\.suite-lock taken/);
      assert.match(ok.stdout, /\.run-lock taken/);
      const bad = run(d, 'run', '--', 'bash', '-c', 'exit 17');
      assert.equal(bad.status, 17, 'a wrapper that swallows the command’s status hides every failure it wraps');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('single-lock modes take only the lock they name', () => {
    const d = camp();
    try {
      const s = run(d, 'suite', '--', 'true');
      assert.match(s.stdout, /\.suite-lock taken/);
      assert.doesNotMatch(s.stdout, /\.run-lock taken/);
      const r = run(d, 'run', '--', 'true');
      assert.match(r.stdout, /\.run-lock taken/);
      assert.doesNotMatch(r.stdout, /\.suite-lock taken/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('REFUSES what it does not understand rather than answering a different question', () => {
    const d = camp();
    try {
      assert.equal(run(d, 'sweet', '--', 'true').status, 2, 'an unknown mode must refuse');
      assert.equal(run(d, 'both', '--wait-sec', '5', '--', 'true').status, 2, 'a mistyped flag must not read as "no options"');
      assert.equal(run(d, 'both', '--wait-secs', 'soon', '--', 'true').status, 2, 'a non-numeric bound must refuse');
      assert.equal(run(d, 'both', '--').status, 2, 'no command after -- must refuse');
      assert.equal(run('/nope/not/a/campaign', 'both', '--', 'true').status, 2);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

// ------------------------------------------------------------ 7.6.95
/**
 * REFUSING A COMBINATION THAT CANNOT SUCCEED, BEFORE TAKING ANYTHING.
 *
 * `with-locks.sh <camp> run -- gate.sh` can never succeed, and the old header
 * RECOMMENDED it. `gate.sh` never takes `.run-lock`, so the rule "name only the
 * locks the command does not take" pointed straight at the one choice that is
 * always fatal: the gate runs `npm test`, whose guard refuses when the run-lock
 * is held, awaited, or merely OPEN. The wrapper's own hold guarantees the
 * child's refusal.
 *
 * The rule is now "neither TAKES nor REFUSES UNDER", and the second property is
 * enforced rather than documented. These doors pin the three cases the bead
 * names plus the one it does not: a launcher whose FILENAME contains `gate` must
 * still run, because refusing it for its name would be this defect pointing the
 * other way.
 */
const GUARANTEED = 73;

test('7.6.95: run -- gate.sh is REFUSED at launch, and NOTHING is taken', () => {
  const d = camp();
  const before = [statSync(join(d, '.suite-lock')).mtimeMs, statSync(join(d, '.run-lock')).mtimeMs];
  const r = run(d, 'run', '--', 'bash', '/nowhere/gate.sh', 'a', 'b');
  assert.equal(r.status, GUARANTEED, `expected the guaranteed-failure refusal: ${r.stderr}`);
  assert.match(r.stderr, /REFUSING 'run'/);
  assert.match(r.stderr, /held, awaited or merely OPEN/, 'the reason names WHY the guard refuses');
  assert.match(r.stderr, /run it unheld/, 'and what to do instead');
  // The whole point of refusing AT LAUNCH: no lock was touched on the way out.
  assert.deepEqual(
    [statSync(join(d, '.suite-lock')).mtimeMs, statSync(join(d, '.run-lock')).mtimeMs], before,
    'a refusal must not have taken, opened or timestamped either lock',
  );
  assert.ok(takeable(d, '.run-lock') && takeable(d, '.suite-lock'), 'both locks remain free');
});

test('7.6.95: suite -- gate.sh is REFUSED too, with the OTHER reason', () => {
  // Different fact, different remedy: the gate TAKES the suite-lock itself, so
  // it would wait on a lock its own caller holds (#694). A single refusal
  // message for both cases would send a reader to the wrong fix.
  const d = camp();
  const r = run(d, 'suite', '--', 'bash', '/nowhere/gate.sh', 'a', 'b');
  assert.equal(r.status, GUARANTEED);
  assert.match(r.stderr, /TAKES \.suite-lock itself/);
  assert.match(r.stderr, /invoke it unwrapped/);
  assert.ok(takeable(d, '.suite-lock'), 'the suite-lock remains free');
});

test('7.6.95: run -- a plain launcher PROCEEDS and takes the run-lock', () => {
  const d = camp();
  const r = run(d, 'run', '--', 'true');
  assert.equal(r.status, 0, `a launcher is exactly what this wrapper is for: ${r.stderr}`);
  assert.match(r.stdout, /\.run-lock taken/);
});

test('7.6.95: a launcher whose NAME contains "gate" is NOT refused', () => {
  // The over-match negative. `my-gate-launcher.sh` is a launcher, not a gate,
  // and refusing it for its filename would be this bead's own defect pointing
  // the other way. It fails 127 because the path does not exist — which proves
  // it got PAST the refusal and was executed.
  const d = camp();
  const r = run(d, 'run', '--', 'bash', '/nowhere/my-gate-launcher.sh');
  assert.notEqual(r.status, GUARANTEED, `a launcher must not be refused for its name: ${r.stderr}`);
  assert.doesNotMatch(r.stderr, /REFUSING/);
});
