/**
 * Row 122 (bead forge-8vfn.8.1.55, T1 1609/1617) — a `resumeFrom: 'pr-open'`
 * develop-flow run (an environment failure classified specifically at the
 * review node's PR-open call, ADR 019 amendment) must skip the WHOLE
 * post-develop band (`integrate`, `adversarial-review`) — not just the per-WI
 * dev-loop `resumeFrom: 'integrate'` already skips. Both bands already
 * succeeded before PR-open failed; re-running them would re-derive a demo
 * bundle / review-findings artifact that is already correct on the preserved
 * worktree, at the cost of a full merge-boundary gate + adversarial-review
 * pass for nothing.
 *
 * RED at base (before this row's fix): `execIntegrate` / `execAdversarialReview`
 * (packages/stations/phases/executor-table.ts) never read `input.resumeFrom`
 * at all — every one of the injected throwing stubs below would fire even on
 * a `resumeFrom: 'pr-open'` run, so the "skips" assertions in this file fail.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAgentDefinition } from '@forge/agents';
import { createLogger, FORGE_ROOT, type EventLogEntry } from '@forge/kernel';
import type { CycleInput, NodeExecContext, NodeRunState } from '@forge/flows';
import { WedgeDetector } from '@forge/flows';
import type { AgentDefinition } from '@forge/contracts';

import { createPhaseExecutor } from '../../phases/executor-table.ts';

const DEMO_AGENT_SKILL = join(FORGE_ROOT, 'skills', 'demo-agent', 'SKILL.md');
const ADVERSARIAL_REVIEW_SKILL = join(FORGE_ROOT, 'skills', 'adversarial-review', 'SKILL.md');

function makeCtx(
  node: { id: string; agent: string },
  agents: Map<string, AgentDefinition>,
  input: CycleInput,
  nodeLogger: NodeExecContext['nodeLogger'],
): NodeExecContext {
  const state: NodeRunState = {
    cycleOutcome: 'ready-for-review',
    reflectionStatus: 'skipped',
    lintStatus: 'skipped',
    reviewerOutcome: 'ready-for-review',
    closure: null,
    terminateEarly: false,
  };
  return {
    node,
    nodeId: node.id,
    kind: 'agent',
    projectGate: { runPreflight: () => { throw new Error('unexpected preflight call in this fixture'); } },
    input,
    nodeLogger,
    costLogger: nodeLogger,
    wedgeDetector: new WedgeDetector({ wedgeKillMs: undefined, nodeId: node.id }),
    nodeBudget: undefined,
    state,
    agents,
    inboundArtifacts: [],
  };
}

function readEvents(logFilePath: string): EventLogEntry[] {
  return readFileSync(logFilePath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as EventLogEntry);
}

/** A stub that fails the test loudly if the band ever calls it — proves the
 *  skip branch returns before any side-effecting call, not just before the
 *  final derive call. */
function neverCall(name: string): () => never {
  return () => { throw new Error(`UNEXPECTED CALL: ${name} must not run on a resumeFrom:'pr-open' resume`); };
}

test('execIntegrate: resumeFrom:"pr-open" skips entirely — no gate call, one skip log event', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-pr-open-resume-integrate-'));
  try {
    const def = loadAgentDefinition(DEMO_AGENT_SKILL);
    const logger = createLogger('cyc-pr-open-skip-integrate', join(tmp, '_logs'));
    const input: CycleInput = {
      initiativeId: 'INIT-2026-09-28-pr-open-skip',
      manifestPath: join(tmp, 'manifest.md'),
      projectRepoPath: tmp,
      worktreePath: tmp,
      cycleId: 'cyc-pr-open-skip-integrate',
      resumeFrom: 'pr-open',
    };
    const agents = new Map([['demo-agent', def]]);
    const ctx = makeCtx({ id: 'integrate', agent: 'demo-agent' }, agents, input, logger);
    const executor = createPhaseExecutor({
      deps: {
        commitDevLoopBoundary: neverCall('commitDevLoopBoundary'),
        enforceDevLoopCloseInvariant: neverCall('enforceDevLoopCloseInvariant'),
        computeDeliveryStats: neverCall('computeDeliveryStats'),
        assertNonEmptyDelivery: neverCall('assertNonEmptyDelivery'),
        runMergeBoundaryGate: neverCall('runMergeBoundaryGate'),
        runIntegrate: neverCall('runIntegrate'),
      },
    });

    await executor.run('integrate', ctx);

    const events = readEvents(logger.logFilePath);
    const skipEvt = events.find((e) => e.message === 'flow-runner.integrate-skipped-resume');
    assert.ok(skipEvt, 'must emit flow-runner.integrate-skipped-resume');
    assert.equal((skipEvt!.metadata as { resume_from?: string }).resume_from, 'pr-open');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('execIntegrate: a NORMAL run still runs the close contract — skip is gated on pr-open', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-pr-open-resume-integrate-normal-'));
  try {
    const def = loadAgentDefinition(DEMO_AGENT_SKILL);
    const logger = createLogger('cyc-pr-open-normal-integrate', join(tmp, '_logs'));
    const input: CycleInput = {
      initiativeId: 'INIT-2026-09-28-pr-open-skip-normal',
      manifestPath: join(tmp, 'manifest.md'),
      projectRepoPath: tmp,
      worktreePath: tmp,
      cycleId: 'cyc-pr-open-normal-integrate',
      // resumeFrom deliberately omitted — a fresh, non-resume run.
    };
    const agents = new Map([['demo-agent', def]]);
    const ctx = makeCtx({ id: 'integrate', agent: 'demo-agent' }, agents, input, logger);
    const executor = createPhaseExecutor({
      deps: { commitDevLoopBoundary: neverCall('commitDevLoopBoundary (marker)') },
    });

    await assert.rejects(
      () => executor.run('integrate', ctx),
      /UNEXPECTED CALL: commitDevLoopBoundary \(marker\)/,
      'a normal (non-resume) run must still reach commitDevLoopBoundary',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('execAdversarialReview: resumeFrom:"pr-open" skips — no pipeline call, one skip log event', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-pr-open-resume-review-'));
  try {
    const def = loadAgentDefinition(ADVERSARIAL_REVIEW_SKILL);
    const logger = createLogger('cyc-pr-open-skip-review', join(tmp, '_logs'));
    const input: CycleInput = {
      initiativeId: 'INIT-2026-09-28-pr-open-skip-review',
      manifestPath: join(tmp, 'manifest.md'),
      projectRepoPath: tmp,
      worktreePath: tmp,
      cycleId: 'cyc-pr-open-skip-review',
      resumeFrom: 'pr-open',
    };
    const ctx = makeCtx(
      { id: 'adversarial-review', agent: 'adversarial-review' },
      new Map([['adversarial-review', def]]),
      input,
      logger,
    );
    const executor = createPhaseExecutor({
      deps: { runAdversarialReview: neverCall('runAdversarialReview') },
    });

    await executor.run('adversarial-review', ctx);

    const events = readEvents(logger.logFilePath);
    const skipEvt = events.find((e) => e.message === 'flow-runner.adversarial-review-skipped-resume');
    assert.ok(skipEvt, 'must emit flow-runner.adversarial-review-skipped-resume');
    assert.equal((skipEvt!.metadata as { resume_from?: string }).resume_from, 'pr-open');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('execAdversarialReview: a NORMAL run still calls the pipeline — skip is gated on pr-open', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-pr-open-resume-review-normal-'));
  try {
    const def = loadAgentDefinition(ADVERSARIAL_REVIEW_SKILL);
    const logger = createLogger('cyc-pr-open-normal-review', join(tmp, '_logs'));
    const input: CycleInput = {
      initiativeId: 'INIT-2026-09-28-pr-open-skip-review-normal',
      manifestPath: join(tmp, 'manifest.md'),
      projectRepoPath: tmp,
      worktreePath: tmp,
      cycleId: 'cyc-pr-open-normal-review',
    };
    const ctx = makeCtx(
      { id: 'adversarial-review', agent: 'adversarial-review' },
      new Map([['adversarial-review', def]]),
      input,
      logger,
    );
    const executor = createPhaseExecutor({
      deps: { runAdversarialReview: neverCall('runAdversarialReview (marker)') },
    });

    await assert.rejects(
      () => executor.run('adversarial-review', ctx),
      /UNEXPECTED CALL: runAdversarialReview \(marker\)/,
      'a normal (non-resume) run must still reach runAdversarialReview',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
