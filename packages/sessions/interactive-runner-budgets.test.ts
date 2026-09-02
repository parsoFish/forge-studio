/**
 * Turn-budget threading for the GENERIC interactive spine — W8-B5b.
 *
 * WHY THIS FILE EXISTS. These two tests are not new. They lived in
 * `orchestrator/interactive-runner-community.test.ts`, which W8-B5b deleted
 * wholesale along with the `community-refresh` session kind. That file was
 * mostly kind-specific and deleting it was right, but it also contained these
 * two, which are about the GENERIC spine and not about that kind at all — the
 * default-budget one already used `project-brain-builder` as its subject and
 * never mentioned community-refresh.
 *
 * Deleting them took the ONLY assertion of
 * `packages/sessions/interactive-session.ts`'s `maxTurns: args.maxTurns ?? 16` with
 * them: after the retirement, a repo-wide grep for a test asserting that
 * default returned nothing. The `?? 16` branch would have shipped unguarded.
 * That is the "excise the block, keep the file" rule failing at the granularity
 * of a whole-file delete — the block worth keeping was inside the file being
 * removed — so it is restored here on surviving subjects instead.
 *
 * SUBJECTS, both real installed skills, chosen so neither test depends on a
 * retired kind:
 *   - `onboarding-agent` declares `budgets.maxTurns: 60` and backs a real
 *     surviving session kind ⇒ the DECLARED-budget path.
 *   - `project-brain-builder` declares no `maxTurns` at all ⇒ the DEFAULT path.
 * Each test asserts its subject's own declaration first, so the day a skill's
 * frontmatter changes the test says "arrange" failed rather than silently
 * testing the other branch.
 *
 * Harness mirrors `packages/sessions/interactive-runner.test.ts`: isolated tempdir
 * fixture tree, real `loadSessionKinds` parse, stubbed `queryFn`. Only the LLM
 * call is stubbed — spec/model/budget derivation runs against the REAL skills
 * roster.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInteractiveTurn } from './interactive-runner.ts';
import { loadSessionKinds, type SessionKindDescriptor } from './studio/session-kinds.ts';
import { writeSessionStatus, type QueryFn } from './interactive-session.ts';
import { createLogger } from '@forge/kernel';
import { loadAgentDefinition } from '../../orchestrator/studio/registry.ts';
import { skillPath } from '@forge/agents/skill-path.ts';

/** Two rows, both real-parsed through `loadSessionKinds`. The agents are real;
 *  only the kind ids and directories are fixture-local, so this file pins the
 *  spine's budget derivation without depending on any shipped descriptor's
 *  phase table staying the shape it has today. */
const FIXTURE_SESSION_KINDS_YAML = `
- id: declared-budget-kind
  agent: onboarding-agent
  title: Declared Budget Test Kind
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _declaredbudget
    style: agent
    phases:
      - { phase: analyzing, step: agent, writes: [staging], next: awaiting-review }
      - { phase: awaiting-review, step: noop }
- id: default-budget-kind
  agent: project-brain-builder
  title: Default Budget Test Kind
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _defaultbudget
    style: agent
    phases:
      - { phase: analyzing, step: agent, writes: [staging], next: awaiting-review }
      - { phase: awaiting-review, step: noop }
`;

type TestStatus = { session_id: string; phase: string; updated_at: string };

function descriptorFor(forgeRoot: string, id: string): SessionKindDescriptor {
  const found = loadSessionKinds(forgeRoot).find((d) => d.id === id);
  if (!found) throw new Error(`test fixture bug: no descriptor "${id}" in the fixture yaml`);
  return found;
}

/** Captures the exact `{prompt, options}` handed to the SDK, and performs the
 *  staging write the runner's own post-turn check requires. */
function capturingQueryFn(sessionDir: string, captured: { options?: Record<string, unknown> }): QueryFn {
  return (params) => {
    captured.options = params.options;
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'draft.md'), '# staged\n');
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };
}

async function runCapturedTurn(kindId: string, kindDir: string): Promise<Record<string, unknown>> {
  const root = mkdtempSync(join(tmpdir(), 'interactive-runner-budgets-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_SESSION_KINDS_YAML);
  const projectRoot = join(root, 'project');
  const logsRoot = join(root, '_logs');
  const sessionId = '2026-08-20T00-00-00';
  const sessionDir = join(projectRoot, kindDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, {
    session_id: sessionId,
    phase: 'analyzing',
    updated_at: new Date().toISOString(),
  });
  const captured: { options?: Record<string, unknown> } = {};
  await runInteractiveTurn(descriptorFor(forgeRoot, kindId), {
    sessionId,
    projectRoot,
    forgeRoot,
    logsRoot,
    queryFn: capturingQueryFn(sessionDir, captured),
    logger: createLogger(`_interactive-runner-budgets-test-${sessionId}`, logsRoot),
  });
  assert.ok(captured.options !== undefined, 'the agent turn must have run');
  return captured.options!;
}

test('interactive agent turn threads the SKILL-declared budgets.maxTurns into the SDK options', async () => {
  const declared = loadAgentDefinition(skillPath('onboarding-agent')).budgets.maxTurns;
  assert.equal(typeof declared, 'number', 'arrange: onboarding-agent must genuinely declare a numeric budgets.maxTurns');
  const options = await runCapturedTurn('declared-budget-kind', '_declaredbudget');
  assert.equal(
    options.maxTurns,
    declared,
    `runAgentTurn must receive the SKILL-declared maxTurns (${String(declared)}), not the hardcoded 16 default`,
  );
});

test('an agent whose SKILL declares no budgets.maxTurns keeps the prior 16 default', async () => {
  const def = loadAgentDefinition(skillPath('project-brain-builder'));
  assert.equal(def.budgets.maxTurns, undefined, 'arrange: project-brain-builder must genuinely declare no maxTurns');
  const options = await runCapturedTurn('default-budget-kind', '_defaultbudget');
  assert.equal(options.maxTurns, 16, 'no-declaration kinds must keep the exact prior default');
});
