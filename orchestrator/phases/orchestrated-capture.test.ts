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
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildDemoCaptureArgv,
  commitOrchestratedCaptureArtifacts,
  demoJsonWantsCapture,
  resolveDemoCaptureTimeoutMs,
  runOrchestratorCommand,
} from './orchestrated-capture.ts';

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
    assert.equal(commitOrchestratedCaptureArtifacts(wt, demoRel, 'INIT-x'), false);

    // The capture back-filled demo.json + derived DEMO.md → commit + push.
    writeFileSync(join(wt, demoRel, 'demo.json'), '{"a":2}');
    writeFileSync(join(wt, demoRel, 'DEMO.md'), '# demo');
    assert.equal(commitOrchestratedCaptureArtifacts(wt, demoRel, 'INIT-x'), true);
    const head = git(wt, 'log', '--oneline', '-1');
    assert.match(head, /orchestrated demo capture \(INIT-x\)/);
    // Pushed: origin HEAD matches local HEAD.
    const localSha = git(wt, 'rev-parse', 'HEAD').trim();
    const remoteSha = git(origin, 'rev-parse', 'main').trim();
    assert.equal(remoteSha, localSha);
  } finally {
    rmSync(root, { recursive: true, force: true });
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
