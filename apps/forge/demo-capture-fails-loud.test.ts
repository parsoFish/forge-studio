/**
 * bead forge-8vfn.17, defects 2 and 3 of 3 — the G1 gate failure of 2026-09-04.
 *
 * `forge demo capture` wrapped its whole capture in a try/catch that logged and
 * `return`ed. The process therefore EXITED 0 with `demo.json` unstamped, and the
 * orchestrator — which reads the exit code to decide whether the capture ran —
 * saw success. `demo-agent.ts` then read the missing nonce and reported
 * "stale, replayed, or hand-written": a crashed capture reported as a success and
 * then accused of forgery, with the line naming the real cause dropped on the
 * success branch.
 *
 * A failure-behaviour claim cannot be established by reading — only execution
 * says what the caller does with the throw — so this test RUNS the CLI and reads
 * the exit code and the file. It is deliberately in `apps/forge/`, where the
 * control flow lives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const CLI = resolve(import.meta.dirname, 'cli.ts');

function runCapture(demoDir: string, env: Record<string, string> = {}): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath,
    ['--experimental-strip-types', CLI, 'demo', 'capture', 'INIT-2026-09-05-forgery-probe', '--dir', demoDir],
    { encoding: 'utf8', env: { ...process.env, ...env }, cwd: demoDir });
  return { status: r.status, stderr: (r.stderr ?? '') + (r.stdout ?? '') };
}

/** A demo.json whose checkpoint carries the exact shape that broke the live run. */
function seedDemoDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-demo-capture-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'demo.json'), JSON.stringify({
    title: 'probe', essence: 'e', project: 'gitpulse', diffStat: '',
    checkpoints: [{ label: 'forge studio/home', caption: 'c', command: 'echo hi' }],
  }, null, 2));
  return dir;
}

test('AT-1: a capture that cannot run EXITS NON-ZERO instead of reporting success', () => {
  const dir = seedDemoDir();
  try {
    // cwd is a bare temp dir: not a git repo, so materialising the before/after
    // worktrees must fail. This is the live G1 shape minus the model spend.
    const { status, stderr } = runCapture(dir);
    assert.notEqual(status, 0,
      `capture failed but exited ${status} — the orchestrator reads this code to decide whether the capture ran`);
    assert.match(stderr, /capture/i, 'the failure must name itself on the way out');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AT-2: a failed capture leaves demo.json UNSTAMPED — a nonce is proof the capture happened', () => {
  const dir = seedDemoDir();
  try {
    runCapture(dir, { FORGE_CAPTURE_NONCE: 'nonce-that-must-not-be-written' });
    const after = JSON.parse(readFileSync(join(dir, 'demo.json'), 'utf8')) as { capture?: { nonce?: string } };
    assert.equal(after.capture?.nonce, undefined,
      'stamping after a failed capture would make the evidence claim a run that did not happen');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('AT-3: the cause reaches stderr — the line naming it must not be dropped on the way out', () => {
  const dir = seedDemoDir();
  try {
    const { stderr } = runCapture(dir);
    assert.ok(stderr.trim().length > 0, 'a failing capture that prints nothing is indistinguishable from one that did not run');
    assert.doesNotMatch(stderr, /left notes-only/,
      'the old best-effort wording described a success path; a hard failure must not claim it degraded gracefully');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
