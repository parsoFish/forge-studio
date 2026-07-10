/**
 * POST /api/verdict `send-back` — auditability plumbing (plan 2.7).
 *
 * The operator's feedback must land in BOTH places:
 *   1. VERBATIM in the appended concern UWI spec (`.forge/unifier-items/UWI-2.md`)
 *      — the re-run's prompt source, and
 *   2. as a structured `reviewer.verdict.send-back` event in the cycle's
 *      `_logs/<cycleId>/events.jsonl`, carrying the rationale + ACs.
 *      `cli/cycle-retention.ts` and `cli/cycle-recap.ts` count exactly this
 *      message; before this test the event was consumed but never emitted, so
 *      send-back counting was permanently zero.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { seedStaticUnifierItem } from '../orchestrator/unifier-items.ts';

function makeManifest(worktreePath: string, initiativeId: string, cycleId: string): string {
  return [
    '---',
    `initiative_id: ${initiativeId}`,
    `cycle_id: ${cycleId}`,
    'project: test-project',
    'project_repo_path: /tmp/test-project',
    `worktree_path: ${worktreePath}`,
    'created_at: 2026-01-01T00:00:00.000Z',
    'iteration_budget: 5',
    'cost_budget_usd: 2.0',
    '---',
    '',
    '# Test initiative',
  ].join('\n');
}

async function postVerdict(
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${url}/api/verdict`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('send-back: 200, feedback lands verbatim in the concern UWI AND as a reviewer.verdict.send-back event', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'bv-sendback-'));
  const worktreePath = join(forgeRoot, 'projects', 'test-project', 'worktrees', 'test-sendback');
  mkdirSync(worktreePath, { recursive: true });
  const initiativeId = 'INIT-2026-01-01-test-sendback';
  const cycleId = `${initiativeId}-20260101T000000`;
  const rfr = join(forgeRoot, '_queue', 'ready-for-review');
  mkdirSync(rfr, { recursive: true });
  writeFileSync(join(rfr, `${initiativeId}.md`), makeManifest(worktreePath, initiativeId, cycleId));

  // Production invariant: UWI-1 always exists by review time (seeded by the
  // unifier phase); the appended concern depends on it.
  seedStaticUnifierItem(worktreePath, {
    initiativeId,
    estimatedIterations: 3,
    qualityGateCmd: ['npm', 'test'],
  });

  const rationale = 'The demo shows a test-name table, not the live GET response — embed the actual API output.';
  const ac = {
    given: 'the review page for this cycle',
    when: 'the demo section renders',
    then: 'the live GET response body is embedded verbatim',
  };

  const { url, close } = await startBridge({
    forgeRoot,
    port: 0,
    mergePr: () => {
      throw new Error('mergePr must not be called on send-back');
    },
    finalizeAfterMerge: async () => {
      throw new Error('finalizeAfterMerge must not be called on send-back');
    },
  });
  try {
    const { status, json } = await postVerdict(url, {
      initiativeId,
      kind: 'send-back',
      rationale,
      acceptanceCriteria: [ac],
      concernKind: 'code-fix',
    });
    assert.equal(status, 200, `expected 200, got ${status}: ${JSON.stringify(json)}`);
    const body = json as Record<string, unknown>;
    assert.deepEqual(body.appendedUnifierItems, ['UWI-2', 'UWI-3']);

    // 1. The operator's rationale lands VERBATIM in the concern UWI spec (the
    //    re-run's prompt source — prepareUnifierWorkspace threads it).
    const uwi2Path = join(worktreePath, '.forge', 'unifier-items', 'UWI-2.md');
    assert.ok(existsSync(uwi2Path), 'concern UWI written');
    const uwi2 = readFileSync(uwi2Path, 'utf8');
    assert.ok(uwi2.includes(rationale), 'rationale verbatim in the concern UWI body');

    // 2. The structured event lands in the CYCLE's event log (same cycleId the
    //    drain re-claims — one lineage, auditable).
    const eventsPath = join(forgeRoot, '_logs', cycleId, 'events.jsonl');
    assert.ok(existsSync(eventsPath), `events.jsonl missing at ${eventsPath}`);
    const events = readFileSync(eventsPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    const ev = events.find((e) => e.message === 'reviewer.verdict.send-back');
    assert.ok(ev, 'reviewer.verdict.send-back event emitted');
    assert.equal(ev.cycle_id, cycleId);
    assert.equal(ev.initiative_id, initiativeId);
    assert.equal(ev.phase, 'review-loop');
    const meta = ev.metadata as Record<string, unknown>;
    assert.equal(meta.rationale, rationale, 'operator feedback verbatim in the event');
    assert.deepEqual(meta.acceptance_criteria, [ac], 'send-back ACs carried on the event');
    assert.deepEqual(meta.appended_uwis, ['UWI-2', 'UWI-3']);
    assert.equal(meta.decided_by, 'operator');
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
