/**
 * Characterization (golden) test — pins the EXACT `{prompt, options}` object
 * `runAgent`'s generic one-shot path (`runOneShotSpawn`, `orchestrator/run-
 * agent.ts`) builds for a plain (non-band) roster agent, so the R4-01
 * `composition.hooks` → `composition.guards` vocabulary migration can prove
 * byte-level no-behavioural-delta on the generic runnable primitive itself
 * (not just the four band pipelines pm/reflector/demo-agent/adversarial-
 * review already cover).
 *
 * Injection: `RunContext.queryFn` — the same DI seam `run-agent.test.ts`
 * already uses (`capturingQueryFn`). No production code changed for this test.
 *
 * Base def: `project-scoped-review`, loaded for real via `loadAgentDefinition`
 * (through `listAgentDefinitions`) — the exact same on-disk `skills/project-
 * scoped-review/SKILL.md` `run-agent.test.ts`'s own `oneShotClone` fixture
 * uses. That SKILL.md declares NO `runtime.loopStrategy` and an empty
 * `budgets: {}` — it is a real, shipped, non-band roster agent, but not one
 * that runs through the one-shot path AS SHIPPED today (see the header note
 * below on why every currently-shipped `loopStrategy: one-shot` agent is also
 * a band agent). This test clones it in-memory with a declared
 * `runtime.loopStrategy: 'one-shot'` and fixed test budgets — mirroring
 * `run-agent.test.ts`'s `oneShotClone` helper exactly — to exercise
 * `runOneShotSpawn`'s option-building logic. The clone's `path` still points
 * at the real SKILL.md, so `allowedTools`/`disallowedTools`/`model` are
 * derived from shipped data (`deriveAgentSpec` re-reads `def.path` from disk);
 * only `runtime.loopStrategy` and `budgets` are test-applied, exactly as
 * `run-agent.test.ts` already establishes as the correct way to exercise this
 * seam without a hand-built def.
 *
 * NOTE (roster surprise, reported to the task owner): as of this writing,
 * EVERY roster agent that declares `loopStrategy: one-shot`
 * (project-manager, reflector, demo-agent, adversarial-review) is ALSO a band
 * agent (declares one of the four `BAND_HOOK_IDS` in `composition.hooks`).
 * There is currently no shipped agent that is simultaneously "generic" (no
 * band hook) AND "one-shot" — the R4-01-F2 migration onto declared
 * `loopStrategy` happened exactly for those four phase pipelines. This test's
 * clone-with-override is therefore the only way to pin the *primitive's*
 * generic one-shot shape today; `dispatch-decision-capture.test.ts` pins the
 * REAL (unmodified) roster's dispatch table separately.
 *
 * What's pinned: the full captured `{prompt, options}` — `cwd`, `systemPrompt`,
 * `model`, `permissionMode`, `allowedTools`, `disallowedTools`, `maxTurns`,
 * `maxBudgetUsd`. No `streamGuard` is passed, so (mirroring the reflector's
 * shape) there is no `abortController` key at all — this test deliberately
 * covers the OTHER branch from the PM/demo-agent/adversarial-review fixtures,
 * which all pass a streamGuard.
 *
 * Normalized (genuinely volatile, not a behavioural signal):
 *  - the mkdtemp root (appears in `cwd`) -> `<TMP>`.
 *
 * Bootstrap / regenerate:
 *   UPDATE_SNAPSHOT=1 node --experimental-strip-types --test orchestrator/run-agent-spawn-capture.test.ts
 * (or delete the fixture) rewrites
 * orchestrator/test-fixtures/spawn-capture/generic-one-shot.json from current code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runAgent } from './run-agent.ts';
import { listAgentDefinitions } from '../../orchestrator/studio/registry.ts';
import { skillsDir } from './skill-path.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';
import type { AgentDefinition } from '@forge/contracts/studio/types.ts';
import { normalizeForSnapshot, assertMatchesJsonSnapshot } from '../../orchestrator/test-fixtures/spawn-capture/normalize.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');
const FIXTURE_PATH = resolve(FORGE_ROOT, 'orchestrator', 'test-fixtures', 'spawn-capture', 'generic-one-shot.json');

const AGENT_SLUG = 'project-scoped-review';
const RUN_ID = 'SPAWN-CAPTURE-TEST-run-agent-generic-one-shot';

/**
 * Save + delete the spawn-suppression env vars so this test exercises the
 * real (non-suppressed) spawn path deterministically, regardless of what the
 * ambient shell/CI has set — mirrors `run-agent.test.ts`'s own helper.
 */
function withoutSpawnSuppressionEnv(): () => void {
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  return () => {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
  };
}

/** Clone a real on-disk roster def with a declared one-shot runtime + fixed
 * test budgets (see header note) — `path` still points at the real SKILL.md. */
function oneShotClone(def: AgentDefinition): AgentDefinition {
  return {
    ...def,
    runtime: { ...def.runtime, loopStrategy: 'one-shot' },
    budgets: { maxTurns: 25, maxBudgetUsd: 3.5 },
  };
}

function capturingQueryFn(captured: { value: { prompt: string; options: Record<string, unknown> } | null }): StreamQueryFn {
  return ((params: { prompt: string; options: Record<string, unknown> }) => {
    captured.value = { prompt: params.prompt, options: params.options };
    async function* gen(): AsyncGenerator<unknown> {
      yield {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.01,
        duration_ms: 1,
        usage: { input_tokens: 1, output_tokens: 1 },
      };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

test('runAgent generic one-shot: pins the exact {prompt, options} spawn call built by runOneShotSpawn (characterization)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const dir = mkdtempSync(join(tmpdir(), 'forge-run-agent-spawn-capture-'));
  try {
    const defs = listAgentDefinitions(skillsDir(FORGE_ROOT));
    const base = defs.find((d) => d.slug === AGENT_SLUG);
    assert.ok(base, `expected the ${AGENT_SLUG} library fixture in the roster`);
    assert.equal(
      base!.runtime.loopStrategy,
      undefined,
      'sanity: the on-disk def declares no loopStrategy — the one-shot override below is test-applied, not shipped data (see header note)',
    );
    const def = oneShotClone(base!);

    const captured: { value: { prompt: string; options: Record<string, unknown> } | null } = { value: null };

    await runAgent(def, {
      runId: RUN_ID,
      workdir: dir,
      prompt: 'SPAWN-CAPTURE-TEST fixed prompt for the generic one-shot primitive.',
      systemPrompt: 'SPAWN-CAPTURE-TEST fixed system prompt.',
      logsRoot: join(dir, '_logs'),
      queryFn: capturingQueryFn(captured),
    });

    assert.ok(captured.value, 'queryFn must have been invoked exactly once with the spawn call');
    const normalized = normalizeForSnapshot(captured.value, [{ value: dir, placeholder: '<TMP>' }]);
    assertMatchesJsonSnapshot(FIXTURE_PATH, normalized);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    restoreEnv();
  }
});
