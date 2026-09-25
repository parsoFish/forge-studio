/**
 * lane-heartbeat-daemon.sh — campaign row 84.
 *
 * One lane hand-built a background loop so `heartbeat.sh` (lane-protocol.md §2, every STEP)
 * would still cover the stretch BETWEEN steps — a long detached job, or a long in-process worker
 * turn — that would otherwise read as a stall to `watch-heartbeats.sh`. This is that loop,
 * promoted into the skill: every path an argument, nothing hardcoded to one lane, scratchpad or
 * user.
 *
 * The daemon calls `heartbeat.sh` and nothing else writes a heartbeat file (heartbeat.sh's own
 * header). These tests stub `heartbeat.sh` — via `LANE_HB_DAEMON_HEARTBEAT_SH`, the same
 * HERE-relative-plus-env-override seam `merge-slot.sh` already uses for `pin-precheck.sh` — and
 * record every call's argv, so what is asserted is the DAEMON's own behaviour (what it detects,
 * what it says), never anything a real heartbeat.sh does. `--once` runs exactly one iteration and
 * exits, which is what makes this a unit test rather than a background process left running.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DAEMON = join(
  import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'lane-heartbeat-daemon.sh',
);

/** A scratch campaign dir with its `heartbeat/` subdir already present. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'hb-daemon-'));
  const camp = join(dir, 'camp');
  mkdirSync(join(camp, 'heartbeat'), { recursive: true });
  return { dir, camp };
}

/** A stub `heartbeat.sh` that records every call's argv (JSON per line) instead of writing
 *  anything — what these tests assert on is the DAEMON's call, not a real heartbeat file. */
function fakeHeartbeat(dir: string) {
  const calls = join(dir, 'heartbeat-calls.jsonl');
  const bin = join(dir, 'fake-heartbeat.sh');
  writeFileSync(bin, `#!/usr/bin/env bash\nnode -e "require('fs').appendFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)) + '\\n')" '${calls}' "$@"\n`);
  chmodSync(bin, 0o755);
  return { bin, calls };
}
function readCalls(callsFile: string): string[][] {
  if (!existsSync(callsFile)) return [];
  return readFileSync(callsFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]);
}

/** A tiny long-lived process whose full argv (cmdline) is exactly `<dir>/<name>` — a stand-in
 *  for a detached job script, matchable by a `--job-pattern` naming `name` without depending on
 *  anything already running on the host. Returns its pid; caller kills it in `finally`. */
function spawnJob(dir: string, name: string, seconds = 8) {
  const p = join(dir, name);
  writeFileSync(p, `#!/usr/bin/env bash\nsleep ${seconds}\n`);
  chmodSync(p, 0o755);
  const child = spawn(p, [], { stdio: 'ignore', detached: true });
  child.unref();
  return child.pid as number;
}
function killJob(pid: number | undefined) {
  if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
}

function runOnce(camp: string, lane: string, heartbeatBin: string, extra: string[]) {
  return spawnSync('bash', [DAEMON, camp, lane, '--once', ...extra], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, LANE_HB_DAEMON_HEARTBEAT_SH: heartbeatBin },
  });
}

/** A job-pattern guaranteed to match nothing already running on the host. */
const IMPOSSIBLE = 'zzz-lane-heartbeat-daemon-test-impossible-pattern-9f3a1c';
/** A worktree-glob guaranteed to match nothing. */
const noWorktree = (dir: string) => join(dir, 'no-such-worktree');

describe('lane-heartbeat-daemon.sh --once (campaign row 84)', () => {
  test('(a) no matching job and no recent worktree activity — silent, no heartbeat call', () => {
    const { dir, camp } = fixture();
    try {
      const { bin, calls } = fakeHeartbeat(dir);
      const wt = join(dir, 'wt-idle');
      mkdirSync(wt, { recursive: true });
      const old = join(wt, 'old.txt');
      writeFileSync(old, 'stale\n');
      const t = Date.now() / 1000 - 3600; // an hour old — well outside any --recent-min
      utimesSync(old, t, t);

      const r = runOnce(camp, 'x', bin, ['--job-pattern', IMPOSSIBLE, '--worktree-glob', wt, '--recent-min', '10']);

      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(readCalls(calls), [], 'nothing detached, nothing recent — the beat is silent');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('(b) a live matching job process — one call naming the log\'s last line', () => {
    const { dir, camp } = fixture();
    let pid: number | undefined;
    try {
      const { bin, calls } = fakeHeartbeat(dir);
      const marker = `jobmarker-b-${process.pid}`;
      pid = spawnJob(dir, marker);
      const log = join(dir, 'run.log');
      writeFileSync(log, 'starting up\n\nrow 3 red 1 fail 0\n');

      const r = runOnce(camp, 'x', bin, [
        '--job-pattern', marker,
        '--worktree-glob', noWorktree(dir),
        '--log-glob', log,
      ]);

      assert.equal(r.status, 0, r.stderr);
      const rows = readCalls(calls);
      assert.equal(rows.length, 1, 'exactly one heartbeat call');
      const [c, lane, state, jobLog] = rows[0];
      assert.equal(c, camp);
      assert.equal(lane, 'x');
      assert.match(state, /^auto: 1 job proc\(s\); run\.log: row 3 red 1 fail 0$/, 'names the job count and the log\'s last meaningful line');
      assert.equal(jobLog, log, 'the log is passed through as the declared liveness path');
    } finally {
      killJob(pid);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('(c) a recently-modified file in a matching worktree — call says a worker is active', () => {
    const { dir, camp } = fixture();
    try {
      const { bin, calls } = fakeHeartbeat(dir);
      const wt = join(dir, 'wt-active');
      mkdirSync(wt, { recursive: true });
      writeFileSync(join(wt, 'fresh.txt'), 'just written\n'); // mtime now

      const r = runOnce(camp, 'x', bin, ['--job-pattern', IMPOSSIBLE, '--worktree-glob', wt, '--recent-min', '10']);

      assert.equal(r.status, 0, r.stderr);
      const rows = readCalls(calls);
      assert.equal(rows.length, 1, 'no job, but a recently-touched worktree still beats');
      assert.match(rows[0][2], /worker active in/, 'the state names a worker, not a job process');
      assert.match(rows[0][2], new RegExp(wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'and names WHICH worktree');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('(d) files only in the excluded run tree — no call', () => {
    const { dir, camp } = fixture();
    try {
      const { bin, calls } = fakeHeartbeat(dir);
      const wt = join(dir, 'wt-run');
      mkdirSync(wt, { recursive: true });
      writeFileSync(join(wt, 'fresh.txt'), 'just written\n');

      const r = runOnce(camp, 'x', bin, [
        '--job-pattern', IMPOSSIBLE,
        '--worktree-glob', wt,
        '--exclude-tree', wt, // the ONLY matching worktree IS the excluded run tree
        '--recent-min', '10',
      ]);

      assert.equal(r.status, 0, r.stderr);
      assert.deepEqual(readCalls(calls), [], 'the excluded tree\'s own churn is not evidence of a worker');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('(e) a second start is refused while the pid file names a live pid', () => {
    const { dir, camp } = fixture();
    try {
      const { bin, calls } = fakeHeartbeat(dir);
      const pidFile = join(camp, 'heartbeat', 'x.hb-daemon.pid');
      writeFileSync(pidFile, `${process.pid}\n`); // this test process itself — certainly alive

      const r = runOnce(camp, 'x', bin, ['--job-pattern', IMPOSSIBLE, '--worktree-glob', noWorktree(dir)]);

      assert.notEqual(r.status, 0, 'refused, not silently skipped');
      assert.match(r.stderr, new RegExp(`${process.pid}.*alive|alive.*${process.pid}`), 'names the pid it found alive');
      assert.deepEqual(readCalls(calls), [], 'never even reaches a beat');
      assert.equal(readFileSync(pidFile, 'utf8').trim(), String(process.pid), 'the existing pidfile is untouched — not a pid this run is entitled to overwrite');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
