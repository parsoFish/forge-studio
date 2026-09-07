/**
 * Ruling 380 — the completeness critic runs BEFORE the operator is asked.
 *
 * WHAT WAS WRONG. The critic used to run inside the FINALIZE turn, i.e. after
 * the operator had already read a plan and pressed approve: approve →
 * `finalizing` → critic → a HIGH finding → back to `awaiting-verdict` with the
 * gate re-armed. The operator was shown a plan, asked to approve it, and then
 * told it was incomplete and asked again. S1 beat 11 measured exactly that
 * (`data-architect-phase: expected "committed", got "awaiting-verdict"`;
 * `data-gate-armed: expected "false", got "true"`).
 *
 * WHAT IS TRUE NOW. The critic runs at the END of the drafting turn, before
 * `awaiting-verdict` ever appears: findings send the architect another draft
 * round (the operator never sees the faulted plan), a clean pass promotes the
 * session to `awaiting-verdict` with the pass recorded, and the approve press
 * commits in ONE turn.
 *
 * These drive the KIND'S DOOR (`runArchitectTurn`), not the critic helper —
 * the helper's own behaviour is `architect-critic.test.ts`'s. A helper-level
 * test cannot tell you which turn calls it, which is the entire ruling.
 *
 * The four things the move must not lose, one test each: the round key (a
 * SECOND draft round is checked too, never waved through on the first round's
 * flag), the crash path (advisory infra never strands a session), the finding
 * events (the operator's record), and the round CEILING (a critic that never
 * clears must ask the operator rather than spend forever — 6.10.28's class).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runArchitectTurn, MAX_CRITIC_DRAFT_ROUNDS, type ArchitectStatus } from '../../kinds/architect.ts';
import { stubArchitectManifestPorts } from '../../tests/architect-ports-stub.ts';
import type { EventLogEntry, EventLogger } from '@forge/kernel';

const DRAFT = (title: string) => ({
  vision: 'A vision.',
  initiatives: [{
    slug: 'add-a-flag',
    title,
    iteration_budget: 3,
    cost_budget_usd: 2,
    class: 'code',
    acceptance_criteria: [{ given: 'the CLI', when: '--flag is passed', then: 'it is honoured' }],
    body: `# ${title}\n`,
  }],
});

const HIGH = { findings: [{ severity: 'high', initiativeId: 'INIT-1', gap: 'nothing covers the migration.' }] };
const CLEAN = { findings: [] };

/** A queryFn that replays a fixed script of structured outputs, recording each
 *  prompt it was handed. A call past the end of the script is a test failure
 *  with the count, never a silent extra turn. */
function scriptedQueryFn(script: readonly unknown[]): { queryFn: (o: { prompt: string }) => AsyncGenerator<unknown>; prompts: string[] } {
  const prompts: string[] = [];
  const queryFn = (opts: { prompt: string }) => {
    const i = prompts.length;
    prompts.push(opts.prompt);
    if (i >= script.length) throw new Error(`scriptedQueryFn: call ${i + 1} past the end of a ${script.length}-turn script`);
    const scripted = script[i];
    async function* gen(): AsyncGenerator<unknown> {
      // An Error in the script is a STREAM failure, which is the only thing the
      // critic reports as `crashed` — a malformed structured output sanitizes
      // to zero findings instead, and calling that a crash would test a shape
      // the product does not have.
      if (scripted instanceof Error) throw scripted;
      yield { type: 'result', total_cost_usd: 0.01, structured_output: scripted };
    }
    return gen();
  };
  return { queryFn, prompts };
}

function recordingLogger(): { logger: EventLogger; messages: string[] } {
  const messages: string[] = [];
  const logger: EventLogger = {
    emit: (entry) => {
      messages.push(String((entry as { message?: unknown }).message ?? ''));
      return ({ event_id: 'stub', cycle_id: 'stub', started_at: '1970-01-01T00:00:00.000Z', ...entry }) as EventLogEntry;
    },
    cycleId: 'stub',
    logFilePath: '',
  };
  return { logger, messages };
}

function plant(over: Partial<ArchitectStatus>): { root: string; projectRoot: string; statusPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'arch-critic-order-'));
  const projectRoot = join(root, 'projects', 'p1');
  const sessionDir = join(projectRoot, '_architect', 'sess-1');
  mkdirSync(sessionDir, { recursive: true });
  const status: ArchitectStatus = {
    session_id: 'sess-1',
    project: 'p1',
    project_repo_path: projectRoot,
    phase: 'drafting',
    round: 1,
    idea: 'Migrate every resource to the plugin framework.',
    updated_at: new Date().toISOString(),
    ...over,
  };
  writeFileSync(join(sessionDir, 'status.json'), JSON.stringify(status, null, 2), 'utf8');
  return { root, projectRoot, statusPath: join(sessionDir, 'status.json') };
}

const readStatus = (p: string): ArchitectStatus => JSON.parse(readFileSync(p, 'utf8')) as ArchitectStatus;

test('380: a draft the critic faults NEVER reaches awaiting-verdict — the architect drafts again first', async () => {
  const { root, projectRoot, statusPath } = plant({});
  const { queryFn, prompts } = scriptedQueryFn([DRAFT('first'), HIGH, DRAFT('second'), CLEAN]);
  const { logger } = recordingLogger();
  try {
    const result = await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger,
    });
    assert.equal(result.phase, 'awaiting-verdict', 'the operator is asked only once the critic is clean');
    assert.equal(prompts.length, 4, 'draft → critic(HIGH) → draft → critic(clean): four turns, in that order');
    // The plan the operator is asked about is the SECOND draft, not the faulted first.
    assert.match(readFileSync(join(projectRoot, '_architect', 'sess-1', 'PLAN.md'), 'utf8'), /second/);
    // The re-draft was TOLD what the critic faulted — a round that does not know
    // what was wrong is a coin flip, not a round.
    assert.match(prompts[2], /nothing covers the migration/, 'the second draft prompt carries the findings');
    const status = readStatus(statusPath);
    assert.equal(status.phase, 'awaiting-verdict');
    assert.deepEqual(status.completenessCritic?.findings, [], 'the recorded pass is the CLEAN one');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('380 (positive control): a clean draft reaches awaiting-verdict in one round, with the pass recorded', async () => {
  const { root, projectRoot, statusPath } = plant({});
  const { queryFn, prompts } = scriptedQueryFn([DRAFT('only'), CLEAN]);
  const { logger } = recordingLogger();
  try {
    const result = await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger,
    });
    assert.equal(result.phase, 'awaiting-verdict');
    assert.equal(prompts.length, 2, 'one draft, one critic — no extra round on a clean plan');
    const cc = readStatus(statusPath).completenessCritic;
    assert.ok(cc?.ranAt, 'the critic pass is recorded on the status the operator is asked from');
    assert.deepEqual(cc?.findings, []);
    assert.equal(cc?.crashed, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('380: the round key — a SECOND draft round is checked too, never waved through on the first round`s flag', async () => {
  // The status already carries a completenessCritic from an earlier round. Under
  // the OLD one-shot-per-session flag that fact alone skipped the critic; here it
  // must not, or a re-drafted plan reaches the operator unchecked.
  const { root, projectRoot, statusPath } = plant({
    completenessCritic: { ranAt: '2026-01-01T00:00:00.000Z', round: 1, findings: [] },
  });
  const { queryFn, prompts } = scriptedQueryFn([DRAFT('re-draft'), HIGH, DRAFT('third'), CLEAN]);
  const { logger } = recordingLogger();
  try {
    await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger,
    });
    assert.equal(prompts.length, 4, 'the stale flag did not skip this round`s critic');
    const cc = readStatus(statusPath).completenessCritic;
    assert.notEqual(cc?.ranAt, '2026-01-01T00:00:00.000Z', 'the record is THIS round`s, not the stale one');
    assert.equal(cc?.round, 2, 'the record names the draft round it checked');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('380: a critic that never clears asks the operator at the ceiling — bounded rounds, outstanding findings recorded', async () => {
  const { root, projectRoot, statusPath } = plant({});
  // Every critic turn finds something. The turn must stop at the ceiling and ASK,
  // never spend forever and never strand the session with no operator control.
  const script: unknown[] = [];
  for (let i = 0; i < MAX_CRITIC_DRAFT_ROUNDS; i++) { script.push(DRAFT(`round-${i + 1}`), HIGH); }
  const { queryFn, prompts } = scriptedQueryFn(script);
  const { logger } = recordingLogger();
  try {
    const result = await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger,
    });
    assert.equal(result.phase, 'awaiting-verdict', 'at the ceiling the operator is asked — never a stranded session');
    assert.equal(prompts.length, MAX_CRITIC_DRAFT_ROUNDS * 2, 'exactly the ceiling`s worth of draft+critic pairs');
    const cc = readStatus(statusPath).completenessCritic;
    assert.equal(cc?.findings.length, 1, 'the outstanding findings are recorded, not swallowed');
    assert.equal(cc?.round, MAX_CRITIC_DRAFT_ROUNDS);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('380: a CRASHED critic is advisory — the session proceeds to the ask with crashed recorded', async () => {
  const { root, projectRoot, statusPath } = plant({});
  // The critic's own crash path: its structured turn throws.
  // `runCompletenessCritic` reports `crashed` rather than propagating.
  const { queryFn, prompts } = scriptedQueryFn([DRAFT('only'), new Error('the critic stream fell over')]);
  const { logger } = recordingLogger();
  try {
    const result = await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger,
    });
    assert.equal(result.phase, 'awaiting-verdict', 'a critic that fell over must not strand the session');
    assert.equal(prompts.length, 2, 'a crash is not a finding — no re-draft round');
    assert.equal(readStatus(statusPath).completenessCritic?.crashed, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('380: the finding events survive the move — one architect.completeness-critic.finding per finding', async () => {
  const { root, projectRoot } = plant({});
  const { queryFn } = scriptedQueryFn([DRAFT('first'), HIGH, DRAFT('second'), CLEAN]);
  const { logger, messages } = recordingLogger();
  try {
    await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger,
    });
    const findings = messages.filter((m) => m.startsWith('architect.completeness-critic.finding'));
    assert.equal(findings.length, 1, 'the operator`s record of what was faulted survives the move');
    assert.match(findings[0], /\(high\): nothing covers the migration\./);
    assert.equal(messages.filter((m) => m.startsWith('architect.completeness-critic.start')).length, 2, 'one start per round');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('380: FINALIZE no longer runs the critic — approve commits on ONE press', async () => {
  const { root, projectRoot, statusPath } = plant({ phase: 'finalizing' });
  // No completenessCritic on the status at all: under the old order that is
  // exactly the state that made finalize run the critic and re-arm the gate.
  const manifestsDir = join(projectRoot, '_architect', 'sess-1', 'manifests');
  mkdirSync(manifestsDir, { recursive: true });
  writeFileSync(join(manifestsDir, 'INIT-1.md'), '---\ninitiative_id: INIT-1\n---\nbody\n', 'utf8');
  const { queryFn, prompts } = scriptedQueryFn([]);
  const { logger } = recordingLogger();
  try {
    const result = await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), queueRoot: join(root, '_queue'), brainCwd: root,
      queryFn: queryFn as never, logger,
    });
    assert.equal(result.phase, 'committed', 'one press, one commit');
    assert.equal(prompts.length, 0, 'finalize spends nothing — no critic turn after the ask');
    assert.equal(readStatus(statusPath).phase, 'committed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
