/**
 * Two defects the M4 ruling-60 ports fix, each pinned by the observable it
 * broke. Both are DISCLOSED BEHAVIOUR CHANGES, not refactor side effects, and
 * both are recorded in the port PR's body.
 *
 * DEFECT 1 — the event log did not terminate. `runInstructionsTurn` emitted a
 * `start` event and then returned on BOTH of its paths without an `end`. A run
 * whose log has no terminal event is bead forge-8vfn.5.38's exact signature:
 * every consumer that decides "is this still running?" from the log reads it as
 * perpetually in flight. The shared driver emits the `end` event for every
 * kind, so the shape cannot come back one kind at a time.
 *
 * DEFECT 2 — the `_logs` root was CWD-RELATIVE. `instructions-runner.ts` read
 * `input.logsRoot ?? resolve('_logs')`, ignoring the `forgeRoot` its own caller
 * threads in (`cmdAgentRun`'s `needsForgeRoot`). That is the class M4-agents
 * closed as finding A1: a process that changes directory does not stop writing
 * events, it writes them somewhere else, and the run's log simply ends. The
 * driver anchors on `forgeRoot`.
 *
 * WHY THESE ASSERTIONS AND NOT THE GOLDEN. The spawn-capture golden passes
 * `logsRoot` AND `logger` explicitly, so it never exercises either default and
 * would stay green against both defects — a control the fix cannot change is
 * not a control (COMMON §15.75). These drive the real entry point with those
 * two inputs OMITTED, which is the only shape that can tell the versions apart.
 * Both were run against the pre-port code and fail there: no `end` event at all
 * for the first, and `<cwd>/_logs` instead of `<forgeRoot>/_logs` for the
 * second.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInstructionsTurn, instructionsSessionDir, type InstructionsStatus } from '../../kinds/instructions.ts';
import { writeSessionStatus } from '../../interactive-session.ts';

const SESSION_ID = '2026-09-03T00-00-00-deadbeef';

/** A phase whose step does real work and never spawns: it writes status and
 *  returns, so the turn is driven end to end with no LLM anywhere near it. */
const NON_SPAWNING_PHASE = 'rejected' as const;

function setup(): { forgeRoot: string; projectRoot: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'kind-turn-log-'));
  const projectRoot = join(forgeRoot, 'projects', 'testproj');
  const sessionDir = instructionsSessionDir(projectRoot, SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });
  const status: InstructionsStatus = {
    session_id: SESSION_ID,
    project: 'testproj',
    project_repo_path: projectRoot,
    phase: NON_SPAWNING_PHASE,
    round: 1,
    prompt: '',
    updated_at: new Date(0).toISOString(),
  };
  writeSessionStatus(sessionDir, status);
  return { forgeRoot, projectRoot };
}

/** Every event object under `<root>/_logs/<dir>/events.jsonl`, flattened. */
function eventsUnder(logsRoot: string): Record<string, unknown>[] {
  if (!existsSync(logsRoot)) return [];
  const out: Record<string, unknown>[] = [];
  for (const dir of readdirSync(logsRoot)) {
    const f = join(logsRoot, dir, 'events.jsonl');
    if (!existsSync(f)) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line) as Record<string, unknown>); } catch { /* a torn line is not an event */ }
    }
  }
  return out;
}

test('an instructions turn TERMINATES its event log (bead 5.38 shape)', async () => {
  const { forgeRoot, projectRoot } = setup();
  try {
    const result = await runInstructionsTurn({ sessionId: SESSION_ID, projectRoot, forgeRoot });
    assert.equal(result.phase, 'rejected', 'fixture precondition: the non-spawning step must have run');

    const events = eventsUnder(join(forgeRoot, '_logs'));
    const types = events.map((e) => e.event_type);
    assert.ok(types.includes('start'), `the turn must emit a start event, got ${JSON.stringify(types)}`);
    assert.ok(
      types.includes('end'),
      `the turn must TERMINATE its log — a run whose events never end reads as perpetually in flight (bead 5.38). Got ${JSON.stringify(types)}`,
    );

    // Stronger than "an end exists": the end must describe THIS turn, so a
    // stray terminal event from anything else cannot satisfy the assertion.
    const end = events.find((e) => e.event_type === 'end');
    const meta = (end?.metadata ?? {}) as Record<string, unknown>;
    assert.equal(meta.session_id, SESSION_ID, 'the end event must name this session');
    assert.equal(meta.phase, 'rejected', 'the end event must carry the phase the turn left behind');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('the _logs root is anchored on forgeRoot, never the process cwd (agents finding A1)', async () => {
  const { forgeRoot, projectRoot } = setup();
  const elsewhere = mkdtempSync(join(tmpdir(), 'kind-turn-cwd-'));
  const before = process.cwd();
  try {
    // The whole point: cwd is NOT forgeRoot. Under the pre-port
    // `resolve('_logs')` the events land here instead, and the run's log ends.
    process.chdir(elsewhere);
    await runInstructionsTurn({ sessionId: SESSION_ID, projectRoot, forgeRoot });

    assert.ok(
      eventsUnder(join(forgeRoot, '_logs')).length > 0,
      'the turn must write its events under <forgeRoot>/_logs',
    );
    assert.equal(
      eventsUnder(join(elsewhere, '_logs')).length,
      0,
      'no event may land under the process cwd — that is the A1 defect: the log does not stop, it MOVES',
    );
  } finally {
    process.chdir(before);
    rmSync(forgeRoot, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});
