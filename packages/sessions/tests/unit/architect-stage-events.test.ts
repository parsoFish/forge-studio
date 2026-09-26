/**
 * forge-8vfn.8.1.14 — DEFECT: `status.json.phase` sat on `drafting` from the
 * draft turn's end through plan-emitted, the completeness critic (ruling 380
 * — it can bounce the draft back for revision BEFORE the operator is asked),
 * AND a silent revision turn: m7-d-proof-S1 (`_1.0/evidence/m7-d-proof-S1/
 * run2/`) read `drafting` for 481s straight, with a 2.3-minute gap in
 * events.jsonl, before the story cancelled it. The operator and any
 * progress-aware client saw "drafting" the whole time and nothing at all
 * during the silent revision turn.
 *
 * FIX, pinned here:
 *   1. `status.json.phase` moves to `critiquing` before the critic's own
 *      structured turn runs, and to `revising` before a round the critic
 *      bounced back re-drafts (`architect-steps.ts::runDraftRounds`).
 *   2. Every architect STAGE — not just the coarser per-TURN start
 *      `kind-turn.ts` already emits — gets its own `architect.<stage>.start`
 *      event, BEFORE that stage's structured turn is invoked (a
 *      progress-aware client keys "still working" on this event's presence,
 *      never on the stage's first output). The completeness critic already
 *      had one (`architect.completeness-critic.start`); this pins the same
 *      family for explore/draft/revise/finalize, via the SAME `logger.emit`
 *      — no new event mechanism.
 *
 * These drive the KIND'S DOOR (`runArchitectTurn`), the same convention
 * `architect-critic-before-ask.test.ts` uses, with the SAME `scriptedQueryFn`/
 * `recordingLogger`/`plant` shapes — extended here with a shared `trace[]` so
 * a test can assert ORDER, not just presence: each stage's start event must
 * precede that stage's own structured-turn consumption, not merely appear
 * somewhere in the log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runArchitectTurn, type ArchitectStatus } from '../../kinds/architect.ts';
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
const EXPLORE_OK = {
  edgeCases: [{ title: 'a rename mid-migration', detail: 'the old id must still resolve', disposition: 'covered' }],
  brainConstraints: [],
  exploreSummary: 'one edge case surfaced.',
};

/**
 * A queryFn that replays a fixed script of structured outputs, recording each
 * prompt AND pushing a `queryFn:consume:<i>:phase=<status.json phase at that
 * instant>` marker into the shared `trace` at the moment its generator body
 * actually starts running — i.e. when the caller begins CONSUMING it, not
 * when `queryFn(...)` is merely invoked to build the generator. This is the
 * earliest point production code could call "the model turn began", so a
 * stage-start event that lands in `trace` before this marker genuinely
 * preceded the turn, not just the call that built it.
 */
function tracingQueryFn(
  script: readonly unknown[],
  trace: string[],
  statusPath: string,
): { queryFn: (o: { prompt: string }) => AsyncGenerator<unknown>; prompts: string[] } {
  const prompts: string[] = [];
  const queryFn = (opts: { prompt: string }) => {
    const i = prompts.length;
    prompts.push(opts.prompt);
    if (i >= script.length) throw new Error(`tracingQueryFn: call ${i + 1} past the end of a ${script.length}-turn script`);
    const scripted = script[i];
    async function* gen(): AsyncGenerator<unknown> {
      const phaseNow = (JSON.parse(readFileSync(statusPath, 'utf8')) as ArchitectStatus).phase;
      trace.push(`queryFn:consume:${i}:phase=${phaseNow}`);
      if (scripted instanceof Error) throw scripted;
      yield { type: 'result', total_cost_usd: 0.01, structured_output: scripted };
    }
    return gen();
  };
  return { queryFn, prompts };
}

/** Same shape as `architect-critic-before-ask.test.ts`'s `recordingLogger`,
 *  plus every emitted message is ALSO pushed onto the shared `trace` — so
 *  interleaving it with `tracingQueryFn`'s markers reconstructs real
 *  chronological order. */
function tracingLogger(trace: string[]): { logger: EventLogger; messages: string[]; entries: EventLogEntry[] } {
  const messages: string[] = [];
  const entries: EventLogEntry[] = [];
  const logger: EventLogger = {
    emit: (entry) => {
      const msg = String((entry as { message?: unknown }).message ?? '');
      messages.push(msg);
      trace.push(`log:${msg}`);
      const full = ({ event_id: 'stub', cycle_id: 'stub', started_at: '1970-01-01T00:00:00.000Z', ...entry }) as EventLogEntry;
      entries.push(full);
      return full;
    },
    cycleId: 'stub',
    logFilePath: '',
  };
  return { logger, messages, entries };
}

function plant(over: Partial<ArchitectStatus>): { root: string; projectRoot: string; statusPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'arch-stage-events-'));
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

test('8.1.14: draft -> critic(HIGH) -> revise -> critic(clean) -> awaiting-verdict: the phase sequence WRITTEN and every stage-start event BEFORE its own turn', async () => {
  const { root, projectRoot, statusPath } = plant({});
  const trace: string[] = [];
  const { queryFn } = tracingQueryFn([DRAFT('first'), HIGH, DRAFT('second'), CLEAN], trace, statusPath);
  const { logger } = tracingLogger(trace);
  try {
    const result = await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger,
    });
    assert.equal(result.phase, 'awaiting-verdict');

    // The FINAL status.json — the round ceiling's other half.
    assert.equal(readStatus(statusPath).phase, 'awaiting-verdict');

    // The phase WRITTEN at the instant of every structured call — captured
    // by reading status.json from inside each turn's own generator, the exact
    // instant production code would have started that turn's LLM call. This
    // is the defect's other half: `drafting` used to survive unchanged
    // through the critic's call AND the revision draft's call.
    const phaseAtCall = trace.filter((t) => t.startsWith('queryFn:consume:'));
    assert.deepEqual(phaseAtCall, [
      'queryFn:consume:0:phase=drafting', // round-1 draft: the turn's starting phase, unchanged
      'queryFn:consume:1:phase=critiquing', // round-1 critic: written BEFORE this call
      'queryFn:consume:2:phase=revising', // round-2 (revision) draft: written by round 1's findings branch
      'queryFn:consume:3:phase=critiquing', // round-2 critic: written again before this call
    ]);

    // Ordering: each stage's start event immediately precedes that stage's own
    // turn consumption — never merely "logged somewhere in the run".
    const relevant = trace.filter((t) =>
      t.startsWith('queryFn:consume:') ||
      t === 'log:architect.draft.start' ||
      t === 'log:architect.revise.start' ||
      t === 'log:architect.completeness-critic.start');
    assert.deepEqual(relevant, [
      'log:architect.draft.start',
      'queryFn:consume:0:phase=drafting',
      'log:architect.completeness-critic.start',
      'queryFn:consume:1:phase=critiquing',
      'log:architect.revise.start',
      'queryFn:consume:2:phase=revising',
      'log:architect.completeness-critic.start',
      'queryFn:consume:3:phase=critiquing',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('8.1.14: the explore stage gets its own start event, before its structured turn, carrying the operator round', async () => {
  const { root, projectRoot, statusPath } = plant({ phase: 'exploring', round: 2 });
  const trace: string[] = [];
  const { queryFn } = tracingQueryFn([EXPLORE_OK, DRAFT('only'), CLEAN], trace, statusPath);
  const { logger, entries } = tracingLogger(trace);
  try {
    const result = await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), brainCwd: root, queryFn: queryFn as never, logger,
    });
    assert.equal(result.phase, 'awaiting-verdict');

    // The explore stage's own turn is call 0 — its start event must precede
    // THAT specific consumption, whatever else the rest of the turn logs.
    const exploreStartIdx = trace.indexOf('log:architect.explore.start');
    const call0Idx = trace.indexOf('queryFn:consume:0:phase=exploring');
    assert.notEqual(exploreStartIdx, -1, 'architect.explore.start must be logged');
    assert.notEqual(call0Idx, -1, 'the explore turn must run at status.json phase=exploring');
    assert.ok(exploreStartIdx < call0Idx, 'explore.start must precede the explore turn it announces');

    const exploreStart = entries.filter((e) => e.message === 'architect.explore.start');
    assert.equal(exploreStart.length, 1, 'exactly one explore-stage start event');
    assert.equal(exploreStart[0]!.metadata?.round, 2, 'the explore stage names the operator round it belongs to');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('8.1.14: finalize gets its own start event, at the top, before "plan-approved"', async () => {
  const { root, projectRoot } = plant({ phase: 'finalizing' });
  const manifestsDir = join(projectRoot, '_architect', 'sess-1', 'manifests');
  mkdirSync(manifestsDir, { recursive: true });
  writeFileSync(join(manifestsDir, 'INIT-1.md'), '---\ninitiative_id: INIT-1\n---\nbody\n', 'utf8');
  const trace: string[] = [];
  const { queryFn, prompts } = tracingQueryFn([], trace, join(projectRoot, '_architect', 'sess-1', 'status.json'));
  const { logger, messages } = tracingLogger(trace);
  try {
    const result = await runArchitectTurn({
      manifestPorts: stubArchitectManifestPorts(), sessionId: 'sess-1', projectRoot,
      logsRoot: join(root, '_logs'), queueRoot: join(root, '_queue'), brainCwd: root,
      queryFn: queryFn as never, logger,
    });
    assert.equal(result.phase, 'committed');
    assert.equal(prompts.length, 0, 'the deterministic finalize path spends nothing — manifests already exist');
    assert.equal(messages.filter((m) => m === 'architect.finalize.start').length, 1);
    assert.ok(
      messages.indexOf('architect.finalize.start') < messages.indexOf('plan-approved'),
      'finalize.start must precede the work it announces the start of',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
