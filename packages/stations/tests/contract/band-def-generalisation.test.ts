/**
 * Seam F4 (operator item 81, ADR-039 generalisation) — TDD reds for the claim
 * that a band station now spawns under the EXECUTING NODE'S OWN agent def,
 * never a hardcoded canonical slug.
 *
 * Each test builds a NON-canonical agent (its own temp SKILL.md, a distinct
 * slug) declaring the same dispatch data (`composition.guards` / the ralph
 * `loopStrategy`) a canonical phase agent declares, puts it on a hand-built
 * flow node, and drives it through the REAL `execAgent` dispatch
 * (`createPhaseExecutor().run(nodeId, ctx)` — the same `PhaseExecutor` port
 * `runFlow` holds). `runFlow` itself is not used here: it resolves its agent
 * roster from the real on-disk `skills/` tree (`listAgentDefinitions`), which
 * cannot carry a temp, non-canonical def — so the roster (`ctx.agents`) is
 * built by hand instead, exactly the seam `execAgent` itself reads.
 *
 * (a)/(c) capture the real spawn call via an injected `queryFn`, mirroring
 * `pm-spawn-capture.test.ts` / `adversarial-review-spawn-capture.test.ts`.
 * (a) also reads back the run's own events.jsonl to prove telemetry identity
 * (round 2 item 3): `skill`/`agent_slug` must be the executing def's OWN
 * slug, never a canonical literal.
 * (b) cannot capture a spawn: `runDeveloperLoop` has no injectable query
 * function (see `developer-loop.cost-ceiling.test.ts`'s header) — proven
 * instead as three parts: execAgent's dispatch (a stubbed
 * `deps.runDeveloperLoop` records which def it was handed), `buildDevSystemPrompt`
 * (the prompt), and `resolveDevSpawnModel` (round 2 item 2: model/tier come
 * from the def, not the canonical `DEV_MODEL` constant).
 * (d) is a single direct test of the shared `loadAgentSkillText` helper every
 * binding now goes through.
 *
 * Round 2 item 1 (no canonical default) is proven by the TYPE SYSTEM, not a
 * runtime test here: `agentDef` is a REQUIRED field everywhere it was
 * threaded (`RunProjectManagerOptions`, the adversarial-review/reflector
 * `opts`/`ReflectorDeps`, `runDeveloperLoop`'s own param) — every one of
 * this test file's calls below supplies it explicitly, and `npx tsc --noEmit`
 * is the enforcement (see the session report for the pinned-test ripple this
 * produced when the defaults were removed).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createPhaseExecutor } from '../../phases/executor-table.ts';
import { runAdversarialReview as realRunAdversarialReview } from '../../phases/adversarial-review.ts';
import { runProjectManager as realRunProjectManager, type PmQueryFn } from '../../phases/project-manager.ts';
import { buildDevSystemPrompt, resolveDevSpawnModel, DEV_MODEL, DEV_ALLOWED_TOOLS } from '../../phases/dev-binding.ts';
import { loadAgentSkillText } from '../../phases/agent-skill-text.ts';
import { loadAgentDefinition } from '@forge/agents';
import type { AgentDefinition } from '@forge/contracts';
import { createLogger } from '@forge/kernel';
import type { NodeExecContext, NodeRunState } from '@forge/flows';
import { WedgeDetector } from '@forge/flows';
import type { StreamQueryFn } from '@forge/agents';
import { testClassProfilePort } from '../test-fixtures/class-profile-port-fixture.ts';
import {
  makeFixture,
  stubQueryFn,
  validFindingsJson,
  type Fixture,
} from '../test-fixtures/adversarial-review-fixture.ts';

/** Every JSON line the run's own event log recorded (round 2 item 3 proof). */
function readEvents(logsDir: string, cycleId: string): Array<{ skill?: string; event_type?: string; metadata?: Record<string, unknown> }> {
  const path = join(logsDir, cycleId, 'events.jsonl');
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** A studio-agent SKILL.md valid enough to load, at `<tmp>/skills/<slug>/SKILL.md`. */
function writeAgentSkill(
  tmp: string,
  opts: {
    slug: string;
    guard?: string;
    loopStrategy?: string;
    allowedTools: string[];
    disallowedTools: string[];
    marker: string;
    model?: string;
  },
): AgentDefinition {
  const dir = join(tmp, 'skills', opts.slug);
  mkdirSync(dir, { recursive: true });
  const guards = ['event-log', ...(opts.guard ? [opts.guard] : [])];
  const frontmatter = [
    '---',
    `name: ${opts.slug}`,
    `description: "${opts.slug} — a second factory's own agent (seam F4 test fixture)."`,
    'library: true',
    `phase: ${opts.slug}`,
    'surface: unattended',
    `purpose: Test fixture agent for seam F4 (${opts.slug}).`,
    'composition:',
    '  skills: []',
    '  tools: []',
    '  mcps: []',
    `  guards: [${guards.join(', ')}]`,
    'runtime:',
    '  sdk: claude',
    '  strategy: fixed',
    `  model: ${opts.model ?? 'claude-sonnet-4-6'}`,
    ...(opts.loopStrategy ? [`  loopStrategy: ${opts.loopStrategy}`] : []),
    'brainAccess: none',
    'interactivity: Fully autonomous; never blocks on the operator.',
    `allowed-tools: [${opts.allowedTools.join(', ')}]`,
    `disallowed-tools: [${opts.disallowedTools.join(', ')}]`,
    'budgets: {maxTurns: 10, maxBudgetUsd: 1.0}',
    '---',
    '',
    `# ${opts.slug} skill contract`,
    '',
    `MARKER-${opts.marker}-MARKER — this is ${opts.slug}'s own SKILL.md body, not the canonical agent's.`,
    '',
  ].join('\n');
  writeFileSync(join(dir, 'SKILL.md'), frontmatter);
  return loadAgentDefinition(join(dir, 'SKILL.md'));
}

function makeCtx(overrides: {
  node: { id: string; agent: string };
  agents: Map<string, AgentDefinition>;
  input: NodeExecContext['input'];
  nodeLogger: NodeExecContext['nodeLogger'];
  state?: Partial<NodeRunState>;
}): NodeExecContext {
  const nodeId = overrides.node.id;
  const state: NodeRunState = {
    cycleOutcome: 'ready-for-review',
    reflectionStatus: 'skipped',
    lintStatus: 'skipped',
    reviewerOutcome: 'ready-for-review',
    closure: null,
    terminateEarly: false,
    ...overrides.state,
  };
  return {
    node: overrides.node,
    nodeId,
    kind: 'agent',
    projectGate: { runPreflight: () => { throw new Error('unexpected preflight call in this fixture'); } },
    input: overrides.input,
    nodeLogger: overrides.nodeLogger,
    costLogger: overrides.nodeLogger,
    wedgeDetector: new WedgeDetector({ wedgeKillMs: undefined, nodeId }),
    nodeBudget: undefined,
    state,
    agents: overrides.agents,
    inboundArtifacts: [],
  };
}

// ---------------------------------------------------------------------------
// (a) review-band, non-canonical `docs-review` → the SAME queryFn capture
// technique `adversarial-review-spawn-capture.test.ts` uses.
// ---------------------------------------------------------------------------

test('execAgent: a non-canonical def declaring review-band routes to the review band and spawns under ITS OWN SKILL.md, not adversarial-review\'s', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'band-def-review-'));
  let fx: Fixture | undefined;
  try {
    fx = makeFixture();
    const def = writeAgentSkill(tmp, {
      slug: 'docs-review',
      guard: 'review-band',
      loopStrategy: 'one-shot',
      allowedTools: ['Read', 'Grep', 'Glob'],
      disallowedTools: ['Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'Task', 'Agent'],
      marker: 'docs-review',
    });

    const calls: Array<{ prompt: string; options?: Record<string, unknown> }> = [];
    const queryFn: StreamQueryFn = (params) => {
      calls.push(params);
      return stubQueryFn([(p) => writeFileSync(join(fx!.worktree, '.forge', 'review-findings.json'), validFindingsJson(p))])(params);
    };

    const logsDir = mkdtempSync(join(tmpdir(), 'band-def-review-logs-'));
    const logger = createLogger('CY-band-def-review', logsDir);
    const ctx = makeCtx({
      node: { id: 'review', agent: 'docs-review' },
      agents: new Map([['docs-review', def]]),
      input: { initiativeId: 'INIT-2026-01-01-band-def-review', manifestPath: '', projectRepoPath: fx.worktree, worktreePath: fx.worktree, cycleId: 'CY-band-def-review' },
      nodeLogger: logger,
    });

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
              changeClass: 'code',
            },
            nodeLogger,
            { queryFn, classProfiles: testClassProfilePort(), agentDef: resolvedDef, signal },
          ),
      },
    });

    await executor.run('review', ctx);

    assert.ok(calls.length >= 1, 'the review band spawned at least once — non-canonical dispatch was NOT refused');
    const systemPrompt = String(calls[0]!.options?.systemPrompt ?? '');
    assert.match(systemPrompt, /MARKER-docs-review-MARKER/, 'the spawned system prompt carries docs-review\'s OWN SKILL.md body');
    assert.doesNotMatch(
      systemPrompt,
      /adversarial-review skill contract/,
      'the spawned system prompt must NOT carry the canonical adversarial-review identity',
    );

    // Round 2 item 3: the run's own start/end events name WHO ran — the
    // executing def's own slug, never the canonical 'adversarial-review' literal.
    const events = readEvents(logsDir, 'CY-band-def-review');
    const boundary = events.filter((e) => e.event_type === 'start' || e.event_type === 'end');
    assert.ok(boundary.length >= 2, 'expected a start and an end event for the review band');
    for (const e of boundary) {
      assert.equal(e.skill, 'docs-review', `event.skill must be docs-review, not the canonical literal — got ${JSON.stringify(e)}`);
      assert.equal(
        (e.metadata as { agent_slug?: string } | undefined)?.agent_slug,
        'docs-review',
        `event.metadata.agent_slug must be docs-review — got ${JSON.stringify(e)}`,
      );
    }
  } finally {
    fx?.cleanup();
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (c) wi-contract band, non-canonical `docs-planner`.
// ---------------------------------------------------------------------------

test('execAgent: a non-canonical def declaring wi-contract routes to the PM band and spawns under ITS OWN SKILL.md, not project-manager\'s', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'band-def-pm-'));
  try {
    const def = writeAgentSkill(tmp, {
      slug: 'docs-planner',
      guard: 'wi-contract',
      loopStrategy: 'one-shot',
      allowedTools: ['Read', 'Grep', 'Glob', 'Write', 'Edit'],
      disallowedTools: ['Bash', 'NotebookEdit', 'WebFetch', 'WebSearch'],
      marker: 'docs-planner',
    });

    const worktree = join(tmp, 'projects', 'testproj');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, 'package.json'), JSON.stringify({ name: 'testproj', scripts: { test: 'node --test' } }));
    const manifestPath = join(tmp, 'manifest.md');
    const initiativeId = 'INIT-2026-01-01-band-def-pm';
    writeFileSync(
      manifestPath,
      [
        '---',
        `initiative_id: ${initiativeId}`,
        'project: testproj',
        'project_repo_path: ./projects/testproj',
        'created_at: 2026-01-01T00:00:00Z',
        'iteration_budget: 3',
        'cost_budget_usd: 1',
        'class: code',
        'phase: in-flight',
        'origin: architect',
        '---',
        '',
        '# Test initiative',
        '',
        '## Acceptance criteria',
        '',
        'Given a user, when asked, then it answers.',
        '',
      ].join('\n'),
    );

    const calls: Array<{ prompt: string; options?: Record<string, unknown> }> = [];
    const queryFn: PmQueryFn = (params) => {
      calls.push(params as { prompt: string; options?: Record<string, unknown> });
      return (async function* () {
        const wiDir = resolve(worktree, '.forge', 'work-items');
        mkdirSync(wiDir, { recursive: true });
        writeFileSync(
          join(wiDir, 'WI-1.md'),
          [
            '---',
            'work_item_id: WI-1',
            `initiative_id: ${initiativeId}`,
            'status: pending',
            'depends_on: []',
            'acceptance_criteria:',
            '  - given: "a test"',
            '    when: "the function runs"',
            '    then: "it returns a value"',
            'files_in_scope:',
            '  - src/thing.ts',
            'creates:',
            '  - src/thing.ts',
            'quality_gate_cmd: ["node", "--test", "tests/thing.test.ts"]',
            'estimated_iterations: 1',
            '---',
            '',
            'Body for WI-1.',
            '',
          ].join('\n'),
        );
        writeFileSync(join(wiDir, '_graph.md'), ['```mermaid', 'graph TD', '  WI-1["WI-1"]', '```'].join('\n'));
        yield { type: 'result', subtype: 'success', duration_ms: 1, total_cost_usd: 0.01 };
      })();
    };

    const logsDir = mkdtempSync(join(tmpdir(), 'band-def-pm-logs-'));
    const logger = createLogger('CY-band-def-pm', logsDir);
    const ctx = makeCtx({
      node: { id: 'pm', agent: 'docs-planner' },
      agents: new Map([['docs-planner', def]]),
      input: { initiativeId, manifestPath, projectRepoPath: worktree, worktreePath: worktree },
      nodeLogger: logger,
    });

    const executor = createPhaseExecutor({
      classProfiles: testClassProfilePort(),
      deps: {
        runProjectManager: (input, nodeLogger, resolvedDef, signal) =>
          realRunProjectManager(input, nodeLogger, { queryFn, classProfiles: testClassProfilePort(), agentDef: resolvedDef, signal }),
      },
    });

    await executor.run('pm', ctx);

    assert.ok(calls.length >= 1, 'the PM band spawned at least once — non-canonical dispatch was NOT refused');
    const systemPrompt = String(calls[0]!.options?.systemPrompt ?? '');
    assert.match(systemPrompt, /MARKER-docs-planner-MARKER/, 'the spawned system prompt carries docs-planner\'s OWN SKILL.md body');
    assert.doesNotMatch(
      systemPrompt,
      /project-manager skill contract/,
      'the spawned system prompt must NOT carry the canonical project-manager identity',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (b) ralph loopStrategy, non-canonical `docs-writer` — decomposed (see
// header): dispatch half (execAgent → execDev → deps.runDeveloperLoop) +
// prompt half (buildDevSystemPrompt).
// ---------------------------------------------------------------------------

test('execAgent: a non-canonical def declaring loopStrategy ralph routes to the dev-loop band with ITS OWN def, not developer-ralph\'s', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'band-def-dev-'));
  try {
    const def = writeAgentSkill(tmp, {
      slug: 'docs-writer',
      loopStrategy: 'ralph',
      allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
      disallowedTools: ['NotebookEdit', 'WebFetch', 'WebSearch'],
      marker: 'docs-writer',
    });

    let received: AgentDefinition | undefined;
    const logsDir = mkdtempSync(join(tmpdir(), 'band-def-dev-logs-'));
    const logger = createLogger('CY-band-def-dev', logsDir);
    const ctx = makeCtx({
      node: { id: 'dev', agent: 'docs-writer' },
      agents: new Map([['docs-writer', def]]),
      input: { initiativeId: 'INIT-2026-01-01-band-def-dev', manifestPath: '', projectRepoPath: tmp, worktreePath: tmp },
      nodeLogger: logger,
    });

    const executor = createPhaseExecutor({
      classProfiles: testClassProfilePort(),
      deps: {
        // runDeveloperLoop cannot be spawned for real in a test (no injectable
        // queryFn — see the header note); this stub proves the DISPATCH half —
        // execAgent routes the non-canonical ralph def to execDev, which
        // resolves and threads THIS def, never developer-ralph's.
        runDeveloperLoop: async (_input, _nodeLogger, resolvedDef) => {
          received = resolvedDef;
        },
      },
    });

    await executor.run('dev', ctx);

    assert.ok(received, 'execAgent did not refuse the non-canonical ralph def — the dev-loop band ran');
    assert.equal(received!.slug, 'docs-writer', 'the dev-loop band received docs-writer\'s OWN def, not a hardcoded canonical one');

    // The prompt half: the exact function the dev loop calls for its
    // per-iteration system prompt reads THIS def's own SKILL.md.
    const prompt = buildDevSystemPrompt(tmp, def);
    assert.match(prompt, /MARKER-docs-writer-MARKER/, 'the dev-loop system prompt carries docs-writer\'s OWN SKILL.md body');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (b2) round 2 item 2 — the dev loop honours the EXECUTING def's model and
// tools, not the canonical DEV_MODEL/DEV_ALLOWED_TOOLS constants. This is the
// exact call (`resolveDevSpawnModel`) `developer-loop.ts`'s live spawn now
// makes; `allowedTools`/`disallowedTools` need no derivation — they are
// already plain fields the spawn reads straight off `agentDef`.
// ---------------------------------------------------------------------------

test('resolveDevSpawnModel: a docs-writer def with a DIFFERENT declared model resolves to ITS OWN model/tier, not developer-ralph\'s DEV_MODEL', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'band-def-dev-model-'));
  try {
    const def = writeAgentSkill(tmp, {
      slug: 'docs-writer-haiku',
      loopStrategy: 'ralph',
      allowedTools: ['Read', 'Grep'],
      disallowedTools: ['Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch'],
      marker: 'docs-writer-haiku',
      model: 'claude-haiku-4-5-20251001',
    });

    const spawnModel = resolveDevSpawnModel(def);
    assert.equal(spawnModel.tier, 'haiku', 'docs-writer-haiku declares haiku — the dev loop must spawn it at haiku');
    assert.equal(spawnModel.model, 'claude-haiku-4-5-20251001');
    assert.notEqual(spawnModel.model, DEV_MODEL, 'must NOT fall back to developer-ralph\'s canonical model');

    // Tools need no derivation at all — the dev loop's live spawn reads
    // `agentDef.allowedTools`/`agentDef.disallowedTools` directly.
    assert.deepEqual(def.allowedTools, ['Read', 'Grep']);
    assert.notDeepEqual(def.allowedTools, DEV_ALLOWED_TOOLS, 'must NOT fall back to developer-ralph\'s canonical tool list');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// (d) a def whose own SKILL.md is absent — no fallback, throws naming both.
// ---------------------------------------------------------------------------

test('loadAgentSkillText: a def whose own SKILL.md cannot be read throws naming the def and the path (no fallback to any other agent\'s file)', () => {
  const missingPath = join(mkdtempSync(join(tmpdir(), 'band-def-missing-')), 'skills', 'docs-ghost', 'SKILL.md');
  const ghost: AgentDefinition = {
    slug: 'docs-ghost',
    name: 'docs-ghost',
    description: 'd',
    purpose: 'p',
    composition: { skills: [], tools: [], mcps: [], guards: [], hooks: [] },
    runtime: { sdk: 'claude', strategy: 'fixed', model: 'claude-sonnet-4-6' },
    brainAccess: 'none',
    interactivity: 'autonomous',
    budgets: {},
    allowedTools: [],
    disallowedTools: [],
    body: '',
    path: missingPath,
  };
  assert.throws(
    () => loadAgentSkillText(ghost),
    (err: Error) => {
      assert.match(err.message, /docs-ghost/, 'the error names the def');
      assert.match(err.message, new RegExp(missingPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the error names the path');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// (e) integrate-band, non-canonical `docs-integrate`. execIntegrate spawns no
// agent (it derives the demo bundle synchronously), but — like every other
// band — the events it emits must carry the EXECUTING node's own def slug,
// historical: never the canonical `demo-agent` literal.
// ---------------------------------------------------------------------------

test('execAgent: a non-canonical def declaring integrate-band routes to the integrate band and its events carry ITS OWN slug, not demo-agent\'s', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'band-def-integrate-'));
  try {
    const def = writeAgentSkill(tmp, {
      slug: 'docs-integrate',
      guard: 'integrate-band',
      loopStrategy: 'one-shot',
      allowedTools: ['Read', 'Grep', 'Glob'],
      disallowedTools: ['Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'WebFetch', 'WebSearch', 'Task', 'Agent'],
      marker: 'docs-integrate',
    });

    const logsDir = mkdtempSync(join(tmpdir(), 'band-def-integrate-logs-'));
    const logger = createLogger('CY-band-def-integrate', logsDir);
    const ctx = makeCtx({
      node: { id: 'integrate', agent: 'docs-integrate' },
      agents: new Map([['docs-integrate', def]]),
      input: {
        initiativeId: 'INIT-2026-01-01-band-def-integrate',
        manifestPath: '',
        projectRepoPath: tmp,
        worktreePath: tmp,
        cycleId: 'CY-band-def-integrate',
      },
      nodeLogger: logger,
    });

    const executor = createPhaseExecutor({
      classProfiles: testClassProfilePort(),
      deps: {
        // Close-contract prep + gate are stubbed no-ops/greens — this test is
        // about event identity, not the gate machinery those already cover.
        commitDevLoopBoundary: () => {},
        enforceDevLoopCloseInvariant: () => {},
        computeDeliveryStats: () => ({ commitsAhead: 1, filesChanged: 1, insertions: 1 }),
        assertNonEmptyDelivery: () => {},
        runMergeBoundaryGate: () => ({ ok: true, evidence: [] }),
        runIntegrate: () => ({ status: 'complete', demoJsonPath: join(tmp, 'demo.json') }),
      },
    });

    await executor.run('integrate', ctx);

    const events = readEvents(logsDir, 'CY-band-def-integrate');
    const boundary = events.filter((e) => e.event_type === 'start' || e.event_type === 'end');
    assert.ok(boundary.length >= 2, 'expected a start and an end event for the integrate band');
    for (const e of boundary) {
      assert.equal(
        e.skill,
        'docs-integrate',
        `event.skill must be docs-integrate, not the canonical 'demo-agent' literal — got ${JSON.stringify(e)}`,
      );
      assert.equal(
        (e.metadata as { agent_slug?: string } | undefined)?.agent_slug,
        'docs-integrate',
        `event.metadata.agent_slug must be docs-integrate — got ${JSON.stringify(e)}`,
      );
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
