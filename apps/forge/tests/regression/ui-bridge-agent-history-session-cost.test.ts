/**
 * forge-8vfn.7.6.1 — a session row's cost is the ONE kernel event-cost rule's
 * figure, never a naive sum over every priced row.
 *
 * `readSessionLogFacts` (`packages/agents/bridge-agents-history-rows.ts`)
 * summed every `cost_usd` it found. A phase that emits `iteration` events
 * RESTATES its dollars on the per-item and rollup `end` rows, so a naive sum
 * double-counts — measured at 2.35x the truth on M5-A, which is why
 * `packages/kernel/event-cost.ts` exists and why every other consumer goes
 * through it.
 *
 * This matters beyond tidiness: S5 beat 13 asserts `data-ledger-cost-usd` on a
 * row fed by this route. A beat can go GREEN on a double-counted number, and a
 * green beat on a wrong figure is worse than a red one — it pins the defect
 * into a story that is then immutable. Lane D raised exactly that, which is
 * why this landed before the beat was authored.
 *
 * Its own file rather than an append to `ui-bridge-agent-history.test.ts`:
 * that file carries an 800-line exemption, and an exemption is a ceiling.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startBridge } from '../../ui-bridge.ts';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-agent-history-cost-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  // The route reads the session-kind registry to know which kinds an agent
  // owns; one row is enough, and it keeps this file independent of whatever
  // `studio/session-kinds.yaml` ships.
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'session-kinds.yaml'), `- id: architect
  agent: architect
  title: Planning session
  legacyRoutes:
    - /architect/[sessionId]
  stages: [roadmap]
  defaultStage: roadmap
  artifact:
    kind: roadmap-draft
    label: Roadmap draft
`);
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function getJson(path: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${url}${path}`);
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

/** An iteration-phase session log: two authoritative turns and one rollup that
 *  restates the second turn's dollars. */
function seedRestatingSession(project: string, sessionId: string): { rule: number; naive: number } {
  const projectDir = join(forgeRoot, 'projects', project);
  mkdirSync(join(projectDir, '_architect', sessionId), { recursive: true });
  writeFileSync(join(projectDir, '_architect', sessionId, 'status.json'), JSON.stringify({
    phase: 'drafting', session_id: sessionId, project, project_repo_path: projectDir,
    updated_at: '2026-01-01T00:10:00.000Z',
  }, null, 2));
  const logDir = join(forgeRoot, '_logs', `_architect-${sessionId}`);
  mkdirSync(logDir, { recursive: true });
  const base = { cycle_id: `_architect-${sessionId}`, initiative_id: `architect-session-${sessionId}`, phase: 'developer', skill: 'architect-runner', input_refs: [], output_refs: [], started_at: '2026-01-01T00:11:00.000Z' };
  const events = [
    { ...base, event_id: 'EV_it_1', event_type: 'iteration', iteration: 1, cost_usd: 1.0 },
    { ...base, event_id: 'EV_it_2', event_type: 'iteration', iteration: 2, cost_usd: 2.0 },
    // The rollup: the SAME dollars as the two turns above, restated once.
    { ...base, event_id: 'EV_end', event_type: 'end', cost_usd: 3.0 },
  ];
  writeFileSync(join(logDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return { rule: 3.0, naive: 6.0 };
}

test('7.6.1: a session row\'s cost comes from the kernel event-cost rule, NOT a naive sum over every priced row', async () => {
  const { rule, naive } = seedRestatingSession('proj-restate', '2026-05-04T00-00-00-sess-r');
  assert.notEqual(rule, naive, 'fixture guard: the two answers must differ, or this test proves nothing');

  const { status, body } = await getJson('/api/agents/architect/history');
  assert.equal(status, 200, `history route must serve: ${JSON.stringify(body)}`);
  const rows = (body as { rows: { id: string; costUsd: number | null }[] }).rows;
  const row = rows.find((r) => r.id === '2026-05-04T00-00-00-sess-r');
  assert.ok(row, `expected the session row, got ${JSON.stringify(rows.map((r) => r.id))}`);
  assert.equal(row!.costUsd, rule, 'the phase emitted iteration events, so only those count — the rollup end restates them');
  assert.notEqual(row!.costUsd, naive, 'a naive sum double-counts the restatement; that is the defect this row exists to refuse');
});
