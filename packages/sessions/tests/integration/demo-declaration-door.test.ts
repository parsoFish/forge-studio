/**
 * The demo-builder session's door, generate → lock (bead forge-mfv5.2.8).
 *
 * The session's output is the project's demo DECLARATION: a fake agent turn
 * drafts `demoProcess` steps, the generate step snapshots them, and locking
 * writes them into `.forge/project.json` — the sole cycle-time demo input —
 * after which `forge preflight`'s DEMO-SKILL clause passes on that project.
 * An undrivable declaration is refused at lock with the drive rule's reason,
 * and nothing is written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createLogger, FORGE_ROOT } from '@forge/kernel';
import { runPreflight } from '@forge/projects';
import { runDemoBuilderTurn, demoSessionDir } from '../../kinds/demo-builder.ts';
import type { DemoBuilderStatus } from '../../kinds/demo-session-store.ts';
import { readSessionStatus, writeSessionStatus, type QueryFn } from '../../interactive-session.ts';

const SESSION_ID = '2026-09-27T00-00-00';

const DRIVABLE = [
  { kind: 'capture', text: 'Run `node bin/cli.js --summary` on both trees.' },
  { kind: 'verify', text: 'The summary names every scanned file.' },
];
const UNDRIVABLE = [
  { kind: 'capture', text: 'Show the summary somehow.' },
  { kind: 'verify', text: 'It looks right.' },
];

/** Every pass writes what the real write pass writes: the declaration draft
 *  and the sample. Only the write pass may (the fence denies the others), and
 *  a fake that writes on every pass proves nothing different. */
function agentWriting(declaration: unknown): QueryFn {
  return ({ options }) => {
    const cwd = (options?.cwd as string) ?? '.';
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(cwd, '.forge', 'demo'), { recursive: true });
      writeFileSync(join(cwd, '.forge', 'demo', 'demo-process.json'), JSON.stringify(declaration, null, 2));
      writeFileSync(join(cwd, '.forge', 'demo', 'DEMO.html'), '<!DOCTYPE html><html><body>sample</body></html>');
      yield { type: 'result', total_cost_usd: 0 };
    }
    return gen();
  };
}

const PROJECT_CONFIG = {
  testProcess: { local: { cmd: ['npm', 'test'] } },
  northStar: 'Scan a repo and summarise it.',
  skills: ['demo-design'],
  demoProcess: [{ kind: 'verify', text: 'The old, undrivable declaration.' }],
};

function setup(): { projectRoot: string; repoPath: string; sessionDir: string; logsRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'demo-declaration-door-'));
  const projectRoot = join(root, 'project');
  const repoPath = join(root, 'repo');
  mkdirSync(join(repoPath, '.forge'), { recursive: true });
  writeFileSync(join(repoPath, '.forge', 'project.json'), JSON.stringify(PROJECT_CONFIG));
  const sessionDir = demoSessionDir(join(root, '_logs'), 'door', SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });
  const status: DemoBuilderStatus = {
    session_id: SESSION_ID, project: 'door', project_repo_path: repoPath,
    phase: 'generating', iteration: 1, prompt: 'Show the summary.', updated_at: new Date().toISOString(),
  };
  writeSessionStatus(sessionDir, status);
  return { projectRoot, repoPath, sessionDir, logsRoot: join(root, '_logs') };
}

async function turn(ctx: ReturnType<typeof setup>, queryFn: QueryFn) {
  return await runDemoBuilderTurn({
    sessionId: SESSION_ID, project: 'door', projectRoot: ctx.projectRoot, forgeRoot: FORGE_ROOT, queryFn,
    logger: createLogger(`_demo-${SESSION_ID}`, ctx.logsRoot), logsRoot: ctx.logsRoot,
  });
}

/** What `handleDemoVerdict`'s approve arm writes before it spawns the lock turn. */
function approve(sessionDir: string): void {
  const status = readSessionStatus<DemoBuilderStatus>(sessionDir)!;
  writeSessionStatus(sessionDir, { ...status, phase: 'locking' });
}

const readConfig = (repoPath: string) => JSON.parse(readFileSync(join(repoPath, '.forge', 'project.json'), 'utf8'));

test('generate → lock: the declaration lands in project.json demoProcess and DEMO-SKILL passes', async () => {
  const ctx = setup();
  const generated = await turn(ctx, agentWriting(DRIVABLE));
  assert.equal(generated.phase, 'awaiting-review');
  assert.equal(existsSync(join(ctx.repoPath, '.forge', 'demo', 'demo-process.json')), false, 'the draft leaves the repo once snapshotted');
  assert.deepEqual(readConfig(ctx.repoPath).demoProcess, PROJECT_CONFIG.demoProcess, 'generating never writes the declaration');
  assert.equal(runPreflight(ctx.repoPath, { forgeRoot: FORGE_ROOT }).clauses.find((c) => c.clause === 'DEMO-SKILL')?.pass, false, 'precondition: the old declaration drives nothing');

  approve(ctx.sessionDir);
  const locked = await turn(ctx, agentWriting([]));
  assert.equal(locked.phase, 'locked');
  assert.deepEqual(readConfig(ctx.repoPath), { ...PROJECT_CONFIG, demoProcess: DRIVABLE }, 'only demoProcess changed');
  assert.equal(JSON.parse(readFileSync(join(ctx.repoPath, '.forge', 'demo', 'demo.lock.json'), 'utf8')).generation, 1);
  const demoSkill = runPreflight(ctx.repoPath, { forgeRoot: FORGE_ROOT }).clauses.find((c) => c.clause === 'DEMO-SKILL');
  assert.equal(demoSkill?.pass, true, demoSkill?.detail);
  assert.equal(existsSync(join(ctx.repoPath, '.forge', 'skills', 'demo-design', 'SKILL.md')), false, 'no composer SKILL.md is ever written');
});

test('an undrivable declaration is refused at lock with the rule\'s reason, and nothing is written', async () => {
  const ctx = setup();
  await turn(ctx, agentWriting(UNDRIVABLE));
  approve(ctx.sessionDir);
  await assert.rejects(() => turn(ctx, agentWriting([])), /cannot lock — generation 1's declaration is refused: capture step 0 \("Show the summary somehow\."\) yields no drivable command — no inline-code span to run/);
  assert.deepEqual(readConfig(ctx.repoPath), PROJECT_CONFIG, 'project.json untouched');
  assert.equal(existsSync(join(ctx.repoPath, '.forge', 'demo', 'demo.lock.json')), false, 'no lock file');
  assert.notEqual(readSessionStatus<DemoBuilderStatus>(ctx.sessionDir)?.phase, 'locked');
});
