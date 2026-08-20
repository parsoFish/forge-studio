/**
 * W7-B3 pinned tests — the community-refresh turn actually works end to end
 * (findings community-13, sessions-kinds-32, home-sessions-06, community-01;
 * bead forge-bzt.8).
 *
 * Three root causes pinned here, all in the generic interactive spine:
 *
 *  1. TURN BUDGET (community-13): `runAgentTurn` hard-defaulted every
 *     interactive agent turn to `maxTurns: 16` — a real sonnet
 *     community-refresh run died at exactly 16 tool calls (2×TodoWrite,
 *     2×Read, 12×WebFetch — zero writes left for the three staging files)
 *     and crashed with "produced no files". The budget must come from the
 *     agent's OWN SKILL.md `budgets.maxTurns` (the same field every
 *     unattended agent already declares), with the 16 default surviving
 *     ONLY for a skill that declares none.
 *
 *  2. WRITE-ROOT ADDRESSING (sessions-kinds-32 / home-sessions-06): the turn
 *     prompt said "Write your output into the following sub-directory of
 *     your working directory: staging" — a RELATIVE instruction the live
 *     agent resolved against the wrong base (beside `status.registryPath`,
 *     landing three files in the repo at studio/community/staging/). The
 *     prompt must name the ABSOLUTE, fence-resolved write root(s) — the
 *     EXACT realpaths `runAgentTurn`'s canUseTool fence accepts (W7-A2
 *     made that fence real; this makes the instruction agree with it).
 *
 *  3. BRIEF (community-08, the prompt half): an operator-supplied
 *     `status.brief` ("find me skills for X") must reach the agent's
 *     prompt — the SKILL turns it into targeted hub queries. The status
 *     JSON is inlined into the prompt by the spine, so this pins the
 *     wire-through rather than trusting it silently.
 *
 * Harness mirrors orchestrator/interactive-runner.test.ts exactly (isolated
 * tempdir fixture tree, real loadSessionKinds parse, stubbed queryFn) — only
 * the LLM call is stubbed; spec/model/prompt derivation runs against the
 * REAL skills roster (community-refresh / project-brain-builder are real
 * installed skills).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInteractiveTurn } from './interactive-runner.ts';
import { loadSessionKinds, type SessionKindDescriptor } from './studio/session-kinds.ts';
import { writeSessionStatus, type QueryFn } from './interactive-session.ts';
import { createLogger } from './logging.ts';
import { loadAgentDefinition } from './studio/registry.ts';
import { skillPath } from './skill-path.ts';

// ---------------------------------------------------------------------------
// Fixture yaml — two rows, both real-parsed through loadSessionKinds. The
// first names the REAL community-refresh agent (its SKILL.md declares the
// raised budgets.maxTurns this file pins); the second names
// project-brain-builder (budgets: {} — the surviving-default case).
// ---------------------------------------------------------------------------

const FIXTURE_SESSION_KINDS_YAML = `
- id: cr-test-kind
  agent: community-refresh
  title: Community Refresh Budget/Prompt Test Kind
  stages: [community]
  defaultStage: community
  artifact: { kind: file-package, label: "Registry draft" }
  turnSpec:
    kindDir: _crtest
    style: agent
    phases:
      - { phase: gathering, step: agent, writes: [staging], next: awaiting-review }
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

type TestStatus = {
  session_id: string;
  phase: string;
  updated_at: string;
  brief?: string;
  registryPath?: string;
  hubsPath?: string;
};

type Fixture = {
  forgeRoot: string;
  projectRoot: string;
  logsRoot: string;
  sessionId: string;
};

function setup(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'interactive-runner-community-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_SESSION_KINDS_YAML);
  const projectRoot = join(root, 'project');
  mkdirSync(projectRoot, { recursive: true });
  const logsRoot = join(root, '_logs');
  return { forgeRoot, projectRoot, logsRoot, sessionId: '2026-08-20T00-00-00' };
}

function descriptorFor(forgeRoot: string, id: string): SessionKindDescriptor {
  const found = loadSessionKinds(forgeRoot).find((d) => d.id === id);
  if (!found) throw new Error(`test fixture bug: no descriptor "${id}" in the fixture yaml`);
  return found;
}

/** Captures the exact `{prompt, options}` runAgentTurn hands the SDK, and
 *  performs the staging write the runner's own post-turn check requires. */
function capturingQueryFn(sessionDir: string, captured: { prompt?: string; options?: Record<string, unknown> }): QueryFn {
  return (params) => {
    captured.prompt = params.prompt;
    captured.options = params.options;
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'registry.yaml'), 'meta: {}\n');
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };
}

async function runCapturedTurn(kindId: string, kindDir: string, statusExtra: Partial<TestStatus> = {}): Promise<{
  prompt: string;
  options: Record<string, unknown>;
  sessionDir: string;
}> {
  const { forgeRoot, projectRoot, logsRoot, sessionId } = setup();
  const sessionDir = join(projectRoot, kindDir, sessionId);
  mkdirSync(sessionDir, { recursive: true });
  const phase = kindId === 'cr-test-kind' ? 'gathering' : 'analyzing';
  writeSessionStatus<TestStatus>(sessionDir, {
    session_id: sessionId,
    phase,
    updated_at: new Date().toISOString(),
    ...statusExtra,
  });
  const captured: { prompt?: string; options?: Record<string, unknown> } = {};
  await runInteractiveTurn(descriptorFor(forgeRoot, kindId), {
    sessionId,
    projectRoot,
    forgeRoot,
    logsRoot,
    queryFn: capturingQueryFn(sessionDir, captured),
    logger: createLogger(`_interactive-runner-community-test-${sessionId}`, logsRoot),
  });
  assert.ok(captured.prompt !== undefined && captured.options !== undefined, 'the agent turn must have run');
  return { prompt: captured.prompt!, options: captured.options!, sessionDir };
}

// ---------------------------------------------------------------------------
// 1. Turn budget from the SKILL (community-13)
// ---------------------------------------------------------------------------

test('community-refresh SKILL.md declares a raised budgets.maxTurns (the 16-call ceiling killed a real run)', () => {
  const def = loadAgentDefinition(skillPath('community-refresh'));
  assert.ok(
    typeof def.budgets.maxTurns === 'number' && def.budgets.maxTurns >= 40,
    `skills/community-refresh/SKILL.md must declare budgets.maxTurns >= 40 (got ${String(def.budgets.maxTurns)}) — a full 9-item verification pass needs ~2 fetches per item plus 3 staging writes; 16 provably starves it (community-13)`,
  );
});

test('interactive agent turn threads the SKILL-declared budgets.maxTurns into the SDK options', async () => {
  const declared = loadAgentDefinition(skillPath('community-refresh')).budgets.maxTurns;
  const { options } = await runCapturedTurn('cr-test-kind', '_crtest');
  assert.equal(
    options.maxTurns,
    declared,
    `runAgentTurn must receive the SKILL-declared maxTurns (${String(declared)}), not the hardcoded 16 default`,
  );
});

test('an agent whose SKILL declares no budgets.maxTurns keeps the prior 16 default', async () => {
  const def = loadAgentDefinition(skillPath('project-brain-builder'));
  assert.equal(def.budgets.maxTurns, undefined, 'arrange: project-brain-builder must genuinely declare no maxTurns');
  const { options } = await runCapturedTurn('default-budget-kind', '_defaultbudget');
  assert.equal(options.maxTurns, 16, 'no-declaration kinds must keep the exact prior default');
});

// ---------------------------------------------------------------------------
// 2. The prompt names the ABSOLUTE fence-resolved write root
//    (sessions-kinds-32 / home-sessions-06)
// ---------------------------------------------------------------------------

test('turn prompt names the absolute session staging path, never a bare relative "staging"', async () => {
  const { prompt, sessionDir } = await runCapturedTurn('cr-test-kind', '_crtest', {
    registryPath: '/somewhere/studio/community/registry.yaml',
  });
  const absStaging = join(realpathSync(sessionDir), 'staging');
  assert.ok(
    prompt.includes(absStaging),
    `the prompt must name the fence's own absolute write root (${absStaging}) — the relative instruction let a live agent resolve "staging" beside registryPath and crash the session (sessions-kinds-32)`,
  );
  // The instruction sentence itself must be anchored to the absolute path,
  // not merely mention it somewhere while still instructing a relative write.
  assert.ok(
    !/following sub-director(y|ies) of your working directory: staging\b/.test(prompt),
    'the old relative-only instruction sentence must be gone',
  );
});

// ---------------------------------------------------------------------------
// 3. An operator brief reaches the prompt (community-08, prompt half)
// ---------------------------------------------------------------------------

test('status.brief is carried into the turn prompt for the agent to act on', async () => {
  const { prompt } = await runCapturedTurn('cr-test-kind', '_crtest', {
    brief: 'find me skills for terraform drift detection',
  });
  assert.ok(
    prompt.includes('find me skills for terraform drift detection'),
    'the operator brief must be visible to the agent (the status JSON is the wire — pin it, never assume it)',
  );
});
