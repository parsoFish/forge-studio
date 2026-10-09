/**
 * The develop factory's demo planner (forge-mfv5.1.19, D-45) through the REAL
 * `runAgent` and the real `demo-agent` SKILL.md, with an injected `queryFn` in
 * place of the SDK — no model, no network. Pins what the planner is shown (user
 * stories, ACs, only the allowed means), that its reply is parsed as inert
 * data, and that a suppressed spawn is reported, never faked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadAgentDefinition, skillPath, type StreamQueryFn } from '@forge/agents';
import type { DemoPlannerInput } from '@forge/stations';
import type { EventLogger } from '@forge/kernel';

import { createDemoPlanner, extractPlanJson } from './demo-planner.ts';

const def = loadAgentDefinition(skillPath('demo-agent'));
// runAgent roots its spawn marker two levels above the logger's file — a tmp dir, never the repo's _logs.
const logger = { emit: (e: unknown) => e, logFilePath: join(mkdtempSync(join(tmpdir(), 'demo-planner-logs-')), 'run', 'events.jsonl') } as unknown as EventLogger;
const PLAN = { narrative: 'Admins can read the org back.', checkpoints: [{ form: 'test-evidence', caption: 'Gate output' }] };

function input(): DemoPlannerInput {
  return {
    initiativeId: 'INIT-2026-10-09-x', cycleId: 'cycle-1', worktreePath: mkdtempSync(join(tmpdir(), 'demo-planner-')), title: 'Read the org',
    workItems: [{ id: 'WI-1', title: 'Org read', story: 'As a platform admin I want to read the org back.' }],
    acceptanceCriteria: ['(WI-1) GIVEN an org WHEN `gitweave org show --json` runs THEN it prints the org'],
    diffStat: '1 file changed', changedFiles: ['src/org.py'],
    allowed: { commands: [], routes: [], apiPaths: [], apiCommands: ['gitweave org show --json'] },
  };
}

function replying(text: string, subtype = 'success'): { queryFn: StreamQueryFn; seen: Array<{ prompt: string; options?: Record<string, unknown> }> } {
  const seen: Array<{ prompt: string; options?: Record<string, unknown> }> = [];
  const queryFn = (({ prompt, options }: { prompt: string; options?: Record<string, unknown> }) => {
    seen.push({ prompt, options });
    return (async function* () {
      yield { type: 'result', subtype, result: text, duration_ms: 1, total_cost_usd: 0.03 };
    })();
  }) as unknown as StreamQueryFn;
  return { queryFn, seen };
}

test('the planner is shown the user stories, the ACs and only the allowed means; its reply is the plan', async () => {
  const { queryFn, seen } = replying(`Here is the plan.\n\`\`\`json\n${JSON.stringify(PLAN)}\n\`\`\``);
  const out = await createDemoPlanner({ queryFn }).plan(def, input(), logger);
  assert.deepEqual(out, { ok: true, raw: PLAN, costUsd: 0.03 });
  const { prompt, options } = seen[0]!;
  assert.match(prompt, /As a platform admin I want to read the org back\./);
  assert.match(prompt, /WHEN `gitweave org show --json` runs/);
  assert.match(prompt, /API commands \(api-before-after, prints JSON\):\n- `gitweave org show --json`/);
  assert.match(String(options?.systemPrompt), /demo-agent skill — the demo planner/);
  assert.deepEqual(options?.allowedTools, [], 'the planner runs nothing');
});

test('a reply with no plan JSON is no-plan; a budget-killed turn is spawn-failed — both carry their cost', async () => {
  assert.deepEqual(await createDemoPlanner(replying('I could not decide.')).plan(def, input(), logger),
    { ok: false, reason: 'no-plan', detail: 'the reply carried no plan JSON', costUsd: 0.03 });
  const killed = await createDemoPlanner(replying('{}', 'error_max_turns')).plan(def, input(), logger);
  assert.equal(killed.ok, false);
  assert.equal(!killed.ok && killed.reason, 'spawn-failed');
});

test('a harness that suppresses spawns gets spawn-suppressed, never a plan', async () => {
  const prev = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    assert.deepEqual(await createDemoPlanner().plan(def, input(), logger), { ok: false, reason: 'spawn-suppressed', detail: 'FORGE_DRY_BRIDGE' });
  } finally {
    if (prev === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prev;
  }
});

test('extractPlanJson: a fenced block wins; a bare object parses; prose is null', () => {
  assert.deepEqual(extractPlanJson('x\n```json\n{"a":1}\n```\ny'), { a: 1 });
  assert.deepEqual(extractPlanJson(' {"a":2} '), { a: 2 });
  assert.equal(extractPlanJson('no plan'), null);
});
