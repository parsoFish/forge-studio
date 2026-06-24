/**
 * Tests for the demo-builder runner (Stage B). The write-enabled agent sits
 * behind an injectable `queryFn`; the stub writes DEMO.html as a side-effect to
 * simulate the real agent's file output. Each test uses a fresh tempdir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  runDemoBuilderTurn,
  demoSessionDir,
  demoBuilderAgentSpec,
  DEMO_BUILDER_MODEL,
  DEMO_HTML_REL_PATH,
  DEMO_LOCK_REL_PATH,
  type DemoBuilderStatus,
} from './demo-builder-runner.ts';
import { writeSessionStatus, readSessionStatus, type QueryFn } from './interactive-session.ts';
import { createLogger } from './logging.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..');

/** A queryFn that simulates the agent writing DEMO.html into its cwd (the repo). */
function makeWritingQueryFn(capture?: (prompt: string) => void): QueryFn {
  return ({ prompt, options }) => {
    capture?.(prompt);
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      const demoDir = join(cwd, '.forge', 'demo');
      mkdirSync(demoDir, { recursive: true });
      writeFileSync(join(demoDir, 'DEMO.html'), '<!DOCTYPE html><html><body>demo</body></html>');
      yield { type: 'result', total_cost_usd: 0.05 };
    }
    return gen();
  };
}

/** A queryFn that does NOT write DEMO.html (the agent failed to produce output). */
function makeNoopQueryFn(): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
}

function setup(overrides?: Partial<DemoBuilderStatus>): {
  projectRoot: string;
  repoPath: string;
  logsRoot: string;
  sessionId: string;
  sessionDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'demo-runner-'));
  const projectRoot = join(root, 'project');
  const repoPath = join(root, 'repo');
  mkdirSync(join(repoPath, '.forge'), { recursive: true });
  writeFileSync(
    join(repoPath, '.forge', 'project.json'),
    JSON.stringify({ quality_gate_cmd: ['npm', 'test'], demoProcess: [{ kind: 'capture', text: 'Run the CLI on a sample.' }, { kind: 'verify', text: 'Output matches the golden file.' }] }),
  );
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-06-24T11-00-00';
  const sessionDir = demoSessionDir(projectRoot, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const status: DemoBuilderStatus = {
    session_id: sessionId,
    project: 'demo',
    project_repo_path: repoPath,
    phase: 'generating',
    iteration: 1,
    prompt: 'Show the before/after of the headline command, dark and minimal.',
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  writeSessionStatus(sessionDir, status);
  return { projectRoot, repoPath, logsRoot, sessionId, sessionDir };
}

const logger = (logsRoot: string, sid: string) => createLogger(`_demo-${sid}`, logsRoot);

test('generating → agent produces DEMO.html → awaiting-review', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup();
  const result = await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(result.phase, 'awaiting-review');
  assert.ok(existsSync(join(repoPath, DEMO_HTML_REL_PATH)));
  assert.equal(result.demoPath, join(repoPath, DEMO_HTML_REL_PATH));
  assert.equal(readSessionStatus<DemoBuilderStatus>(sessionDir)?.phase, 'awaiting-review');
});

test('generating but no DEMO.html produced → throws a clear, recoverable error', async () => {
  const { projectRoot, logsRoot, sessionId } = setup();
  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    /without producing .*DEMO\.html/,
  );
});

test('generate prompt carries the demoProcess, look-and-feel, feedback, and the inlined base CSS', async () => {
  const { projectRoot, logsRoot, sessionId, sessionDir } = setup({ phase: 'generating' });
  writeFileSync(join(sessionDir, 'feedback.md'), 'Make the diff bigger and drop the footer.');
  let captured = '';
  await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeWritingQueryFn((p) => { captured = p; }), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.match(captured, /Output matches the golden file/, 'demoProcess steps injected');
  assert.match(captured, /dark and minimal/, 'look-and-feel guidance injected');
  assert.match(captured, /drop the footer/, 'feedback injected');
  assert.match(captured, /--bg: #0a0e14/, 'forge demo base CSS inlined into the prompt');
});

test('locking → writes demo.lock.json + status locked', async () => {
  const { projectRoot, repoPath, logsRoot, sessionId, sessionDir } = setup({ phase: 'locking', iteration: 3 });
  // A prior generate left DEMO.html in the repo.
  mkdirSync(join(repoPath, '.forge', 'demo'), { recursive: true });
  writeFileSync(join(repoPath, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>demo</body></html>');

  const result = await runDemoBuilderTurn({
    sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot,
  });
  assert.equal(result.phase, 'locked');
  const lockPath = join(repoPath, DEMO_LOCK_REL_PATH);
  assert.ok(existsSync(lockPath));
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  assert.equal(lock.iterations, 3);
  assert.equal(lock.demo_html, DEMO_HTML_REL_PATH);
  assert.equal(readSessionStatus<DemoBuilderStatus>(sessionDir)?.phase, 'locked');
});

test('locking with no DEMO.html in the repo → throws', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'locking' });
  await assert.rejects(
    () => runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot }),
    /cannot lock/,
  );
});

test('awaiting-review turn is a no-op (bridge owns the wait state)', async () => {
  const { projectRoot, logsRoot, sessionId } = setup({ phase: 'awaiting-review' });
  const result = await runDemoBuilderTurn({ sessionId, projectRoot, forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn(), logger: logger(logsRoot, sessionId), logsRoot });
  assert.equal(result.phase, 'awaiting-review');
  assert.equal(result.wrote.length, 0);
});

test('missing status.json throws a clear error', async () => {
  const root = mkdtempSync(join(tmpdir(), 'demo-runner-'));
  await assert.rejects(
    runDemoBuilderTurn({ sessionId: 'nope', projectRoot: join(root, 'p'), forgeRoot: FORGE_ROOT, queryFn: makeNoopQueryFn() }),
    /no status\.json/,
  );
});

test('ADR-024: demoBuilderAgentSpec derives phase (unifier), tier (sonnet), and write tools', () => {
  assert.equal(demoBuilderAgentSpec.phase, 'unifier');
  assert.equal(demoBuilderAgentSpec.tier, 'sonnet');
  assert.equal(DEMO_BUILDER_MODEL, 'claude-sonnet-4-6');
  assert.ok(demoBuilderAgentSpec.allowedTools.includes('Write'), 'demo-builder writes the machinery + HTML');
  assert.ok(demoBuilderAgentSpec.allowedTools.includes('Bash'), 'demo-builder runs the project for real output');
});
