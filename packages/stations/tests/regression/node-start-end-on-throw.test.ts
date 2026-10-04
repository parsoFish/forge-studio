/**
 * Row 207 (bead `forge-8vfn.8.5.57`) — a node executor that wrote its own
 * run-level `start` writes exactly one `end`, on a throw too. Measured by the
 * row-207 offline parity replay over the captured S10 cycle logs:
 *
 *   2026-10-02T03-37-47 / 2026-10-03T12-16-45: integrate `demo-agent` start,
 *     then `cycle.dev-close-push-failed` thrown out of the close contract —
 *     no `end` for the integrate start (`EV_muqfdc3p_ylxrgxxg`,
 *     `EV_musdb6ty_qryuz6i6`).
 *   2026-10-02T08-17-35: integrate start, then `demo.capture.tooling-
 *     unavailable` → the delivery-gate throw — no `end` (`EV_muqpzcc2_wvkvwabz`).
 *
 * The adversarial-review band (a live-turn abort or wedge kill rejects out of
 * `runWithWedge`) and the onboard-preflight band share the shape. Each end
 * carries `parent_event_id` = its start and the shared failed marker
 * (`errorEndMetadata`), and the original error still propagates.
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

function makeCtx(
  node: { id: string; agent: string }, kind: NodeExecContext['kind'], agents: Map<string, AgentDefinition>,
  input: CycleInput, nodeLogger: NodeExecContext['nodeLogger'], runPreflight: () => never = () => { throw new Error('unexpected preflight'); },
): NodeExecContext {
  const state: NodeRunState = {
    cycleOutcome: 'ready-for-review', reflectionStatus: 'skipped', lintStatus: 'skipped',
    reviewerOutcome: 'ready-for-review', closure: null, terminateEarly: false,
  };
  return {
    node, nodeId: node.id, kind, projectGate: { runPreflight }, input, nodeLogger, costLogger: nodeLogger,
    wedgeDetector: new WedgeDetector({ wedgeKillMs: undefined, nodeId: node.id }), nodeBudget: undefined, state, agents, inboundArtifacts: [],
  };
}

function withRun(name: string, body: (logger: ReturnType<typeof createLogger>, input: CycleInput, tmp: string) => Promise<void>) {
  return async () => {
    const tmp = mkdtempSync(join(tmpdir(), `forge-r207-${name}-`));
    try {
      const logger = createLogger(`cyc-r207-${name}`, join(tmp, '_logs'));
      const input: CycleInput = {
        initiativeId: 'INIT-2026-10-02-coupling-sort-flag', manifestPath: join(tmp, 'manifest.md'),
        projectRepoPath: tmp, worktreePath: tmp, cycleId: `cyc-r207-${name}`,
      };
      await body(logger, input, tmp);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  };
}

const rows = (logger: ReturnType<typeof createLogger>): EventLogEntry[] =>
  readFileSync(logger.logFilePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as EventLogEntry);

function assertOneEndPerStart(events: EventLogEntry[], skill: string, error: RegExp): void {
  const starts = events.filter((e) => e.skill === skill && e.event_type === 'start');
  const ends = events.filter((e) => e.skill === skill && e.event_type === 'end');
  assert.equal(starts.length, 1);
  assert.equal(ends.length, 1, `every ${skill} start gets exactly one end, on a throw too`);
  assert.equal(ends[0].parent_event_id, starts[0].event_id);
  assert.equal(ends[0].metadata?.status, 'failed');
  assert.match(String(ends[0].metadata?.error), error);
}

const DEMO = () => new Map([['demo-agent', loadAgentDefinition(join(FORGE_ROOT, 'skills', 'demo-agent', 'SKILL.md'))]]);
const REVIEW = () => new Map([['adversarial-review', loadAgentDefinition(join(FORGE_ROOT, 'skills', 'adversarial-review', 'SKILL.md'))]]);
const throwing = (msg: string) => () => { throw new Error(msg); };

test('execIntegrate: the close contract throwing (dev-close push failed) still ends the integrate start', withRun('integrate-push', async (logger, input) => {
  const push = 'dev-loop close could not publish the branch: Command failed: git push --set-upstream origin forge/INIT-2026-10-02-coupling-sort-flag';
  const executor = createPhaseExecutor({ deps: { commitDevLoopBoundary: () => {}, enforceDevLoopCloseInvariant: throwing(push) } });
  await assert.rejects(() => executor.run('integrate', makeCtx({ id: 'integrate', agent: 'demo-agent' }, 'agent', DEMO(), input, logger)), /could not publish the branch/);
  assertOneEndPerStart(rows(logger), 'demo-agent', /^Error: dev-loop close could not publish the branch/);
}));

test('execIntegrate: the delivery-gate throw (demo capture tooling unavailable) still ends the integrate start', withRun('integrate-gate', async (logger, input) => {
  const executor = createPhaseExecutor({
    deps: {
      commitDevLoopBoundary: () => {}, enforceDevLoopCloseInvariant: () => {},
      computeDeliveryStats: () => ({ files: 1, insertions: 1, commits: 1 }) as never, assertNonEmptyDelivery: () => {},
      runMergeBoundaryGate: () => ({ ok: true, evidence: [] }) as never,
      runIntegrate: () => ({ status: 'failed', reason: 'tooling-unavailable', detail: 'demo capture command(s) not producible' }) as never,
    },
  });
  await assert.rejects(() => executor.run('integrate', makeCtx({ id: 'integrate', agent: 'demo-agent' }, 'agent', DEMO(), input, logger)), /delivery gate: integrate band failed/);
  assertOneEndPerStart(rows(logger), 'demo-agent', /^Error: delivery gate: integrate band failed \(tooling-unavailable/);
}));

test('execAdversarialReview: a rejected pipeline (a live-turn abort or wedge kill) still ends the review start', withRun('review', async (logger, input) => {
  const executor = createPhaseExecutor({ deps: { runAdversarialReview: async () => { throw new Error('operator-stop: the operator requested this run stop'); } } });
  await assert.rejects(() => executor.run('adversarial-review', makeCtx({ id: 'adversarial-review', agent: 'adversarial-review' }, 'agent', REVIEW(), input, logger)), /operator-stop:/);
  assertOneEndPerStart(rows(logger), 'adversarial-review', /^Error: operator-stop:/);
}));

test('execOnboardPreflight: a throwing preflight still ends the contract-check start', withRun('preflight', async (logger, input) => {
  const agents = new Map([['contract-check', loadAgentDefinition(join(FORGE_ROOT, 'skills', 'contract-check', 'SKILL.md'))]]);
  const ctx = makeCtx({ id: 'contract', agent: 'contract-check' }, 'agent', agents, input, logger, throwing('EACCES: .forge/project.json'));
  await assert.rejects(() => createPhaseExecutor().run('contract', ctx), /EACCES/);
  assertOneEndPerStart(rows(logger), 'contract-check', /^Error: EACCES/);
}));
