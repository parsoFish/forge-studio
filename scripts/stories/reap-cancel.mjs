/**
 * reap-cancel.mjs — the terminal fact a KILL cannot write for itself.
 *
 * Bead `forge-8vfn.6.11.12` (T1 ruling 232). `reap.mjs` ends processes; this
 * module records that they ended. The two are separated because they answer
 * different questions and fail differently: a reap is a signal aimed at a pid
 * under a provenance ladder, and a cancellation is a guarded write into a
 * session an operator will read. Splitting them also kept `reap.mjs` under the
 * 800-line cap when `6.11.14`'s fallback landed — the cap naming the seam
 * rather than the seam being invented to satisfy the cap.
 */
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { findSessionProject } from '@forge/sessions/session-resolution.ts';
import {
  CANCELLED_PHASE,
  guardedReadSessionStatus,
  guardedWriteSessionStatus,
} from '@forge/sessions/session-status-io.ts';

// ---------------------------------------------------------------------------
// The terminal fact a KILL cannot write for itself (bead `forge-8vfn.6.11.12`,
// T1 ruling 232).
// ---------------------------------------------------------------------------

/**
 * A SIGTERM cannot run a pending `finally` and a SIGKILL cannot be handled at
 * all, so a reaped turn writes NOTHING on its way out: `runInteractiveTurn`'s
 * closing `end` event never fires and `status.json` keeps the phase the turn
 * was working in. What is left on disk is byte-for-byte what a turn still
 * running looks like — COMMON §15.92 inside the session log — so a torn-down
 * architect reads `working`, then `stalled` once the ceiling passes, and never
 * becomes terminal. Four costed story runs in M5-B reported their agents as
 * in-progress after the run that killed them had exited.
 *
 * THE FIX IS A REUSE, NOT A NEW VOCABULARY. The product already owns exactly
 * one word for this: `CANCELLED_PHASE` — "the ONE universal reserved terminal
 * phase, checked FIRST for every kind" (`isTerminalPhase`), which makes
 * `deriveSessionLifecycle` answer `terminal`. The generic cancel route writes
 * it and calls `killTrackedTurn`; this reaper killed and wrote nothing. So it
 * now performs the SAME act, through the SAME guarded seam, with a reason
 * naming what fired.
 *
 * ONLY A DIR WE ACTUALLY REAPED. A skipped pid is one `decideReap` refused to
 * signal — declaring its turn over would be a claim about a process still
 * working in somebody else's tree, which is the S3 incident's error wearing a
 * different hat.
 *
 * THE SESSION IS READ FROM THE START EVENT, NEVER FROM THE DIRECTORY NAME.
 * `_${kind}-${sessionId}` has no unique parse: kinds contain hyphens
 * (`project-brain`) and so do session ids (`2026-08-14T15-07-02`), so
 * `_project-brain-2026-08-14T15-07-02` splits five ways. The runner already
 * writes `{session_kind, session_id}` into the start event's metadata — read
 * the fact rather than re-deriving it (§15.155: never recover a field by
 * splitting a string that also carries free text).
 *
 * THE STICKY-CANCEL RULE IS NOT RE-IMPLEMENTED HERE. `guardedWriteSessionStatus`
 * already refuses a write that would move a session OFF `cancelled` and allows
 * re-stamping `cancelled` over `cancelled`; routing through that seam means
 * this caller inherits the rule instead of carrying a second copy of it.
 *
 * Never throws: this runs inside the run's `finally`, where an exception loses
 * the verdict the run exists to write. Every refusal is returned BY NAME.
 *
 * @param {{reaped: Array<{pid:number,dir:string,signal:string,via?:string}>, skipped: Array<unknown>}} report
 * @param {{projectsRoot: string, reason: string}} opts
 * @returns {Array<{dir:string,kind:string|null,sessionId:string|null,project:string|null,cancelledFrom:string|null,written:boolean,reason:string|null}>}
 */
export function recordReapedCancellations(report, opts) {
  const { projectsRoot, reason } = opts;
  /** dir -> the ROOT signal, i.e. the first pid reaped for it. Descendants
   *  share their root's dir and are reported on their own `describeReap` line;
   *  the session was terminated once, so it is stamped once. */
  const firstByDir = new Map();
  for (const r of report.reaped ?? []) {
    if (!firstByDir.has(r.dir)) firstByDir.set(r.dir, r);
  }

  const outcomes = [];
  for (const [dir, root] of firstByDir) {
    outcomes.push(cancelOneSession(dir, root, projectsRoot, reason));
  }
  return outcomes;
}

/** A cancellation reason is written into a session an operator will read, so
 *  it is capped rather than allowed to carry a whole failure dump. */
const REASON_CAP = 300;

/**
 * The reason a story run gives for terminating the turns it killed.
 *
 * It names the run's FIRST RED BEAT and quotes that beat's first failure line,
 * because since bead `forge-8vfn.6.11.10` that line already names WHICH BOUND
 * gave up (`beatBound`'s label). So the session says "the agent wait declared
 * 600000 ms fired at beat 11" rather than only "the run ended" — which is the
 * difference between a diagnosable teardown and a guess, exactly as the
 * provenance rung is for the kill itself.
 *
 * An all-green run still cancels: the turn outlived the run that dispatched
 * it, which is the orphan window this module exists to close.
 */
export function reapReasonFor(story, beats) {
  const total = story?.beats?.length ?? beats.length;
  const firstRed = beats.findIndex((b) => b.status !== 'green');
  const where =
    firstRed === -1
      ? `all ${beats.length} beats green`
      : `first red at beat ${firstRed + 1} of ${total}: ${beats[firstRed].failures?.[0] ?? 'no failure text recorded'}`;
  const reason = `story runner ${story?.id ?? 'unknown'}: the run ended while this turn was still working (${where})`;
  return reason.length > REASON_CAP ? `${reason.slice(0, REASON_CAP)}…` : reason;
}

/** One dir's whole decision, with every refusal named. Never throws. */
function cancelOneSession(dir, root, projectsRoot, reason) {
  const miss = (kind, sessionId, why) => ({
    dir, kind, sessionId, project: null, cancelledFrom: null, written: false, reason: why,
  });
  try {
    const start = readStartEvent(dir);
    if (start === null) {
      return miss(null, null, 'no start event names the session — nothing to terminate');
    }
    if (start.kind === null) {
      // Two facts that disagree. Say which, and change nothing.
      return miss(
        null,
        start.sessionId,
        `the start event names session "${start.sessionId}" but the log dir "${start.nameMismatch}" ` +
          'does not name it as `_<kind>-<sessionId>` — refusing to guess the kind',
      );
    }
    const { kind, sessionId } = start;
    const kindDirName = `_${kind}`;
    const found = findSessionProject(projectsRoot, kindDirName, sessionId);
    if (!found.ok) {
      return miss(kind, sessionId, `no session dir under the projects root (${found.reason})`);
    }
    const segments = [found.project, kindDirName, sessionId];
    const status = guardedReadSessionStatus(projectsRoot, segments);
    if (status === null || typeof status.phase !== 'string') {
      return { ...miss(kind, sessionId, 'no readable status.json'), project: found.project };
    }
    if (status.phase === CANCELLED_PHASE) {
      return {
        ...miss(kind, sessionId, 'already cancelled — a terminal phase is never re-stamped'),
        project: found.project,
      };
    }
    const written = guardedWriteSessionStatus(projectsRoot, segments, {
      ...status,
      phase: CANCELLED_PHASE,
      cancelled_at: new Date().toISOString(),
      cancelled_from: status.phase,
      cancelled_reason: `${reason} (reaped ${root.signal})`,
    });
    if (written === null) {
      return {
        ...miss(kind, sessionId, 'the guarded status write refused the path'),
        project: found.project,
      };
    }
    return {
      dir,
      kind,
      sessionId,
      project: found.project,
      cancelledFrom: status.phase,
      written: true,
      reason: null,
    };
  } catch (err) {
    return miss(null, null, `could not terminate: ${err?.message ?? String(err)}`);
  }
}

/**
 * `{kind, sessionId}` from the FIRST `start` row of `<dir>/events.jsonl`, or
 * `null` when the log is absent, unreadable, or carries no start row naming a
 * session. A malformed line is skipped, never fatal: a log truncated mid-write
 * by the very kill this function reports on is the expected input.
 *
 * `session_kind` IS OPTIONAL, and that is measured rather than defensive (bead
 * `forge-8vfn.6.11.14`, S4 run 2). The generic `interactive-runner.ts` writes
 * `metadata {session_id, session_kind, phase, step}`; the LEGACY bespoke
 * architect runner writes `{session_id, phase, round}` and no kind — so the
 * first real reap after `6.11.12` landed refused with `unknown/unknown` for the
 * one kind every costed story in this milestone depends on.
 *
 * WHY THE DIR NAME IS SAFE TO READ HERE, having been refused above. `_${kind}-
 * ${sessionId}` has NO unique split — kinds contain hyphens (`project-brain`)
 * and so do session ids (`2026-09-05T07-58-40-acb79ba9`). That is true of the
 * name ALONE. It stops being true the moment one half is known: with
 * `session_id` from the event, the kind is the name minus a leading `_` minus a
 * trailing `-<sessionId>`. Subtraction, not a guess — and it FAILS CLOSED when
 * the name does not have that exact shape, because two facts that disagree mean
 * "I cannot name this session", never a kind assembled from the leftovers.
 *
 * A DECLARED `session_kind` always wins: the fallback is for runners that emit
 * none, not a replacement for the ones that do.
 */
function readStartEvent(dir) {
  let text;
  try {
    text = readFileSync(join(dir, 'events.jsonl'), 'utf8');
  } catch {
    return null;
  }
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    if (row?.event_type !== 'start') continue;
    const sessionId = row?.metadata?.session_id;
    if (typeof sessionId !== 'string' || sessionId.length === 0) continue;
    const declared = row?.metadata?.session_kind;
    if (typeof declared === 'string' && declared.length > 0) return { kind: declared, sessionId };
    const derived = kindFromLogDirName(basename(dir), sessionId);
    if (derived !== null) return { kind: derived, sessionId, derivedKind: true };
    return { kind: null, sessionId, nameMismatch: basename(dir) };
  }
  return null;
}

/**
 * The kind in `_<kind>-<sessionId>`, by subtracting the parts already known, or
 * `null` when the name is not that shape. See {@link readStartEvent} for why
 * this is subtraction and not parsing.
 */
function kindFromLogDirName(dirName, sessionId) {
  const suffix = `-${sessionId}`;
  if (!dirName.startsWith('_') || !dirName.endsWith(suffix)) return null;
  const kind = dirName.slice(1, dirName.length - suffix.length);
  return kind.length > 0 ? kind : null;
}
