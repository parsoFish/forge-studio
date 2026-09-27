/**
 * forge-8vfn.8.1.30 / T1 ruling 1693 — the reviewer's turn must emit
 * `agent_heartbeat` while it runs, the same as every dev-loop turn. Same
 * defect class as the reflector (`reflector-heartbeat.test.ts`) and the PM
 * (`project-manager-heartbeat.test.ts`): `runAdversarialReview`
 * (packages/stations/phases/adversarial-review.ts) calls `runAgent` with
 * `lifecycle: 'caller'`, and that branch only wires the heartbeat timer when
 * the caller hands in its own `turnSink` (packages/agents/run-agent.ts).
 *
 * This pipeline's OWN events already log under `phase: 'orchestrator'` (its
 * shared `emit()` helper) — the turnSink built for it uses that SAME
 * phase/skill, not an invented 'review-loop', so the heartbeat reads as
 * whichever pipeline it already is.
 *
 * `run()`'s `heartbeatTimers` opt-in (this fix, in the shared fixture)
 * mirrors `runAgent`'s own `RunContext.heartbeatTimers` test-injection seam
 * (7.6.148) one layer up — same fake-timer shape `run-agent-w7b5.test.ts`
 * uses.
 */

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  collectLogger, makeFixture, run, stubQueryFn, validFindingsJson, withoutSpawnSuppressionEnv,
} from '../test-fixtures/adversarial-review-fixture.ts';

/** `ticks` immediate fires, then nothing (run-agent-w7b5.test.ts's own
 *  `fakeTimers`) — asserts the emitted heartbeats without a real wait. */
function fakeTimers(ticks: number) {
  let now = 0;
  return {
    setInterval: (fn: () => void, ms: number) => {
      for (let i = 0; i < ticks; i += 1) {
        now += ms;
        fn();
      }
      return 'handle';
    },
    clearInterval: (_h: unknown) => {},
    now: () => now,
  };
}

test('8.1.30: an adversarial-review turn that is SLOW emits agent_heartbeat, named for the review', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const qf = stubQueryFn([
      (prompt) => writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(prompt)),
    ]);
    const res = await run(fx, qf, logger, { heartbeatTimers: fakeTimers(3) });
    assert.equal(res.status, 'complete', 'sanity: the stubbed pass must close cleanly');

    const heartbeats = events.filter((e) => e.event_type === 'agent_heartbeat');
    assert.ok(
      heartbeats.length > 0,
      `an adversarial-review turn must emit agent_heartbeat while it runs — got ${JSON.stringify(events.map((e) => e.event_type))}`,
    );
    for (const hb of heartbeats) {
      assert.equal(hb.phase, 'orchestrator', 'the review heartbeat must say the SAME phase this pipeline already logs under');
      assert.equal(hb.skill, 'adversarial-review', 'the review heartbeat must name adversarial-review');
    }
  } finally {
    restore();
    fx.cleanup();
  }
});
