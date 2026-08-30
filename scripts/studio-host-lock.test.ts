/**
 * forge-pxef — scripts/studio-host-lock.sh half-released the host lock when
 * run from a lane worktree.
 *
 * The script's identity check accepted a `next-server` only when its cwd was
 * literally `$FORGE_ROOT/forge-ui`, and FORGE_ROOT comes from the script's OWN
 * location. Every campaign lane works in its own git worktree, so a lane
 * running the script saw the live Studio's next-server as FOREIGN: the bridge
 * (4123) was stopped, the UI (4124) was not, and the next harness run failed
 * on a still-held port looking like a harness bug. The same location-bound
 * assumption made the bridge itself unrecognisable whenever Studio was
 * launched through an `npm link` / `npx` shim, whose argv names
 * `node_modules/.bin/forge` rather than `orchestrator/cli.ts`.
 *
 * The properties under test:
 *
 *   1. A REFUSAL SIGNALS NOTHING. `cmd_stop` verifies every holder before it
 *      signals any, so one foreign holder can never cost you the other half
 *      of the lock. Driven over decoy processes this test spawns itself.
 *   2. THE IDENTITY CHECK IS NOT A WIDENING. A foreign process is refused —
 *      from a stranger's directory, from a directory dressed up to look like
 *      forge, from a real checkout's non-UI subdirectories, and (the shape a
 *      hostile review found) from an argv that merely MENTIONS forge's
 *      entrypoint. Identity reads argv with its real NUL boundaries and
 *      anchors on the program position; it never pattern-matches a joined
 *      command line.
 *   3. THE GUARDS REACH AS FAR AS THE KILL. `stop` refuses on a cycle in
 *      flight in any checkout it is about to signal into, not just its own,
 *      and `start` restores the checkout `stop` took down, not the caller's.
 *   4. `stop` on already-free ports reports and exits 0.
 *
 * What is real here and what is not: the identity decision, the /proc reads
 * and `kill` are all the real thing, run against real processes. The ONLY
 * substitution is `port_holders` — the port→PID enumeration, which carries no
 * safety semantics — replaced by a scripted list of this test's own decoy
 * PIDs. The substitute keeps the real one's exit contract (non-zero when it
 * finds nothing), because that status is load-bearing under `set -e`. Nothing
 * in this file binds, probes or enumerates 4123/4124, so a live `forge studio`
 * on the host is never a participant.
 *
 * RUN: node --test --experimental-strip-types scripts/studio-host-lock.test.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts/studio-host-lock.sh');

/** forge's own package names, read from forge's own tree — the fixtures wear
 *  these, so a rename cannot silently turn the fixtures into strangers. */
const packageName = (dir: string): string =>
  JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name as string;
const OUR_ROOT_NAME = packageName(ROOT);
const OUR_UI_NAME = packageName(join(ROOT, 'apps', 'studio'));

/** `next` overwrites its argv with this title in startServer(), for `next dev`
 *  and `next start` alike — verified against node_modules/next and against the
 *  live process's raw /proc/<pid>/cmdline. */
const UI_ARGV0 = 'next-server (v14.2.35)';

const FIXTURES = mkdtempSync(join(tmpdir(), 'studio-host-lock-'));

/** A decoy program: stays alive, does nothing. It is installed AS a fixture
 *  checkout's bin/forge.mjs so a decoy bridge can carry the real argv shape
 *  (`node <flags> <entrypoint> studio`) instead of an imitation of it. */
const IDLE = 'setTimeout(() => {}, 10 * 60 * 1000);\n';

/** Lay down the marker files that make a directory recognisably a forge checkout. */
function forgeCheckout(dir: string, names: { root?: string; ui?: string } = {}): string {
  mkdirSync(join(dir, 'orchestrator'), { recursive: true });
  mkdirSync(join(dir, 'apps', 'studio'), { recursive: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'orchestrator/cli.ts'), '// fixture\n');
  writeFileSync(join(dir, 'bin/forge.mjs'), IDLE);
  writeFileSync(join(dir, 'apps/studio/package.json'), JSON.stringify({ name: names.ui ?? OUR_UI_NAME }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: names.root ?? OUR_ROOT_NAME }, null, 2));
  return dir;
}

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    stdio: 'pipe',
  });
}

// A primary checkout and a GENUINE sibling git worktree of it — the exact
// campaign layout. The worktree's `.git` is a file, not a directory.
const PRIMARY = forgeCheckout(join(FIXTURES, 'forge'));
git(PRIMARY, 'init', '--initial-branch=main');
git(PRIMARY, 'add', '-A');
git(PRIMARY, 'commit', '-m', 'fixture');
const LANE = join(FIXTURES, 'forge-lane');
git(PRIMARY, 'worktree', 'add', '--detach', LANE, 'HEAD');
mkdirSync(join(LANE, 'scripts'), { recursive: true });
copyFileSync(SCRIPT, join(LANE, 'scripts/studio-host-lock.sh'));

// An `npx`/`npm link` shim: argv names a symlink in a package cache that
// resolves back into a checkout's bin/forge.mjs. This is the shape the live
// bridge actually runs as.
const SHIM_DIR = join(FIXTURES, 'npx-cache/node_modules/.bin');
mkdirSync(SHIM_DIR, { recursive: true });
symlinkSync(join(PRIMARY, 'bin/forge.mjs'), join(SHIM_DIR, 'forge'));

const STRANGER_PROGRAM = join(FIXTURES, 'stranger.mjs');
writeFileSync(STRANGER_PROGRAM, IDLE);

/** Ask a copy of the script (rooted at `scriptRoot`) how it classifies one
 *  process's evidence. Returns 'forge <checkout>' or 'FOREIGN'. */
function classify(cwd: string, argv: string[], scriptRoot = ROOT): string {
  const script = join(scriptRoot, 'scripts/studio-host-lock.sh');
  const r = spawnSync(script, ['classify', cwd, ...argv], { encoding: 'utf8' });
  const out = `${r.stdout ?? ''}`.trim();
  // exit 1 = FOREIGN (an answer); anything else is a broken harness, not a verdict.
  assert.ok(r.status === 0 || r.status === 1, `classify failed (exit ${r.status}): ${r.stderr ?? ''}${out}`);
  return out;
}

const verdict = (out: string): string => out.split(' ')[0];

// ---------------------------------------------------------------------------
// the identity decision
// ---------------------------------------------------------------------------

test('the live Studio in a sibling checkout is forge — the reported failure', () => {
  // Reported direction: the script runs from the LANE, the next-server lives in
  // the primary checkout. This is what printed "REFUSING to signal ... not a
  // forge process: next-server" while the bridge had already been stopped.
  assert.equal(classify(join(PRIMARY, 'apps', 'studio'), [UI_ARGV0], LANE), `forge ${PRIMARY}`);
});

test('a next-server in a sibling worktree is forge, seen from the primary checkout', () => {
  assert.equal(classify(join(LANE, 'apps', 'studio'), [UI_ARGV0]), `forge ${LANE}`);
});

test("this checkout's own next-server is still forge, at the UI dir or the root", () => {
  assert.equal(classify(join(ROOT, 'apps', 'studio'), [UI_ARGV0]), `forge ${ROOT}`);
  assert.equal(classify(ROOT, [UI_ARGV0]), `forge ${ROOT}`);
});

test('the bridge is forge however it was launched, in any checkout', () => {
  // relative argv, resolved against the process's own cwd — the live shape
  assert.equal(
    classify(PRIMARY, ['/usr/bin/node', '--experimental-strip-types', 'orchestrator/cli.ts', 'studio', '--no-open'], LANE),
    `forge ${PRIMARY}`,
  );
  // absolute argv
  assert.equal(classify(PRIMARY, ['node', join(PRIMARY, 'bin/forge.mjs'), 'studio', '--dev'], LANE), `forge ${PRIMARY}`);
  // argv[0] is the entrypoint itself (a shebang exec)
  assert.equal(classify(PRIMARY, [join(PRIMARY, 'bin/forge.mjs'), 'studio'], LANE), `forge ${PRIMARY}`);
  // the npx/npm-link shim — a symlink into the checkout's bin/forge.mjs, and
  // the shape the live bridge ran as. The cmdline-substring test this
  // replaced called it FOREIGN.
  assert.equal(classify(PRIMARY, ['node', '--experimental-strip-types', join(SHIM_DIR, 'forge'), 'studio'], LANE), `forge ${PRIMARY}`);
});

test('an argv that merely MENTIONS forge\'s entrypoint is not the bridge', () => {
  const entry = join(PRIMARY, 'bin/forge.mjs');
  // one single argument that happens to contain "<entry> studio". Collapsing
  // argv to a string and re-splitting it accepted this from any cwd — the
  // finding that made this file read /proc/<pid>/cmdline with real boundaries.
  assert.equal(verdict(classify(tmpdir(), ['my-supervisor', '--restart-command', `${entry} studio`])), 'FOREIGN');
  assert.equal(verdict(classify(tmpdir(), ['bash', '-c', `echo ${entry} studio`])), 'FOREIGN');
  // separate arguments, but the program is somebody else
  assert.equal(verdict(classify(tmpdir(), ['systemd-run', '--description', entry, 'studio', '/usr/bin/nc'])), 'FOREIGN');
  assert.equal(verdict(classify(PRIMARY, ['strace', '-f', entry, 'studio'])), 'FOREIGN');
  // node, but the entrypoint is not what node was asked to run
  assert.equal(verdict(classify(PRIMARY, ['node', STRANGER_PROGRAM, entry, 'studio'])), 'FOREIGN');
});

test('a bridge-shaped command line with no forge checkout behind it is REFUSED', () => {
  const stranger = join(FIXTURES, 'not-forge');
  mkdirSync(join(stranger, 'bin'), { recursive: true });
  writeFileSync(join(stranger, 'bin/forge.mjs'), '// impostor\n');
  writeFileSync(join(stranger, 'package.json'), JSON.stringify({ name: OUR_ROOT_NAME }));
  // right name, right file, no checkout behind it
  assert.equal(verdict(classify(stranger, ['node', join(stranger, 'bin/forge.mjs'), 'studio'])), 'FOREIGN');
  // a word that resolves to nothing at all
  assert.equal(verdict(classify(PRIMARY, ['node', '/nowhere/bin/forge.mjs', 'studio'])), 'FOREIGN');
  // forge's entrypoint, but not the studio subcommand
  assert.equal(verdict(classify(PRIMARY, ['node', join(PRIMARY, 'bin/forge.mjs'), 'serve'])), 'FOREIGN');
  // an editor holding forge's files open, with `studio` in the argv but not as
  // the subcommand
  assert.equal(verdict(classify(PRIMARY, ['vim', join(PRIMARY, 'orchestrator/cli.ts'), 'studio.md'])), 'FOREIGN');
  // "studio" alone proves nothing
  assert.equal(verdict(classify(PRIMARY, ['some-other-cli', 'studio'])), 'FOREIGN');
});

test('a relative bridge argv is resolved against the PROCESS cwd, never ours', () => {
  // The same argv the live bridge runs, but from a cwd that is not a forge
  // checkout: `orchestrator/cli.ts` resolves to nothing there, and the script
  // must not fall back on its own directory to find one.
  assert.equal(verdict(classify(tmpdir(), ['node', '--experimental-strip-types', 'orchestrator/cli.ts', 'studio'])), 'FOREIGN');
});

test('the UI is identified by its own argv[0], not by a string in a command line', () => {
  // Every one of these ran with a cwd inside a real forge checkout. Matching
  // the whole command line accepted them all; the SSH tunnel is the one that
  // could plausibly hold :4124 and be SIGTERMed for it.
  assert.equal(verdict(classify(ROOT, ['ssh', '-L', '4124:localhost:4124', 'next-server.example.com'])), 'FOREIGN');
  assert.equal(verdict(classify(ROOT, ['tail', '-f', join(ROOT, '_logs/next-server.log')])), 'FOREIGN');
  assert.equal(verdict(classify(ROOT, ['vim', 'next-server-notes.md'])), 'FOREIGN');
  assert.equal(verdict(classify(ROOT, ['docker', 'run', '-p', '4124:4124', 'next-server:latest'])), 'FOREIGN');
  assert.equal(verdict(classify(ROOT, ['npm', 'run', 'start', '--workspace', 'forge-ui'])), 'FOREIGN');
  // and the real thing still is forge
  assert.equal(verdict(classify(join(ROOT, 'apps', 'studio'), [UI_ARGV0])), 'forge');
});

test('an unrelated next-server is REFUSED', () => {
  const stranger = join(FIXTURES, 'someone-elses-app');
  mkdirSync(join(stranger, 'apps', 'studio'), { recursive: true });
  writeFileSync(join(stranger, 'package.json'), JSON.stringify({ name: 'someone-elses-app' }));
  assert.equal(verdict(classify(stranger, [UI_ARGV0])), 'FOREIGN');
  // even when it happens to have a directory named forge-ui
  assert.equal(verdict(classify(join(stranger, 'apps', 'studio'), [UI_ARGV0])), 'FOREIGN');
  // and even when it claims forge's package name without forge's files
  const impostor = join(FIXTURES, 'impostor');
  mkdirSync(impostor, { recursive: true });
  writeFileSync(join(impostor, 'package.json'), JSON.stringify({ name: OUR_ROOT_NAME }));
  assert.equal(verdict(classify(impostor, [UI_ARGV0])), 'FOREIGN');
});

test('each of the four checkout markers is load-bearing on its own', () => {
  // Every fixture below is a complete forge checkout with exactly ONE marker
  // spoiled, so a check that silently stopped running would show up here.
  const spoil = (name: string, mutate: (dir: string) => void): string => {
    const dir = forgeCheckout(join(FIXTURES, name));
    mutate(dir);
    return dir;
  };
  const noCli = spoil('no-cli', (d) => rmSync(join(d, 'orchestrator/cli.ts')));
  const noBin = spoil('no-bin', (d) => rmSync(join(d, 'bin/forge.mjs')));
  const badRootName = forgeCheckout(join(FIXTURES, 'renamed-fork'), { root: 'someone-elses-fork' });
  const badUiName = forgeCheckout(join(FIXTURES, 'other-ui'), { ui: 'someone-elses-ui' });
  for (const dir of [noCli, noBin, badRootName, badUiName]) {
    assert.equal(verdict(classify(join(dir, 'apps', 'studio'), [UI_ARGV0])), 'FOREIGN', dir);
    assert.equal(verdict(classify(dir, ['node', join(dir, 'bin/forge.mjs'), 'studio'])), 'FOREIGN', dir);
  }
});

test('an unreadable package.json refuses, even when OURS is unreadable too', () => {
  // names_match must not treat "we could not read either name" as a match:
  // the failure mode of this script is report, do not signal.
  const brokenLane = forgeCheckout(join(FIXTURES, 'broken-lane'));
  writeFileSync(join(brokenLane, 'package.json'), '{ not json');
  writeFileSync(join(brokenLane, 'apps/studio/package.json'), '{ not json');
  mkdirSync(join(brokenLane, 'scripts'), { recursive: true });
  copyFileSync(SCRIPT, join(brokenLane, 'scripts/studio-host-lock.sh'));
  const brokenTarget = forgeCheckout(join(FIXTURES, 'broken-target'));
  writeFileSync(join(brokenTarget, 'package.json'), '{ not json');
  writeFileSync(join(brokenTarget, 'apps/studio/package.json'), '{ not json');
  assert.equal(verdict(classify(join(brokenTarget, 'apps', 'studio'), [UI_ARGV0], brokenLane)), 'FOREIGN');
  // a well-formed checkout is still refused by a script whose own names are unreadable
  assert.equal(verdict(classify(join(PRIMARY, 'apps', 'studio'), [UI_ARGV0], brokenLane)), 'FOREIGN');
});

test('a next-server in a non-UI subdirectory of a forge checkout is REFUSED', () => {
  // only the checkout root and its apps/studio/ workspace are Studio's own cwds
  assert.equal(verdict(classify(join(ROOT, 'scripts'), [UI_ARGV0])), 'FOREIGN');
  assert.equal(verdict(classify(join(ROOT, 'orchestrator'), [UI_ARGV0])), 'FOREIGN');
  // a managed project nested inside the checkout, with its own forge-ui, is
  // still someone else's app
  const nested = join(PRIMARY, 'projects/some-app/forge-ui');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(PRIMARY, 'projects/some-app/package.json'), JSON.stringify({ name: 'some-app' }));
  assert.equal(verdict(classify(nested, [UI_ARGV0])), 'FOREIGN');
});

test('a checkout that is itself named forge-ui is still identified', () => {
  // stripping a `forge-ui` basename before trying the cwd as a checkout root
  // walks one level too far and loses the whole checkout
  const oddly = forgeCheckout(join(FIXTURES, 'clones/forge-ui'));
  assert.equal(classify(oddly, [UI_ARGV0]), `forge ${oddly}`);
  assert.equal(classify(join(oddly, 'apps', 'studio'), [UI_ARGV0]), `forge ${oddly}`);
});

test('a checkout whose path contains a space is identified, argv and all', () => {
  const spaced = forgeCheckout(join(FIXTURES, 'my forge/checkout'));
  assert.equal(classify(join(spaced, 'apps', 'studio'), [UI_ARGV0]), `forge ${spaced}`);
  assert.equal(classify(spaced, ['node', join(spaced, 'bin/forge.mjs'), 'studio']), `forge ${spaced}`);
});

test('a non-forge command line is REFUSED wherever it runs', () => {
  assert.equal(verdict(classify(join(ROOT, 'apps', 'studio'), ['python3', '-m', 'http.server', '4124'])), 'FOREIGN');
  assert.equal(verdict(classify(join(ROOT, 'apps', 'studio'), [''])), 'FOREIGN');
});

test('a missing or unreadable cwd is REFUSED, never assumed', () => {
  assert.equal(verdict(classify(join(FIXTURES, 'does-not-exist'), [UI_ARGV0])), 'FOREIGN');
  assert.equal(verdict(classify('', [UI_ARGV0])), 'FOREIGN');
});

// ---------------------------------------------------------------------------
// all-or-nothing release, over decoy processes
// ---------------------------------------------------------------------------

// The harness sources the script under test and replaces ONLY port_holders —
// the port→PID enumeration — with a scripted sequence of PID lists, one line
// per call, the last line repeating (filtered to those still alive). It keeps
// the real pipeline's exit contract: non-zero when it finds nothing. The
// identity decision, the /proc reads and `kill` all stay real, and no port is
// ever touched.
const HARNESS = join(FIXTURES, 'stop-harness.sh');
writeFileSync(
  HARNESS,
  [
    '#!/usr/bin/env bash',
    '# written by scripts/studio-host-lock.test.ts; not shipped',
    'set -euo pipefail',
    'source "$1"',
    'SEQ="$2"',
    '# The call counter lives in a FILE: every caller of port_holders in the',
    '# script runs it inside a command substitution, i.e. in a subshell, so a',
    '# shell variable would reset on every call and the sequence would never',
    '# advance.',
    'COUNTER="$SEQ.calls"',
    'port_holders() {',
    '  local CALL total out p',
    '  CALL=$(( $(cat "$COUNTER" 2>/dev/null || echo 0) + 1 ))',
    '  echo "$CALL" > "$COUNTER"',
    '  total="$(wc -l < "$SEQ")"',
    '  if [ "$CALL" -le "$total" ]; then',
    '    out="$(sed -n "${CALL}p" "$SEQ")"',
    '  else',
    '    out=""',
    '    for p in $(sed -n "${total}p" "$SEQ"); do',
    '      if [ -n "$(tr -d "\\000" < "/proc/$p/cmdline" 2>/dev/null || true)" ]; then out="$out $p"; fi',
    '    done',
    '  fi',
    '  out="$(echo $out)"',
    '  [ -n "$out" ] || return 1',
    '  printf "%s\\n" $out',
    '}',
    '"$3"',
    '',
  ].join('\n'),
);

const decoys: ChildProcess[] = [];
after(() => {
  for (const d of decoys) { try { d.kill('SIGKILL'); } catch { /* already gone */ } }
  rmSync(FIXTURES, { recursive: true, force: true });
});

/** Spawn a decoy carrying the given evidence; returns its pid. `argv0` sets
 *  the process title the way `next` sets its own. */
function decoy(args: string[], cwd: string, argv0?: string): number {
  const child = argv0 === undefined
    ? spawn(process.execPath, args, { cwd, stdio: 'ignore' })
    : spawn('bash', ['-c', 'exec -a "$1" "$2" "$3"', '_', argv0, process.execPath, args[0]], { cwd, stdio: 'ignore' });
  decoys.push(child);
  assert.ok(child.pid, 'decoy failed to spawn');
  return child.pid as number;
}

/** A decoy bridge: the real argv shape, `node <entrypoint> studio`. */
const bridgeDecoy = (checkout: string, entry = join(checkout, 'bin/forge.mjs')): number =>
  decoy([entry, 'studio'], checkout);
/** A decoy UI: `next`'s own process title, in a checkout's forge-ui. */
const uiDecoy = (checkout: string): number =>
  decoy([join(checkout, 'bin/forge.mjs')], join(checkout, 'apps', 'studio'), UI_ARGV0);
/** A decoy that is nobody's Studio. */
const strangerDecoy = (): number => decoy([STRANGER_PROGRAM], tmpdir());

/** True while the pid names a live (non-reaped, non-zombie) process. */
function alive(pid: number): boolean {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, '').length > 0;
  } catch {
    return false;
  }
}

let seq = 0;
/** Run `fn` (default cmd_stop) with port_holders scripted call by call. */
function run(scriptRoot: string, calls: number[][], fn = 'cmd_stop'): { status: number; out: string } {
  const seqFile = join(FIXTURES, `holders-${seq++}.seq`);
  writeFileSync(seqFile, `${calls.map((c) => c.join(' ')).join('\n')}\n`);
  const r = spawnSync('bash', [HARNESS, join(scriptRoot, 'scripts/studio-host-lock.sh'), seqFile, fn], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** Wait for a decoy to actually leave /proc (SIGTERM delivery is not instant). */
function waitGone(pid: number): boolean {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    execFileSync('sleep', ['0.05']);
  }
  return !alive(pid);
}

test('a refusal signals NOTHING — the forge holder survives it', () => {
  // The reported failure, at the level it actually happened: a forge holder
  // and a foreign one in the same release, the script run from a lane
  // worktree while the forge holder serves the primary checkout. Before the
  // fix the forge holder was killed and the foreign one then aborted the run,
  // leaving the lock half released.
  const ui = uiDecoy(PRIMARY);
  const stranger = strangerDecoy();
  const r = run(LANE, [[ui, stranger]]);
  assert.equal(r.status, 3, r.out);
  assert.match(r.out, /REFUSING to signal/);
  assert.match(r.out, /nothing was signalled/);
  assert.ok(alive(ui), 'the forge holder was signalled during a refusal — the lock half released');
  assert.ok(alive(stranger), 'the foreign holder was signalled');
});

test('a refusal signals nothing whichever order the holders come in', () => {
  // Order is what made the original bug intermittent: the kill loop refused
  // when it reached the foreign holder, so everything ahead of it was already
  // dead. Verification now precedes every signal, so neither order kills.
  const stranger = strangerDecoy();
  const ui = uiDecoy(PRIMARY);
  const r = run(LANE, [[stranger, ui]]);
  assert.equal(r.status, 3, r.out);
  assert.ok(alive(ui), 'the forge holder was signalled during a refusal');
  assert.ok(alive(stranger), 'the foreign holder was signalled');
});

test('the holder list is snapshotted once, not re-enumerated before the kill', () => {
  // A PID that appears only AFTER the verify loop has run must never reach
  // the kill loop — it has been verified by nobody.
  const ui = uiDecoy(PRIMARY);
  const latecomer = strangerDecoy();
  const r = run(LANE, [[ui], [ui, latecomer], [ui]]);
  assert.equal(r.status, 0, r.out);
  assert.ok(waitGone(ui), 'the verified holder was not stopped');
  assert.ok(alive(latecomer), 'an unverified PID was signalled — the kill list was re-enumerated');
});

test('a lane worktree CAN release a Studio serving the primary checkout', () => {
  // The other half of the bead: from the lane, both holders of the primary
  // checkout's Studio are recognised, so the release completes instead of
  // stopping half way — and the lane records WHOSE Studio it took down.
  const bridge = bridgeDecoy(PRIMARY, join(SHIM_DIR, 'forge'));
  const ui = uiDecoy(PRIMARY);
  const r = run(LANE, [[bridge, ui]]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /released ports 4123\/4124 \(stopped 2 process\(es\)\)/);
  assert.ok(waitGone(bridge), 'the bridge survived a release');
  assert.ok(waitGone(ui), 'the next-server survived a release');
  assert.equal(readFileSync(join(LANE, '_logs/studio-host-lock.stopped-roots'), 'utf8').trim(), PRIMARY);
});

test('stopping already-free ports reports it and exits 0', () => {
  // port_holders ends in a grep that exits non-zero when nothing holds the
  // ports. Under `set -e` that status killed `stop` silently — the ordinary
  // pre-gate state producing an unexplained exit 1.
  const r = run(LANE, [[]]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /released ports 4123\/4124 \(stopped 0 process\(es\)\)/);
});

test('a cycle in flight in OUR checkout refuses the release', () => {
  const inflight = join(LANE, '_queue/in-flight');
  mkdirSync(inflight, { recursive: true });
  writeFileSync(join(inflight, 'INIT-1.md'), '# in flight\n');
  try {
    const ui = uiDecoy(PRIMARY);
    const r = run(LANE, [[ui]]);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, /cycle\(s\) in flight/);
    assert.ok(alive(ui), 'a holder was signalled despite the in-flight refusal');
  } finally {
    rmSync(join(LANE, '_queue'), { recursive: true, force: true });
  }
});

test('a cycle in flight in the STOPPED checkout refuses the release too', () => {
  // The guard has to reach as far as the kill does. It used to read only
  // $FORGE_ROOT/_queue/in-flight, so a lane with an empty queue would stop a
  // Studio mid-cycle that the cycle's own checkout would have refused to stop.
  const inflight = join(PRIMARY, '_queue/in-flight');
  mkdirSync(inflight, { recursive: true });
  writeFileSync(join(inflight, 'INIT-1.md'), '# in flight\n');
  try {
    const bridge = bridgeDecoy(PRIMARY);
    const ui = uiDecoy(PRIMARY);
    const r = run(LANE, [[bridge, ui]]);
    assert.equal(r.status, 2, r.out);
    assert.match(r.out, new RegExp(`in flight in ${PRIMARY}`));
    assert.ok(alive(bridge) && alive(ui), 'a holder was signalled despite the in-flight refusal');
  } finally {
    rmSync(join(PRIMARY, '_queue'), { recursive: true, force: true });
  }
});

test('start restores the checkout that was stopped, not the caller"s', () => {
  // `stop` can now take down another checkout's Studio, so an unconditional
  // `start` here would quietly relocate Studio into the lane's tree — a
  // different build under the same URL, with nothing said about it.
  const record = join(LANE, '_logs/studio-host-lock.stopped-roots');
  mkdirSync(dirname(record), { recursive: true });
  writeFileSync(record, `${PRIMARY}\n`);
  assert.equal(run(LANE, [[]], 'start_root').out.trim(), PRIMARY);
  // nothing stopped: our own checkout
  rmSync(record);
  assert.equal(run(LANE, [[]], 'start_root').out.trim(), LANE);
  // two checkouts stopped at once is ambiguous, and guessing is worse than saying so
  writeFileSync(record, `${PRIMARY}\n${LANE}\n`);
  assert.equal(run(LANE, [[]], 'start_root').status, 1);
  rmSync(record);
});
