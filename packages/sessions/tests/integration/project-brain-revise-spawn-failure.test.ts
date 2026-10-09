/**
 * forge-mfv5.1.15 — a failed spawn on `POST /api/project-brain/revise` rolls
 * the phase back to the review gate and keeps the operator's feedback.md, so
 * the retry carries it (mirrors handleGenericRevise's A7 rollback). Driven
 * through the handler with a fake host surface: a dry bridge never fails a
 * spawn, so the real bridge cannot reach this branch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { handleProjectBrainRoutes, type ProjectBrainRouteContext } from '../../bridge-studio-project-brain.ts';

test('a failed spawn rolls the phase back to awaiting-review, keeps feedback.md, answers 500', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-revise-fail-'));
  const logsRoot = join(forgeRoot, '_logs');
  const sessionId = '2026-10-09T11-00-00';
  const dir = join(logsRoot, '_sessions', 'demoproj', '_project-brain', sessionId);
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(forgeRoot, 'projects', 'demoproj'), { recursive: true });
  writeFileSync(join(dir, 'status.json'), JSON.stringify({
    session_id: sessionId, project: 'demoproj', project_repo_path: join(forgeRoot, 'projects', 'demoproj'),
    phase: 'awaiting-review', round: 2, prompt: '', updated_at: new Date().toISOString(),
  }));
  const claims: string[] = [];
  const ctx = {
    forgeRoot, logsRoot, projectsRoot: join(forgeRoot, 'projects'),
    readBody: async () => ({ project: 'demoproj', sessionId, feedback: 'please fix the build line' }),
    ensureSessionTail: () => {},
    broadcastProjectBrainChanged: () => {},
    claimAgentTurnSlot: (_root: string, _agent: string, sid: string) => { claims.push(sid); },
    spawnClaimedAgentTurn: () => ({ ok: false as const, error: 'spawn exploded' }),
    dryBridgeAgentTurnMarker: () => ({}),
  } as unknown as ProjectBrainRouteContext;
  const server = createServer((req, res) => {
    void handleProjectBrainRoutes(req, res, ctx, '/api/project-brain/revise', 'POST');
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  try {
    const { port } = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${port}/x`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    const json = (await res.json()) as { error?: string };
    assert.equal(res.status, 500);
    assert.match(String(json.error), /spawn exploded/);
    assert.deepEqual(claims, [sessionId], 'the slot was claimed once, before the writes');
    const status = JSON.parse(readFileSync(join(dir, 'status.json'), 'utf8')) as { phase: string; round: number };
    assert.equal(status.phase, 'awaiting-review', 'rolled back to the review gate');
    assert.equal(status.round, 2, 'the round is rolled back with the phase');
    assert.equal(readFileSync(join(dir, 'feedback.md'), 'utf8'), 'please fix the build line', 'feedback.md stays for the retry');
    assert.equal(existsSync(join(dir, 'verdicts.json')), false, 'a revise that never started is not recorded as a decision');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
