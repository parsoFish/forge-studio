/**
 * ACCEPTANCE TESTS (W7-B5, agents-21 / agents-23 / agents-31) — cost-ceiling
 * enforcement on the LEGACY invocation path, ceiling provenance on the START
 * event, and per-turn transcript events for standalone runs.
 *
 * HONESTY BOUND (same as run-agent-ceiling.test.ts's header): forge does not
 * halt spend in-process — the SDK does, keyed off the options it is handed.
 * The legacy-path assertions below therefore pin the observable call record:
 * `createClaudeAgent` builds `options.maxBudgetUsd` from its
 * `maxBudgetUsdPerIteration` opt and `options.maxTurns` from
 * `maxTurnsPerIteration` (loops/ralph/claude-agent.ts:227-228), and one
 * invocation-path run is exactly ONE iteration, so a per-iteration cap IS the
 * run ceiling. The injected `queryFn` captures the options the SDK would have
 * read.
 *
 * WHY THIS AMENDS THE R6-04 REFUSAL PINS: run-agent-ceiling.test.ts (R6-04)
 * pinned "a ceiling on a non-one-shot agent is REFUSED" because the legacy
 * path then had NO budget wiring at all — an accepted-but-unenforced ceiling
 * would have been a lie. W7-B5 adds the wiring (this file's own assertions
 * prove enforcement reaches the SDK call), so the refusal is retired for the
 * legacy path and RETAINED for 'ralph' (a standalone ralph dispatch is
 * refused outright by runAgent — there is no run to cap). The corresponding
 * R6-04 tests are amended in the same commit, per the wave-7 lane brief
 * ("cost-ceiling gate for all agents").
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from './run-agent.ts';
import { listAgentDefinitions } from './studio/registry.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';
import type { AgentDefinition } from './studio/types.ts';

const ROOT = process.cwd();

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

function getFixtureDef(defs: AgentDefinition[], slug: string): AgentDefinition {
  const def = defs.find((d) => d.slug === slug);
  assert.ok(def, `expected the ${slug} agent in the roster`);
  return def!;
}

/** Legacy-path def: NO loopStrategy (the invocation-spawn road runAgent takes
 *  for 'project-scoped-review' and its 13 siblings), with injectable budgets. */
function legacyClone(def: AgentDefinition, budgets: AgentDefinition['budgets'] = {}): AgentDefinition {
  const runtime = { ...def.runtime };
  delete (runtime as { loopStrategy?: unknown }).loopStrategy;
  return { ...def, runtime, budgets };
}

type Captured = { prompt: unknown; options: Record<string, unknown> };

/** Fake queryFn that records the options the SDK would read, then yields one
 *  successful result — the canonical stub shape (run-agent.test.ts). */
function capturingQueryFn(captured: Captured[], costUsd = 0.05): StreamQueryFn {
  return ((params: { prompt: unknown; options?: Record<string, unknown> }) => {
    captured.push({ prompt: params.prompt, options: params.options ?? {} });
    async function* gen() {
      yield { type: 'result', subtype: 'success', total_cost_usd: costUsd, usage: { input_tokens: 3, output_tokens: 4 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

/** Fake queryFn that first streams one assistant message carrying a tool_use
 *  block + a text block, then the result — the per-turn transcript ground. */
function transcriptQueryFn(captured: Captured[]): StreamQueryFn {
  return ((params: { prompt: unknown; options?: Record<string, unknown> }) => {
    captured.push({ prompt: params.prompt, options: params.options ?? {} });
    async function* gen() {
      yield {
        type: 'assistant',
        message: {
          id: 'msg_1',
          content: [
            { type: 'text', text: 'Reading the contract file first.' },
            { type: 'tool_use', name: 'Read', input: { file_path: '/tmp/x.md' } },
          ],
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      };
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.07, usage: { input_tokens: 10, output_tokens: 5 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

function readEvents(logsRoot: string, runId: string): Array<Record<string, unknown>> {
  return readFileSync(join(logsRoot, runId, 'events.jsonl'), 'utf8')
    .trim().split('\n').filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Legacy invocation path: the ceiling is ENFORCED (reaches the SDK options)
// ---------------------------------------------------------------------------

test('legacy path: ctx.kickoffCeilingUsd reaches options.maxBudgetUsd (agents-21 — the six no-loopStrategy agents are no longer uncapped)', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const logsRoot = mkdtempSync(join(tmpdir(), 'w7b5-legacy-ceiling-'));
  try {
    const def = legacyClone(getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review'));
    const captured: Captured[] = [];
    const result = await runAgent(def, {
      runId: '_agent-psr-ceiling',
      workdir: logsRoot,
      prompt: 'test',
      logsRoot,
      kickoffCeilingUsd: 4.5,
      queryFn: capturingQueryFn(captured),
    });
    assert.equal(result.suppressed, false);
    assert.equal(captured.length, 1, 'the SDK was invoked exactly once');
    assert.equal(captured[0].options['maxBudgetUsd'], 4.5, 'the operator ceiling must reach the SDK call record');
  } finally {
    restore();
    rmSync(logsRoot, { recursive: true, force: true });
  }
});

test('legacy path: no ceiling, declared budgets → options.maxBudgetUsd/maxTurns from def.budgets (the declared budget becomes REAL on this path)', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const logsRoot = mkdtempSync(join(tmpdir(), 'w7b5-legacy-budget-'));
  try {
    const def = legacyClone(
      getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review'),
      { maxTurns: 33, maxBudgetUsd: 2.75 },
    );
    const captured: Captured[] = [];
    await runAgent(def, {
      runId: '_agent-psr-budget',
      workdir: logsRoot,
      prompt: 'test',
      logsRoot,
      queryFn: capturingQueryFn(captured),
    });
    assert.equal(captured[0].options['maxBudgetUsd'], 2.75);
    assert.equal(captured[0].options['maxTurns'], 33);
  } finally {
    restore();
    rmSync(logsRoot, { recursive: true, force: true });
  }
});

test('legacy path: neither ceiling nor budget → NO maxBudgetUsd key in the SDK options (control: no fabricated cap)', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const logsRoot = mkdtempSync(join(tmpdir(), 'w7b5-legacy-nocap-'));
  try {
    const def = legacyClone(getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review'));
    const captured: Captured[] = [];
    await runAgent(def, {
      runId: '_agent-psr-nocap',
      workdir: logsRoot,
      prompt: 'test',
      logsRoot,
      queryFn: capturingQueryFn(captured),
    });
    assert.ok(!('maxBudgetUsd' in captured[0].options), 'no cap declared anywhere ⇒ no maxBudgetUsd key');
  } finally {
    restore();
    rmSync(logsRoot, { recursive: true, force: true });
  }
});

test('runAgent still throws for a ralph-strategy agent, ceiling or not (the standalone primitive never drives a loop)', async () => {
  const defs = listAgentDefinitions(join(ROOT, 'skills'));
  const ralph = getFixtureDef(defs, 'developer-ralph');
  await assert.rejects(
    () => runAgent(ralph, { runId: '_agent-ralph-x', workdir: '/tmp', prompt: 'test', kickoffCeilingUsd: 5 }),
    /ralph/,
  );
});

// ---------------------------------------------------------------------------
// Ceiling provenance on the START event (agents-31)
// ---------------------------------------------------------------------------

test('start event carries kickoff_ceiling_usd when a ceiling is in force (one-shot self lifecycle) — a failed/running run can still surface its ceiling', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const logsRoot = mkdtempSync(join(tmpdir(), 'w7b5-start-ceiling-'));
  try {
    const base = getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review');
    const def: AgentDefinition = { ...base, runtime: { ...base.runtime, loopStrategy: 'one-shot' }, budgets: {} };
    const captured: Captured[] = [];
    const runId = '_agent-psr-startceil';
    await runAgent(def, {
      runId,
      workdir: logsRoot,
      prompt: 'test',
      logsRoot,
      kickoffCeilingUsd: 6.25,
      queryFn: capturingQueryFn(captured),
    });
    const events = readEvents(logsRoot, runId);
    const start = events.find((e) => e.event_type === 'start');
    assert.ok(start, 'a start event exists');
    assert.equal((start!.metadata as Record<string, unknown>).kickoff_ceiling_usd, 6.25,
      'the ceiling must be recorded at start time, not only on the terminal end event');
  } finally {
    restore();
    rmSync(logsRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Per-turn transcript events (agents-23)
// ---------------------------------------------------------------------------

test('one-shot self lifecycle: an assistant tool_use block lands as a tool_use event in the run log (agents-23 — a run is more than start+end)', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const logsRoot = mkdtempSync(join(tmpdir(), 'w7b5-turns-oneshot-'));
  try {
    const base = getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review');
    const def: AgentDefinition = { ...base, runtime: { ...base.runtime, loopStrategy: 'one-shot' }, budgets: {} };
    const captured: Captured[] = [];
    const runId = '_agent-psr-turns1';
    await runAgent(def, {
      runId,
      workdir: logsRoot,
      prompt: 'test',
      logsRoot,
      queryFn: transcriptQueryFn(captured),
    });
    const events = readEvents(logsRoot, runId);
    const tool = events.find((e) => e.event_type === 'tool_use');
    assert.ok(tool, `expected a tool_use event in the run log (got types ${JSON.stringify(events.map((e) => e.event_type))})`);
    assert.equal((tool!.metadata as Record<string, unknown>).tool, 'Read');
  } finally {
    restore();
    rmSync(logsRoot, { recursive: true, force: true });
  }
});

test('legacy invocation path: the adapter-observed tool_use reaches the run log too (agents-23 for the 14 legacy-path agents)', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const logsRoot = mkdtempSync(join(tmpdir(), 'w7b5-turns-legacy-'));
  try {
    const def = legacyClone(getFixtureDef(listAgentDefinitions(join(ROOT, 'skills')), 'project-scoped-review'));
    const captured: Captured[] = [];
    const runId = '_agent-psr-turns2';
    await runAgent(def, {
      runId,
      workdir: logsRoot,
      prompt: 'test',
      logsRoot,
      queryFn: transcriptQueryFn(captured),
    });
    const events = readEvents(logsRoot, runId);
    const tool = events.find((e) => e.event_type === 'tool_use');
    assert.ok(tool, `expected a tool_use event in the run log (got types ${JSON.stringify(events.map((e) => e.event_type))})`);
    assert.equal((tool!.metadata as Record<string, unknown>).tool, 'Read');
  } finally {
    restore();
    rmSync(logsRoot, { recursive: true, force: true });
  }
});
