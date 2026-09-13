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
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && alive(pid)) spawnSync('sleep', ['0.2']);
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
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline && !existsSync(f)) spawnSync('sleep', ['0.1']);
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
  test('`lanes.sh proc-start <pid>` is within a second of when the process was spawned, however late it is first looked at', () => {
    const r0 = spawnSync('bash', ['-c', 'sleep 300 </dev/null >/dev/null 2>&1 & echo $!'], { encoding: 'utf8' });
    const pid = Number(r0.stdout.trim());
    planted.add(pid);
    const spawned = Math.floor(Date.now() / 1000);
    spawnSync('sleep', ['2.5']);                      // nothing looks at /proc/<pid> meanwhile
    const r = lanes(['proc-start', String(pid)]);
    assert.equal(r.status, 0, r.stderr);
    const got = Number(r.stdout.trim());
    assert.ok(Math.abs(got - spawned) <= 1, `proc-start ${got} vs spawned ${spawned} — a first-lookup stamp would read ~2.5 s late`);
    spawnSync('kill', ['-KILL', String(pid)]);
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
      assert.match(r.stderr, /census:/, 'and the census reports what it saw, so a red carries evidence');
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
