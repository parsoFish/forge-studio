/**
 * forge-pxef — scripts/studio-host-lock.sh half-released the host lock when
 * run from a lane worktree.
 *
 * The script's identity check accepted a `next-server` only when its cwd was
 * literally `$FORGE_ROOT/forge-ui`, and FORGE_ROOT comes from the script's OWN
 * location. Every campaign lane works in its own git worktree, so a lane
 * running the script saw the live Studio's next-server as FOREIGN: the bridge
 * (4123) was stopped, the UI (4124) was not, and the next harness run failed
 * on a still-held port looking like a harness bug.
 *
 * These tests drive the pure decision (`studio-host-lock.sh classify <cmdline>
 * <cwd>`) against fixtures on disk. Nothing here starts, finds or signals a
 * real process — that is the point of splitting the decision out.
 *
 * RUN: node --test --experimental-strip-types scripts/studio-host-lock.test.ts
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts/studio-host-lock.sh');

const BRIDGE_CMDLINE = 'node --experimental-strip-types orchestrator/cli.ts studio ';
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
after(() => rmSync(FIXTURES, { recursive: true, force: true }));

/** Lay down the marker files that make a directory recognisably a forge checkout. */
function forgeCheckout(dir: string, name = 'forge'): string {
  mkdirSync(join(dir, 'orchestrator'), { recursive: true });
  mkdirSync(join(dir, 'forge-ui'), { recursive: true });
  writeFileSync(join(dir, 'orchestrator/cli.ts'), '// fixture\n');
  writeFileSync(join(dir, 'forge-ui/package.json'), JSON.stringify({ name: 'forge-ui' }));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, private: true }, null, 2));
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
  assert.equal(classify('next start ', ROOT), 'forge');
});

test('the bridge signature still matches, on cmdline alone', () => {
  assert.equal(classify(BRIDGE_CMDLINE, join(ROOT, 'forge-ui')), 'forge');
  assert.equal(classify(BRIDGE_CMDLINE, '/nowhere-at-all'), 'forge');
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
  writeFileSync(join(impostor, 'package.json'), JSON.stringify({ name: 'forge' }));
  assert.equal(classify(NEXT_CMDLINE, impostor), 'FOREIGN');
});

test('a next-server in a non-UI subdirectory of a forge checkout is REFUSED', () => {
  // only the checkout root and its forge-ui/ workspace are Studio's own cwds
  assert.equal(classify(NEXT_CMDLINE, join(ROOT, 'scripts')), 'FOREIGN');
  assert.equal(classify(NEXT_CMDLINE, join(ROOT, 'orchestrator')), 'FOREIGN');
});

test('a non-forge command line is REFUSED wherever it runs', () => {
  assert.equal(classify('vim orchestrator/cli.ts studio.md ', join(ROOT, 'forge-ui')), 'FOREIGN');
  assert.equal(classify('python3 -m http.server 4124 ', join(ROOT, 'forge-ui')), 'FOREIGN');
  assert.equal(classify('', join(ROOT, 'forge-ui')), 'FOREIGN');
});

test('a missing or unreadable cwd is REFUSED, never assumed', () => {
  assert.equal(classify(NEXT_CMDLINE, join(FIXTURES, 'does-not-exist')), 'FOREIGN');
  assert.equal(classify(NEXT_CMDLINE, ''), 'FOREIGN');
});
