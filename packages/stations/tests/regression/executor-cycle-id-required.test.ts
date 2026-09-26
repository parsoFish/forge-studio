/**
 * forge-8vfn.8.1.17 / T1 ruling 1562 / §6.15: a cycle input reaching an
 * executor with NO `cycleId` must never fall back to the bare initiativeId
 * as a stand-in `_logs` dir — that silently misfiled review-findings.json,
 * review-chunks/ and the agent-run marker under `_logs/<initiativeId>/`
 * while Studio read `_logs/<cycleId>/` and showed nothing. `cycle.ts` now
 * always threads its minted cycleId (see cycle.test.ts's
 * "a fresh cycle threads its minted cycleId..." test), so a missing
 * `input.cycleId` reaching either site below means something upstream of
 * BOTH cycle.ts and this package dropped it — worth a loud, descriptive
 * throw, not a quiet write to the wrong directory.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildDefaultDeps } from '../../phases/executor-deps.ts';
import { createPhaseExecutor } from '../../phases/executor-table.ts';
import { loadAgentDefinition } from '@forge/agents';
import { createLogger } from '@forge/kernel';
import type { CycleInput, NodeExecContext, NodeRunState } from '@forge/flows';
import { WedgeDetector } from '@forge/flows';
import type { AgentDefinition } from '@forge/contracts';

/** A minimal, valid, non-canonical agent def: no band guard, no ralph
 *  loopStrategy — resolves to `execAgent`'s plain `runAgent` path. */
function writePlainAgentSkill(tmp: string, slug: string): AgentDefinition {
  const dir = join(tmp, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  const frontmatter = [
    '---',
    `name: ${slug}`,
    `description: "${slug} — test fixture agent, no band guard."`,
    'library: true',
    `phase: ${slug}`,
    'surface: unattended',
    `purpose: Test fixture agent for executor-cycle-id-required.test.ts.`,
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    '  guards: [event-log]',
    'runtime:',
    '  sdk: claude',
    '  strategy: fixed',
    '  model: claude-sonnet-4-6',
    'brainAccess: none',
    'interactivity: Fully autonomous; never blocks on the operator.',
    'allowed-tools: [Read]',
    'disallowed-tools: [Edit, MultiEdit, NotebookEdit, Bash, WebFetch, WebSearch, Task, Agent]',
    'budgets: {maxTurns: 10, maxBudgetUsd: 1.0}',
    '---',
    '',
    `# ${slug} skill contract`,
    '',
  ].join('\n');
  writeFileSync(join(dir, 'SKILL.md'), frontmatter);
  return loadAgentDefinition(join(dir, 'SKILL.md'));
}

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

test('execAgent: a missing input.cycleId throws, never falls back to initiativeId as runId', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-execagent-no-cycleid-'));
  try {
    const def = writePlainAgentSkill(tmp, 'plain-agent');
    const logsDir = join(tmp, '_logs');
    const logger = createLogger('unused-run-id', logsDir);
    const input: CycleInput = {
      initiativeId: 'INIT-2026-01-01-no-cycleid',
      manifestPath: join(tmp, 'manifest.md'),
      projectRepoPath: tmp,
      worktreePath: tmp,
      // cycleId deliberately omitted
    };
    const ctx = makeCtx({ id: 'dev', agent: 'plain-agent' }, new Map([['plain-agent', def]]), input, logger);
    const executor = createPhaseExecutor({});

    await assert.rejects(
      () => executor.run('dev', ctx),
      /cycleId/,
      'execAgent must refuse a missing input.cycleId rather than silently using initiativeId as runId',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('runAdversarialReview: a missing input.cycleId throws, never falls back to initiativeId', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-advreview-no-cycleid-'));
  try {
    const logger = createLogger('unused-run-id', join(tmp, '_logs'));
    const deps = buildDefaultDeps();
    const input: CycleInput = {
      initiativeId: 'INIT-2026-01-01-no-cycleid',
      manifestPath: join(tmp, 'manifest.md'),
      projectRepoPath: tmp,
      worktreePath: tmp,
      // cycleId deliberately omitted
    };
    // The guard throws synchronously, before the function ever returns a
    // promise (it only returns one on the real `realRunAdversarialReview`
    // path) — `assert.throws`, not `assert.rejects`, is what actually
    // observes that.
    assert.throws(
      () => { void deps.runAdversarialReview(input, logger, {} as AgentDefinition); },
      /cycleId/,
      'runAdversarialReview must refuse a missing cycleId, not use initiativeId as its _logs dir',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
