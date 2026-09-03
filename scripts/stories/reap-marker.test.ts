/**
 * The MARKER rung of the story reaper — bead `forge-8vfn.5.50` (M4-agents).
 *
 * `reap.test.ts` covers the three rungs sessions' #322 built (record,
 * descendant, group) and sits at 782 lines; these cases are the fourth rung
 * and live beside it rather than inside it, so neither file approaches the
 * 800-line cap and the two bodies of evidence stay separable.
 *
 * WHAT THIS RUNG IS FOR, in the module's own words: "A grandchild that BOTH
 * calls `setsid` (leaving our group) AND loses its parent before the snapshot
 * is invisible to both walks." The fix is at the DISPATCH seam — every agent
 * child carries a per-run token in its environment
 * (`packages/agents/spawn-marker.ts`) and the run records that token beside
 * its event log — so the reaper can identify OUR PROCESSES rather than a
 * DIRECTORY. That distinction is the whole point: the cwd sweep the module
 * refused to build would have signalled the story runner, the Studio bridge
 * and the operator's own shell, none of which ever carried a token.
 *
 * Mutation-tested: emptying the rung's claim loop reds four of these,
 * including the real-process control.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { collectAgentRuns, describeReap, reapAgentRuns } from './reap.mjs';

// ------------------------------------------- THE MARKER RUNG (5.50, agents)

test('the marker rung claims a process no other rung can see, and names the rung that admitted it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'story-reap-marker-unit-'));
  const dir = join(root, '_logs', '_agent-marked');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent-run.marker'), '_agent-marked:RUN-TOKEN-1\n');

  const signalled = [];
  const report = await reapAgentRuns(collectAgentRuns(root, 0), {
    ownRoot: root,
    // Neither ancestry nor group can reach 9001: it is in nobody's table.
    procTable: () => new Map(),
    carryingMarker: (token) => (token === '_agent-marked:RUN-TOKEN-1' ? [9001] : []),
    cwdOf: () => null,
    isAlive: () => false,
    kill: (pid, sig) => signalled.push([pid, sig]),
    graceMs: 0,
    pollMs: 1,
  });
  rmSync(root, { recursive: true, force: true });

  assert.deepEqual(
    report.reaped.map((r) => ({ pid: r.pid, via: r.via })),
    [{ pid: 9001, via: 'marker' }],
    'a setsid\'d orphan with no ppid or pgid tie to the run must still be reaped, by marker',
  );
  assert.deepEqual(signalled, [[9001, 'SIGTERM']]);
  assert.match(describeReap(report)[0], /by marker/);
});

test('a run that recorded a MARKER but never a turn.pid is still collected and swept', async () => {
  // `collectAgentRuns` used to key solely on `turn.pid`. A dispatch that wrote
  // its marker and no pid file would have been invisible; its children carry
  // the token regardless.
  const root = mkdtempSync(join(tmpdir(), 'story-reap-marker-nopid-'));
  const dir = join(root, '_logs', '_agent-nopid');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent-run.marker'), '_agent-nopid:RUN-TOKEN-2\n');

  const runs = collectAgentRuns(root, 0);
  assert.deepEqual(
    runs.map((r) => ({ pid: r.pid, markers: r.markers })),
    [{ pid: null, markers: ['_agent-nopid:RUN-TOKEN-2'] }],
  );

  const report = await reapAgentRuns(runs, {
    ownRoot: root,
    procTable: () => new Map(),
    carryingMarker: () => [9002],
    cwdOf: () => null,
    isAlive: () => false,
    kill: () => {},
    graceMs: 0,
    pollMs: 1,
  });
  rmSync(root, { recursive: true, force: true });
  assert.deepEqual(report.reaped.map((r) => r.pid), [9002]);
  assert.deepEqual(report.skipped, [], 'a marker-only run must not be reported as an unsignalable pid');
});

test('THE ONE LOOSENED INVARIANT: a MARKED process outside the worktree is reaped; an unmarked one still is NOT', async () => {
  // The cwd rule ("a readable cwd outside the run worktree is never
  // signalled") was bought by the S3 incident, when the only evidence was a
  // pid file that could be stale. A per-run token cannot be stale, and the
  // process it identifies — ours, working in someone else's checkout — IS the
  // S3 escape. So the marker rung, and ONLY the marker rung, claims it.
  const root = mkdtempSync(join(tmpdir(), 'story-reap-marker-outside-'));
  const dir = join(root, '_logs', '_agent-escaped');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'turn.pid'), '9101');
  writeFileSync(join(dir, 'agent-run.marker'), '_agent-escaped:RUN-TOKEN-3\n');

  const opts = {
    ownRoot: root,
    procTable: () => new Map(),
    cwdOf: () => '/home/parso/forge', // another checkout entirely — the S3 cwd
    isAlive: () => true,
    kill: () => {},
    graceMs: 0,
    pollMs: 1,
  };

  const marked = await reapAgentRuns(collectAgentRuns(root, 0), { ...opts, carryingMarker: () => [9101] });
  assert.deepEqual(
    marked.reaped.map((r) => ({ pid: r.pid, via: r.via })),
    [{ pid: 9101, via: 'marker' }],
    'an escaped agent of OURS must be reaped once the token proves it is ours',
  );
  assert.deepEqual(marked.skipped, [], 'a pid must never be reported as both reaped and refused');

  const unmarked = await reapAgentRuns(collectAgentRuns(root, 0), { ...opts, carryingMarker: () => [] });
  assert.deepEqual(unmarked.reaped, [], 'without the token the cwd rule still refuses — the invariant is loosened for the marker rung ALONE');
  assert.match(unmarked.skipped[0].reason, /outside the run worktree/);

  rmSync(root, { recursive: true, force: true });
});

test('a failing marker sweep is REPORTED, and still never throws out of the teardown', async () => {
  // THIS TEST CHANGED, and what it claimed before is worth saying out loud
  // (COMMON §15.28). It asserted `{reaped: [], skipped: []}` — that a failed
  // sweep produces no trace at all — and locked that silence in as correct.
  // The never-throw half is right and is the module's stated design; the
  // report-nothing half was a choice, and a bad one: it makes a rung that
  // FAILED indistinguishable from a rung that ran and found nothing, which is
  // exactly the reading that lets a leaked agent be recorded as "no agents to
  // reap". Found by `silent-failure-hunter` on this diff. Every other rung in
  // the file already pushes a reasoned `skipped` entry; this one now does too.
  const root = mkdtempSync(join(tmpdir(), 'story-reap-marker-throw-'));
  const dir = join(root, '_logs', '_agent-x');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent-run.marker'), '_agent-x:RUN-TOKEN-4\n');
  const report = await reapAgentRuns(collectAgentRuns(root, 0), {
    ownRoot: root,
    procTable: () => new Map(),
    carryingMarker: () => {
      throw new Error('/proc vanished');
    },
    cwdOf: () => null,
    isAlive: () => false,
    kill: () => {},
    graceMs: 0,
    pollMs: 1,
  });
  rmSync(root, { recursive: true, force: true });
  assert.deepEqual(report.reaped, []);
  assert.equal(report.skipped.length, 1, 'a failed rung must leave a trace');
  assert.match(report.skipped[0].reason, /marker sweep for .* failed, so that rung did not run: \/proc vanished/);
  assert.match(describeReap(report)[0], /NOT reaped: marker sweep/);
});

test('PLANTED CROSS-RUN TOKEN: another run\'s live token, dropped in a directory of the attacker\'s making, reaps NOTHING', async () => {
  // The attack the adversarial containment review found (HIGH), reproduced as
  // it would actually happen. An agent that has escaped its worktree reads
  // another run's live token off disk — same uid, readable by design — and
  // drops it into a fresh directory under `_logs/`. The VICTIM's own directory
  // is not in this sweep at all: it belongs to a run that started earlier, so
  // `collectAgentRuns`' `sinceMs` filter excludes it. Only the planted copy is
  // collected. Without a bind between a token and the directory holding it,
  // our teardown would sweep the victim's token and SIGKILL its healthy
  // processes, with no cwd corroboration to catch it because this rung waives
  // that check on purpose — and would then file the result as "reaped by
  // marker", a false record of what happened.
  const root = mkdtempSync(join(tmpdir(), 'story-reap-marker-planted-'));
  const plantedDir = join(root, '_logs', '_agent-planted');
  mkdirSync(plantedDir, { recursive: true });
  const victimToken = '2026-09-03T10-00-00-victim01:2f1c-live-token';
  writeFileSync(join(plantedDir, 'agent-run.marker'), `${victimToken}\n`);

  const swept = [];
  const signalled = [];
  const report = await reapAgentRuns(collectAgentRuns(root, 0), {
    ownRoot: root,
    procTable: () => new Map(),
    carryingMarker: (token) => {
      swept.push(token);
      return token === victimToken ? [9500] : [];
    },
    cwdOf: () => null,
    isAlive: () => false,
    kill: (pid, sig) => signalled.push([pid, sig]),
    graceMs: 0,
    pollMs: 1,
  });
  rmSync(root, { recursive: true, force: true });

  assert.deepEqual(swept, [], "a token found in a directory it was not minted for must never be swept");
  assert.deepEqual(signalled, [], "the victim run's live process must not be signalled");
  assert.deepEqual(report.reaped, [], 'and nothing may be reported reaped by marker');
});

test('a token that names no directory at all is refused — the bind is required, not merely checked', async () => {
  // A bare token with no `<runId>:` prefix cannot be attributed to any run, so
  // it is not swept. `recordRunMarker` only ever writes prefixed tokens, so
  // reaching this branch means the file was written by something else.
  const root = mkdtempSync(join(tmpdir(), 'story-reap-marker-unbound-'));
  const dir = join(root, '_logs', '_agent-x');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent-run.marker'), 'RUN-TOKEN-WITH-NO-RUN\n');
  const swept = [];
  const report = await reapAgentRuns(collectAgentRuns(root, 0), {
    ownRoot: root,
    procTable: () => new Map(),
    carryingMarker: (token) => {
      swept.push(token);
      return [];
    },
    cwdOf: () => null,
    isAlive: () => false,
    kill: () => {},
    graceMs: 0,
    pollMs: 1,
  });
  rmSync(root, { recursive: true, force: true });
  assert.deepEqual(swept, [], 'an unattributable token must never be swept');
  assert.deepEqual(report, { reaped: [], skipped: [] });
});

test('POSITIVE CONTROL (real processes): a grandchild that setsids AND orphans itself is reaped by its MARKER', async (t) => {
  // The residual this module documented and could not close: no ppid tie (the
  // parent is gone), no shared pgid (it called setsid via `detached: true`),
  // and its cwd is outside the run worktree, so even a cwd sweep — which this
  // module rightly refuses to perform from the repo root — would not have
  // admitted it. The ONLY evidence left is the token it inherited.
  const root = mkdtempSync(join(tmpdir(), 'story-reap-marker-real-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'story-reap-marker-real-tree-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });

  const token = `_agent-marked-real:REAP-MARKER-CONTROL-${process.pid}-${Date.now()}`;
  const turn = spawn(
    process.execPath,
    [
      '-e',
      `const { spawn } = require('node:child_process');
       const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
         cwd: ${JSON.stringify(elsewhere)}, stdio: 'ignore', detached: true });
       c.unref();
       console.log(String(c.pid));
       setTimeout(() => process.exit(0), 200);`,
    ],
    {
      cwd: elsewhere,
      detached: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, FORGE_AGENT_RUN_MARKER: token },
    },
  );
  const grandchild = await new Promise((resolve) => {
    let buf = '';
    turn.stdout.on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) resolve(Number.parseInt(buf.trim(), 10));
    });
  });
  t.after(() => {
    for (const pid of [turn.pid, grandchild]) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already reaped, which is the point */
      }
    }
  });

  const dir = join(root, '_logs', '_agent-marked-real');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent-run.marker'), `${token}\n`);

  // Let the parent exit so the grandchild is a true orphan before the sweep.
  for (let i = 0; i < 100; i += 1) {
    try {
      process.kill(turn.pid, 0);
    } catch {
      break;
    }
    await new Promise((r) => setTimeout(r, 25));
  }

  const report = await reapAgentRuns(collectAgentRuns(root, 0), { ownRoot: root, graceMs: 3000, pollMs: 25 });

  await new Promise((r) => setTimeout(r, 150));
  let alive = true;
  try {
    process.kill(grandchild, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false, `the setsid'd orphan survived the reap: ${JSON.stringify(report)}`);
  assert.ok(
    report.reaped.some((r) => r.pid === grandchild && r.via === 'marker'),
    `the orphan must be reported reaped BY MARKER, not silently: ${JSON.stringify(report)}`,
  );
});

test('NEGATIVE CONTROL (real processes): with our marker file on disk, an UNMARKED same-argv process survives', async (t) => {
  // The operator's shell and the Studio bridge under another name: same user,
  // same executable, never spawned by a run. This is the half the module
  // header says a cwd sweep from the repo root could not satisfy.
  const root = mkdtempSync(join(tmpdir(), 'story-reap-marker-neg-'));
  const elsewhere = mkdtempSync(join(tmpdir(), 'story-reap-marker-neg-tree-'));
  const dir = join(root, '_logs', '_agent-marked-neg');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agent-run.marker'), `_agent-marked-neg:REAP-NEG-CONTROL-${process.pid}-${Date.now()}\n`);

  const foreign = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    cwd: elsewhere,
    stdio: 'ignore',
    detached: true,
  });
  t.after(() => {
    try {
      process.kill(foreign.pid, 'SIGKILL');
    } catch {
      /* fine */
    }
    rmSync(root, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  });

  const report = await reapAgentRuns(collectAgentRuns(root, 0), { ownRoot: root, graceMs: 200, pollMs: 25 });

  let foreignAlive = true;
  try {
    process.kill(foreign.pid, 0);
  } catch {
    foreignAlive = false;
  }
  assert.equal(foreignAlive, true, 'an unmarked same-argv process was killed — the marker sweep has become a pattern kill');
  assert.ok(!report.reaped.some((r) => r.pid === foreign.pid));
  assert.ok(
    !report.reaped.some((r) => r.pid === process.pid),
    'the sweep claimed the test runner itself — the caller is never its own target',
  );
});
