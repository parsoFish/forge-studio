/**
 * Bead forge-mfv5.1.27 — the parked fix round, read through the real bridge on
 * the exact live shape (forge-develop manifest in `_queue/ready-for-review/`,
 * `resume_from: develop`, `review_rounds: 1`, 5 complete + 1 pending gate-fix
 * WI, a `cycle.end` that says `ready-for-review`). `fixRound` is derived ONCE
 * (`fixRoundOf`, run model) and every consumer agrees:
 *
 *   1. roadmap card — `fixRound: 1` on a `ready-for-review` status (Studio
 *      labels it FIX ROUND 1), the WI badge reads 5/6;
 *   2. merged count — no `completedAt` on the card or the run (no ✓);
 *   3. runs — `GET /api/runs` serves `fixRound: 1`;
 *   4. Start — unchanged: a same-flow park is refused, never re-enqueued.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';
import { FIX_INIT, FIX_PROJECT, plantStrandedFixRound } from '../../../../packages/flows/tests/test-fixtures/stranded-fix-round.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

type Card = { status: string; fixRound?: number; fixRoundRunning?: true; developRunning?: true; completedAt?: string; canStartDevelopment: boolean; workItems?: Array<{ status?: string }> };
type RunRow = { initiativeId: string; fixRound?: number; completedAt?: string; awaitingKickoff?: true };

test('stranded fix round: card, merged count, runs and Start agree on fixRound 1', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'fix-round-consumers-'));
  plantStrandedFixRound(forgeRoot);
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const { url, close } = await startBridge({ forgeRoot, port: 0 });
  try {
    const roadmap = (await (await fetch(`${url}/api/studio/projects/${FIX_PROJECT}/roadmap`)).json()) as { roadmap: { initiatives: Array<Card & { initiativeId: string }> } };
    const card = roadmap.roadmap.initiatives.find((i) => i.initiativeId === FIX_INIT);
    const runs = (await (await fetch(`${url}/api/runs`)).json()) as { runs: RunRow[] };
    const run = runs.runs.find((r) => r.initiativeId === FIX_INIT);
    assert.ok(card && run, 'the parked initiative is on the roadmap and in the runs list');

    assert.equal(card.status, 'ready-for-review', 'a field, never a new queue status word');
    assert.equal(card.fixRound, 1);
    const done = (card.workItems ?? []).filter((w) => w.status === 'complete').length;
    assert.equal(`${done}/${card.workItems?.length}`, '5/6');
    assert.equal(card.completedAt, undefined, 'a parked fix round is not counted merged');
    assert.equal(run.fixRound, 1);
    assert.equal(run.completedAt, undefined);
    assert.equal(run.awaitingKickoff, undefined, 'a fix round is never a kickoff');

    assert.equal(card.canStartDevelopment, false, 'start eligibility unchanged: same-flow is refused');
    const res = await fetch(`${url}/api/develop/start`, { method: 'POST', headers: CSRF, body: JSON.stringify({ initiativeIds: [FIX_INIT] }) });
    const body = (await res.json()) as { results: Array<{ status: string }> };
    assert.notEqual(body.results[0]?.status, 'enqueued');
  } finally {
    await close();
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// forge-nk1y.23 — the drain re-entered the fix WI: the manifest is in-flight, and the card is served the facts.
test('re-entered fix round: the in-flight card is served fixRound 1, fixRoundRunning and developRunning; parked serves neither flag', async () => {
  for (const queueDir of ['in-flight', 'ready-for-review'] as const) {
    const forgeRoot = mkdtempSync(join(tmpdir(), 'fix-round-in-flight-'));
    plantStrandedFixRound(forgeRoot, { queueDir });
    process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
    const { url, close } = await startBridge({ forgeRoot, port: 0 });
    try {
      const roadmap = (await (await fetch(`${url}/api/studio/projects/${FIX_PROJECT}/roadmap`)).json()) as { roadmap: { initiatives: Array<Card & { initiativeId: string }> } };
      const card = roadmap.roadmap.initiatives.find((i) => i.initiativeId === FIX_INIT);
      assert.ok(card, queueDir);
      assert.equal(card.status, queueDir);
      assert.equal(card.fixRound, 1, queueDir);
      assert.equal(card.fixRoundRunning, queueDir === 'in-flight' ? true : undefined, queueDir);
      assert.equal(card.developRunning, queueDir === 'in-flight' ? true : undefined, queueDir);
      assert.equal(card.completedAt, undefined, queueDir);
    } finally {
      await close();
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  }
});
