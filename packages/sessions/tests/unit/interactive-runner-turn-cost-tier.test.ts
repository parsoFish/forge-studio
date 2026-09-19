/**
 * forge-8vfn.22 — `interactive.turn-cost`'s metadata must carry the turn's
 * model TIER, not just `session_id`/`session_kind`.
 *
 * `resolveKickoffModelTier` validates and persists an operator-chosen tier to
 * `status.json.modelTier`; `resolveSessionModel`/`readRequestedModelTier`
 * resolve it back out and use it as the turn's `model:` at spawn time
 * (`interactive-agent-step.ts`), but the event `emitTurnCostRow` writes
 * (`interactive-runner.ts` ~267) never carried it — an operator (or a cost
 * dashboard) reading the event log cannot tell which tier a priced turn ran
 * on.
 *
 * `creation-agent` is a real, shipped `strategy:range` skill
 * (`skills/creation-agent/SKILL.md`, range `[claude-sonnet-4-6,
 * claude-opus-4-8]`) — used deliberately instead of a `strategy:fixed` agent
 * so a second tier is actually reachable: `resolveSessionModel` throws for any
 * requested tier outside a fixed agent's one legal value, which would make a
 * negative control impossible to construct honestly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInteractiveTurn } from '../../interactive-runner.ts';
import { loadSessionKinds, type SessionKindDescriptor } from '../../studio/session-kinds.ts';
import { writeSessionStatus, type QueryFn } from '../../interactive-session.ts';

const TURN_COST_USD = 0.4231;

/** A real range-strategy agent (creation-agent), a fixture-local kind id and
 *  dir — the spine's emission is what is under test, never a shipped kind's
 *  phases. */
const FIXTURE_SESSION_KINDS_YAML = `
- id: tiercostkind
  agent: creation-agent
  title: Turn Cost Tier Test Kind
  stages: [analyzing]
  defaultStage: analyzing
  artifact: { kind: file-package, label: "Test artifact" }
  turnSpec:
    kindDir: _tiercost
    style: agent
    phases:
      - { phase: analyzing, step: agent, writes: [staging], next: awaiting-review }
      - { phase: awaiting-review, step: noop }
`;

type TestStatus = { session_id: string; phase: string; updated_at: string; modelTier?: string };

function descriptorFor(forgeRoot: string, id: string): SessionKindDescriptor {
  const found = loadSessionKinds(forgeRoot).find((d) => d.id === id);
  if (!found) throw new Error(`test fixture bug: no descriptor "${id}" in the fixture yaml`);
  return found;
}

/** The SDK's own result message carries `total_cost_usd` — mirrors
 *  `interactive-runner-turn-cost.test.ts`'s own fake. */
function pricedQueryFn(sessionDir: string): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'draft.md'), '# staged\n');
      yield { type: 'result', total_cost_usd: TURN_COST_USD };
    }
    return gen();
  };
}

/** Every event row the runner wrote, from the log dir the session route
 *  reads — mirrors `interactive-runner-unpriced-turn.test.ts`'s own helper. */
function eventsUnder(logsRoot: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let dirs: string[] = [];
  try { dirs = readdirSync(logsRoot); } catch { return out; }
  for (const d of dirs) {
    let text: string;
    try { text = readFileSync(join(logsRoot, d, 'events.jsonl'), 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as Record<string, unknown>); } catch { /* a partial line is not this door's business */ }
    }
  }
  return out;
}

function setUp(sessionId: string, modelTier?: string): { forgeRoot: string; projectRoot: string; logsRoot: string; sessionDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'interactive-runner-turn-cost-tier-'));
  const forgeRoot = join(root, 'forge');
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), FIXTURE_SESSION_KINDS_YAML);
  const projectRoot = join(root, 'project');
  const logsRoot = join(root, '_logs');
  const sessionDir = join(projectRoot, '_tiercost', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<TestStatus>(sessionDir, {
    session_id: sessionId,
    phase: 'analyzing',
    updated_at: new Date().toISOString(),
    ...(modelTier ? { modelTier } : {}),
  });
  return { forgeRoot, projectRoot, logsRoot, sessionDir };
}

test('a priced turn on the DEFAULT (cheapest-first) tier reports that tier on interactive.turn-cost', async () => {
  const sessionId = '2026-09-19T00-00-00-defaulttier';
  const { forgeRoot, projectRoot, logsRoot, sessionDir } = setUp(sessionId);

  await runInteractiveTurn(descriptorFor(forgeRoot, 'tiercostkind'), {
    sessionId, projectRoot, forgeRoot, logsRoot, queryFn: pricedQueryFn(sessionDir),
  });

  const rows = eventsUnder(logsRoot).filter((r) => r['message'] === 'interactive.turn-cost');
  assert.equal(rows.length, 1, `exactly one turn-cost row:\n${JSON.stringify(rows, null, 2)}`);
  const meta = rows[0]!['metadata'] as Record<string, unknown>;
  assert.equal(meta['session_id'], sessionId);
  assert.equal(meta['session_kind'], 'tiercostkind');
  assert.equal(meta['model_tier'], 'sonnet', 'creation-agent is strategy:range [sonnet, opus] — no requested tier resolves to the cheapest, sonnet');
});

test('NEGATIVE CONTROL: a session kicked off at a DIFFERENT tier emits that different tier — a hardcoded value cannot pass', async () => {
  const sessionId = '2026-09-19T00-00-00-opustier';
  const { forgeRoot, projectRoot, logsRoot, sessionDir } = setUp(sessionId, 'opus');

  await runInteractiveTurn(descriptorFor(forgeRoot, 'tiercostkind'), {
    sessionId, projectRoot, forgeRoot, logsRoot, queryFn: pricedQueryFn(sessionDir),
  });

  const rows = eventsUnder(logsRoot).filter((r) => r['message'] === 'interactive.turn-cost');
  assert.equal(rows.length, 1, `exactly one turn-cost row:\n${JSON.stringify(rows, null, 2)}`);
  const meta = rows[0]!['metadata'] as Record<string, unknown>;
  assert.equal(meta['model_tier'], 'opus', 'an operator-chosen opus tier must be the tier reported — a hardcoded "sonnet" must fail this');
});
