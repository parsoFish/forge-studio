/**
 * lanes.sh — the T1 lane mechanism, after the pane-relay was retired (2026-08-30).
 *
 * History this file guards: `lanes.sh send`/`launch` once printed success over a
 * payload the Claude TUI had staged and never submitted (forge-8vfn.2.15, three
 * times in one afternoon, a ruling parked 99 minutes); the fix was pane-scraping
 * heuristics that were wrong again on a U+00A0 detail. Retired: T1 and lanes now
 * talk through cross-session SendMessage, and `launch` is confirmed by the lane
 * appearing in Claude Code's own roster (`claude agents --json`), never by pane text.
 *
 * What is real here: tmux, the sessions, the process lifecycle, the git worktrees
 * and every line of `lanes.sh`. Two seams the script already has are substituted:
 * `LANES_CLAUDE_BIN` (the program under the lane) and `LANES_ROSTER_CMD` (the
 * roster), so nothing here can address a real lane or a real session.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, chmodSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LANES = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'lanes.sh');
const PREFIX = `lanestest${process.pid}-`;

let dir: string;
let camp: string;
let repo: string;
let rosterFile: string;
let rosterCmd: string;
const sessions = new Set<string>();

function tmux(...args: string[]) {
  return spawnSync('tmux', args, { encoding: 'utf8' });
}
function killAll() {
  for (const s of sessions) tmux('kill-session', '-t', s);
  sessions.clear();
}
/** Run lanes.sh. Never throws — the exit status IS the subject of these tests. */
function lanes(args: string[], env: Record<string, string> = {}, timeoutMs = 30000) {
  const r = spawnSync('bash', [LANES, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...process.env,
      LANES_SESSION_PREFIX: PREFIX,
      LANES_CONFIRM_TIMEOUT_S: '6',
      LANES_ROSTER_CMD: rosterCmd,
      LANES_CWD: repo,
      LANES_WORKTREE_ROOT: join(dir, 'wt'),
      ...env,
    },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
function setRoster(rows: Array<Record<string, unknown>>) {
  writeFileSync(rosterFile, JSON.stringify(rows));
}
function writeExec(name: string, body: string) {
  const p = join(dir, name);
  writeFileSync(p, body);
  chmodSync(p, 0o755);
  return p;
}
/**
 * A lane program: records its argv, optionally registers itself in the roster
 * (what a real claude session does by existing), then idles.
 */
function laneBin(name: string, opts: { register: 'busy' | 'blocked' | 'never' }) {
  const argvFile = join(dir, `${name}.argv`);
  const row =
    opts.register === 'never'
      ? ''
      : `python3 - "$$" <<'PY'
import json, os, sys
p = os.environ["ROSTER"]
rows = json.load(open(p)) if os.path.exists(p) else []
rows.append({"name": os.environ["SESS"], "pid": int(sys.argv[1]), "kind": "interactive", "status": ${opts.register === 'blocked' ? '"waiting", "state": "blocked", "waitingFor": "input needed"' : '"busy"'}})
json.dump(rows, open(p, "w"))
PY`;
  return writeExec(
    name,
    `#!/usr/bin/env bash
printf '%s\\0' "$@" > '${argvFile}'
SESS=""; while [ $# -gt 0 ]; do [ "$1" = -n ] && SESS="$2"; shift; done
export SESS ROSTER='${rosterFile}'
${row}
sleep 120
`,
  );
}
function argvOf(name: string) {
  return readFileSync(join(dir, `${name}.argv`), 'utf8').replace(/\0$/, '').split('\0');
}
function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

before(() => {
  const probe = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
  assert.equal(probe.status, 0, 'tmux must be installed — these tests drive real tmux sessions and must never silently skip');
  dir = mkdtempSync(join(tmpdir(), 'lanes-'));
  camp = join(dir, 'camp');
  mkdirSync(join(camp, 'heartbeat'), { recursive: true });
  mkdirSync(join(dir, 'wt'), { recursive: true });
  rosterFile = join(dir, 'roster.json');
  setRoster([]);
  rosterCmd = writeExec('roster', `#!/usr/bin/env bash\ncat '${rosterFile}'\n`);
  repo = join(dir, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'root');
});
after(() => {
  killAll();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('lanes.sh launch — confirmed by the roster, never by the pane', () => {
  test('a lane that registers is launched with its name, the hook, the protocol and its T1', () => {
    const bin = laneBin('lane-ok', { register: 'busy' });
    const lane = 'ok';
    const s = `${PREFIX}${lane}`;
    sessions.add(s);
    const prompt = join(dir, 'prompt.md');
    writeFileSync(prompt, 'KICKOFF HEAD LINE\nbody\n');
    // T1 is found by walking this process's ancestry against the roster — no flag needed.
    setRoster([{ name: 't1-under-test', pid: process.pid, kind: 'interactive', status: 'busy' }]);

    const r = lanes(['launch', camp, lane, prompt, '--cwd', dir], { LANES_CLAUDE_BIN: bin });

    assert.equal(r.status, 0, `launch should succeed against a registering lane; stderr=${r.stderr}`);
    assert.match(r.stdout, /^launched /m, 'launch reports the start it confirmed');
    assert.match(r.stdout, /t1=t1-under-test/, 'T1 was found from the roster by ancestry');
    const argv = argvOf('lane-ok');
    assert.ok(argv.includes('-n') && argv[argv.indexOf('-n') + 1] === s, 'the session is named after the lane');
    assert.ok(argv.includes('--session-id'), 'a session id is fixed so the lane can be resumed after retirement');
    assert.ok(argv.some((a) => a.endsWith('lane-settings.json')), 'the AskUserQuestion hook is loaded for an unattended lane');
    const proto = argv[argv.indexOf('--append-system-prompt') + 1];
    assert.match(proto, /You are lane ok/, 'the lane protocol names the lane');
    assert.match(proto, /named t1-under-test/, 'the lane protocol names T1 so the lane can message it');
    assert.match(proto, new RegExp(camp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the lane protocol names the campaign dir');
    assert.equal(argv[argv.length - 1], 'KICKOFF HEAD LINE\nbody', 'the rendered prompt is the last argument, whole');
    assert.equal(readFileSync(join(camp, 'heartbeat', 'ACTIVE'), 'utf8').trim(), lane, 'the lane is registered in ACTIVE by launch');
    assert.ok(existsSync(join(camp, 'heartbeat', `${lane}.session`)), 'the session id is recorded for claude --resume');
    assert.ok(existsSync(join(camp, 'prompts', `${lane}.protocol.md`)), 'the rendered protocol is a file a successor can read');
  });

  test('--attended launches without the AskUserQuestion hook', () => {
    const bin = laneBin('lane-att', { register: 'busy' });
    const lane = 'att';
    sessions.add(`${PREFIX}${lane}`);
    const prompt = join(dir, 'prompt-att.md');
    writeFileSync(prompt, 'narrate\n');

    const r = lanes(['launch', camp, lane, prompt, '--cwd', dir, '--attended', '--t1', 'named-t1'], { LANES_CLAUDE_BIN: bin });

    assert.equal(r.status, 0, r.stderr);
    const argv = argvOf('lane-att');
    assert.ok(!argv.some((a) => a.endsWith('lane-settings.json')), 'an attended lane keeps AskUserQuestion for the operator sitting in it');
    assert.match(argv[argv.indexOf('--append-system-prompt') + 1], /named named-t1/, '--t1 overrides discovery');
  });

  test('a lane that never appears in the roster makes launch FAIL LOUDLY and stay out of ACTIVE', () => {
    const bin = laneBin('lane-deaf', { register: 'never' });
    const lane = 'deaf';
    sessions.add(`${PREFIX}${lane}`);
    const prompt = join(dir, 'prompt-deaf.md');
    writeFileSync(prompt, 'never consumed\n');
    const before = readFileSync(join(camp, 'heartbeat', 'ACTIVE'), 'utf8');

    const r = lanes(['launch', camp, lane, prompt, '--cwd', dir, '--t1', 't1'], { LANES_CLAUDE_BIN: bin });

    assert.notEqual(r.status, 0, 'launch must exit non-zero when the lane cannot be confirmed');
    assert.doesNotMatch(r.stdout, /^launched/m, 'launch must not print a success line it did not verify');
    assert.match(r.stderr, new RegExp(`NOT CONFIRMED for ${lane}`), 'the failure names the lane');
    assert.equal(readFileSync(join(camp, 'heartbeat', 'ACTIVE'), 'utf8'), before, 'an unconfirmed lane is not registered');
  });

  test('a lane that comes up blocked on a dialog is reported, not called launched', () => {
    const bin = laneBin('lane-blocked', { register: 'blocked' });
    const lane = 'blocked';
    sessions.add(`${PREFIX}${lane}`);
    const prompt = join(dir, 'prompt-blocked.md');
    writeFileSync(prompt, 'trust me?\n');

    const r = lanes(['launch', camp, lane, prompt, '--cwd', dir, '--t1', 't1'], { LANES_CLAUDE_BIN: bin });

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /blocked on a dialog/, 'the failure says what a terminal must answer');
  });
});

describe('lanes.sh kill — retirement cleans up, and never destroys work', () => {
  function worktreeFor(lane: string) {
    const wt = join(dir, 'wt', `forge-${lane}`);
    git(repo, 'worktree', 'add', '-q', wt, '-b', `lane/${lane}`);
    return wt;
  }
  test('ends the session, drops ACTIVE and stall stamps, removes a CLEAN worktree', () => {
    const lane = 'clean';
    const s = `${PREFIX}${lane}`;
    sessions.add(s);
    tmux('new-session', '-d', '-s', s, 'sleep 120');
    writeFileSync(join(camp, 'heartbeat', 'ACTIVE'), `${lane} other\n`);
    writeFileSync(join(camp, 'heartbeat', `.armed-${lane}`), '1\n');
    writeFileSync(join(camp, 'heartbeat', `STALL-${lane}`), 'STALL\n');
    const wt = worktreeFor(lane);

    const r = lanes(['kill', camp, lane]);

    assert.equal(r.status, 0, r.stderr);
    assert.notEqual(tmux('has-session', '-t', s).status, 0, 'the tmux session is gone');
    assert.equal(readFileSync(join(camp, 'heartbeat', 'ACTIVE'), 'utf8').trim(), 'other', 'only this lane left ACTIVE');
    assert.ok(!existsSync(join(camp, 'heartbeat', `.armed-${lane}`)) && !existsSync(join(camp, 'heartbeat', `STALL-${lane}`)), 'its stall stamps are cleared');
    assert.ok(!existsSync(wt), 'a clean worktree is removed');
    assert.match(git(repo, 'branch', '--list', `lane/${lane}`), /lane\/clean/, 'the branch is never touched by kill');
  });

  test('KEEPS a worktree with uncommitted changes', () => {
    const lane = 'dirty';
    writeFileSync(join(camp, 'heartbeat', 'ACTIVE'), `${lane}\n`);
    const wt = worktreeFor(lane);
    writeFileSync(join(wt, 'work.txt'), 'uncommitted\n');

    const r = lanes(['kill', camp, lane]);

    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(wt, 'work.txt')), 'uncommitted work survives retirement');
    assert.match(r.stdout, /KEPT worktree/, 'and the operator is told');
    assert.equal(readFileSync(join(camp, 'heartbeat', 'ACTIVE'), 'utf8').trim(), 'NONE');
  });
});

describe('lanes.sh events — one line per lane state, read from the roster and tmux', () => {
  function firstPass(extraEnv: Record<string, string> = {}) {
    // The loop sleeps 30 s after its first pass; a 4 s timeout captures exactly that pass.
    const r = lanes(['events', camp], extraEnv, 4000);
    return r.stdout;
  }
  test('LANE_GONE, LANE_EXITED, LANE_BLOCKED, LANE_IDLE and STALL each fire from real state', () => {
    // claude-named process for pane_current_command, without a real claude
    const fakeClaude = join(dir, 'claude');
    copyFileSync(execFileSync('bash', ['-c', 'command -v sleep'], { encoding: 'utf8' }).trim(), fakeClaude);
    chmodSync(fakeClaude, 0o755);
    const up = (lane: string, cmd: string) => {
      const s = `${PREFIX}${lane}`;
      sessions.add(s);
      assert.equal(tmux('new-session', '-d', '-s', s, cmd).status, 0, `precondition: ${s} did not exist yet`);
      // the shell that tmux starts has not exec'd yet when new-session returns — wait for the pane to show its real command
      const want = cmd.startsWith('exec ') ? 'claude' : cmd;
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && tmux('display', '-p', '-t', s, '#{pane_current_command}').stdout.trim() !== want) spawnSync('sleep', ['0.1']);
      assert.equal(tmux('display', '-p', '-t', s, '#{pane_current_command}').stdout.trim(), want, `precondition: ${s} runs ${want}`);
      return s;
    };
    // `exec` so the pane's own process IS the claude-named one, as with a real lane after `; exit`
    up('ev-exited', 'bash');
    const blocked = up('ev-blocked', `exec ${fakeClaude} 120`);
    const idle = up('ev-idle', `exec ${fakeClaude} 120`);
    const busy = up('ev-busy', `exec ${fakeClaude} 120`);
    writeFileSync(join(camp, 'heartbeat', 'ACTIVE'), 'ev-gone ev-exited ev-blocked ev-idle ev-busy\n');
    writeFileSync(join(camp, 'heartbeat', 'STALL-ev-gone'), 'STALL ev-gone gap=45min ceiling=30min\n');
    writeFileSync(join(camp, 'heartbeat', 'ev-busy.log'), 'fresh\n');
    setRoster([
      { name: blocked, pid: 1, status: 'waiting', state: 'blocked', waitingFor: 'input needed' },
      { name: idle, pid: 2, status: 'idle' },
      { name: busy, pid: 3, status: 'busy' },
    ]);

    const out = firstPass();

    assert.match(out, /^STALL: STALL ev-gone gap=45min/m);
    assert.match(out, new RegExp(`^LANE_GONE: ${PREFIX}ev-gone tmux session gone`, 'm'));
    assert.match(out, new RegExp(`^LANE_EXITED: ${PREFIX}ev-exited claude has exited \\(pane runs 'bash'\\)`, 'm'));
    assert.match(out, new RegExp(`^LANE_BLOCKED: ${PREFIX}ev-blocked is waiting on a dialog`, 'm'));
    assert.match(out, new RegExp(`^LANE_IDLE: ${PREFIX}ev-idle finished its turn, heartbeat 16666 min old`, 'm'), 'idle with no heartbeat is the relay hole');
    assert.doesNotMatch(out, new RegExp(`${PREFIX}ev-busy`), 'a busy lane with a fresh heartbeat is not an event');
    assert.equal(out.split('\n').filter((l) => l.startsWith('LANE_') || l.startsWith('STALL')).length, 5, 'exactly one line per state, no repeats within a pass');
  });
});
