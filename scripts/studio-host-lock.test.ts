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
 * Two properties are under test, and they are the two that matter:
 *
 *   1. A REFUSAL SIGNALS NOTHING. `cmd_stop` verifies every holder before it
 *      signals any, so one foreign holder can never cost you the other half
 *      of the lock. Driven here over decoy processes this test spawns itself.
 *   2. THE IDENTITY CHECK IS NOT A WIDENING. A genuinely foreign process is
 *      still refused — from a stranger's directory, from a directory dressed
 *      up to look like forge, and from a real forge checkout's non-UI
 *      subdirectories.
 *
 * What is real here and what is not: the identity decision, the /proc reads
 * and `kill` are all the real thing, run against real processes. The ONLY
 * substitution is `port_holders` — the port→PID enumeration, which carries no
 * safety semantics — replaced by a fixed list of this test's own decoy PIDs.
 * Nothing in this file binds, probes or enumerates 4123/4124, so a live
 * `forge studio` on the host is never a participant.
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
const OUR_UI_NAME = packageName(join(ROOT, 'forge-ui'));

const NEXT_CMDLINE = 'next-server (v14.2.35) ';

/** Ask a copy of the script (rooted at `scriptRoot`) how it classifies evidence. */
function classify(cmdline: string, cwd: string, scriptRoot = ROOT): string {
  const script = join(scriptRoot, 'scripts/studio-host-lock.sh');
  try {
    return execFileSync(script, ['classify', cmdline, cwd], { encoding: 'utf8' }).trim();
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    const out = `${e.stdout ?? ''}`.trim();
    // exit 1 = FOREIGN (an answer); anything else is a broken harness, not a verdict.
    assert.equal(e.status, 1, `classify failed unexpectedly (exit ${e.status}): ${e.stderr ?? ''}${out}`);
    return out;
  }
}

const FIXTURES = mkdtempSync(join(tmpdir(), 'studio-host-lock-'));

/** Lay down the marker files that make a directory recognisably a forge checkout. */
function forgeCheckout(dir: string, names: { root?: string; ui?: string } = {}): string {
  mkdirSync(join(dir, 'orchestrator'), { recursive: true });
  mkdirSync(join(dir, 'forge-ui'), { recursive: true });
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'orchestrator/cli.ts'), '// fixture\n');
  writeFileSync(join(dir, 'bin/forge.mjs'), '// fixture\n');
  writeFileSync(join(dir, 'forge-ui/package.json'), JSON.stringify({ name: names.ui ?? OUR_UI_NAME }));
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
// resolves back into a checkout's bin/forge.mjs. This is the shape the LIVE
// bridge actually runs as.
const SHIM_DIR = join(FIXTURES, 'npx-cache/node_modules/.bin');
mkdirSync(SHIM_DIR, { recursive: true });
symlinkSync(join(PRIMARY, 'bin/forge.mjs'), join(SHIM_DIR, 'forge'));

// ---------------------------------------------------------------------------
// the identity decision
// ---------------------------------------------------------------------------

test('the live Studio in a sibling checkout is forge — the reported failure', () => {
  // Reported direction: the script runs from the LANE, the next-server lives in
  // the primary checkout. This is what printed "REFUSING to signal ... not a
  // forge process: next-server" while the bridge had already been stopped.
  assert.equal(classify(NEXT_CMDLINE, join(PRIMARY, 'forge-ui'), LANE), 'forge');
});

test('a next-server in a sibling worktree is forge, seen from the primary checkout', () => {
  assert.equal(classify(NEXT_CMDLINE, join(LANE, 'forge-ui')), 'forge');
});

test("this checkout's own next-server is still forge, at the UI dir or the root", () => {
  assert.equal(classify(NEXT_CMDLINE, join(ROOT, 'forge-ui')), 'forge');
  assert.equal(classify('next start -p 4124 ', ROOT), 'forge');
});

test('the bridge is forge however it was launched, in any checkout', () => {
  // relative argv, resolved against the process's own cwd
  assert.equal(classify('node --experimental-strip-types orchestrator/cli.ts studio ', PRIMARY, LANE), 'forge');
  // absolute argv
  assert.equal(classify(`node ${join(PRIMARY, 'bin/forge.mjs')} studio --dev `, PRIMARY, LANE), 'forge');
  // the npx/npm-link shim — a symlink into the checkout's bin/forge.mjs, and
  // the shape the live bridge runs as. The cmdline-substring test this
  // replaced called it FOREIGN.
  assert.equal(classify(`node --experimental-strip-types ${join(SHIM_DIR, 'forge')} studio `, PRIMARY, LANE), 'forge');
});

test('a bridge-shaped command line with no forge checkout behind it is REFUSED', () => {
  const stranger = join(FIXTURES, 'not-forge');
  mkdirSync(join(stranger, 'bin'), { recursive: true });
  writeFileSync(join(stranger, 'bin/forge.mjs'), '// impostor\n');
  writeFileSync(join(stranger, 'package.json'), JSON.stringify({ name: OUR_ROOT_NAME }));
  // right name, right file, no checkout behind it
  assert.equal(classify(`node ${join(stranger, 'bin/forge.mjs')} studio `, stranger), 'FOREIGN');
  // a word that resolves to nothing at all
  assert.equal(classify('node /nowhere/bin/forge.mjs studio ', PRIMARY), 'FOREIGN');
  // forge's entrypoint, but not the studio subcommand
  assert.equal(classify(`node ${join(PRIMARY, 'bin/forge.mjs')} serve `, PRIMARY), 'FOREIGN');
  // an editor holding forge's files open, with `studio` in the argv but not as
  // the subcommand
  assert.equal(classify(`vim ${join(PRIMARY, 'orchestrator/cli.ts')} studio.md `, PRIMARY), 'FOREIGN');
  // "studio" alone proves nothing
  assert.equal(classify('some-other-cli studio ', PRIMARY), 'FOREIGN');
});

test('a relative bridge argv is resolved against the PROCESS cwd, never ours', () => {
  // The same command line the live bridge runs, but from a cwd that is not a
  // forge checkout: `orchestrator/cli.ts` resolves to nothing there, and the
  // script must not fall back on its own directory to find one.
  assert.equal(classify('node --experimental-strip-types orchestrator/cli.ts studio ', tmpdir()), 'FOREIGN');
});

test('an unrelated next-server is REFUSED', () => {
  const stranger = join(FIXTURES, 'someone-elses-app');
  mkdirSync(join(stranger, 'forge-ui'), { recursive: true });
  writeFileSync(join(stranger, 'package.json'), JSON.stringify({ name: 'someone-elses-app' }));
  assert.equal(classify(NEXT_CMDLINE, stranger), 'FOREIGN');
  // even when it happens to have a directory named forge-ui
  assert.equal(classify(NEXT_CMDLINE, join(stranger, 'forge-ui')), 'FOREIGN');
  // and even when it claims forge's package name without forge's files
  const impostor = join(FIXTURES, 'impostor');
  mkdirSync(impostor, { recursive: true });
  writeFileSync(join(impostor, 'package.json'), JSON.stringify({ name: OUR_ROOT_NAME }));
  assert.equal(classify(NEXT_CMDLINE, impostor), 'FOREIGN');
});

test('a checkout that gets any marker wrong is REFUSED', () => {
  // forge's whole layout, someone else's root package name
  const renamed = forgeCheckout(join(FIXTURES, 'renamed-fork'), { root: 'someone-elses-fork' });
  assert.equal(classify(NEXT_CMDLINE, join(renamed, 'forge-ui')), 'FOREIGN');
  // forge's layout and root name, a different UI workspace underneath
  const otherUi = forgeCheckout(join(FIXTURES, 'other-ui'), { ui: 'someone-elses-ui' });
  assert.equal(classify(NEXT_CMDLINE, join(otherUi, 'forge-ui')), 'FOREIGN');
  // forge's names, but no entrypoints on disk
  const shell = join(FIXTURES, 'names-only');
  mkdirSync(join(shell, 'forge-ui'), { recursive: true });
  writeFileSync(join(shell, 'package.json'), JSON.stringify({ name: OUR_ROOT_NAME }));
  writeFileSync(join(shell, 'forge-ui/package.json'), JSON.stringify({ name: OUR_UI_NAME }));
  assert.equal(classify(NEXT_CMDLINE, join(shell, 'forge-ui')), 'FOREIGN');
});

test('a next-server in a non-UI subdirectory of a forge checkout is REFUSED', () => {
  // only the checkout root and its forge-ui/ workspace are Studio's own cwds
  assert.equal(classify(NEXT_CMDLINE, join(ROOT, 'scripts')), 'FOREIGN');
  assert.equal(classify(NEXT_CMDLINE, join(ROOT, 'orchestrator')), 'FOREIGN');
  // a managed project nested inside the checkout, with its own forge-ui, is
  // still someone else's app
  const nested = join(PRIMARY, 'projects/some-app/forge-ui');
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(PRIMARY, 'projects/some-app/package.json'), JSON.stringify({ name: 'some-app' }));
  assert.equal(classify(NEXT_CMDLINE, nested), 'FOREIGN');
});

test('a non-forge command line is REFUSED wherever it runs', () => {
  assert.equal(classify('python3 -m http.server 4124 ', join(ROOT, 'forge-ui')), 'FOREIGN');
  assert.equal(classify('', join(ROOT, 'forge-ui')), 'FOREIGN');
});

test('a missing or unreadable cwd is REFUSED, never assumed', () => {
  assert.equal(classify(NEXT_CMDLINE, join(FIXTURES, 'does-not-exist')), 'FOREIGN');
  assert.equal(classify(NEXT_CMDLINE, ''), 'FOREIGN');
});

// ---------------------------------------------------------------------------
// all-or-nothing release, over decoy processes
// ---------------------------------------------------------------------------

// A process that does nothing but stay alive. Its command line and its cwd
// are the evidence under test — that is all `is_forge_process` ever reads of
// a process, so a sleeper wearing the evidence is the honest stand-in.
const SLEEPER = join(FIXTURES, 'sleeper.mjs');
writeFileSync(SLEEPER, 'setTimeout(() => {}, 10 * 60 * 1000);\n');

// The harness sources the script under test and replaces ONLY port_holders —
// the port→PID enumeration — with a fixed list. The identity decision, the
// /proc reads and `kill` all stay real. It never touches a port.
const HARNESS = join(FIXTURES, 'stop-harness.sh');
writeFileSync(
  HARNESS,
  [
    '#!/usr/bin/env bash',
    '# written by scripts/studio-host-lock.test.ts; not shipped',
    'set -euo pipefail',
    'source "$1"; shift',
    'HOLDERS=("$@")',
    'port_holders() {',
    '  local p',
    '  for p in ${HOLDERS[@]+"${HOLDERS[@]}"}; do',
    '    if [ -n "$(tr -d "\\000" < "/proc/$p/cmdline" 2>/dev/null || true)" ]; then echo "$p"; fi',
    '  done',
    '  return 0',
    '}',
    'cmd_stop',
    '',
  ].join('\n'),
);

const decoys: ChildProcess[] = [];
after(() => {
  for (const d of decoys) { try { d.kill('SIGKILL'); } catch { /* already gone */ } }
  rmSync(FIXTURES, { recursive: true, force: true });
});

/** Spawn a decoy carrying the given evidence; returns its pid. */
function decoy(args: string[], cwd: string, argv0?: string): number {
  const child = argv0 === undefined
    ? spawn(process.execPath, [SLEEPER, ...args], { cwd, stdio: 'ignore' })
    : spawn('bash', ['-c', 'exec -a "$1" "$2" "$3"', '_', argv0, process.execPath, SLEEPER], { cwd, stdio: 'ignore' });
  decoys.push(child);
  assert.ok(child.pid, 'decoy failed to spawn');
  return child.pid as number;
}

/** True while the pid names a live (non-reaped, non-zombie) process. */
function alive(pid: number): boolean {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, '').length > 0;
  } catch {
    return false;
  }
}

function runStop(scriptRoot: string, pids: number[]): { status: number; out: string } {
  const r = spawnSync('bash', [HARNESS, join(scriptRoot, 'scripts/studio-host-lock.sh'), ...pids.map(String)], {
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
  const forgeUi = decoy([], join(PRIMARY, 'forge-ui'), 'next-server (v14.2.35)');
  const stranger = decoy([], tmpdir());
  const r = runStop(LANE, [forgeUi, stranger]);
  assert.equal(r.status, 3, r.out);
  assert.match(r.out, /REFUSING to signal/);
  assert.match(r.out, /nothing was signalled/);
  assert.ok(alive(forgeUi), 'the forge holder was signalled during a refusal — the lock half released');
  assert.ok(alive(stranger), 'the foreign holder was signalled');
});

test('a refusal signals nothing whichever order the holders come in', () => {
  // Order is what made the original bug intermittent: the kill loop refused
  // when it reached the foreign holder, so everything ahead of it was already
  // dead. Verification now precedes every signal, so neither order kills.
  const stranger = decoy([], tmpdir());
  const forgeUi = decoy([], join(PRIMARY, 'forge-ui'), 'next-server (v14.2.35)');
  const r = runStop(LANE, [stranger, forgeUi]);
  assert.equal(r.status, 3, r.out);
  assert.ok(alive(forgeUi), 'the forge holder was signalled during a refusal');
  assert.ok(alive(stranger), 'the foreign holder was signalled');
});

test('a lane worktree CAN release a Studio serving the primary checkout', () => {
  // The other half of the bead: from the lane, both holders of the primary
  // checkout's Studio are recognised, so the release completes instead of
  // stopping half way.
  const bridge = decoy([join(SHIM_DIR, 'forge'), 'studio'], PRIMARY);
  const ui = decoy([], join(PRIMARY, 'forge-ui'), 'next-server (v14.2.35)');
  const r = runStop(LANE, [bridge, ui]);
  assert.equal(r.status, 0, r.out);
  assert.match(r.out, /released ports 4123\/4124 \(stopped 2 process\(es\)\)/);
  assert.ok(waitGone(bridge), 'the bridge survived a release');
  assert.ok(waitGone(ui), 'the next-server survived a release');
});
