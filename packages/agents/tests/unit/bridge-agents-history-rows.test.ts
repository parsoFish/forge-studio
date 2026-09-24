/**
 * `collectFlowNodeRows` (bridge-agents-history-rows.ts) — two defects in the
 * same slug→node resolution:
 *
 *  - forge-dgj: it resolves a slug to a single, GLOBAL node id via
 *    `deps.buildAgentSlugToNodeId` (first-write-wins across every flow) and
 *    then accepts ANY run carrying that bare node id in `run.phases`, with
 *    no check that the run's OWN flow is the one that actually declared the
 *    slug there. Node ids are unique only WITHIN a flow — two flows sharing
 *    a literal id (`dev`, `review`, `demo` are all ordinary) collide, and a
 *    run of flow B is silently attributed to flow A's agent.
 *
 *  - forge-ewl: the SAME slug→node lookup returns [] unconditionally when NO
 *    LIVE flow declares the slug at all — which is exactly what happens the
 *    moment a flow retires (reflector's `forge-reflect` flow, W7-C1) or for
 *    an agent that was never a flow node to begin with (release-finalizer,
 *    always threaded straight into the cycle manifest). The runs themselves
 *    still honestly carry the phase in `run.phases`; only the LOOKUP forgets
 *    it ever existed.
 *
 * Both are fixed together: primary resolution keys on `(flowId, nodeId)` via
 * the file's own per-flow `buildFlowNodeToSlug` (closes dgj); a fallback to
 * the agent's own canonical phase key applies ONLY when no live flow
 * declares the slug AT ALL, and ONLY when no live flow node claims that key
 * for a different agent either (closes ewl without reopening dgj's hole).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { collectFlowNodeRows, type AgentHistoryDeps } from '../../bridge-agents-history-rows.ts';
import type { AgentFlowRun } from '../../bridge-agents-run-state.ts';

function setupForgeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'agents-history-rows-'));
}

/** A minimal, well-formed studio agent — just enough for `listAgentDefinitions`
 *  (`loadAgentDefinition`) to load it and expose `phase`. */
function plantAgent(forgeRoot: string, slug: string, phase: string): void {
  const dir = join(forgeRoot, 'skills', slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---
name: ${slug}
description: Agent ${slug}.
phase: ${phase}
purpose: history-rows fixture.
brainAccess: none
interactivity: Fully autonomous.
runtime:
  sdk: claude
  strategy: fixed
composition:
  skills: []
  tools: []
  mcps: []
  hooks: []
  guards: []
---

Body.
`,
  );
}

function plantFlow(forgeRoot: string, flowId: string, nodes: Array<{ id: string; agent?: string }>): void {
  const dir = join(forgeRoot, 'studio', 'flows', flowId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'flow.yaml'), yaml.dump({ id: flowId, name: flowId, nodes }));
}

function loadFlowDefinition(flowPath: string): { id: string; nodes: readonly { id: string; agent?: string }[] } {
  return yaml.load(readFileSync(flowPath, 'utf8')) as {
    id: string;
    nodes: readonly { id: string; agent?: string }[];
  };
}

/** The REAL `buildAgentSlugToNodeId` algorithm (packages/flows/run-model-
 *  flow-graph.ts:166) reproduced against this test's own fixture root: a
 *  FLAT, first-write-wins union of every LIVE flow's `node.agent` — no
 *  fallback, no per-flow scoping. Reproduced rather than imported: a NEW
 *  cross-package test import (`packages/agents/tests` -> `@forge/flows`)
 *  would add an edge `check-boundaries.mjs`'s allow-graph ratchet has no
 *  baseline entry for (only production files carrying an ALREADY-baselined
 *  edge may cross this boundary today). Reproducing the exact algorithm
 *  keeps the RED evidence a genuine behavioural failure — a wrong VALUE,
 *  not a thrown "you called the old function" tripwire. */
function buildAgentSlugToNodeIdFixture(forgeRoot: string): Map<string, string> {
  const map = new Map<string, string>();
  const flowsDir = join(forgeRoot, 'studio', 'flows');
  let entries: string[] = [];
  try { entries = existsSync(flowsDir) ? readdirSync(flowsDir).sort() : []; } catch { entries = []; }
  for (const entry of entries) {
    const flowPath = join(flowsDir, entry, 'flow.yaml');
    if (!existsSync(flowPath)) continue;
    let flow;
    try { flow = loadFlowDefinition(flowPath); } catch { continue; }
    for (const node of flow.nodes) {
      if (!node.agent) continue;
      if (!map.has(node.agent)) map.set(node.agent, node.id);
    }
  }
  return map;
}

function makeDeps(runs: AgentFlowRun[]): AgentHistoryDeps {
  return {
    parseGuardedEventsJsonl: () => { throw new Error('unexpected parseGuardedEventsJsonl call'); },
    parseGuardedFirstEvent: () => { throw new Error('unexpected parseGuardedFirstEvent call'); },
    isTurnAlive: () => { throw new Error('unexpected isTurnAlive call'); },
    extractErrorMessage: () => { throw new Error('unexpected extractErrorMessage call'); },
    stallCeilingMs: 0,
    projectsRoot: '/unused',
    cachedListRuns: () => runs,
    buildAgentSlugToNodeId: buildAgentSlugToNodeIdFixture,
    loadFlowDefinition,
    loadSessionKinds: () => { throw new Error('unexpected loadSessionKinds call'); },
  };
}

function run(overrides: Partial<AgentFlowRun>): AgentFlowRun {
  return {
    id: 'RUN-1', flowId: 'forge-develop', status: 'complete', phases: {}, phaseMeta: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// forge-dgj — cross-flow node-id collision
// ---------------------------------------------------------------------------

test('collectFlowNodeRows: a phantom agent sharing a node id with a REAL agent in another flow gets ZERO rows, not the real agent\'s history', () => {
  const forgeRoot = setupForgeRoot();
  try {
    plantAgent(forgeRoot, 'developer-ralph', 'developer-loop');
    plantAgent(forgeRoot, 'dev', 'dev'); // the "phantom" — never actually ran
    // forge-develop (LIVE): node id "dev" -> developer-ralph.
    plantFlow(forgeRoot, 'forge-develop', [{ id: 'dev', agent: 'developer-ralph' }]);
    // w7-throwaway-flow (LIVE, operator-authored): node id "dev" -> the
    // phantom agent "dev" — same literal node id, different flow, different agent.
    plantFlow(forgeRoot, 'w7-throwaway-flow', [{ id: 'dev', agent: 'dev' }]);

    const realRun = run({ id: 'RUN-real', flowId: 'forge-develop', phases: { dev: 'complete' }, phaseMeta: { dev: { costUsd: 5 } } });
    const deps = makeDeps([realRun]);

    const phantomRows = collectFlowNodeRows(deps, forgeRoot, 'dev');
    assert.deepEqual(phantomRows, [], `the phantom "dev" agent never ran — got: ${JSON.stringify(phantomRows)}`);

    const realRows = collectFlowNodeRows(deps, forgeRoot, 'developer-ralph');
    assert.equal(realRows.length, 1, 'the real agent must still see its own run');
    assert.equal(realRows[0]!.id, 'RUN-real');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// forge-ewl — retired-flow / never-flow-noded agents
// ---------------------------------------------------------------------------

test('collectFlowNodeRows: an agent whose declaring flow was retired keeps its previously-recorded rows (reflector / forge-reflect)', () => {
  const forgeRoot = setupForgeRoot();
  try {
    plantAgent(forgeRoot, 'reflector', 'reflector'); // frontmatter phase != canonical node id 'reflect'
    // NO flow declares {agent: reflector} anywhere — forge-reflect is gone.
    plantFlow(forgeRoot, 'forge-develop', [{ id: 'dev', agent: 'developer-ralph' }]);

    const historicalRun = run({
      id: 'RUN-old-reflect',
      flowId: 'forge-develop',
      phases: { dev: 'complete', reflect: 'complete' },
      phaseMeta: { reflect: { costUsd: 1.5 } },
    });
    const deps = makeDeps([historicalRun]);

    const rows = collectFlowNodeRows(deps, forgeRoot, 'reflector');
    assert.equal(rows.length, 1, `reflector's historically-recorded run must still surface — got: ${JSON.stringify(rows)}`);
    assert.equal(rows[0]!.id, 'RUN-old-reflect');
    assert.equal(rows[0]!.costUsd, 1.5);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('collectFlowNodeRows: an agent that NEVER had a flow node surfaces its phase runs at all (release-finalizer)', () => {
  const forgeRoot = setupForgeRoot();
  try {
    plantAgent(forgeRoot, 'release-finalizer', 'release-finalize');
    plantFlow(forgeRoot, 'forge-develop', [{ id: 'dev', agent: 'developer-ralph' }]);

    const cycleRun = run({
      id: 'RUN-cycle',
      flowId: 'forge-develop',
      phases: { dev: 'complete', 'release-finalize': 'complete' },
      phaseMeta: { 'release-finalize': { costUsd: 0.4 } },
    });
    const deps = makeDeps([cycleRun]);

    const rows = collectFlowNodeRows(deps, forgeRoot, 'release-finalizer');
    assert.equal(rows.length, 1, `release-finalizer must surface its own phase run — got: ${JSON.stringify(rows)}`);
    assert.equal(rows[0]!.id, 'RUN-cycle');
    assert.equal(rows[0]!.costUsd, 0.4);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('collectFlowNodeRows: the retired-flow fallback never fires when a LIVE flow claims that same node id for someone else', () => {
  const forgeRoot = setupForgeRoot();
  try {
    // "orphan" declares phase "dev" verbatim (no override) — collides with
    // forge-develop's REAL, live "dev" node, owned by developer-ralph.
    plantAgent(forgeRoot, 'developer-ralph', 'developer-loop');
    plantAgent(forgeRoot, 'orphan-agent', 'dev');
    plantFlow(forgeRoot, 'forge-develop', [{ id: 'dev', agent: 'developer-ralph' }]);

    const devRun = run({ id: 'RUN-dev', flowId: 'forge-develop', phases: { dev: 'complete' } });
    const deps = makeDeps([devRun]);

    const rows = collectFlowNodeRows(deps, forgeRoot, 'orphan-agent');
    assert.deepEqual(rows, [], `the fallback must never claim a node id a LIVE flow already owns for a different agent — got: ${JSON.stringify(rows)}`);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
