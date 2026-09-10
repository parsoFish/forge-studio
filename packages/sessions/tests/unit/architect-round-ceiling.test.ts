/**
 * The architect interview's ROUND ceiling — the door test it never had.
 *
 * T1 ruling 581, correcting 568. The behaviour under test ALREADY EXISTS and
 * has since ruling 380; this file is GREEN ON ARRIVAL and says so rather than
 * claiming a red it did not see. What was missing is any test at all:
 * `grep -rn maxInterviewRounds packages/sessions/tests` returned NOTHING before
 * this file, and that absence is why bead `forge-8vfn.6.10.28` was written
 * asserting the ceiling does not exist.
 *
 * WHY THE BEAD READ THAT WAY, and the distinction worth keeping: the ROUTE
 * accepts and the TURN decides. `bridge-studio-architect.ts:377-381` computes
 * `round = prior.length + 1`, writes `{ phase: 'interviewing', round: round + 1 }`
 * and spawns a turn with no ceiling check of its own — so reading the route
 * alone shows an unbounded loop. The spawned turn then reads `status.round`
 * against `maxRounds` and refuses to ask again (`kinds/architect.ts:167-184`),
 * so the loop terminates. Both halves are true; only together are they the
 * design.
 *
 * MEASURED, and it corrects this lane's own earlier reading: S1 run 1 reported
 * `answered 3 round(s)` and its 600 000 ms bound running out. Three answers
 * leave `status.round = 4`, `4 < 4` is false, and the fourth turn was already
 * exploring/drafting when the bound expired. The interview was ONE ROUND from
 * exiting, not unbounded — slowness reported as non-convergence.
 *
 * The ceiling stays at 4 (581). It is cap-then-proceed, the shape
 * `contract-compliance-loop.ts:79` already uses: at the ceiling the operator is
 * not refused, the architect stops asking and DRAFTS.
 *
 * PROVED ABLE TO FAIL by mutation, since it could not be written red-first:
 * raising `DEFAULT_MAX_INTERVIEW_ROUNDS` from 4 to 99 turns the ceiling case
 * green-to-red — the turn asks a fifth question instead of drafting. Recorded
 * in the PR body with the failure text.
 *
 * RUN: node --experimental-strip-types --test packages/sessions/tests/unit/architect-round-ceiling.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runArchitectTurn, type ArchitectStatus } from '../../kinds/architect.ts';
import { stubArchitectManifestPorts } from '../../tests/architect-ports-stub.ts';
import type { EventLogEntry, EventLogger } from '@forge/kernel';

/** The ceiling the kind ships with (`kinds/architect.ts`). Named here, not
 *  imported, ON PURPOSE: a test that imports the constant it is pinning agrees
 *  with any change to it. This is the figure ruling 581 ratified. */
const RATIFIED_CEILING = 4;

/** One interview answer with questions still outstanding — the agent would ask
 *  again if the ceiling let it. */
const STILL_ASKING = { done: false, questions: [{ question: 'Which schema default?' }] };

function plant(round: number): { root: string; projectRoot: string; statusPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'arch-round-ceiling-'));
  const projectRoot = join(root, 'projects', 'p1');
  const sessionDir = join(projectRoot, '_architect', 'sess-1');
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(join(root, '_logs', '_architect-sess-1'), { recursive: true });
  const status: ArchitectStatus = {
    session_id: 'sess-1',
    project: 'p1',
    project_repo_path: projectRoot,
    phase: 'interviewing',
    round,
    idea: 'test the round ceiling',
    updated_at: new Date().toISOString(),
  };
  const statusPath = join(sessionDir, 'status.json');
  writeFileSync(statusPath, JSON.stringify(status, null, 2), 'utf8');
  return { root, projectRoot, statusPath };
}

/** Replays one structured output, then FAILS LOUDLY. A second call means the
 *  turn went past the interview — which is exactly what the ceiling case must
 *  do, and what the under-ceiling case must not. */
function oneShotQueryFn(output: unknown): { queryFn: (o: { prompt: string }) => AsyncGenerator<unknown>; calls: () => number } {
  let n = 0;
  const queryFn = (_o: { prompt: string }) => {
    const i = n++;
    async function* gen(): AsyncGenerator<unknown> {
      if (i > 0) throw new Error('PAST_THE_INTERVIEW');
      yield { type: 'result', total_cost_usd: 0.01, structured_output: output };
    }
    return gen();
  };
  return { queryFn, calls: () => n };
}

function silentLogger(): EventLogger {
  return {
    emit: (entry) => ({ event_id: 'stub', cycle_id: 'stub', started_at: '1970-01-01T00:00:00.000Z', ...entry }) as EventLogEntry,
    cycleId: 'stub',
    logFilePath: '',
  } as EventLogger;
}

const readStatus = (p: string): ArchitectStatus => JSON.parse(readFileSync(p, 'utf8')) as ArchitectStatus;

test('UNDER the ceiling the architect asks again — the operator gets the question', async () => {
  const { root, projectRoot, statusPath } = plant(RATIFIED_CEILING - 1);
  const { queryFn } = oneShotQueryFn(STILL_ASKING);
  try {
    const result = await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger: silentLogger(),
    });
    assert.equal(result.phase, 'awaiting-answers', 'below the ceiling a turn with questions asks them');
    assert.equal(readStatus(statusPath).phase, 'awaiting-answers');
    assert.ok(existsSync(join(projectRoot, '_architect', 'sess-1', 'questions.json')), 'the questions reach disk for the operator');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT the ceiling the architect STOPS ASKING AND DRAFTS — cap-then-proceed, never a refusal', async () => {
  // `status.round === maxRounds` is the boundary: `round < maxRounds` is false,
  // so the turn abandons the interview and runs explore→draft. The one-shot
  // queryFn then throws PAST_THE_INTERVIEW on the explore call, which is the
  // PROOF that the turn proceeded rather than asking — asserted on the status
  // the turn wrote before it got there.
  const { root, projectRoot, statusPath } = plant(RATIFIED_CEILING);
  const { queryFn, calls } = oneShotQueryFn(STILL_ASKING);
  try {
    await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger: silentLogger(),
    }).catch(() => undefined);

    const status = readStatus(statusPath);
    assert.notEqual(status.phase, 'awaiting-answers',
      `at round ${RATIFIED_CEILING} the architect must not ask again — it drafted instead (got phase "${status.phase}")`);
    assert.ok(!existsSync(join(projectRoot, '_architect', 'sess-1', 'questions.json')),
      'no questions are written at the ceiling — the operator is not asked a question the loop cannot afford');
    assert.ok(calls() > 1, 'the turn went PAST the interview step — cap-then-proceed, not a stop');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the operator is never REFUSED at the ceiling — no 409-shaped throw out of the turn', async () => {
  // 568 proposed refusing past the ceiling and it was withdrawn: a refusal
  // leaves the operator with a session that can never produce a plan. This pins
  // the shape that was chosen instead — whatever the turn does at the ceiling,
  // it is not "your answer is rejected".
  const { root, projectRoot } = plant(RATIFIED_CEILING);
  const { queryFn } = oneShotQueryFn(STILL_ASKING);
  let thrown: unknown = null;
  try {
    await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger: silentLogger(),
    });
  } catch (err) {
    thrown = err;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  const message = thrown instanceof Error ? thrown.message : String(thrown ?? '');
  assert.ok(!/refus|reject|409|too many rounds/i.test(message),
    `the ceiling must not refuse the operator — got ${JSON.stringify(message)}`);
});
