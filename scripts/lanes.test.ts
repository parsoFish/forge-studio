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
const planted = new Set<number>();

function tmux(...args: string[]) {
  return spawnSync('tmux', args, { encoding: 'utf8' });
}
function killAll() {
  for (const s of sessions) tmux('kill-session', '-t', s);
  sessions.clear();
}
/**
 * The inherited environment with every `LANES_*` variable stripped.
 *
 * `lanes.sh` reads nine of them, and this file sets six — so `LANES_T1`,
 * `LANES_MODEL` and `LANES_PERMISSION_MODE` used to arrive from whatever shell
 * ran the suite. That is not hypothetical: `lanes.sh` exports `LANES_T1` into
 * every lane it launches, so inside a lane the suite inherited it, `lanes.sh`
 * short-circuited its ancestry walk on it, and the launch test read the real
 * T1's session name instead of the mocked roster's — a false red in every lane
 * and green everywhere else, including CI.
 *
 * Stripping the whole prefix rather than the one variable is deliberate: the
 * next `LANES_*` knob would reopen the same hole, and a test that reads the
 * environment it happens to run in is not testing `lanes.sh`.
 */
function envWithoutLanesVars(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LANES_')));
}

/** Run lanes.sh. Never throws — the exit status IS the subject of these tests. */
function lanes(args: string[], env: Record<string, string> = {}, timeoutMs = 30000, cwd?: string) {
  const r = spawnSync('bash', [LANES, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    cwd,
    env: {
      ...envWithoutLanesVars(),
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
 * A binary at `<dir>/<name>/<name>`, so its `comm` (what `pgrep -x` matches) is <name>.
 * A copy of `sleep`: it idles, and it is not the real program of that name.
 */
function fakeBin(name: string) {
  const d = join(dir, `bin-${name}`);
  mkdirSync(d, { recursive: true });
  const p = join(d, name);
  // Copied once per name: re-copying over a running copy is ETXTBSY, and every planted
  // process of that name wants the same binary anyway.
  if (!existsSync(p)) {
    copyFileSync(execFileSync('bash', ['-c', 'command -v sleep'], { encoding: 'utf8' }).trim(), p);
    chmodSync(p, 0o755);
  }
  return p;
}
/**
 * A lane program: records its argv, optionally registers itself in the roster
 * (what a real claude session does by existing), then idles.
 *
 * `register` values are the ones `claude agents --json` really emits, measured on
 * Claude Code v2.1.260 (2026-09-04, bead forge-8vfn.2.31):
 *   busy     — working
 *   waiting  — parked on a dialog: `{"status":"waiting","waitingFor":"permission prompt"}`.
 *              `waitingFor` is only present while waiting; there is NO `state` key, and no
 *              observed value anywhere contains the string "blocked".
 *   never    — the trust dialog: the session never reaches the roster at all, while its
 *              process is alive in the lane's cwd.
 *
 * `detach` spawns a grandchild through `setsid` before idling, so it survives the death of
 * the tmux session that started it — §15.100's RC-attached claude, plantable on demand.
 */
function laneBin(name: string, opts: { register: 'busy' | 'waiting' | 'never'; detach?: string }) {
  const argvFile = join(dir, `${name}.argv`);
  const status =
    opts.register === 'waiting' ? '"waiting", "waitingFor": "permission prompt"' : '"busy"';
  const row =
    opts.register === 'never'
      ? ''
      : `python3 - "$$" <<'PY'
import json, os, sys
p = os.environ["ROSTER"]
rows = json.load(open(p)) if os.path.exists(p) else []
rows.append({"name": os.environ["SESS"], "pid": int(sys.argv[1]), "kind": "interactive", "status": ${status}})
json.dump(rows, open(p, "w"))
PY`;
  const detach = opts.detach
    ? `setsid nohup '${opts.detach}' 300 </dev/null >'${join(dir, `${name}.detached`)}' 2>&1 &
echo $! > '${join(dir, `${name}.detachedpid`)}'
`
    : '';
  return writeExec(
    name,
    `#!/usr/bin/env bash
printf '%s\\0' "$@" > '${argvFile}'
SESS=""; while [ $# -gt 0 ]; do [ "$1" = -n ] && SESS="$2"; shift; done
export SESS ROSTER='${rosterFile}'
${detach}${row}
sleep 120
`,
  );
}
/** The pid of the grandchild `laneBin(..., {detach})` spawned, once it exists. */
function detachedPid(name: string) {
  const f = join(dir, `${name}.detachedpid`);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && !existsSync(f)) spawnSync('sleep', ['0.1']);
  assert.ok(existsSync(f), `precondition: ${name} never spawned its detached process`);
  const pid = Number(readFileSync(f, 'utf8').trim());
  planted.add(pid);
  return pid;
}
/** Plant a detached process with a chosen cwd and comm — the orphan a retirement must find. */
function plant(name: string, cwd: string) {
  const r = spawnSync('bash', ['-c', `setsid nohup '${fakeBin(name)}' 300 </dev/null >/dev/null 2>&1 & echo $!`], {
    cwd,
    encoding: 'utf8',
  });
  const pid = Number(r.stdout.trim());
  assert.ok(pid > 0 && alive(pid), `precondition: could not plant ${name} in ${cwd}`);
  planted.add(pid);
  return pid;
}
/** True while /proc/<pid> exists — the only honest 'is it gone?' (§15.100). */
function alive(pid: number) {
  return existsSync(`/proc/${pid}`);
}
function waitGone(pid: number, ms = 12000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && alive(pid)) spawnSync('sleep', ['0.2']);
  return !alive(pid);
}
/**
 * A rendered kickoff carries the campaign's suite lock line — `launch` refuses one that does
 * not, because a lane that never saw the lock runs its suite outside it (COMMON §1).
 */
function kickoff(body: string) {
  return `${body}\nSuites: flock ${camp}/.suite-lock npm test\n`;
}
/** A /proc/meminfo the memory floor can be pointed at — no 4 GiB host required to plant a red. */
function meminfo(availableKb: number) {
  const p = join(dir, `meminfo-${availableKb}`);
  writeFileSync(p, `MemTotal:       16000000 kB\nMemFree:         1000000 kB\nMemAvailable:   ${availableKb} kB\n`);
  return p;
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
  // The skill is COMMITTED in the fixture repo, because that is the property ruling 151 is
  // about: a worktree cut from a ref carries only what the ref carries, and `.claude/skills/*`
  // was gitignored, so no lane worktree since M0 had the skills its brief cited.
  mkdirSync(join(repo, '.claude', 'skills', 'tiered-orchestration'), { recursive: true });
  writeFileSync(join(repo, '.claude', 'skills', 'tiered-orchestration', 'SKILL.md'), '# skill\n');
  git(repo, 'add', '.claude/skills/tiered-orchestration/SKILL.md');
  git(repo, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'root');
});
after(() => {
  killAll();
  // A red test must never leak a planted process into the host (§15.100 through our own door).
  for (const pid of planted) if (alive(pid)) spawnSync('kill', ['-KILL', String(pid)]);
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('lanes.sh launch — confirmed by the roster, never by the pane', () => {
  test('a lane that registers is launched with its name, the hook, the protocol and its T1', () => {
    const bin = laneBin('lane-ok', { register: 'busy' });
    const lane = 'ok';
    const s = `${PREFIX}${lane}`;
    sessions.add(s);
    const prompt = join(dir, 'prompt.md');
    writeFileSync(prompt, kickoff('KICKOFF HEAD LINE\nbody'));
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
    assert.equal(argv[argv.length - 1], kickoff('KICKOFF HEAD LINE\nbody').trimEnd(), 'the rendered prompt is the last argument, whole');
    assert.equal(readFileSync(join(camp, 'heartbeat', 'ACTIVE'), 'utf8').trim(), lane, 'the lane is registered in ACTIVE by launch');
    assert.ok(existsSync(join(camp, 'heartbeat', `${lane}.session`)), 'the session id is recorded for claude --resume');
    assert.ok(existsSync(join(camp, 'prompts', `${lane}.protocol.md`)), 'the rendered protocol is a file a successor can read');
  });

  /**
   * §15.60 / bead forge-uowf (T1, wave-3 launch): the `-s` existence check runs in the
   * LAUNCHER's cwd and the `cat` runs inside the pane, in `--cwd`. A relative prompt path
   * passed both and launched a promptless session — $0.00, 0 context, an empty box.
   */
  test('a RELATIVE prompt path still reaches the lane when --cwd is somewhere else', () => {
    const bin = laneBin('lane-rel', { register: 'busy' });
    const lane = 'rel';
    sessions.add(`${PREFIX}${lane}`);
    const laneCwd = join(dir, 'cwd-rel');
    mkdirSync(laneCwd, { recursive: true });
    writeFileSync(join(dir, 'rel-prompt.md'), kickoff('RELATIVE KICKOFF'));

    const r = lanes(['launch', camp, lane, 'rel-prompt.md', '--cwd', laneCwd, '--t1', 't1'], { LANES_CLAUDE_BIN: bin }, 30000, dir);

    assert.equal(r.status, 0, r.stderr);
    const argv = argvOf('lane-rel');
    assert.equal(argv[argv.length - 1], kickoff('RELATIVE KICKOFF').trimEnd(), 'the prompt is resolved to an absolute path before send-keys');
  });

  test('--attended launches without the AskUserQuestion hook', () => {
    const bin = laneBin('lane-att', { register: 'busy' });
    const lane = 'att';
    sessions.add(`${PREFIX}${lane}`);
    const prompt = join(dir, 'prompt-att.md');
    writeFileSync(prompt, kickoff('narrate'));

    const r = lanes(['launch', camp, lane, prompt, '--cwd', dir, '--attended', '--t1', 'named-t1'], { LANES_CLAUDE_BIN: bin });

    assert.equal(r.status, 0, r.stderr);
    const argv = argvOf('lane-att');
    assert.ok(!argv.some((a) => a.endsWith('lane-settings.json')), 'an attended lane keeps AskUserQuestion for the operator sitting in it');
    assert.match(argv[argv.indexOf('--append-system-prompt') + 1], /named named-t1/, '--t1 overrides discovery');
  });

  /**
   * Bead forge-8vfn.2.32, reproduced live on 2026-09-04 before this test existed: the first
   * probe lane sat on the trust dialog, `launch` printed NOT CONFIRMED and exited — and left
   * the tmux session AND `claude` pid 421213 running with `ACTIVE` still `NONE`. A live session
   * with a full prompt, no orchestrator, no registry entry and no watcher signal.
   *
   * The lane program here plants a `claude`-named grandchild through `setsid`, so it survives
   * the death of the tmux session on its own: killing the pane is NOT enough, and a test whose
   * fake process dies with tmux would pass against the broken script.
   */
  test('a launch that cannot be confirmed kills the session AND the process it started, by PID', () => {
    const lane = 'deaf';
    const laneCwd = join(dir, `cwd-${lane}`);
    mkdirSync(laneCwd, { recursive: true });
    const bin = laneBin('lane-deaf', { register: 'never', detach: fakeBin('claude') });
    const s = `${PREFIX}${lane}`;
    sessions.add(s);
    const prompt = join(dir, 'prompt-deaf.md');
    writeFileSync(prompt, kickoff('never consumed'));
    const before = readFileSync(join(camp, 'heartbeat', 'ACTIVE'), 'utf8');

    const r = lanes(['launch', camp, lane, prompt, '--cwd', laneCwd, '--t1', 't1'], { LANES_CLAUDE_BIN: bin });
    const stray = detachedPid('lane-deaf');

    assert.notEqual(r.status, 0, 'launch must exit non-zero when the lane cannot be confirmed');
    assert.doesNotMatch(r.stdout, /^launched/m, 'launch must not print a success line it did not verify');
    assert.match(r.stderr, new RegExp(`NOT CONFIRMED for ${lane}`), 'the failure names the lane');
    assert.equal(readFileSync(join(camp, 'heartbeat', 'ACTIVE'), 'utf8'), before, 'an unconfirmed lane is not registered');
    assert.notEqual(tmux('has-session', '-t', s).status, 0, 'the failure path ends the tmux session the success path created');
    assert.ok(waitGone(stray), `the claude it started is retired by PID, not left burning tokens (pid ${stray})`);
    assert.match(r.stderr, new RegExp(`\\b${stray}\\b`), 'and the pid it retired is printed, so a human can check it');
  });

  /**
   * MEASURED, 2026-09-04, Claude Code v2.1.260 (bead forge-8vfn.2.31). A session parked on a
   * permission dialog is in the roster as {"status":"waiting","waitingFor":"permission prompt"};
   * an AskUserQuestion reads {"status":"waiting","waitingFor":"input needed"}. There is no
   * `state` key and no value containing the string "blocked" — which is what the script used
   * to match on, so this case could never fire and a lane on a dialog was CONFIRMED as launched.
   */
  test('a lane parked on a permission dialog is reported, not called launched', () => {
    const bin = laneBin('lane-waiting', { register: 'waiting' });
    const lane = 'waiting';
    sessions.add(`${PREFIX}${lane}`);
    const prompt = join(dir, 'prompt-waiting.md');
    writeFileSync(prompt, kickoff('trust me?'));

    const r = lanes(['launch', camp, lane, prompt, '--cwd', dir, '--t1', 't1'], { LANES_CLAUDE_BIN: bin });

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /waiting on a dialog/, 'the failure says what a terminal must answer');
    assert.match(r.stderr, /permission prompt/, 'and quotes waitingFor, the field that says WHICH dialog');
    assert.equal(readFileSync(join(camp, 'heartbeat', 'ACTIVE'), 'utf8').includes(lane), false, 'a lane on a dialog is not registered');
  });
});

/**
 * Bead forge-8vfn.6.8.1 — the preflight T1 ran by hand for every lane of M4, as code.
 *
 * Each predicate is a rule that lived in a brief and was applied by a human: the 4 GiB floor
 * (COMMON §1, after suites died under load), the worktree cut + `npm install` + kernel-link proof
 * (ruling 144 did it by hand for this very lane; §15.148 — a tree without its own install
 * measures a different question), the suite-lock line in the rendered prompt, an MCP config with
 * no tokensave (ruling 140 holds today only because ~/.claude.json happens to be clean), and the
 * skills a brief tells the lane to use actually existing in the tree it is launched into.
 *
 * Every failure is loud, named, and undoes what it started — the same rule as bead 2.32, applied
 * before anything is started rather than after.
 */
describe('lanes.sh launch — preflight, before a single token is spent', () => {
  function prep(lane: string) {
    const s = `${PREFIX}${lane}`;
    sessions.add(s);
    const laneCwd = join(dir, `cwd-${lane}`);
    mkdirSync(join(laneCwd, '.claude', 'skills', 'tiered-orchestration'), { recursive: true });
    writeFileSync(join(laneCwd, '.claude', 'skills', 'tiered-orchestration', 'SKILL.md'), '# skill\n');
    const prompt = join(dir, `prompt-${lane}.md`);
    writeFileSync(prompt, kickoff(`work ${lane}`));
    return { s, laneCwd, prompt };
  }
  const noTmux = (s: string) => assert.notEqual(tmux('has-session', '-t', s).status, 0, 'nothing was started');

  test('below the 4 GiB floor, launch refuses by name and starts nothing', () => {
    const { s, laneCwd, prompt } = prep('mem');
    const bin = laneBin('lane-mem', { register: 'busy' });

    const r = lanes(['launch', camp, 'mem', prompt, '--cwd', laneCwd, '--t1', 't1'], {
      LANES_CLAUDE_BIN: bin,
      LANES_MEMINFO: meminfo(2 * 1024 * 1024),
    });

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /MemAvailable/, 'the failure names the predicate');
    assert.match(r.stderr, /2\.0 GiB/, 'and the number it read, so it can be checked');
    noTmux(s);
  });

  test('above the floor it proceeds — the floor is a gate, not a wall', () => {
    const { s, laneCwd, prompt } = prep('memok');
    const bin = laneBin('lane-memok', { register: 'busy' });

    const r = lanes(['launch', camp, 'memok', prompt, '--cwd', laneCwd, '--t1', 't1'], {
      LANES_CLAUDE_BIN: bin,
      LANES_MEMINFO: meminfo(9 * 1024 * 1024),
    });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^launched /m);
    assert.ok(s.length > 0);
  });

  test('a rendered prompt with no suite-lock line is refused — a lane that never saw the lock runs outside it', () => {
    const { s, laneCwd } = prep('nolock');
    const bin = laneBin('lane-nolock', { register: 'busy' });
    const prompt = join(dir, 'prompt-nolock-bare.md');
    writeFileSync(prompt, 'work with no lock line\n');

    const r = lanes(['launch', camp, 'nolock', prompt, '--cwd', laneCwd, '--t1', 't1'], { LANES_CLAUDE_BIN: bin });

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /suite-lock/, 'the failure names what the prompt is missing');
    assert.match(r.stderr, new RegExp(camp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'and quotes the exact literal it looked for');
    noTmux(s);
  });

  test('the session is started with --strict-mcp-config and a lane MCP file carrying no tokensave', () => {
    const { laneCwd, prompt } = prep('mcp');
    const bin = laneBin('lane-mcp', { register: 'busy' });

    const r = lanes(['launch', camp, 'mcp', prompt, '--cwd', laneCwd, '--t1', 't1'], { LANES_CLAUDE_BIN: bin });

    assert.equal(r.status, 0, r.stderr);
    const argv = argvOf('lane-mcp');
    assert.ok(argv.includes('--strict-mcp-config'), 'ruling 140 holds by flag, not by the user config happening to be clean');
    const mcp = argv[argv.indexOf('--mcp-config') + 1];
    assert.match(mcp, /lane-mcp\.json$/);
    assert.equal(readFileSync(mcp, 'utf8').includes('tokensave'), false, 'the file it points at declares no tokensave server');
  });

  test('a tokensave server in the MCP file is refused by name (ruling 140)', () => {
    const { s, laneCwd, prompt } = prep('tokensave');
    const bin = laneBin('lane-tokensave', { register: 'busy' });
    const bad = join(dir, 'bad-mcp.json');
    writeFileSync(bad, JSON.stringify({ mcpServers: { tokensave: { command: 'tokensave' } } }));

    const r = lanes(['launch', camp, 'tokensave', prompt, '--cwd', laneCwd, '--t1', 't1', '--mcp', bad], { LANES_CLAUDE_BIN: bin });

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /tokensave/, 'the failure names the server it found');
    noTmux(s);
  });

  test('--skill names a skill the lane must be able to open, and dies when it cannot', () => {
    const { s, laneCwd, prompt } = prep('skill');
    const bin = laneBin('lane-skill', { register: 'busy' });

    const bad = lanes(['launch', camp, 'skill', prompt, '--cwd', laneCwd, '--t1', 't1', '--skill', 'immutable-gates'], { LANES_CLAUDE_BIN: bin, HOME: dir });

    assert.notEqual(bad.status, 0, 'a brief that cites a skill the tree does not carry is a launch that cannot do its job');
    assert.match(bad.stderr, /immutable-gates/, 'the failure names the skill');
    noTmux(s);

    const good = lanes(['launch', camp, 'skill', prompt, '--cwd', laneCwd, '--t1', 't1', '--skill', 'tiered-orchestration'], { LANES_CLAUDE_BIN: bin });
    assert.equal(good.status, 0, good.stderr);
  });

  test('--branch cuts the worktree, installs into it, and proves the kernel link is its own', () => {
    const lane = 'wt';
    const s = `${PREFIX}${lane}`;
    sessions.add(s);
    const bin = laneBin('lane-wt', { register: 'busy' });
    const prompt = join(dir, 'prompt-wt.md');
    writeFileSync(prompt, kickoff('work wt'));
    const wt = join(dir, 'wt', `forge-${lane}`);

    const r = lanes(['launch', camp, lane, prompt, '--branch', `lane/${lane}`, '--t1', 't1', '--skill', 'tiered-orchestration'], {
      LANES_CLAUDE_BIN: bin,
      LANES_BASE_REF: 'main',
      // The install is a seam: what is under test is that the launch RUNS one and then proves
      // the link, not npm itself. This one plants the link a real install would create.
      LANES_INSTALL_CMD: `mkdir -p node_modules/@forge packages/kernel && ln -sfn ${wt}/packages/kernel node_modules/@forge/kernel`,
    });

    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(wt), 'the worktree was cut');
    assert.match(r.stdout, new RegExp(`cwd=${wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'and the lane was launched into it');
    assert.match(r.stdout, /kernel link/, 'the proof is printed, not assumed');
  });

  test('a kernel link that resolves outside the worktree kills the launch AND removes the worktree it cut', () => {
    const lane = 'wtbad';
    const s = `${PREFIX}${lane}`;
    sessions.add(s);
    const bin = laneBin('lane-wtbad', { register: 'busy' });
    const prompt = join(dir, 'prompt-wtbad.md');
    writeFileSync(prompt, kickoff('work wtbad'));
    const wt = join(dir, 'wt', `forge-${lane}`);
    const elsewhere = join(dir, 'borrowed-kernel');
    mkdirSync(elsewhere, { recursive: true });

    const r = lanes(['launch', camp, lane, prompt, '--branch', `lane/${lane}`, '--t1', 't1'], {
      LANES_CLAUDE_BIN: bin,
      LANES_BASE_REF: 'main',
      LANES_INSTALL_CMD: `mkdir -p node_modules/@forge && ln -sfn ${elsewhere} node_modules/@forge/kernel`,
    });

    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /kernel/, 'the failure names the link it could not prove');
    assert.ok(!existsSync(wt), 'a failed preflight leaves nothing behind — including the worktree it created');
    noTmux(s);
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

  /**
   * §15.100 (sessions s4, 2026-09-04): `lanes.sh kill` ended the tmux session and left an
   * RC-attached `claude` alive with cwd `/home/parso/forge-sessions (deleted)` — the worktree
   * had already been removed under it. Both planted processes here survive tmux death on their
   * own, so a script that only kills the pane fails this test.
   */
  test('retires every process whose cwd is the worktree — the claude AND an orphan — by PID', () => {
    const lane = 'procs';
    const s = `${PREFIX}${lane}`;
    sessions.add(s);
    tmux('new-session', '-d', '-s', s, 'sleep 120');
    writeFileSync(join(camp, 'heartbeat', 'ACTIVE'), `${lane}\n`);
    const wt = worktreeFor(lane);
    const claudePid = plant('claude', wt);
    const orphanPid = plant('node', wt);

    const r = lanes(['kill', camp, lane]);

    assert.equal(r.status, 0, r.stderr);
    assert.ok(waitGone(claudePid), `the lane's claude is retired by PID (pid ${claudePid})`);
    assert.ok(waitGone(orphanPid), `and so is an orphan that is not named claude (pid ${orphanPid})`);
    assert.match(r.stdout, new RegExp(`\\b${claudePid}\\b`), 'every retired pid is printed');
    assert.match(r.stdout, new RegExp(`\\b${orphanPid}\\b`), 'the orphan scan names what it found');
    assert.ok(!existsSync(wt), 'the worktree is removed only after its processes are gone');
  });

  /**
   * A lane launched with `--cwd` has no worktree of its own, so the worktree scan finds
   * nothing — and §15.100's survivor is exactly the session's own process. `kill` reads its
   * pid out of the roster BEFORE ending the pane, while the row still exists.
   */
  test('retires the session pid the roster names, even with no worktree to scan', () => {
    const lane = 'rosterpid';
    const s = `${PREFIX}${lane}`;
    sessions.add(s);
    tmux('new-session', '-d', '-s', s, 'sleep 120');
    writeFileSync(join(camp, 'heartbeat', 'ACTIVE'), `${lane}\n`);
    const laneCwd = join(dir, `cwd-${lane}`);
    mkdirSync(laneCwd, { recursive: true });
    const pid = plant('claude', laneCwd);
    // `waitingFor` carries a SPACE. A retirement that reads the pid positionally out of the
    // roster ROW retires field 3 — the word "prompt" — and silently retires nothing: measured
    // live on 2026-09-04, pid 511842 survived a `kill` that reported success.
    setRoster([{ name: s, pid, kind: 'interactive', status: 'waiting', waitingFor: 'permission prompt', cwd: laneCwd }]);

    const r = lanes(['kill', camp, lane]);

    assert.equal(r.status, 0, r.stderr);
    assert.ok(waitGone(pid), `the pid the roster named is retired (pid ${pid})`);
    assert.match(r.stdout, new RegExp(`\\b${pid}\\b`), 'and it is printed');
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

/**
 * Bead forge-uowf / §15.59 (T1, wave-3 launch): `lanes.sh render docs/roadmaps/1.0-kickoffs.md
 * '11. M4-' out` produced the T1 kickoff block from §1 — twice — because a heading regex that
 * matches nothing left `found` false and the first ```text block in the file won. A rendered
 * prompt that is silently the wrong prompt is worse than no prompt.
 */
describe('lanes.sh render — a heading miss is an error, never a fallback', () => {
  let src: string;
  before(() => {
    src = join(dir, 'kickoffs.md');
    writeFileSync(
      src,
      ['## 1. T1 — campaign orchestrator', '', '```text', 'ROLE: T1 campaign orchestrator', '```', '',
       '## 11. M4-<pkg> — package lane', '', '```text', 'ROLE: T2 lane for $PKG', '```', ''].join('\n'),
    );
  });

  test('a heading regex that matches nothing exits non-zero, names the regex and writes NO file', () => {
    const out = join(dir, 'render-miss.md');

    const r = lanes(['render', src, '^## nope', out]);

    assert.notEqual(r.status, 0, 'a miss is an error');
    assert.match(r.stderr, /\^## nope/, 'the failure names the regex that missed, so it can be fixed');
    assert.ok(!existsSync(out), 'and nothing is left on disk to be mistaken for a rendered prompt');
  });

  test('a hit prints the heading it matched, so the render can be checked before a launch', () => {
    const out = join(dir, 'render-hit.md');

    const r = lanes(['render', src, '^## 11\\. M4-', out, 'PKG=agents']);

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /## 11\. M4-<pkg> — package lane/, 'the matched heading is printed');
    assert.equal(readFileSync(out, 'utf8').trim(), 'ROLE: T2 lane for agents', 'the right block, with its parameters filled');
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
      { name: blocked, pid: 1, status: 'waiting', waitingFor: 'permission prompt' },
      { name: idle, pid: 2, status: 'idle' },
      { name: busy, pid: 3, status: 'busy' },
    ]);

    const out = firstPass();

    assert.match(out, /^STALL: STALL ev-gone gap=45min/m);
    assert.match(out, new RegExp(`^LANE_GONE: ${PREFIX}ev-gone tmux session gone`, 'm'));
    assert.match(out, new RegExp(`^LANE_EXITED: ${PREFIX}ev-exited claude has exited \\(pane runs 'bash'\\)`, 'm'));
    assert.match(out, new RegExp(`^LANE_BLOCKED: ${PREFIX}ev-blocked is waiting on a dialog .*permission prompt`, 'm'), 'the event quotes waitingFor — WHICH dialog a terminal must answer');
    assert.match(out, new RegExp(`^LANE_IDLE: ${PREFIX}ev-idle finished its turn, heartbeat 16666 min old`, 'm'), 'idle with no heartbeat is the relay hole');
    assert.doesNotMatch(out, new RegExp(`${PREFIX}ev-busy`), 'a busy lane with a fresh heartbeat is not an event');
    assert.equal(out.split('\n').filter((l) => l.startsWith('LANE_') || l.startsWith('STALL')).length, 5, 'exactly one line per state, no repeats within a pass');
  });
});
