/**
 * `lanes.sh die_launch` — the census that retires a half-launched claude
 * (bead `forge-8vfn.7.6.105`, T1 rulings 1010/1011).
 *
 * Found by lane C's gate red on `lanes.test.ts:311` at loadavg 16.7, zero prior
 * instances, 0-of-4 reproduced: the door's 20.4 s was the 6 s confirm timeout
 * plus `waitGone`'s full 12 s — a kill that LANDED shows in under a second, so
 * the census had found nothing. Two defects behind that, both in `lanes.sh`:
 *
 * 1. `die_launch` sent the tmux HUP and then took ONE census, immediately. Under
 *    load the lane program can still be executing its spawn line after HUP, so
 *    the grandchild appears after the only look. Now: census before the kill,
 *    kill, then a bounded re-census that stops on a quiet window.
 * 2. The start-time bound read `/proc/<pid>` mtime "as the process start time".
 *    MEASURED (T1, 2026-09-13): a `sleep` spawned at …042 had directory mtime
 *    …044 while `stat` field 22 decoded to …042.8 — the inode is stamped at
 *    first LOOKUP, so the bound was "when something first looked", which under
 *    load is exactly the lag that drops the one pid the door exists to catch.
 *    Now: `/proc/<pid>/stat` field 22 against `btime`, exposed as `proc-start`.
 *
 * Its own file with its own fixture: `lanes.test.ts` sits at 797 of the 800 cap
 * (C's headroom survey, 1013), and a census race is not a launch test.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LANES = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'lanes.sh');
const PREFIX = `lanescensus${process.pid}-`;

let dir: string;
let camp: string;
let rosterCmd: string;
const sessions = new Set<string>();
const planted = new Set<number>();

const alive = (pid: number) => existsSync(`/proc/${pid}`);
function waitGone(pid: number, ms = 12000) {
  // performance.now(), not Date.now() (forge-8vfn.7.6.50): Date.now() is not
  // monotonic on this host, so a deadline built from its difference can move
  // mid-wait.
  const deadline = performance.now() + ms;
  while (performance.now() < deadline && alive(pid)) spawnSync('sleep', ['0.2']);
  return !alive(pid);
}
function writeExec(name: string, body: string) {
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}
/** A copy of `sleep` at `<dir>/bin-claude/claude`, so its comm is `claude` — what `pgrep -x` matches. */
function fakeClaude() {
  const d = join(dir, 'bin-claude');
  mkdirSync(d, { recursive: true });
  const p = join(d, 'claude');
  if (!existsSync(p)) {
    copyFileSync(execFileSync('bash', ['-c', 'command -v sleep'], { encoding: 'utf8' }).trim(), p);
    chmodSync(p, 0o755);
  }
  return p;
}
/**
 * A lane program that never registers (the trust-dialog shape) and spawns its
 * `claude` grandchild through `setsid` — optionally AFTER ignoring HUP and
 * sleeping, which is the late-spawn race the one-shot census lost: the tmux
 * kill has landed, the program is still running its spawn line.
 */
function laneBin(name: string, opts: { lateSpawnS?: number } = {}) {
  const late = opts.lateSpawnS ? `trap '' HUP\nsleep ${opts.lateSpawnS}\n` : '';
  return writeExec(name, `#!/usr/bin/env bash
echo $$ > '${join(dir, `${name}.selfpid`)}'
${late}setsid nohup '${fakeClaude()}' 300 </dev/null >/dev/null 2>&1 &
echo $! > '${join(dir, `${name}.detachedpid`)}'
sleep 120
`);
}
function pidFrom(file: string, waitMs: number) {
  const f = join(dir, file);
  // performance.now(), not Date.now() (forge-8vfn.7.6.50): Date.now() is not
  // monotonic on this host, so a deadline built from its difference can move
  // mid-wait.
  const deadline = performance.now() + waitMs;
  while (performance.now() < deadline && !existsSync(f)) spawnSync('sleep', ['0.1']);
  assert.ok(existsSync(f), `precondition: ${file} never appeared`);
  const pid = Number(readFileSync(f, 'utf8').trim());
  planted.add(pid);
  return pid;
}
function lanes(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync('bash', [LANES, ...args], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LANES_'))),
      LANES_SESSION_PREFIX: PREFIX,
      LANES_CONFIRM_TIMEOUT_S: '4',
      LANES_MEMINFO: join(dir, 'meminfo'),
      LANES_ROSTER_CMD: rosterCmd,
      LANES_CWD: join(dir, 'repo'),
      LANES_WORKTREE_ROOT: join(dir, 'wt'),
      ...env,
    },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
function launchUnconfirmed(lane: string, bin: string) {
  const laneCwd = join(dir, `cwd-${lane}`);
  mkdirSync(laneCwd, { recursive: true });
  const prompt = join(dir, `prompt-${lane}.md`);
  writeFileSync(prompt, `never consumed\nSuites: flock ${camp}/.suite-lock npm test\n`);
  sessions.add(`${PREFIX}${lane}`);
  return { laneCwd, r: lanes(['launch', camp, lane, prompt, '--cwd', laneCwd, '--t1', 't1'], { LANES_CLAUDE_BIN: bin }) };
}

before(() => {
  assert.equal(spawnSync('tmux', ['-V']).status, 0, 'tmux must be installed — these doors drive real tmux');
  dir = mkdtempSync(join(tmpdir(), 'lanes-census-'));
  camp = join(dir, 'camp');
  mkdirSync(join(camp, 'heartbeat'), { recursive: true });
  mkdirSync(join(dir, 'wt'), { recursive: true });
  writeFileSync(join(dir, 'meminfo'), 'MemTotal: 16000000 kB\nMemFree: 1000000 kB\nMemAvailable: 9437184 kB\n');
  writeFileSync(join(dir, 'roster.json'), '[]');
  rosterCmd = writeExec('roster', `#!/usr/bin/env bash\ncat '${join(dir, 'roster.json')}'\n`);
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, '.claude', 'skills', 'tiered-orchestration'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'skills', 'tiered-orchestration', 'SKILL.md'), '# skill\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  execFileSync('git', ['add', '.claude/skills/tiered-orchestration/SKILL.md'], { cwd: repo });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'root'], { cwd: repo });
});
after(() => {
  for (const s of sessions) spawnSync('tmux', ['kill-session', '-t', s]);
  for (const pid of planted) if (alive(pid)) spawnSync('kill', ['-KILL', String(pid)]);
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('7.6.105 — the census reads a START time, not a first-lookup time', () => {
  test('`lanes.sh proc-start <pid>` agrees with the boot clock read in the same instant, however late the process is first looked at', () => {
    // The wall-clock verb exists for humans; the census never uses it (1043). This door used
    // to assert proc-start within a second of the SPAWN's wall time across a 2.5 s gap — and
    // this box steps its wall clock (dmesg: 122 "Time jumped backwards"), so a step inside the
    // gap red-ed a correct tool (1069). Now: proc-start must equal uptime-cs converted with a
    // wall read taken in the SAME shell instant — internal consistency, no gap for a step to
    // land in — and the 2.5 s of not looking still proves it is not a first-lookup stamp.
    const r0 = spawnSync('bash', ['-c', 'sleep 300 </dev/null >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' });
    const pid = Number(r0.stdout.trim());
    planted.add(pid);
    spawnSync('sleep', ['2.5']);                      // nothing looks at /proc/<pid> meanwhile
    const both = spawnSync('bash', ['-c', `echo $(bash '${LANES}' proc-start ${pid}) $(bash '${LANES}' uptime-cs) $(date +%s%3N) $(awk 'NR==1{printf "%d",$1*1000}' /proc/uptime)`],
      { encoding: 'utf8', env: { ...process.env, LANES_SESSION_PREFIX: PREFIX } });
    const [got, upcs, nowMs, upMs] = both.stdout.trim().split(/\s+/).map(Number);
    const expected = Math.floor((nowMs - upMs) / 1000 + upcs / 100 - upcs / 100 + (Number(spawnSync('bash', ['-c', `bash '${LANES}' proc-since-boot ${pid}`], { encoding: 'utf8' }).stdout.trim()) / 100));
    assert.ok(Math.abs(got - expected) <= 1, `proc-start ${got} vs boot-derived ${expected} read in the same instant (both.stdout=${both.stdout.trim()})`);
    spawnSync('kill', ['-KILL', String(pid)]);
  });

  test('1030: a process spawned INSIDE the census second is never computed to the second before it', () => {
    // CI red (run 34729635825) on the two doors whose claude spawns immediately, green on the
    // two that spawn 1.5 s later: `btime + ticks/hz` uses a boot second FLOORED, so the sum runs
    // up to a second early. Measured locally: boot fraction .749, 11 of 15 same-second spawns
    // excluded. Fifteen spawns each taken right after `date +%s`; every start must be >= it.
    const misses: string[] = [];
    for (let i = 0; i < 15; i++) {
      const t0 = Math.floor(Date.now() / 1000);
      const r0 = spawnSync('bash', ['-c', 'sleep 300 </dev/null >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' });
      const pid = Number(r0.stdout.trim());
      planted.add(pid);
      const got = Number(lanes(['proc-start', String(pid)]).stdout.trim());
      if (!(got >= t0)) misses.push(`spawn ${i}: start ${got} < t0 ${t0}`);
      spawnSync('kill', ['-KILL', String(pid)]);
      spawnSync('sleep', ['0.07']);
    }
    assert.deepEqual(misses, [], `a start computed before its own t0 is a claude the census will not retire:\n${misses.join('\n')}`);
  });

  test('1023: a pid argument that is not digits is refused before it becomes a path segment', () => {
    // `1/../2` would resolve to /proc/2/stat and report pid 2's start as pid 1's —
    // a read-only sink, but §2's path-segment rule is an allowlist, not a judgement
    // about the sink. Refused with the value quoted.
    for (const bad of ['1/../2', 'abc', '12x', '../1']) {
      const r = lanes(['proc-start', bad]);
      assert.notEqual(r.status, 0, `'${bad}' must refuse`);
      assert.equal(r.stdout.trim(), '');
      assert.match(r.stderr, /not a pid \(digits only\)/, r.stderr);
    }
  });

  test('a missing pid is a refusal with its own code, never 0 and never an empty number', () => {
    const r = lanes(['proc-start', '4194304']);   // beyond pid_max on this box, so never live
    assert.notEqual(r.status, 0);
    assert.equal(r.stdout.trim(), '');
    assert.match(r.stderr, /no such pid|not running|cannot read/i);
  });
});

describe('7.6.105 — die_launch retires a claude that appears AFTER the tmux HUP', () => {
  test('a lane program that spawns its grandchild 1.5 s after the kill is still retired, and stderr says what the census saw', () => {
    const bin = laneBin('lane-late', { lateSpawnS: 1.5 });
    const { r } = launchUnconfirmed('late', bin);
    const self = pidFrom('lane-late.selfpid', 8000);
    const stray = pidFrom('lane-late.detachedpid', 12000);
    try {
      assert.notEqual(r.status, 0, 'unconfirmed launch exits non-zero');
      assert.match(r.stderr, /NOT CONFIRMED for late/);
      assert.ok(waitGone(stray, 3000), `the late-spawned claude is retired by PID (pid ${stray}); die_launch stderr:\n${r.stderr}`);
      assert.match(r.stderr, new RegExp(`retired pid ${stray}\\b`), 'the pid it retired is printed');
      assert.match(r.stderr, /census: .* started at\/after uptime \d+cs \(wall ~\d+\)/, 'and the census reports what it saw, in its own clock, so a red carries evidence');
    } finally {
      spawnSync('kill', ['-KILL', String(self)]);
    }
  });

  /*
   * M7-C last-flakes #2 (known-flakes.md `scripts/lanes-census.test.ts:200`):
   * a 1.5 s scripted late-spawn only guarantees a MINIMUM delay — `sleep`
   * never returns early, but under CPU contention the process that runs
   * NEXT after it wakes can be scheduled arbitrarily later, and the
   * recensus loop's own per-iteration `pids_claude_in` shells out to a real
   * subprocess each tick, which is far more CPU-bound (fork+exec) than a
   * sleeping wait — so under load the loop's REAL margin over the spawn can
   * close even though its NOMINAL 5 s budget (`LANES_RECENSUS_S`'s default)
   * never changes. Staged deterministically, with no host load needed: a 6 s
   * late spawn against the default 5 s window is missed EVERY time,
   * regardless of speed — `census: 0 claude pid(s) ... retired in total`,
   * so `waitGone` times out because nothing was ever killed, not because
   * its own verification window was too short. Widening the recensus
   * window to comfortably outlast the spawn (here 12 s, matching
   * `waitGone`'s own generous default) is what actually removes the flake;
   * a bigger `waitGone` number alone could never have helped here, since
   * the census gave up before touching the pid at all.
   */
  test('M7-C last-flakes #2: a spawn 6 s late is still retired once the recensus window comfortably outlasts it', () => {
    const bin = laneBin('lane-margin', { lateSpawnS: 6 });
    const { r } = launchUnconfirmed('margin', bin, { LANES_RECENSUS_S: '12' });
    const self = pidFrom('lane-margin.selfpid', 8000);
    const stray = pidFrom('lane-margin.detachedpid', 12000);
    try {
      assert.ok(
        waitGone(stray),
        `a spawn 6 s late is still retired once the recensus window (12 s) comfortably covers it (pid ${stray}); die_launch stderr:\n${r.stderr}`,
      );
      assert.match(r.stderr, new RegExp(`retired pid ${stray}\\b`), 'the pid it retired is printed');
    } finally {
      spawnSync('kill', ['-KILL', String(self)]);
    }
  });

  test('1023: a non-numeric LANES_RECENSUS_S is reported and defaulted — the re-census still runs', () => {
    // Before this, the loop's `-lt` test errored on 'soon0' and the function fell out after
    // ONE census: exactly the one-shot shape it stopped having, silently. The late-spawn
    // fixture is the proof: with the loop gone, the stray survives.
    const bin = laneBin('lane-late2', { lateSpawnS: 1.5 });
    const laneCwd = join(dir, 'cwd-late2');
    mkdirSync(laneCwd, { recursive: true });
    const prompt = join(dir, 'prompt-late2.md');
    writeFileSync(prompt, `never consumed\nSuites: flock ${camp}/.suite-lock npm test\n`);
    sessions.add(`${PREFIX}late2`);
    const r = lanes(['launch', camp, 'late2', prompt, '--cwd', laneCwd, '--t1', 't1'], { LANES_CLAUDE_BIN: bin, LANES_RECENSUS_S: 'soon' });
    const self = pidFrom('lane-late2.selfpid', 8000);
    const stray = pidFrom('lane-late2.detachedpid', 12000);
    try {
      assert.match(r.stderr, /LANES_RECENSUS_S='soon' is not a whole number of seconds — using 5/, r.stderr);
      assert.ok(waitGone(stray, 3000), `the re-census still ran (pid ${stray}):\n${r.stderr}`);
    } finally {
      spawnSync('kill', ['-KILL', String(self)]);
    }
  });

  test('regression lock (accidentally safe before too, when something looked it up early): an OLDER claude in the same cwd is NOT retired', () => {
    const bin = laneBin('lane-deaf2');
    const laneCwd = join(dir, 'cwd-deaf2');
    mkdirSync(laneCwd, { recursive: true });
    // Planted BEFORE the launch, in the lane's cwd: T1's own session in a shared directory.
    const old = spawnSync('bash', ['-c', `setsid nohup '${fakeClaude()}' 300 </dev/null >/dev/null 2>&1 & echo $!`], { cwd: laneCwd, encoding: 'utf8' });
    const older = Number(old.stdout.trim());
    planted.add(older);
    spawnSync('sleep', ['1.5']);
    const { r } = launchUnconfirmed('deaf2', bin);
    const self = pidFrom('lane-deaf2.selfpid', 8000);
    const stray = pidFrom('lane-deaf2.detachedpid', 12000);
    try {
      assert.ok(waitGone(stray, 3000), `the lane's own claude is retired (pid ${stray}):\n${r.stderr}`);
      assert.ok(alive(older), `the OLDER claude (pid ${older}, started before t0) survives:\n${r.stderr}`);
    } finally {
      spawnSync('kill', ['-KILL', String(self)]);
      spawnSync('kill', ['-KILL', String(older)]);
    }
  });
});
