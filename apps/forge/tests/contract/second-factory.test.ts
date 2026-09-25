/**
 * G3 — a SECOND factory built from data only (1.0.md §3; spec §7 clause 2),
 * PACKAGED (M7-A seam, this branch): `packages/forge-docs/` is the whole
 * factory — its own `flows/forge-docs/flow.yaml` and its own `skills/`,
 * discovered with NO registration code through the platform's package-owned
 * discovery roots (`packages/kernel/discovery-roots.ts`). Delete
 * `packages/forge-docs` and this flow and its three agents are gone; nothing
 * else changes (`scripts/factory-deletable.mjs`'s forge-docs section proves
 * that live).
 *
 * Each test below names the wrong world it kills, mirroring the shape this
 * repo already uses for the FIRST such proof
 * (`packages/stations/tests/contract/band-def-generalisation.test.ts`, seam
 * F4) and this file's own unpackaged draft (`git show
 * m7/a-forge-docs:apps/forge/tests/contract/second-factory.test.ts`) — this
 * version replaces every "lives under studio/flows/" assumption with the
 * packaged, multi-root-discovered truth, and adds the accepts/review.lenses
 * proofs seam F6 introduced after that draft was written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { FORGE_ROOT } from '@forge/kernel';
import type { PhaseExecutor, EventLogger } from '@forge/kernel';
import { createLogger } from '@forge/kernel';
import { skillRoots } from '@forge/kernel';
import { listFlowIds, loadFlowDefinition } from '@forge/flows';
import { flowPathForId, resolveNodeKind, runFlow } from '@forge/flows';
import { WedgeDetector } from '@forge/flows';
import type { NodeExecContext, NodeRunState } from '@forge/flows';
import { listAgentDefinitions } from '@forge/agents';
import { resolveBandGuard } from '@forge/agents';
import type { AgentDefinition } from '@forge/contracts';
import type { StreamQueryFn } from '@forge/agents';
import { registeredBandIds, createPhaseExecutor } from '@forge/stations';
import {
  buildDevSystemPrompt,
  testClassProfilePort,
  makeFixture,
  stubQueryFn,
  validFindingsJson,
  type Fixture,
} from '@forge/stations/testing';
import { runAdversarialReview as realRunAdversarialReview } from '@forge/stations';
import { CLASS_PROFILES } from '@forge/factory/class-profiles.ts';

const SECOND = 'forge-docs';
const FIRST = 'forge-develop';
const PKG_DIR = join(FORGE_ROOT, 'packages', SECOND);

const roster = () => new Map(listAgentDefinitions(skillRoots(FORGE_ROOT)).map((d) => [d.slug, d]));

test('both factories are found by the platform\'s own registry across every package-owned discovery root (kills: a second factory that needs a registration line to exist)', () => {
  const ids = listFlowIds(FORGE_ROOT);
  assert.ok(ids.includes(FIRST), `registry listed ${ids.join(', ')}`);
  assert.ok(ids.includes(SECOND), `registry listed ${ids.join(', ')} — forge-docs is not a flow the platform can see`);
  const path = flowPathForId(SECOND, FORGE_ROOT);
  assert.ok(path.startsWith(PKG_DIR), `forge-docs resolved to ${path}, not under ${PKG_DIR} — it must be the PACKAGED flow, not a studio/flows/ one`);
  const second = loadFlowDefinition(path);
  assert.equal(second.id, SECOND, 'the platform loader parses it under its own id');
});

test('forge-docs is DATA ONLY: the package holds a flow.yaml and SKILL.mds, and no production module anywhere names it (kills: an "assembly line" smuggled in beside the data)', () => {
  const flowDir = join(PKG_DIR, 'flows', SECOND);
  assert.deepEqual(readdirSync(flowDir), ['flow.yaml'], 'the flow directory is its definition and nothing executable');

  const skillsDir = join(PKG_DIR, 'skills');
  for (const slug of readdirSync(skillsDir)) {
    assert.deepEqual(readdirSync(join(skillsDir, slug)), ['SKILL.md'], `skills/${slug} must hold only its SKILL.md`);
  }

  const namers: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      if (e === 'node_modules' || e === '.next' || e === 'tests' || e === 'test-fixtures') continue;
      const full = join(d, e);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx|mjs|js)$/.test(e) || /\.test\./.test(e)) continue;
      if (readFileSync(full, 'utf8').includes(SECOND)) namers.push(relative(FORGE_ROOT, full));
    }
  };
  for (const top of ['apps', 'packages']) walk(join(FORGE_ROOT, top));
  assert.deepEqual(namers, [], `production code names ${SECOND}: ${namers.join(', ')}`);
});

test('forge-docs accepts exactly the docs class (kills: a second factory silently open to every class, or refused for the one it exists for)', () => {
  const flow = loadFlowDefinition(flowPathForId(SECOND, FORGE_ROOT));
  assert.deepEqual(flow.accepts, ['docs']);
});

test('forge-docs narrows review to a non-empty subset of the docs class\'s own lenses (kills: a flow declaring a lens its class does not have, or silently reviewing under a class it does not accept)', () => {
  const flow = loadFlowDefinition(flowPathForId(SECOND, FORGE_ROOT));
  assert.ok(flow.review && flow.review.lenses.length > 0, 'forge-docs must declare review.lenses');
  const docsLenses = CLASS_PROFILES.docs.reviewLenses;
  for (const lens of flow.review!.lenses) {
    assert.ok((docsLenses as readonly string[]).includes(lens), `lens "${lens}" is not one of the docs class's own lenses (${docsLenses.join(', ')})`);
  }
});

test('every station dispatches through the ONE installed executor: no unknown kind, every band it needs is registered, and every agent-bearing node resolves to a SKILL.md INSIDE packages/forge-docs (kills: a flow the runner would reach "unknown" on, or one that quietly borrows the example\'s roster)', () => {
  const agents = roster();
  const flow = loadFlowDefinition(flowPathForId(SECOND, FORGE_ROOT));
  const bands = new Set(registeredBandIds());
  for (const node of flow.nodes) {
    const kind = resolveNodeKind(node, agents);
    assert.notEqual(kind, 'unknown', `node ${node.id} resolves to no executor`);
    if (!node.agent) continue; // the verdict node is a gate, not an agent
    const def = agents.get(node.agent);
    assert.ok(def, `node ${node.id} names agent ${node.agent}, which the roster does not hold`);
    assert.ok(
      def!.path.startsWith(join(PKG_DIR, 'skills')),
      `node ${node.id}'s agent "${node.agent}" resolved to ${def!.path}, not a SKILL.md inside packages/forge-docs`,
    );
    const band = resolveBandGuard(def!);
    if (band) assert.ok(bands.has(band), `node ${node.id} needs band ${band}; registered: ${[...bands].join(', ')}`);
  }
});

test('the real runner walks the second factory build → integrate → review → verdict, in order and by the kinds the data declares (kills: a topology that loads but does not run)', async () => {
  const flow = loadFlowDefinition(flowPathForId(SECOND, FORGE_ROOT));
  const seen: Array<[string, string]> = [];
  const stub: PhaseExecutor<NodeExecContext> = {
    async run(nodeId, ctx) {
      seen.push([nodeId, ctx.kind]);
      return ctx.state.cycleOutcome;
    },
  };
  const events: unknown[] = [];
  const logger: EventLogger = {
    logFilePath: '/tmp/second-factory-pkg/events.jsonl',
    cycleId: 'second-factory-pkg-walk',
    emit(event: unknown) {
      events.push(event);
      return { ...(event as Record<string, unknown>), event_id: `evt-${events.length}` } as ReturnType<EventLogger['emit']>;
    },
  };
  await runFlow({
    flow,
    input: {
      initiativeId: 'second-factory-pkg-walk',
      manifestPath: '/tmp/second-factory-pkg/manifest.md',
      projectRepoPath: '/tmp/second-factory-pkg/project',
      worktreePath: '/tmp/second-factory-pkg/worktree',
      dryRun: true,
    },
    logger,
    executor: stub,
    projectGate: { runPreflight: () => { throw new Error('the walk must never reach the preflight'); } },
    runClosure: async () => { throw new Error('the walk must never close'); },
  });
  assert.deepEqual(seen, [['build', 'agent'], ['integrate', 'agent'], ['review', 'agent'], ['verdict', 'review']]);
});

test('its budget is the docs class\'s and it fires no reflect (spec §5 item 9; kills: a copy of the develop flow under a new name)', () => {
  const second = loadFlowDefinition(flowPathForId(SECOND, FORGE_ROOT));
  const first = loadFlowDefinition(flowPathForId(FIRST, FORGE_ROOT));
  assert.ok(second.costCeilingUsd > 0 && second.costCeilingUsd <= 12, `costCeilingUsd ${second.costCeilingUsd}`);
  assert.ok(second.costCeilingUsd < first.costCeilingUsd, 'a docs factory runs under a tighter bound than the develop flow');
  assert.deepEqual(second.triggers.filter((t) => t.on === 'merged'), [], 'no merge-fired reflect');
  assert.ok(first.triggers.some((t) => t.on === 'merged'), 'control: the develop flow DOES reflect, so the assertion above can fail');
});

// ---------------------------------------------------------------------------
// Real dispatch — mirrors band-def-generalisation.test.ts's technique, but
// drives the ACTUAL on-disk packages/forge-docs defs (not a temp fixture):
// build the executor with a fake query, prove each spawning station's prompt
// is forge-docs's OWN SKILL.md text, never the example's.
// ---------------------------------------------------------------------------

test('execAgent: the review station spawns under docs-review\'s OWN SKILL.md, never adversarial-review\'s', async () => {
  const def = roster().get('docs-review');
  assert.ok(def, 'docs-review must be in the roster');

  let fx: Fixture | undefined;
  try {
    fx = makeFixture();
    const calls: Array<{ prompt: string; options?: Record<string, unknown> }> = [];
    const queryFn: StreamQueryFn = (params) => {
      calls.push(params);
      // Override the fixture's default CODE-class stub finding (category
      // 'correctness') with one shaped for the SINGLE lens forge-docs
      // actually declares — the pipeline validates every finding's category
      // against the narrowed lens list, so a code-shaped stub is rejected.
      return stubQueryFn([(p) => writeFileSync(
        join(fx!.worktree, '.forge', 'review-findings.json'),
        validFindingsJson(p, {
          lenses: ['accuracy-against-source'],
          findings: [
            {
              id: 'RF-1',
              severity: 'minor',
              category: 'accuracy-against-source',
              title: 'stale claim',
              detail: 'the page describes behaviour the source no longer has',
              evidence: [{ file: 'src.ts', line: 1, excerpt: 'export const v = 2;' }],
            },
          ],
        }),
      )])(params);
    };

    const logger = createLogger('CY-second-factory-review', fx.logsRoot);
    const state: NodeRunState = {
      cycleOutcome: 'ready-for-review',
      reflectionStatus: 'skipped',
      lintStatus: 'skipped',
      reviewerOutcome: 'ready-for-review',
      closure: null,
      terminateEarly: false,
    };
    const ctx: NodeExecContext = {
      node: { id: 'review', agent: 'docs-review' },
      nodeId: 'review',
      kind: 'agent',
      projectGate: { runPreflight: () => { throw new Error('unexpected preflight call'); } },
      input: {
        initiativeId: 'INIT-2026-01-01-second-factory-review',
        manifestPath: '',
        projectRepoPath: fx.worktree,
        worktreePath: fx.worktree,
        cycleId: 'CY-second-factory-review',
      },
      nodeLogger: logger,
      costLogger: logger,
      wedgeDetector: new WedgeDetector({ wedgeKillMs: undefined, nodeId: 'review' }),
      nodeBudget: undefined,
      state,
      agents: new Map<string, AgentDefinition>([['docs-review', def!]]),
      inboundArtifacts: [],
    };

    const executor = createPhaseExecutor({
      classProfiles: testClassProfilePort(),
      deps: {
        runAdversarialReview: (input, nodeLogger, resolvedDef, signal) =>
          realRunAdversarialReview(
            {
              initiativeId: input.initiativeId,
              worktreePath: input.worktreePath,
              cycleId: input.cycleId ?? input.initiativeId,
              logsRoot: fx!.logsRoot,
              projectName: 'fix',
              changeClass: 'docs',
              flowReview: { flowId: SECOND, lenses: ['accuracy-against-source'] },
            },
            nodeLogger,
            { queryFn, classProfiles: testClassProfilePort(), agentDef: resolvedDef, signal },
          ),
      },
    });

    await executor.run('review', ctx);

    assert.ok(calls.length >= 1, 'the review band spawned at least once');
    const systemPrompt = String(calls[0]!.options?.systemPrompt ?? '');
    assert.match(systemPrompt, /# Docs Review/, 'the spawned system prompt carries docs-review\'s OWN SKILL.md body');
    assert.doesNotMatch(
      systemPrompt,
      /adversarial-review skill contract|# Adversarial Review/,
      'the spawned system prompt must NOT carry the example\'s adversarial-review identity',
    );
  } finally {
    fx?.cleanup();
  }
});

test('execAgent: the build station dispatches the ralph band under docs-writer\'s OWN def and prompt, never developer-ralph\'s', () => {
  const def = roster().get('docs-writer');
  assert.ok(def, 'docs-writer must be in the roster');
  assert.equal(def!.runtime.loopStrategy, 'ralph');

  let received: AgentDefinition | undefined;
  const state: NodeRunState = {
    cycleOutcome: 'ready-for-review',
    reflectionStatus: 'skipped',
    lintStatus: 'skipped',
    reviewerOutcome: 'ready-for-review',
    closure: null,
    terminateEarly: false,
  };
  const logger = createLogger('CY-second-factory-build', '/tmp/second-factory-pkg-logs');
  const ctx: NodeExecContext = {
    node: { id: 'build', agent: 'docs-writer' },
    nodeId: 'build',
    kind: 'agent',
    projectGate: { runPreflight: () => { throw new Error('unexpected preflight call'); } },
    input: { initiativeId: 'INIT-2026-01-01-second-factory-build', manifestPath: '', projectRepoPath: '/tmp', worktreePath: '/tmp' },
    nodeLogger: logger,
    costLogger: logger,
    wedgeDetector: new WedgeDetector({ wedgeKillMs: undefined, nodeId: 'build' }),
    nodeBudget: undefined,
    state,
    agents: new Map<string, AgentDefinition>([['docs-writer', def!]]),
    inboundArtifacts: [],
  };

  const executor = createPhaseExecutor({
    classProfiles: testClassProfilePort(),
    deps: {
      // `runDeveloperLoop` has no injectable query function (see
      // band-def-generalisation.test.ts's header) — this stub proves the
      // DISPATCH half; the prompt half is `buildDevSystemPrompt` below.
      runDeveloperLoop: async (_input, _nodeLogger, resolvedDef) => {
        received = resolvedDef;
      },
    },
  });

  return executor.run('build', ctx).then(() => {
    assert.ok(received, 'execAgent did not dispatch the ralph band');
    assert.equal(received!.slug, 'docs-writer', 'the dev-loop band received docs-writer\'s OWN def, not a hardcoded canonical one');

    const prompt = buildDevSystemPrompt('/tmp', def!);
    assert.match(prompt, /# Docs Writer/, 'the dev-loop system prompt carries docs-writer\'s OWN SKILL.md body');
    assert.doesNotMatch(prompt, /# Developer — Ralph/, 'must NOT carry the example\'s developer-ralph identity');
  });
});
