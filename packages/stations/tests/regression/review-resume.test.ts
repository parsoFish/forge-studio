/**
 * forge-mfv5.1.61 row 3 — after a review failure, Requeue resumes AT THE REVIEW
 * NODE: the per-WI dev loop and the integrate band (merge-boundary gate, demo
 * capture) are not re-run, and the review re-buys only the chunks it has no
 * record for at this head (`review-chunks.ts`, chunk reuse).
 *
 * gitweave I4 round 4: the review pipeline failure classified `terminal` with no
 * resume point, so Requeue chose a fresh re-run — wiping the worktree whose
 * nineteen work items were complete, green at their gates and green in CI.
 *
 * Kills: the classifier giving a review failure no resume point; the integrate
 * band re-running on a review resume (a 30-minute live gate for nothing); the
 * review band skipping on a review resume (it is the node that failed).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { classifyCycleFailure, loadAgentDefinition } from '@forge/agents';
import { createLogger, FORGE_ROOT, type EventLogEntry } from '@forge/kernel';
import type { CycleInput, NodeExecContext, NodeRunState } from '@forge/flows';
import { WedgeDetector, resumeSkipsPerWiWork } from '@forge/flows';
import type { AgentDefinition } from '@forge/contracts';

import { createPhaseExecutor } from '../../phases/executor-table.ts';

function makeCtx(node: { id: string; agent: string }, agents: Map<string, AgentDefinition>, input: CycleInput, nodeLogger: NodeExecContext['nodeLogger']): NodeExecContext {
  const state: NodeRunState = {
    cycleOutcome: 'ready-for-review', reflectionStatus: 'skipped', lintStatus: 'skipped',
    reviewerOutcome: 'ready-for-review', closure: null, terminateEarly: false,
  };
  return {
    node, nodeId: node.id, kind: 'agent',
    projectGate: { runPreflight: () => { throw new Error('unexpected preflight call in this fixture'); } },
    input, nodeLogger, costLogger: nodeLogger,
    wedgeDetector: new WedgeDetector({ wedgeKillMs: undefined, nodeId: node.id }),
    nodeBudget: undefined, state, agents, inboundArtifacts: [],
  };
}

const neverCall = (name: string) => (): never => { throw new Error(`UNEXPECTED CALL: ${name} must not run on a resumeFrom:'review' resume`); };
const events = (p: string): EventLogEntry[] => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry);

function input(tmp: string, cycleId: string): CycleInput {
  return { initiativeId: 'INIT-2026-10-18-review-resume', manifestPath: join(tmp, 'manifest.md'), projectRepoPath: tmp, worktreePath: tmp, cycleId, resumeFrom: 'review' };
}

test('a review-pipeline failure classifies with resume point "review" (the I4 round-4 failure text)', () => {
  const e = (message: string, event_type: 'error' | 'log' = 'error'): EventLogEntry => ({
    event_id: `e-${message.length}`, initiative_id: 'INIT-x', started_at: '2026-10-18T10:03:29.000Z', phase: 'orchestrator', skill: 'flow-runner',
    event_type, input_refs: [], output_refs: [], message,
  }) as unknown as EventLogEntry;
  const cls = classifyCycleFailure([
    e('cycle.start', 'log'),
    e('delivery gate: adversarial review pipeline failed (author-invalid: WI-19: findings[0].evidence must be a non-empty array) — no findings artifact was produced for the verdict gate'),
  ]);
  assert.equal(cls.kind, 'terminal', 'still never auto-retried — the operator Requeues');
  assert.equal(cls.resumeFrom, 'review');
});

test('resumeFrom "review" skips the per-WI dev loop, like the other post-develop resume points', () => {
  assert.equal(resumeSkipsPerWiWork('review'), true);
});

test('execIntegrate: resumeFrom "review" skips the whole integrate band — no gate, no capture', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-review-resume-integrate-'));
  try {
    const def = loadAgentDefinition(join(FORGE_ROOT, 'skills', 'demo-agent', 'SKILL.md'));
    const logger = createLogger('cyc-review-resume-integrate', join(tmp, '_logs'));
    const executor = createPhaseExecutor({
      deps: {
        commitDevLoopBoundary: neverCall('commitDevLoopBoundary'), enforceDevLoopCloseInvariant: neverCall('enforceDevLoopCloseInvariant'),
        computeDeliveryStats: neverCall('computeDeliveryStats'), assertNonEmptyDelivery: neverCall('assertNonEmptyDelivery'),
        runMergeBoundaryGate: neverCall('runMergeBoundaryGate'), runIntegrate: neverCall('runIntegrate'),
      },
    });
    await executor.run('integrate', makeCtx({ id: 'integrate', agent: 'demo-agent' }, new Map([['demo-agent', def]]), input(tmp, 'cyc-review-resume-integrate'), logger));
    const skip = events(logger.logFilePath).find((e) => e.message === 'flow-runner.integrate-skipped-resume');
    assert.equal((skip?.metadata as { resume_from?: string } | undefined)?.resume_from, 'review');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('execAdversarialReview: resumeFrom "review" RUNS the review — it is the node that failed', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-review-resume-review-'));
  try {
    const def = loadAgentDefinition(join(FORGE_ROOT, 'skills', 'adversarial-review', 'SKILL.md'));
    const logger = createLogger('cyc-review-resume-review', join(tmp, '_logs'));
    const executor = createPhaseExecutor({ deps: { runAdversarialReview: () => { throw new Error('REVIEW RAN'); } } });
    await assert.rejects(
      () => executor.run('adversarial-review', makeCtx({ id: 'adversarial-review', agent: 'adversarial-review' }, new Map([['adversarial-review', def]]), input(tmp, 'cyc-review-resume-review'), logger)),
      /REVIEW RAN/,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
