/**
 * Unit tests for the orchestrator-owned capture primitives (ADR 036 / N1):
 * child-process semantics against fake scripts (pass / fail / timeout /
 * output capture), the demo.json capture-trigger predicate, and the
 * commit-what-forge-produced step. Integration with the composed unifier gate
 * is covered in developer-loop.gate-events.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildDemoCaptureArgv,
  CAPTURE_NONCE_ENV,
  commitOrchestratedCaptureArtifacts,
  demoJsonWantsCapture,
  generateCaptureNonce,
  MAX_COMMITTED_DEMO_MEDIA_BYTES,
  MAX_COMMITTED_DEMO_WEBM_BYTES,
  preflightDemoCaptureCommands,
  resolveDemoCaptureTimeoutMs,
  runOrchestratorCommand,
} from '../../phases/orchestrated-capture.ts';

// ---------------------------------------------------------------------------
// runOrchestratorCommand — fake scripts in temp dirs
// ---------------------------------------------------------------------------

test('runOrchestratorCommand: passing script → ok, exit 0, stdout captured', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-'));
  try {
    const r = runOrchestratorCommand(['bash', '-c', 'echo captured-line'], { cwd: dir, timeoutMs: 10_000 });
    assert.equal(r.ok, true);
    assert.equal(r.exitCode, 0);
    assert.equal(r.timedOut, false);
    assert.equal(r.errored, false);
    assert.match(r.stdoutTail, /captured-line/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runOrchestratorCommand: failing script → not ok, real exit code, stderr captured', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-'));
  try {
    const r = runOrchestratorCommand(['bash', '-c', 'echo boom >&2; exit 3'], { cwd: dir, timeoutMs: 10_000 });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 3);
    assert.equal(r.timedOut, false);
    assert.equal(r.errored, false);
    assert.match(r.stderrTail, /boom/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runOrchestratorCommand: timeout → timedOut true, synthetic -6, not errored (environment class)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-'));
  try {
    const r = runOrchestratorCommand(['sleep', '30'], { cwd: dir, timeoutMs: 300 });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
    assert.equal(r.errored, false, 'timeout is NOT the unrunnable class');
    assert.equal(r.exitCode, -6);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runOrchestratorCommand: missing binary → errored (unrunnable), not timedOut', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-'));
  try {
    const r = runOrchestratorCommand(['definitely-not-a-binary-xyz-42'], { cwd: dir, timeoutMs: 10_000 });
    assert.equal(r.ok, false);
    assert.equal(r.errored, true);
    assert.equal(r.timedOut, false);
    assert.equal(r.exitCode, -4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runOrchestratorCommand: child runs with cwd = the given worktree', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-'));
  try {
    const r = runOrchestratorCommand(['bash', '-c', 'pwd'], { cwd: dir, timeoutMs: 10_000 });
    assert.equal(r.ok, true);
    // realpath both sides (tmpdir may be a symlink on some systems).
    const expected = execFileSync('bash', ['-c', 'pwd'], { cwd: dir, encoding: 'utf8' }).trim();
    assert.equal(r.stdoutTail.trim(), expected);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// demoJsonWantsCapture
// ---------------------------------------------------------------------------

function writeDemo(dir: string, checkpoints: unknown[]): string {
  const p = join(dir, 'demo.json');
  writeFileSync(p, JSON.stringify({ title: 't', essence: 'e', project: 'p', diffStat: 'd', checkpoints }));
  return p;
}

test('demoJsonWantsCapture: command checkpoint → true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-'));
  try {
    const p = writeDemo(dir, [{ label: 'x', command: 'echo hi' }]);
    assert.equal(demoJsonWantsCapture(p), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demoJsonWantsCapture: screenshot/video kinds → true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-'));
  try {
    assert.equal(demoJsonWantsCapture(writeDemo(dir, [{ label: 'x', kind: 'screenshot' }])), true);
    assert.equal(demoJsonWantsCapture(writeDemo(dir, [{ label: 'x', kind: 'video' }])), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demoJsonWantsCapture: notes-only demo → false (trivial tier skips capture)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-'));
  try {
    const p = writeDemo(dir, [{ label: 'x', beforeNote: 'a', afterNote: 'b' }]);
    assert.equal(demoJsonWantsCapture(p), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demoJsonWantsCapture: missing or invalid demo.json → false', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-'));
  try {
    assert.equal(demoJsonWantsCapture(join(dir, 'nope.json')), false);
    const bad = join(dir, 'demo.json');
    writeFileSync(bad, '{not json');
    assert.equal(demoJsonWantsCapture(bad), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// commitOrchestratedCaptureArtifacts — temp git repo with a bare origin
// ---------------------------------------------------------------------------

test('commitOrchestratedCaptureArtifacts: commits + pushes changed demo artifacts; no-op when unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-oc-git-'));
  try {
    const origin = join(root, 'origin.git');
    const wt = join(root, 'wt');
    const git = (cwd: string, ...args: string[]): string =>
      execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
    execFileSync('git', ['init', '--bare', origin], { stdio: 'pipe' });
    execFileSync('git', ['init', '-b', 'main', wt], { stdio: 'pipe' });
    git(wt, 'config', 'user.email', 't@t');
    git(wt, 'config', 'user.name', 't');
    git(wt, 'remote', 'add', 'origin', origin);
    const demoRel = join('demo', 'INIT-x');
    mkdirSync(join(wt, demoRel), { recursive: true });
    writeFileSync(join(wt, demoRel, 'demo.json'), '{"a":1}');
    git(wt, 'add', '-A');
    git(wt, 'commit', '-m', 'seed');
    git(wt, 'push', 'origin', 'main');

    // Nothing changed yet → no commit.
    assert.deepEqual(commitOrchestratedCaptureArtifacts(wt, demoRel, 'INIT-x'), { committed: false, skippedMedia: [] });

    // The capture back-filled demo.json + derived DEMO.md → commit + push.
    writeFileSync(join(wt, demoRel, 'demo.json'), '{"a":2}');
    writeFileSync(join(wt, demoRel, 'DEMO.md'), '# demo');
    const result = commitOrchestratedCaptureArtifacts(wt, demoRel, 'INIT-x');
    assert.equal(result.committed, true);
    assert.deepEqual(result.skippedMedia, []);
    const head = git(wt, 'log', '--oneline', '-1');
    assert.match(head, /orchestrated demo capture \(INIT-x\)/);
    // Pushed: origin HEAD matches local HEAD.
    const localSha = git(wt, 'rev-parse', 'HEAD').trim();
    const remoteSha = git(origin, 'rev-parse', 'main').trim();
    assert.equal(remoteSha, localSha);

    // G8 wave 2 (2026-07-12): orchestrator-issued commit → forge-orchestrator
    // identity via -c flags, not the `t@t`/`t` local identity configured
    // above (deliberately distinct, so this proves the override).
    assert.equal(git(wt, 'log', '-1', '--pretty=%an').trim(), 'forge-orchestrator');
    assert.equal(git(wt, 'log', '-1', '--pretty=%ae').trim(), 'forge-orchestrator@forge.local');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// commitOrchestratedCaptureArtifacts — `.capture/{before,after}` media
// (forge-mfv5.2.5): the WebM "magic" 4 bytes (EBML header) stand in for
// a real recording so the fixture reads as media, not an arbitrary blob.
// ---------------------------------------------------------------------------

const WEBM_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

/** A bare (no bare-origin push needed) git repo with a demo dir seeded with
 *  `demo.json`, ready for `.capture/<side>/` fixtures to be added by the
 *  caller before invoking `commitOrchestratedCaptureArtifacts`. */
function makeCaptureRepo(): { root: string; wt: string; demoRel: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'forge-oc-media-'));
  const origin = join(root, 'origin.git');
  const wt = join(root, 'wt');
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: wt, stdio: 'pipe', encoding: 'utf8' });
  execFileSync('git', ['init', '--bare', origin], { stdio: 'pipe' });
  execFileSync('git', ['init', '-b', 'main', wt], { stdio: 'pipe' });
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  git('remote', 'add', 'origin', origin);
  const demoRel = join('demo', 'INIT-media');
  mkdirSync(join(wt, demoRel), { recursive: true });
  writeFileSync(join(wt, demoRel, 'demo.json'), '{"a":1}');
  git('add', '-A');
  git('commit', '-m', 'seed');
  git('push', 'origin', 'main');
  return { root, wt, demoRel, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function trackedFiles(wt: string): string[] {
  return execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: wt, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

test('commitOrchestratedCaptureArtifacts: a small webm under the bound is committed', () => {
  const { wt, demoRel, cleanup } = makeCaptureRepo();
  try {
    const sideDir = join(wt, demoRel, '.capture', 'after');
    mkdirSync(sideDir, { recursive: true });
    writeFileSync(join(sideDir, 'checkpoint-1.webm'), WEBM_MAGIC);
    const result = commitOrchestratedCaptureArtifacts(wt, demoRel, 'INIT-media');
    assert.equal(result.committed, true);
    assert.deepEqual(result.skippedMedia, []);
    assert.ok(
      trackedFiles(wt).includes(join(demoRel, '.capture', 'after', 'checkpoint-1.webm')),
      'small webm should be tracked',
    );
  } finally {
    cleanup();
  }
});

test('commitOrchestratedCaptureArtifacts: an oversize webm is NOT committed, and is reported', () => {
  const { wt, demoRel, cleanup } = makeCaptureRepo();
  try {
    const sideDir = join(wt, demoRel, '.capture', 'after');
    mkdirSync(sideDir, { recursive: true });
    const oversize = Buffer.concat([WEBM_MAGIC, Buffer.alloc(MAX_COMMITTED_DEMO_WEBM_BYTES + 1)]);
    writeFileSync(join(sideDir, 'checkpoint-1.webm'), oversize);
    const result = commitOrchestratedCaptureArtifacts(wt, demoRel, 'INIT-media');
    // demo.json is unchanged from the seed commit and the oversize webm is
    // refused, so nothing new is staged — committed stays false.
    assert.equal(result.committed, false);
    assert.equal(result.skippedMedia.length, 1);
    assert.equal(result.skippedMedia[0]!.relPath, join(demoRel, '.capture', 'after', 'checkpoint-1.webm'));
    assert.match(result.skippedMedia[0]!.reason, /byte bound/);
    assert.ok(
      !trackedFiles(wt).includes(join(demoRel, '.capture', 'after', 'checkpoint-1.webm')),
      'oversize webm must not be tracked',
    );
  } finally {
    cleanup();
  }
});

test('commitOrchestratedCaptureArtifacts: an oversize filmstrip.png IS committed (no bound, orchestrator ruling)', () => {
  const { wt, demoRel, cleanup } = makeCaptureRepo();
  try {
    const sideDir = join(wt, demoRel, '.capture', 'after');
    mkdirSync(sideDir, { recursive: true });
    // Larger than the webm bound AND the regular-media bound — still committed.
    const oversize = Buffer.alloc(MAX_COMMITTED_DEMO_MEDIA_BYTES + 1, 0xff);
    writeFileSync(join(sideDir, 'checkpoint-1.filmstrip.png'), oversize);
    const result = commitOrchestratedCaptureArtifacts(wt, demoRel, 'INIT-media');
    assert.equal(result.committed, true);
    assert.deepEqual(result.skippedMedia, []);
    assert.ok(
      trackedFiles(wt).includes(join(demoRel, '.capture', 'after', 'checkpoint-1.filmstrip.png')),
      'oversize filmstrip must still be tracked',
    );
  } finally {
    cleanup();
  }
});

test('commitOrchestratedCaptureArtifacts: an oversize plain .png (non-filmstrip) is skipped', () => {
  const { wt, demoRel, cleanup } = makeCaptureRepo();
  try {
    const sideDir = join(wt, demoRel, '.capture', 'before');
    mkdirSync(sideDir, { recursive: true });
    writeFileSync(join(sideDir, 'checkpoint-1.png'), Buffer.alloc(MAX_COMMITTED_DEMO_MEDIA_BYTES + 1));
    const result = commitOrchestratedCaptureArtifacts(wt, demoRel, 'INIT-media');
    assert.equal(result.committed, false);
    assert.equal(result.skippedMedia.length, 1);
    assert.match(result.skippedMedia[0]!.reason, /byte bound/);
  } finally {
    cleanup();
  }
});

test('commitOrchestratedCaptureArtifacts: an oversize .out is skipped', () => {
  const { wt, demoRel, cleanup } = makeCaptureRepo();
  try {
    const sideDir = join(wt, demoRel, '.capture', 'after');
    mkdirSync(sideDir, { recursive: true });
    writeFileSync(join(sideDir, 'checkpoint-1.out'), Buffer.alloc(MAX_COMMITTED_DEMO_MEDIA_BYTES + 1));
    const result = commitOrchestratedCaptureArtifacts(wt, demoRel, 'INIT-media');
    assert.equal(result.committed, false);
    assert.equal(result.skippedMedia.length, 1);
    assert.match(result.skippedMedia[0]!.reason, /byte bound/);
  } finally {
    cleanup();
  }
});

test('commitOrchestratedCaptureArtifacts: a symlink under .capture is refused, not staged', () => {
  const { root, wt, demoRel, cleanup } = makeCaptureRepo();
  try {
    const sideDir = join(wt, demoRel, '.capture', 'after');
    mkdirSync(sideDir, { recursive: true });
    // Points OUTSIDE the demo dir entirely — the escape shape the guard exists for.
    const outside = join(root, 'outside-secret.webm');
    writeFileSync(outside, WEBM_MAGIC);
    symlinkSync(outside, join(sideDir, 'checkpoint-1.webm'));
    const result = commitOrchestratedCaptureArtifacts(wt, demoRel, 'INIT-media');
    assert.equal(result.committed, false);
    assert.equal(result.skippedMedia.length, 1);
    assert.equal(result.skippedMedia[0]!.relPath, join(demoRel, '.capture', 'after', 'checkpoint-1.webm'));
    assert.match(result.skippedMedia[0]!.reason, /refused/);
    assert.ok(
      !trackedFiles(wt).includes(join(demoRel, '.capture', 'after', 'checkpoint-1.webm')),
      'symlinked media must never be tracked',
    );
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// argv + timeout resolution
// ---------------------------------------------------------------------------

test('buildDemoCaptureArgv: node + forge bin + demo capture <id>', () => {
  const argv = buildDemoCaptureArgv('INIT-42');
  assert.equal(argv[0], process.execPath);
  assert.match(argv[1]!, /bin[\\/]forge\.mjs$/);
  assert.deepEqual(argv.slice(2), ['demo', 'capture', 'INIT-42']);
});

test('resolveDemoCaptureTimeoutMs: default 15 min, env override', () => {
  const prev = process.env.FORGE_DEMO_CAPTURE_TIMEOUT_MS;
  try {
    delete process.env.FORGE_DEMO_CAPTURE_TIMEOUT_MS;
    assert.equal(resolveDemoCaptureTimeoutMs(), 15 * 60_000);
    process.env.FORGE_DEMO_CAPTURE_TIMEOUT_MS = '60000';
    assert.equal(resolveDemoCaptureTimeoutMs(), 60_000);
  } finally {
    if (prev === undefined) delete process.env.FORGE_DEMO_CAPTURE_TIMEOUT_MS;
    else process.env.FORGE_DEMO_CAPTURE_TIMEOUT_MS = prev;
  }
});

// ---------------------------------------------------------------------------
// N2 (plan item 2.6) — nonce + producibility in the demo contract.
// ---------------------------------------------------------------------------

test('N2: runOrchestratorCommand passes the caller env to the child (the nonce seam)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-env-'));
  try {
    const r = runOrchestratorCommand(
      ['bash', '-c', `printf '%s' "$${CAPTURE_NONCE_ENV}" > nonce-seen.txt`],
      { cwd: dir, timeoutMs: 10_000, env: { ...process.env, [CAPTURE_NONCE_ENV]: 'nonce-abc123' } },
    );
    assert.equal(r.ok, true);
    const seen = readFileSync(join(dir, 'nonce-seen.txt'), 'utf8');
    assert.equal(seen, 'nonce-abc123', 'the capture child must see the per-run nonce in its environment');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N2: generateCaptureNonce produces distinct non-empty nonces per run', () => {
  const a = generateCaptureNonce();
  const b = generateCaptureNonce();
  assert.ok(a.length >= 16, 'nonce must be non-trivially long');
  assert.notEqual(a, b, 'each run gets its own nonce');
});

function writeDemoJson(dir: string, checkpoints: Array<Record<string, unknown>>): string {
  const p = join(dir, 'demo.json');
  writeFileSync(p, JSON.stringify({ title: 't', essence: 'e', project: 'p', diffStat: 'd', checkpoints }));
  return p;
}

test('N2 producibility: PATH-resolvable command checkpoint → ok', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-prod-'));
  try {
    const demoJson = writeDemoJson(dir, [{ label: 'cli', caption: 'c', command: 'echo hello' }]);
    const r = preflightDemoCaptureCommands(demoJson, dir);
    assert.equal(r.ok, true);
    assert.deepEqual(r.problems, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N2 producibility: missing binary → problem naming the checkpoint and the binary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-prod-'));
  try {
    const demoJson = writeDemoJson(dir, [{ label: 'cli', caption: 'c', command: 'definitely-not-a-binary-xyz-42 --flag' }]);
    const r = preflightDemoCaptureCommands(demoJson, dir);
    assert.equal(r.ok, false);
    assert.equal(r.problems.length, 1);
    assert.match(r.problems[0]!, /cli/);
    assert.match(r.problems[0]!, /definitely-not-a-binary-xyz-42/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N2 producibility: `npm run <script>` requires the script to be defined in the worktree package.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-prod-'));
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { demo: 'echo demo' } }));
    const okJson = writeDemoJson(dir, [{ label: 'defined', caption: 'c', command: 'npm run demo' }]);
    assert.equal(preflightDemoCaptureCommands(okJson, dir).ok, true);

    const badJson = writeDemoJson(dir, [{ label: 'undefined-script', caption: 'c', command: 'npm run nope' }]);
    const r = preflightDemoCaptureCommands(badJson, dir);
    assert.equal(r.ok, false);
    assert.match(r.problems[0]!, /nope/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N2 producibility: worktree-relative script path must exist and be executable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-prod-'));
  try {
    writeFileSync(join(dir, 'tool.sh'), '#!/bin/bash\necho hi\n', { mode: 0o755 });
    const okJson = writeDemoJson(dir, [{ label: 'rel', caption: 'c', command: './tool.sh --version' }]);
    assert.equal(preflightDemoCaptureCommands(okJson, dir).ok, true);

    const badJson = writeDemoJson(dir, [{ label: 'rel-missing', caption: 'c', command: './missing.sh' }]);
    const r = preflightDemoCaptureCommands(badJson, dir);
    assert.equal(r.ok, false);
    assert.match(r.problems[0]!, /missing\.sh/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('N2 producibility: notes-only demo (no command checkpoints) and unreadable demo.json → ok (nothing to preflight)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-oc-prod-'));
  try {
    const notesOnly = writeDemoJson(dir, [{ label: 'notes', caption: 'c' }]);
    assert.equal(preflightDemoCaptureCommands(notesOnly, dir).ok, true);
    assert.equal(preflightDemoCaptureCommands(join(dir, 'nonexistent.json'), dir).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
