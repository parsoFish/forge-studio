/**
 * Bead forge-8vfn.6.6 item 5 — the interview CEILING and the
 * interview -> draft SAME-TURN fall-through, representable in the phase
 * table (`turnSpec.phases`), not hand-written control flow in a kind module.
 *
 * Three new, additive-optional `TurnSpecPhase` fields
 * (`studio/session-kinds.ts`) carry this: `doneField` (a structured turn's
 * output key), `nextOnDone` (the phase to advance to — same call — when that
 * field is true, or when the phase's `ceiling` is reached against
 * `status.round`), reusing the existing `next` field for the "not done yet"
 * target. `test-kind-falls-through` (test-fixtures/interactive-runner-fixtures.ts)
 * mirrors the real instructions kind's shape: interviewing -> (awaiting-answers
 * | drafting) -> awaiting-verdict.
 */
import { loadFixtureDescriptor, logger, setup } from './test-fixtures/interactive-runner-fixtures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInteractiveTurn } from '../../interactive-runner.ts';
import { writeSessionStatus, readSessionStatus, type QueryFn } from '../../interactive-session.ts';

type Status = { session_id: string; phase: string; updated_at: string; round?: number };

/** Returns `{done: true}` on the FIRST call (the interview hop), whatever
 *  shape on any later call (the draft hop) — call count is what every test
 *  below actually asserts. */
function fallThroughQueryFn(sessionDir: string, firstDone: boolean): { queryFn: QueryFn; calls: () => number } {
  let n = 0;
  const queryFn: QueryFn = () => {
    n += 1;
    const done = n === 1 ? firstDone : true;
    async function* gen(): AsyncGenerator<unknown> {
      if (n > 1) {
        mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      }
      yield { type: 'result', total_cost_usd: 0.01, structured_output: { done, questions: done ? [] : [{ question: 'Q?', header: 'Q' }] } };
    }
    return gen();
  };
  return { queryFn, calls: () => n };
}

test('doneField:true drives the SAME-TURN fall-through: interviewing -> drafting runs BOTH turns in one runInteractiveTurn call', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionId = '2026-09-25T01-00-00';
  const sessionDir = join(projectRoot, '_interactivetest-fallthrough', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<Status>(sessionDir, { session_id: sessionId, phase: 'interviewing', updated_at: new Date().toISOString(), round: 1 });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-falls-through');
  const { queryFn, calls } = fallThroughQueryFn(sessionDir, true);

  const result = await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(calls(), 2, 'both the interview turn AND the draft turn must have spawned in this ONE call');
  assert.equal(result.phase, 'awaiting-verdict', 'the fall-through must land on drafting\'s OWN next, not stop at drafting itself');
  assert.equal(readSessionStatus<Status>(sessionDir)?.phase, 'awaiting-verdict', 'status.json must persist the FINAL phase, not the intermediate "drafting" hop');
  assert.ok(existsSync(join(sessionDir, 'staging')), 'the draft hop\'s own turn must actually have run (it is what creates staging/)');
});

test('doneField:false, round UNDER ceiling: stays at awaiting-answers — the draft turn never spawns', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionId = '2026-09-25T01-00-01';
  const sessionDir = join(projectRoot, '_interactivetest-fallthrough', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<Status>(sessionDir, { session_id: sessionId, phase: 'interviewing', updated_at: new Date().toISOString(), round: 1 });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-falls-through');
  const { queryFn, calls } = fallThroughQueryFn(sessionDir, false);

  const result = await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(calls(), 1, 'the draft turn must NOT spawn — round 1 is under the fixture\'s ceiling:2');
  assert.equal(result.phase, 'awaiting-answers');
  assert.equal(readSessionStatus<Status>(sessionDir)?.phase, 'awaiting-answers');
  assert.ok(!existsSync(join(sessionDir, 'staging')), 'no draft turn ran, so staging/ must not exist');
});

test('doneField:false, round AT ceiling: the ceiling FORCES the same-turn fall-through despite the agent saying not done', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionId = '2026-09-25T01-00-02';
  const sessionDir = join(projectRoot, '_interactivetest-fallthrough', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  // Fixture declares ceiling: 2 — round already AT the ceiling.
  writeSessionStatus<Status>(sessionDir, { session_id: sessionId, phase: 'interviewing', updated_at: new Date().toISOString(), round: 2 });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-falls-through');
  const { queryFn, calls } = fallThroughQueryFn(sessionDir, false);

  const result = await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(calls(), 2, 'the ceiling must force the fall-through even though the agent reported done:false');
  assert.equal(result.phase, 'awaiting-verdict');
});

test('a phase with NO doneField behaves exactly as before — a single turn, no fall-through machinery touched', async () => {
  const { forgeRoot, projectRoot, logsRoot, sessionDir, sessionId } = setup();
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  let n = 0;
  const queryFn: QueryFn = () => {
    n += 1;
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'output.md'), '# staged output\n');
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };

  const result = await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.equal(n, 1, 'a kind with no doneField/nextOnDone must spawn exactly ONE turn, as before this bead');
  assert.equal(result.phase, 'awaiting-review');
});
