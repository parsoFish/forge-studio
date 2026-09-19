/**
 * `lanes.sh preflight` (and the same five lines inside `launch`) — the M7 findings-table host
 * checks, red-first: row 5b (foreign residents >256 MB RSS), row 18b (earlyoom's kill
 * thresholds), row 19b (DNS to github.com), row 40 (CLI version vs lastOnboardingVersion) and
 * row 71 (T1's cross-session socket under /tmp or unlinked). `_1.0/rulings/M7-brief-findings.md`
 * rows 5, 18, 19, 40, 71.
 *
 * Every one of these WARNs, never refuses — `launch` used to succeed without them, and it must
 * keep succeeding with every one of the five tripped at once (the last describe() below). Split
 * from lanes.test.ts because that file sits at the 800-line cap; most cases here go through the
 * standalone `preflight` subcommand and need no tmux, only a fake /proc tree (LANES_PROC_ROOT)
 * and a fake roster (LANES_ROSTER_CMD, the seam lanes.test.ts already uses).
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, chmodSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LANES = join(import.meta.dirname, '..', '.claude', 'skills', 'tiered-orchestration', 'scripts', 'lanes.sh');
// A tmux session prefix unique to this file's pid — the one test below that drives a real
// `launch` must never create or kill a session named like a real forge-<lane> lane on this host.
const PREFIX = `lanespf${process.pid}-`;

let dir: string;
let rosterFile: string;
let rosterCmd: string;
// Fast, deterministic defaults for the three checks a test isn't exercising, so a case that
// cares about (say) row 19b's DNS never also scans this host's REAL /proc or reads its own
// ~/.claude.json — every call below still runs all five checks, since `preflight` always does.
let defaultProcRoot: string;
let defaultClaudeBin: string;
let defaultClaudeJson: string;

function envWithoutLanesVars(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('LANES_')));
}

/** Run lanes.sh. Never throws — the exit status IS the subject of these tests. */
function lanes(args: string[], env: Record<string, string> = {}, timeoutMs = 15000) {
  const r = spawnSync('bash', [LANES, ...args], {
    encoding: 'utf8',
    timeout: timeoutMs,
    env: {
      ...envWithoutLanesVars(),
      LANES_ROSTER_CMD: rosterCmd,
      LANES_SESSION_PREFIX: PREFIX,
      LANES_CONFIRM_TIMEOUT_S: '6',
      LANES_PROC_ROOT: defaultProcRoot,
      LANES_DNS_CMD: 'true',
      LANES_CLAUDE_BIN: defaultClaudeBin,
      LANES_CLAUDE_JSON: defaultClaudeJson,
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

/** A fresh fake-/proc-like tree — LANES_PROC_ROOT points here instead of the real /proc. */
function fakeProcRoot() {
  const root = mkdtempSync(join(dir, 'procroot-'));
  mkdirSync(join(root, 'net'), { recursive: true });
  return root;
}
/**
 * One pid's worth of the files these checks read: `comm`, `status` (VmRSS), `cmdline` (NUL-
 * separated), `stat` (field 2 after `sed 's/.*) //'` is ppid — matching what `_ancestors_at` and
 * every existing helper in lanes.sh already reads), and, if `cwd` is given, a `cwd` symlink.
 */
function plantProc(
  root: string,
  pid: number,
  opts: { comm?: string; ppid?: number; rssKb?: number; cwd?: string; cmdline?: string[] } = {},
) {
  const comm = opts.comm ?? 'proc';
  const ppid = opts.ppid ?? 1;
  const p = join(root, String(pid));
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, 'comm'), `${comm}\n`);
  // 20 fields after "pid (comm) " — state(1) ppid(2) ... starttime(20) — enough for every
  // existing lanes.sh reader (`awk '{print $2}'` for ppid, `{print $20}'` for starttime).
  writeFileSync(join(p, 'stat'), `${pid} (${comm}) S ${ppid} 1 1 0 -1 0 0 0 0 0 0 0 0 0 0 0 0 0 12345\n`);
  writeFileSync(join(p, 'status'), `Name:\t${comm}\nVmRSS:\t${opts.rssKb ?? 1024} kB\n`);
  writeFileSync(join(p, 'cmdline'), `${(opts.cmdline ?? [comm]).join('\0')}\0`);
  if (opts.cwd) {
    mkdirSync(opts.cwd, { recursive: true });
    symlinkSync(opts.cwd, join(p, 'cwd'));
  }
  return p;
}
/** A socket fd for `pid`: `fd/<n>` → `socket:[<inode>]`, plus the /proc/net/unix line it names. */
function plantSocket(root: string, pid: number, inode: number, path: string | null) {
  const fdDir = join(root, String(pid), 'fd');
  mkdirSync(fdDir, { recursive: true });
  symlinkSync(`socket:[${inode}]`, join(fdDir, '3'));
  const unixFile = join(root, 'net', 'unix');
  const header = 'Num       RefCount Protocol Flags    Type St Inode Path\n';
  const body = existsSync(unixFile) ? readFileSync(unixFile, 'utf8') : header;
  const line = `0000000000000000: 00000002 00000000 00000000 0001 01 ${inode}${path ? ` ${path}` : ''}\n`;
  writeFileSync(unixFile, body + line);
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'lanes-preflight-'));
  rosterFile = join(dir, 'roster.json');
  setRoster([]);
  rosterCmd = writeExec('roster', `#!/usr/bin/env bash\ncat '${rosterFile}'\n`);
  defaultProcRoot = fakeProcRoot();
  defaultClaudeBin = writeExec('default-claude', `#!/usr/bin/env bash\necho '9.9.9'\n`);
  defaultClaudeJson = join(dir, 'default-claude.json');
  writeFileSync(defaultClaudeJson, JSON.stringify({ lastOnboardingVersion: '9.9.9' }));
});
after(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('lanes.sh preflight — row 5b, FOREIGN RESIDENTS', () => {
  test('names an unrelated process >256 MB RSS by pid, comm, RSS and cwd', () => {
    const root = fakeProcRoot();
    const cwd = join(dir, 'rogue-cwd');
    plantProc(root, 91001, { comm: 'rogue', ppid: 1, rssKb: 300000, cwd });

    const r = lanes(['preflight'], { LANES_PROC_ROOT: root });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^preflight WARN: FOREIGN RESIDENTS/m);
    assert.match(r.stdout, /rogue\(pid 91001, 300000kB, cwd/, 'names comm, pid, RSS and cwd');
  });

  test('does NOT warn about a process descended from a roster (known lane/T1) pid', () => {
    const root = fakeProcRoot();
    setRoster([{ name: 'forge-b', pid: 91100, kind: 'interactive', status: 'busy' }]);
    plantProc(root, 91100, { comm: 'claude', ppid: 1, rssKb: 1024 });
    // a child of the known lane session, itself heavy — e.g. a test runner the lane spawned
    plantProc(root, 91101, { comm: 'node', ppid: 91100, rssKb: 400000 });

    const r = lanes(['preflight'], { LANES_PROC_ROOT: root });

    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /91101/, 'a descendant of a known lane is not a foreign resident');
  });

  test('under the 256 MB floor is not named', () => {
    const root = fakeProcRoot();
    plantProc(root, 91200, { comm: 'small', ppid: 1, rssKb: 100000 });

    const r = lanes(['preflight'], { LANES_PROC_ROOT: root });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^preflight: no foreign residents/m);
  });
});

describe('lanes.sh preflight — row 18b, EARLYOOM', () => {
  test('an earlyoom process is named with its -m/-s thresholds', () => {
    const root = fakeProcRoot();
    plantProc(root, 92001, { comm: 'earlyoom', ppid: 1, rssKb: 2048, cmdline: ['/usr/bin/earlyoom', '-m', '10', '-s', '5'] });

    const r = lanes(['preflight'], { LANES_PROC_ROOT: root });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^preflight: earlyoom running \(pid 92001\), kill thresholds -m 10 -s 5$/m);
  });

  test('an earlyoom with no -m/-s argv reports defaults, not silence', () => {
    const root = fakeProcRoot();
    plantProc(root, 92002, { comm: 'earlyoom', ppid: 1, rssKb: 2048, cmdline: ['/usr/bin/earlyoom'] });

    const r = lanes(['preflight'], { LANES_PROC_ROOT: root });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /kill thresholds -m defaults -s defaults/);
  });

  test('no earlyoom process at all is reported, not omitted', () => {
    const root = fakeProcRoot();

    const r = lanes(['preflight'], { LANES_PROC_ROOT: root });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^preflight: earlyoom not running/m);
  });
});

describe('lanes.sh preflight — row 19b, DNS', () => {
  test('a resolver failure is a named WARN, never silent', () => {
    const r = lanes(['preflight'], { LANES_DNS_CMD: 'false' });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^preflight WARN: DNS: github\.com does not resolve — pushes and gh reads will fail transiently$/m);
  });

  test('a resolving lookup is reported ok', () => {
    const r = lanes(['preflight'], { LANES_DNS_CMD: 'true' });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^preflight: DNS github\.com resolves$/m);
  });
});

describe('lanes.sh preflight — row 40, CLI VERSION vs lastOnboardingVersion', () => {
  function fakeCli(version: string) {
    return writeExec(`claude-${version}-${Math.random().toString(36).slice(2)}`, `#!/usr/bin/env bash\necho '${version}'\n`);
  }
  function claudeJson(lastOnboardingVersion: string) {
    const p = join(dir, `claude-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(p, JSON.stringify({ lastOnboardingVersion }));
    return p;
  }

  test('an onboarding record older than the resolved CLI is a named WARN with both versions', () => {
    const bin = fakeCli('2.1.269');
    const json = claudeJson('2.1.218');

    const r = lanes(['preflight'], { LANES_CLAUDE_BIN: bin, LANES_CLAUDE_JSON: json });

    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stdout,
      /^preflight WARN: CLI VERSION: lastOnboardingVersion 2\.1\.218 is older than the resolved CLI 2\.1\.269/m,
    );
  });

  test('an onboarding record that matches the resolved CLI is reported current, not a WARN', () => {
    const bin = fakeCli('2.1.269');
    const json = claudeJson('2.1.269');

    const r = lanes(['preflight'], { LANES_CLAUDE_BIN: bin, LANES_CLAUDE_JSON: json });

    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(r.stdout, /CLI VERSION.*WARN|WARN.*CLI VERSION/);
    assert.match(r.stdout, /^preflight: CLI 2\.1\.269, lastOnboardingVersion 2\.1\.269 is current$/m);
  });

  test('no lastOnboardingVersion recorded is reported, not treated as older', () => {
    const bin = fakeCli('2.1.269');
    const json = join(dir, 'claude-empty.json');
    writeFileSync(json, JSON.stringify({}));

    const r = lanes(['preflight'], { LANES_CLAUDE_BIN: bin, LANES_CLAUDE_JSON: json });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^preflight: CLI 2\.1\.269 \(no lastOnboardingVersion recorded at/m);
  });
});

describe('lanes.sh preflight — row 71, T1 SOCKET', () => {
  test('a T1 socket under /tmp is a named WARN pointing at the outbox', () => {
    const root = fakeProcRoot();
    setRoster([{ name: 't1', pid: 93001, kind: 'interactive', status: 'busy' }]);
    plantProc(root, 93001, { comm: 'claude', ppid: 1, rssKb: 1024 });
    plantSocket(root, 93001, 555001, '/tmp/cc-socks-1000/93001.sock');

    const r = lanes(['preflight', '--t1', 't1'], { LANES_PROC_ROOT: root });

    assert.equal(r.status, 0, r.stderr);
    assert.match(
      r.stdout,
      /^preflight WARN: T1 unreachable by SendMessage: its socket \/tmp\/cc-socks-1000\/93001\.sock is unlinked \/ under \/tmp \(tmpfiles-clean\) — use the outbox$/m,
    );
  });

  test('a socket path outside /tmp that no longer exists on disk is also a named WARN', () => {
    const root = fakeProcRoot();
    setRoster([{ name: 't1', pid: 93002, kind: 'interactive', status: 'busy' }]);
    plantProc(root, 93002, { comm: 'claude', ppid: 1, rssKb: 1024 });
    plantSocket(root, 93002, 555002, '/run/user/1000/cc-socks/93002.sock');

    const r = lanes(['preflight', '--t1', 't1'], { LANES_PROC_ROOT: root });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /unreachable by SendMessage: its socket \/run\/user\/1000\/cc-socks\/93002\.sock is unlinked/);
  });

  test('a socket path outside /tmp that DOES exist on disk is reported ok', () => {
    const root = fakeProcRoot();
    setRoster([{ name: 't1', pid: 93003, kind: 'interactive', status: 'busy' }]);
    plantProc(root, 93003, { comm: 'claude', ppid: 1, rssKb: 1024 });
    // `os.tmpdir()` IS `/tmp` on this host, so a path under `dir` would (rightly) hit the /tmp
    // branch — /dev/shm is a real, writable, non-/tmp mount, which is what this case is testing.
    const shmDir = mkdtempSync(join('/dev/shm', 'lanes-preflight-'));
    const realSockPath = join(shmDir, '93003.sock');
    writeFileSync(realSockPath, '');
    plantSocket(root, 93003, 555003, realSockPath);

    const r = lanes(['preflight', '--t1', 't1'], { LANES_PROC_ROOT: root });
    rmSync(shmDir, { recursive: true, force: true });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^preflight: T1 socket ${realSockPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} ok`, 'm'));
  });

  test('no pid in the roster for T1 is reported, not a crash', () => {
    const root = fakeProcRoot();

    const r = lanes(['preflight', '--t1', 'ghost'], { LANES_PROC_ROOT: root });

    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^preflight: T1 SOCKET: no pid in the roster for T1 session 'ghost' — skipped$/m);
  });
});

/**
 * The one rule that binds all five: none of them may turn a launch that used to succeed into one
 * that doesn't. A full `launch` with every one of the five WARNs planted at once still has to
 * reach the roster-confirm step and print `launched`.
 */
describe('lanes.sh launch — all five advisory WARNs planted at once still reaches roster-confirm', () => {
  let launchDir: string;
  let camp: string;

  function tmux(...args: string[]) {
    return spawnSync('tmux', args, { encoding: 'utf8' });
  }

  before(() => {
    const probe = spawnSync('tmux', ['-V'], { encoding: 'utf8' });
    assert.equal(probe.status, 0, 'tmux must be installed for this one integration test');
    launchDir = mkdtempSync(join(tmpdir(), 'lanes-preflight-launch-'));
    camp = join(launchDir, 'camp');
    mkdirSync(join(camp, 'heartbeat'), { recursive: true });
  });
  after(() => {
    if (launchDir) rmSync(launchDir, { recursive: true, force: true });
  });

  test('launch reaches "launched" with a foreign resident, earlyoom, a broken DNS, a stale CLI record and a /tmp T1 socket all planted', () => {
    const lane = 'allwarn';
    const s = `${PREFIX}${lane}`;
    const laneCwd = join(launchDir, 'lane-cwd');
    mkdirSync(join(laneCwd, '.claude', 'skills', 'tiered-orchestration'), { recursive: true });
    writeFileSync(join(laneCwd, '.claude', 'skills', 'tiered-orchestration', 'SKILL.md'), '# skill\n');

    // The lane's own program: registers itself in the roster under its `-n NAME`. Answers
    // `--version` directly rather than falling into that registration path (which would
    // otherwise register a name-less row for the version check's own invocation, then
    // `sleep 120` — hanging the launch on the one check this test needs fast).
    const argvFile = join(launchDir, 'lane.argv');
    const bin = writeExec(
      'lane-allwarn',
      `#!/usr/bin/env bash
if [ "\${1:-}" = --version ]; then echo '1.0.0 (fake)'; exit 0; fi
printf '%s\\0' "$@" > '${argvFile}'
SESS=""; while [ $# -gt 0 ]; do [ "$1" = -n ] && SESS="$2"; shift; done
export SESS ROSTER='${rosterFile}'
python3 - "$$" <<'PY'
import json, os, sys
p = os.environ["ROSTER"]
rows = json.load(open(p)) if os.path.exists(p) else []
rows.append({"name": os.environ["SESS"], "pid": int(sys.argv[1]), "kind": "interactive", "status": "busy"})
json.dump(rows, open(p, "w"))
PY
sleep 120
`,
    );

    const prompt = join(launchDir, 'prompt.md');
    writeFileSync(prompt, `KICKOFF\nSuites: flock ${camp}/.suite-lock npm test\n`);
    setRoster([{ name: 't1-under-test', pid: process.pid, kind: 'interactive', status: 'busy' }]);

    const root = fakeProcRoot();
    // row 5b: an unrelated foreign resident, well over the 256 MB floor.
    plantProc(root, 94101, { comm: 'rogue', ppid: 1, rssKb: 400000, cwd: join(launchDir, 'rogue-cwd') });
    // row 18b: earlyoom, present.
    plantProc(root, 94102, { comm: 'earlyoom', ppid: 1, rssKb: 2048, cmdline: ['earlyoom'] });
    // row 71: T1 (pid = this test process) holds a socket under /tmp.
    plantProc(root, process.pid, { comm: 'node', ppid: 1, rssKb: 1024 });
    plantSocket(root, process.pid, 555999, '/tmp/cc-socks-1000/fake.sock');
    const claudeJson = join(launchDir, 'claude.json');
    writeFileSync(claudeJson, JSON.stringify({ lastOnboardingVersion: '0.0.1' })); // row 40: stale

    const r = lanes(
      ['launch', camp, lane, prompt, '--cwd', laneCwd, '--t1', 't1-under-test'],
      {
        LANES_CLAUDE_BIN: bin,
        LANES_PROC_ROOT: root,
        LANES_DNS_CMD: 'false', // row 19b: DNS broken
        LANES_CLAUDE_JSON: claudeJson,
        LANES_MEMINFO: (() => {
          const p = join(launchDir, 'meminfo');
          writeFileSync(p, 'MemTotal:       16000000 kB\nMemFree:         9000000 kB\nMemAvailable:    9000000 kB\n');
          return p;
        })(),
      },
      20000,
    );
    tmux('kill-session', '-t', s);

    assert.equal(r.status, 0, `launch must still succeed with every advisory WARN tripped; stderr=${r.stderr}`);
    assert.match(r.stdout, /^launched /m, 'launch reaches the roster-confirm step and reports it');
    assert.match(r.stdout, /^preflight WARN: FOREIGN RESIDENTS/m, 'row 5b fired');
    assert.match(r.stdout, /^preflight: earlyoom running/m, 'row 18b fired');
    assert.match(r.stdout, /^preflight WARN: DNS:/m, 'row 19b fired');
    assert.match(r.stdout, /^preflight WARN: CLI VERSION:/m, 'row 40 fired');
    assert.match(r.stdout, /^preflight WARN: T1 unreachable by SendMessage/m, 'row 71 fired');
  });
});
