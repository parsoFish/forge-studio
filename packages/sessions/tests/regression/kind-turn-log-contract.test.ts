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
import { runKindTurn, type SessionKindVariant } from '../../kinds/kind-turn.ts';
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

/**
 * DEFECT 3 — architect resurrected a CANCELLED session.
 *
 * W7-FIX-A2 (W7A2-01) gave the interactive seam a sticky terminal `cancelled`
 * phase: a turn that finishes AFTER the operator cancelled must have its
 * advance DISCARDED. Three of the four bespoke runners got that through
 * `guardedWriteSessionStatus`; architect wrote through its own
 * `guardedWriteStatus`, which writes unconditionally and never reads the
 * on-disk phase — so an architect turn completing after a cancel moved the
 * session back out of its terminal phase and it reappeared as live.
 *
 * The M4 ruling-60 port routes architect's status writes through the shared
 * driver, where the seam lives, so the divergence closes by construction.
 *
 * WHY THIS IS TWO ASSERTIONS AND NOT ONE END-TO-END TURN. My first attempt
 * drove `runArchitectTurn` on a session already `cancelled` and asserted the
 * phase survived. It passed against the UNFIXED code too — because
 * `cancelled` has no step handler, the turn takes `otherwise` and writes
 * nothing at all, so the assertion held for a reason that had nothing to do
 * with the seam (COMMON §15.75: a control the fix cannot change is not a
 * control; the mutation pass is what caught it). Staging a genuine
 * write-after-cancel through the real entry point needs a phase whose step
 * both writes status AND spawns, so the honest split is: prove the SEAM
 * behaviourally at the driver, and prove architect REACHES it structurally.
 */
test('the driver refuses a status advance over a cancelled phase, naming the reason (W7A2-01)', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'kind-turn-cancel-'));
  try {
    const projectRoot = join(forgeRoot, 'projects', 'testproj');
    const sessionDir = join(projectRoot, '_probe', SESSION_ID);
    mkdirSync(sessionDir, { recursive: true });
    writeSessionStatus(sessionDir, { session_id: SESSION_ID, phase: 'working' });

    let refusal: Error | null = null;
    const variant: SessionKindVariant<{ phase: string }, { phase: string; wrote: string[] }> = {
      id: 'probe', kindDir: '_probe', label: 'probe runner', eventLabel: 'probe turn',
      eventPhase: 'orchestrator', eventSkill: 'probe',
      initiativeId: (sid) => `probe-${sid}`,
      steps: {
        // The operator cancels WHILE the turn runs, then the turn writes its advance.
        working: async ({ status, writeStatus }) => {
          writeSessionStatus(sessionDir, { session_id: SESSION_ID, phase: 'cancelled' });
          try { writeStatus({ ...status, phase: 'committed' }); }
          catch (err) { refusal = err as Error; }
          return { phase: 'committed', wrote: [] };
        },
      },
      otherwise: (st) => ({ phase: st.phase, wrote: [] }),
    };

    await runKindTurn(variant, { sessionId: SESSION_ID, projectRoot, forgeRoot });

    const after = JSON.parse(readFileSync(join(sessionDir, 'status.json'), 'utf8')) as { phase: string };
    assert.equal(after.phase, 'cancelled', 'the terminal cancelled phase is sticky — the advance must be discarded');
    assert.ok(refusal, 'the refusal must be raised, not swallowed — a silently dropped advance is indistinguishable from success');
    assert.match(
      String(refusal), /cancelled while this turn ran/,
      `the refusal must name the CANCEL, not "containment" — they are different causes and the operator sees this text. Got: ${String(refusal)}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('the architect kind declares no status writer of its own — it reaches the seam above', () => {
  const src = readFileSync(new URL('../../kinds/architect.ts', import.meta.url), 'utf8');
  assert.equal(
    /function writeArchitectStatus\s*\(/.test(src), false,
    'kinds/architect.ts must not re-declare a private status writer — that is how it missed the sticky-cancel seam for a whole wave',
  );
  assert.equal(
    src.split('\n').filter((l) => /^\s*guardedWriteStatus\(/.test(l)).length, 0,
    'no step may advance the phase through the unconditional guardedWriteStatus — advances go through the driver\'s writeStatus',
  );
});
