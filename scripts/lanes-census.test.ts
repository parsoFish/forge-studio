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
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, readFileSync, readdirSync, readlinkSync, existsSync, chmodSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LANES = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'lanes.sh');
const PREFIX = `lanescensus${process.pid}-`;

let dir: string;
let camp: string;
let rosterCmd: string;
const sessions = new Set<string>();
// M7-C last-flakes #2 sequel (2026-09-26): pid -> its /proc start field AT THE
// MOMENT it was planted, not just the bare pid. `Set<number>` used to be
// enough for cleanup ("kill anything still alive"), but a plain pid number is
// not proof of IDENTITY — a reused pid number would belong to a totally
// different, unrelated process by the time cleanup runs. The start field
// (the same `/proc/<pid>/stat` field 22 lanes.sh's own `proc_start_cs` reads,
// forge-8vfn.7.6.105's fix for the identical class of bug) is checked again
// at kill time so cleanup only ever ends the EXACT process it planted.
const planted = new Map<number, string | null>();

const alive = (pid: number) => existsSync(`/proc/${pid}`);
/** `/proc/<pid>/stat` field 22 (ticks since boot the process started) — the
 *  same field lanes.sh's `proc_start_cs()` reads, via the same "strip up to
 *  the LAST `) `, then field 20 of the remainder" parse (comm can itself
 *  contain spaces or parens). `null` for a pid that is not currently running
 *  — never a stand-in for "matches", since `null !== null` is the ONE
 *  comparison that must never look like a match by accident (see
 *  `sweepPlanted`). */
function procStartField(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const afterComm = stat.slice(stat.lastIndexOf(') ') + 2);
    const fields = afterComm.trim().split(/\s+/);
    return fields[19] ?? null;
  } catch {
    return null;
  }
}
const plantedLogPath = () => join(dir, '.planted-pids.jsonl');
/** Records a planted pid two ways: in-memory (`planted`, the fast path for a
 *  normal run) and appended to a file under the fixture's own `dir` (the
 *  backstop for a run that is interrupted before reaching `after()` below —
 *  `process.on('exit')` re-reads this same file, since an in-memory Set does
 *  not survive whatever killed the process before that hook could run). */
function recordPlant(pid: number): number {
  const start = procStartField(pid);
  planted.set(pid, start);
  try {
    appendFileSync(plantedLogPath(), `${JSON.stringify({ pid, start })}\n`);
  } catch {
    /* dir may not exist yet this early in a test that plants before before() finished — the in-memory Set still has it */
  }
  return pid;
}
/** Kills every planted pid still alive — but ONLY if the CURRENTLY running
 *  process at that pid number is still the SAME one (its /proc start field
 *  matches what was recorded at plant time). Never a bare `kill <pid>` on
 *  identity alone: the pid could have been reused. Reads the on-disk log too
 *  (not just the in-memory Set), so this sweep is complete even after an
 *  interruption that skipped straight to `process.on('exit')`. */
function sweepPlanted(): void {
  const entries = new Map<number, string | null>(planted);
  try {
    for (const line of readFileSync(plantedLogPath(), 'utf8').split('\n')) {
      if (!line) continue;
      const { pid, start } = JSON.parse(line) as { pid: number; start: string | null };
      if (!entries.has(pid)) entries.set(pid, start);
    }
  } catch {
    /* no log yet, or dir already gone — the in-memory Set is everything there is */
  }
  for (const [pid, startAtPlant] of entries) {
    if (!alive(pid)) continue;
    if (procStartField(pid) !== startAtPlant) continue; // a DIFFERENT process now owns this pid number — not ours to touch
    spawnSync('kill', ['-KILL', String(pid)]);
  }
}
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
 *
 * M7-C last-flakes #2 sequel: `$!` right after `setsid nohup CMD &` is NOT
 * reliably the real grandchild's pid under this fixture's actual invocation
 * shape (tmux pane → this script as `LANES_CLAUDE_BIN`, with the env-var
 * prefixed command line `cmd_launch` builds) — measured directly: the pid
 * `$!` captured was confirmed dead (die_launch legitimately retired it,
 * `retired pid <that pid>` printed and true), while a DIFFERENT, un-tracked
 * `comm=claude` process in the SAME cwd kept running past the whole test
 * file's own cleanup — reproduced this way every time, but never in
 * isolation outside this exact harness despite extensive attempts, so the
 * fix does not depend on isolating which fork step diverges.
 *
 * A first attempt RE-DISCOVERED the grandchild's identity the way `lanes.sh`
 * die_launch's own `pids_claude_in` does — comm `claude`, exact cwd match,
 * polled after backgrounding — and measured wrong too: still raced, still
 * occasionally found a different pid than the one die_launch actually
 * retired. Polling AFTER backgrounding cannot close this — whatever forks
 * between `$!` and the final `claude`-comm process (never isolated) can
 * still race a poll started after the fact.
 *
 * The fix that removes the ambiguity outright: the grandchild records its
 * OWN pid, from INSIDE itself, the instant before it becomes the tracked
 * process — `bash -c 'echo $$ > "$1"; exec "$2" "$3"'` writes `$$` and THEN
 * `exec`s into the real `claude`-named binary. `exec` replaces the running
 * image but never changes the pid, so the number written is, by
 * construction, exactly the pid that becomes `comm=claude` — no fork, no
 * poll, no window for anything to diverge from what gets written.
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
  return recordPlant(pid);
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
function launchUnconfirmed(lane: string, bin: string, env: Record<string, string> = {}) {
  const laneCwd = join(dir, `cwd-${lane}`);
  mkdirSync(laneCwd, { recursive: true });
  const prompt = join(dir, `prompt-${lane}.md`);
  writeFileSync(prompt, `never consumed\nSuites: flock ${camp}/.suite-lock npm test\n`);
  sessions.add(`${PREFIX}${lane}`);
  return { laneCwd, r: lanes(['launch', camp, lane, prompt, '--cwd', laneCwd, '--t1', 't1'], { LANES_CLAUDE_BIN: bin, ...env }) };
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
/** Every currently-running pid whose executable (`/proc/<pid>/exe`, a kernel
 *  fact, never a guessed string) resolves under `root`. `root` is this run's
 *  OWN `mkdtempSync` fixture directory — nothing else on the host can ever
 *  have an exe path under it — so this identifies OUR processes exactly,
 *  never by name or command-line pattern. */
function survivorsUnder(root: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync('/proc');
  } catch {
    return [];
  }
  return entries.filter((entry) => {
    if (!/^\d+$/.test(entry)) return false;
    try {
      return readlinkSync(`/proc/${entry}/exe`).startsWith(root);
    } catch {
      return false;
    }
  });
}
/**
 * The authoritative cleanup pass. `sweepPlanted()` (pid + /proc start-field
 * identity) is the primary mechanism and stays first — but MEASURED even
 * with `laneBin`'s exec-preserves-pid fix (no more discovery race, every
 * `waitGone(stray)` in every test in this file passing): a normal, otherwise
 * fully green run STILL left 2–3 extra `comm=claude` processes running under
 * this run's OWN `dir`, never referenced by any `.detachedpid` file at all —
 * evidence of a SECOND, un-tracked process this harness's plumbing never
 * names, from a fork this investigation could not isolate despite extensive
 * reproduction attempts (see `laneBin`'s doc comment). `killSurvivorsUnder`
 * does not need to know that pid to end it: `survivorsUnder(dir)` finds
 * ANYTHING still running our own binary under our own fixture root — kernel
 * fact, unique directory, so this is exact identity, not a name/pattern
 * match — and ends it, whether or not this file ever assigned it a name.
 */
function killSurvivorsUnder(root: string): void {
  for (const pid of survivorsUnder(root)) spawnSync('kill', ['-KILL', pid]);
}
// M7-C last-flakes #2 sequel: a normal, uninterrupted run of this file was
// measured leaking (bd forge-8vfn.7.6.105 sequel) — this `process.on('exit')`
// closes the gap `after()` cannot close on its own: a run interrupted
// (killed) before node:test ever reaches its `after()` hook. `exit` still
// fires for a normal or SIGTERM shutdown (never for SIGKILL — no in-process
// hook can close that gap), and it can only run synchronous code, which both
// cleanup passes already are.
process.on('exit', () => {
  try {
    sweepPlanted();
  } catch {
    /* best-effort backstop — never let cleanup itself crash process teardown */
  }
});
after(() => {
  for (const s of sessions) spawnSync('tmux', ['kill-session', '-t', s]);
  sweepPlanted();
  // M7-C last-flakes #2 sequel: the structural door itself — not "cleanup
  // ran" but "cleanup WORKED". Re-scans AFTER both passes above, so a red
  // here means even the exe-path sweep missed something.
  const survivors = survivorsUnder(dir);
  assert.deepEqual(survivors, [], `planted process(es) survived cleanup: pid(s) ${survivors.join(', ')} still running an executable under ${dir}`);
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
    recordPlant(pid);
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
      recordPlant(pid);
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
  /*
   * M7-C last-flakes #2 (known-flakes.md `scripts/lanes-census.test.ts:200`,
   * "1.5 s late spawn + 3 s waitGone timing budget under load"). `sleep`
   * only guarantees a MINIMUM: under CPU contention the shell running it can
   * be scheduled arbitrarily later before its NEXT line executes, so a
   * "1.5 s" scripted delay can stretch past die_launch's 4 s default confirm
   * window under real load, moving the spawn from the deterministic
   * BEFORE-kill census into the AFTER-kill re-census loop.
   *
   * FIRST ATTEMPT widened this test's own `LANES_CONFIRM_TIMEOUT_S` to keep
   * the spawn inside the safe before-kill catch — ruled out (2026-09-26):
   * that is exactly the "bigger number" the brief already forbids, and it
   * papers over the REAL weakness, which was in `lanes.sh` itself: the
   * after-kill loop used to stop on a fixed "quiet for 1 s" window (2 ticks
   * with nothing new) — a load-sensitive GUESS about how long a late spawn
   * line can take, unrelated to whether the launched process could still be
   * running one. A launch that misses this window in production leaks a
   * real, token-burning session, not just a test red.
   *
   * FIXED AT THE PRODUCT instead (`die_launch` in `lanes.sh`): a quiet tick
   * only counts once `launch_pid` — the ONE process the pane's shell was
   * directly running, captured via `/proc/<pane_pid>/task/<pane_pid>/
   * children` before the kill — is CONFIRMED dead. Deterministic, not a
   * guess; still bounded overall by `LANES_RECENSUS_S`, unchanged.
   *
   * `LANES_CONFIRM_TIMEOUT_S` stays at its production default (4 s, no
   * override) in both tests below — the 1.5 s spawn is still caught by the
   * deterministic before-kill census (comfortably under 4 s), and the 6 s
   * door deliberately lands PAST it, exercising the fixed after-kill loop
   * for real, with no host load needed to prove it.
   */
  test('a lane program that spawns its grandchild 1.5 s after the kill is still retired, and stderr says what the census saw', () => {
    const bin = laneBin('lane-late', { lateSpawnS: 1.5 });
    const { r } = launchUnconfirmed('late', bin);
    const self = pidFrom('lane-late.selfpid', 8000);
    const stray = pidFrom('lane-late.detachedpid', 12000);
    try {
      assert.notEqual(r.status, 0, 'unconfirmed launch exits non-zero');
      assert.match(r.stderr, /NOT CONFIRMED for late/);
      assert.ok(waitGone(stray), `the late-spawned claude is retired by PID (pid ${stray}); die_launch stderr:\n${r.stderr}`);
      assert.match(r.stderr, new RegExp(`retired pid ${stray}\\b`), 'the pid it retired is printed');
      assert.match(r.stderr, /census: .* started at\/after uptime \d+cs \(wall ~\d+\)/, 'and the census reports what it saw, in its own clock, so a red carries evidence');
    } finally {
      spawnSync('kill', ['-KILL', String(self)]);
    }
  });

  test('M7-C last-flakes #2: a spawn 6 s late — well past the 4 s confirm window — is still retired by the AFTER-kill census', () => {
    // No host load needed: with LANES_CONFIRM_TIMEOUT_S at its production
    // default, a 6 s spawn is guaranteed to land AFTER the before-kill
    // census every run, so this exercises die_launch's launch_pid-gated
    // after-kill loop directly, not the before-kill shortcut the test above
    // relies on. LANES_RECENSUS_S is die_launch's own legitimate ceiling
    // (never the thing under test), widened only far enough to outlast the
    // deliberately late 6 s spawn.
    const bin = laneBin('lane-margin', { lateSpawnS: 6 });
    const { r } = launchUnconfirmed('margin', bin, { LANES_RECENSUS_S: '8' });
    const self = pidFrom('lane-margin.selfpid', 8000);
    const stray = pidFrom('lane-margin.detachedpid', 12000);
    try {
      assert.ok(
        waitGone(stray),
        `a spawn 6 s late is still retired by the after-kill census once it is gated on the pane's own launch_pid rather than a fixed quiet window (pid ${stray}); die_launch stderr:\n${r.stderr}`,
      );
      assert.match(r.stderr, new RegExp(`retired pid ${stray}\\b`), 'the pid it retired is printed');
      assert.match(r.stderr, /census: 0 claude pid\(s\) .* before the kill/, 'the spawn is NOT yet running at the before-kill census — this exercises the after-kill loop, not the deterministic before-kill shortcut');
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
      // LANES_RECENSUS_S stays malformed here on purpose (that IS this test);
      // die_launch's launch_pid gate still applies on top of the defaulted
      // 5 s ceiling, so waitGone's own generous default is correct as-is.
      assert.ok(waitGone(stray), `the re-census still ran (pid ${stray}):\n${r.stderr}`);
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
    recordPlant(older);
    spawnSync('sleep', ['1.5']);
    const { r } = launchUnconfirmed('deaf2', bin);
    const self = pidFrom('lane-deaf2.selfpid', 8000);
    const stray = pidFrom('lane-deaf2.detachedpid', 12000);
    try {
      assert.ok(waitGone(stray), `the lane's own claude is retired (pid ${stray}):\n${r.stderr}`);
      assert.ok(alive(older), `the OLDER claude (pid ${older}, started before t0) survives:\n${r.stderr}`);
    } finally {
      spawnSync('kill', ['-KILL', String(self)]);
      spawnSync('kill', ['-KILL', String(older)]);
    }
  });
});
