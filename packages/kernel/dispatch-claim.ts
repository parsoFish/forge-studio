/**
 * dispatch-claim.ts — the ONE on-disk claim every detached-agent spawn seam
 * makes before it spawns: `_logs/<logDirName>/turn.pid` holds at most one
 * LIVE, OWNED turn at a time (row 206, forge-8vfn.8.5.56).
 *
 * Lives in kernel (rank 1) so every spawn seam can reuse it directly instead
 * of copying it — `apps/forge/bridge-agent-dispatch.ts`'s `spawnAgentTurn`/
 * `spawnAgentDispatch`, `apps/forge/bridge-studio-writes.ts`'s
 * `spawnPreflightFix`, and `@forge/knowledge`'s `spawnBrainFix` all call the
 * SAME `claimDispatchSlot`/`releaseDispatchSlot` below.
 *
 * `isAlive` is a PARAMETER, never an import of the real liveness check
 * (`isTurnAlive`, `@forge/sessions`): this package is rank 1 and sessions is
 * rank 4, the identical rank problem `packages/agents/bridge-agents-run-
 * state.ts` already documents for the same function. Every caller at or
 * above sessions' own rank passes `isTurnAlive` straight through; a caller
 * below it (knowledge, rank 2) receives it as its own injected port, same
 * shape as `KnowledgeRouteDeps.runFixTurn`.
 */
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { resolveGuardedPath, guardedReadFile, guardedWriteFile, guardedWriteFileExclusive, guardedUnlink } from './path-guard.ts';
import { DispatchInFlight, Halted } from './http-envelope.ts';
import { readHalt, forgeQueueRoot } from './halt.ts';

/** Timestamp + short random suffix (YYYY-MM-DDTHH-mm-ss-SSS-xxxx): ms
 *  precision plus 4 base36 chars so two dispatches minted in the same
 *  millisecond never collide on one `_logs/<runId>/` dir. */
export function newRunStamp(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '');
  return `${ts}-${randomRunSuffix()}`;
}

/** The 4-char base36 random half of `newRunStamp`, exported standalone for a
 *  caller that mints its own id shape (e.g. `<project>-<clause>-<Date.now()
 *  .toString(36)>`) and only wants the collision-breaking tail, not a second
 *  leading timestamp. */
export function randomRunSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/** A placeholder written while a slot is being claimed, before the real
 *  child's pid exists. Deliberately NOT numeric: `readClaimedPid` below only
 *  recognises `/^\d+\s*$/`, so a reader mid-claim never misreads this as a
 *  dead/stale pid and removes a claim that is genuinely in flight. */
const CLAIMING_PLACEHOLDER = 'claiming\n';

/** How long a `CLAIMING_PLACEHOLDER` may sit unresolved — a crash between
 *  the placeholder write and the real pid overwrite, a few synchronous
 *  instructions with no I/O between them — before a later dispatch may treat
 *  it as abandoned rather than genuinely in flight (MEDIUM-2, row 206 follow-
 *  up: an unaged placeholder wedges the run id's dispatch slot forever). */
export const CLAIM_PLACEHOLDER_STALE_MS = 10_000;

function readClaimedPid(logsRoot: string, logDirName: string): number | null {
  const raw = guardedReadFile(logsRoot, [logDirName, 'turn.pid']);
  return raw !== null && /^\d+\s*$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : null;
}

/** The claim file's own mtime age in ms, or `null` when absent/rejected. */
function claimAgeMs(logsRoot: string, logDirName: string): number | null {
  const guarded = resolveGuardedPath(logsRoot, [logDirName, 'turn.pid']);
  if (!guarded.ok || !guarded.exists) return null;
  try {
    return Date.now() - statSync(guarded.realPath).mtimeMs;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Row 206 follow-up (m7-e-r206-fixgate-s1 capture) — "a turn writes its
// run-level `end` and then takes a moment to exit; LIVE must mean 'has not
// written its end', never 'pid not yet reaped'."
//
// A sibling file, never a change to `turn.pid`'s own `/^\d+\s*$/` shape —
// ~15 other readers across the tree (lifecycle derivation, cancel, the
// agents/sessions run-state ports) parse `turn.pid` as a bare pid, and
// reshaping it to carry a second token would mean auditing and updating
// every one of them for no gain this module needs for itself.
// ---------------------------------------------------------------------------

/** Sibling of `turn.pid`: the `events.jsonl` byte SIZE at the instant the
 *  claim now on disk was minted. Read back by `holderHasEnded` so a LATER
 *  claim attempt judges the holder's own window, never one recomputed now —
 *  see that function's doc for the double-press race this guards. */
const CLAIM_MARK_FILENAME = 'turn.pid.mark';

/** A row shape wide enough to classify without importing `EventLogEntry` —
 *  this reads a channel's events, `logging.ts`'s own type is for writing
 *  one. */
type RunLevelCandidate = {
  event_type?: unknown;
  skill?: unknown;
  metadata?: { phase?: unknown; priced?: unknown } | null;
};

/**
 * The SAME discrimination `scripts/stories/agent-parity.mjs`'s
 * `runLevelRows` applies (restated here, not re-derived — that module's own
 * header measured a real capture for each exclusion): never a hook fired
 * mid-turn (`skill: 'hook:<id>'`), never a pricing-only end
 * (`emitTurnCostRow`/`emitTurnEndedUnpricedRow`, `metadata.priced` a
 * boolean, never a lifecycle boundary), and — for a SESSION turn only
 * (`sessionTurnShape`, `runKindTurn`/`interactive-runner.ts`'s shared
 * plumbing) — never an inner stage ping or critic sub-turn, neither of
 * which stamps `metadata.phase` the way the turn's own start/end do. A
 * standalone channel (`runAgent`/`runFixTurn`) carries no `metadata.phase`
 * on its OWN run-level rows either, so `sessionTurnShape` is false there.
 */
function isRunLevelEvent(row: RunLevelCandidate, sessionTurnShape: boolean): boolean {
  if (row.event_type !== 'start' && row.event_type !== 'end') return false;
  if (typeof row.skill === 'string' && row.skill.startsWith('hook:')) return false;
  if (row.event_type === 'end' && typeof row.metadata?.priced === 'boolean') return false;
  if (!sessionTurnShape) return true;
  return typeof row.metadata?.phase === 'string' && row.metadata.phase !== '';
}

/** `events.jsonl`'s current byte size, or 0 when absent/rejected — the
 *  position a fresh claim is minted at. */
function eventsFileSize(logsRoot: string, logDirName: string): number {
  const guarded = resolveGuardedPath(logsRoot, [logDirName, 'events.jsonl']);
  if (!guarded.ok || !guarded.exists) return 0;
  try {
    return statSync(guarded.realPath).size;
  } catch {
    return 0;
  }
}

/** The mark recorded for the claim CURRENTLY on disk — 0 when absent (no
 *  mark file yet, or a claim minted before this feature shipped): the safe
 *  default is "nothing is excluded", never "everything is", so a missing
 *  mark can only widen the read window, never hide a genuine end. */
function readClaimMark(logsRoot: string, logDirName: string): number {
  const raw = guardedReadFile(logsRoot, [logDirName, CLAIM_MARK_FILENAME]);
  const n = raw === null ? NaN : Number.parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Read `events.jsonl` from byte offset `mark` to EOF and return the LAST
 * run-level row's `event_type` found there, or `null` when the window is
 * empty or carries no run-level row at all. NEVER sorted by `started_at` —
 * `events.jsonl` is append-only and line-buffered (this module's own
 * `createLogger`, `logging.ts`), so file order already IS causal order
 * (`agent-parity.mjs`'s header measured a real capture where sorting by the
 * wall clock reordered a healthy sequence into a false double-start).
 */
function lastRunLevelEventTypeSince(logsRoot: string, logDirName: string, mark: number, sessionTurnShape: boolean): 'start' | 'end' | null {
  const guarded = resolveGuardedPath(logsRoot, [logDirName, 'events.jsonl']);
  if (!guarded.ok || !guarded.exists) return null;
  let size: number;
  try {
    size = statSync(guarded.realPath).size;
  } catch {
    return null;
  }
  if (size <= mark) return null;
  let text: string;
  try {
    const fd = openSync(guarded.realPath, 'r');
    try {
      const length = size - mark;
      const buf = Buffer.alloc(length);
      readSync(fd, buf, 0, length, mark);
      text = buf.toString('utf8');
    } finally {
      closeSync(fd);
    }
  } catch {
    return null;
  }
  let last: 'start' | 'end' | null = null;
  for (const line of text.split('\n')) {
    if (line.trim().length === 0) continue;
    let row: RunLevelCandidate;
    try {
      row = JSON.parse(line) as RunLevelCandidate;
    } catch {
      continue; // a torn trailing line mid-append — never the whole truth either way
    }
    if (isRunLevelEvent(row, sessionTurnShape)) last = row.event_type as 'start' | 'end';
  }
  return last;
}

/**
 * True iff the claim currently on disk belongs to a turn that has ALREADY
 * written its own run-level `end` SINCE ITS OWN MARK (`readClaimMark`) —
 * never a mark recomputed now. A holder that was JUST reclaimed and has not
 * written its own start yet must never be judged against a PREVIOUS
 * holder's already-closed turn: for the first moments of a new claim the
 * log still ends with the prior holder's `end`, and reading that as "this
 * holder is finished" is the row-202 double-start — two dispatches 5ms
 * apart, both spawned before either logged. The mark pins the boundary to
 * the instant THIS holder's own claim was minted, so only an end written
 * after that instant can ever be read as this holder's own.
 */
function holderHasEnded(logsRoot: string, logDirName: string, sessionTurnShape: boolean): boolean {
  const mark = readClaimMark(logsRoot, logDirName);
  return lastRunLevelEventTypeSince(logsRoot, logDirName, mark, sessionTurnShape) === 'end';
}

export type ClaimDispatchSlotOpts = {
  /** True for a SESSION-kind turn (`spawnAgentTurn` — architect/instructions/
   *  demo-builder/project-brain/authoring/kb-cleanup, all `runKindTurn`/
   *  `interactive-runner.ts` shaped): its run-level rows carry
   *  `metadata.phase`, and `holderHasEnded` must not be fooled by an inner
   *  stage ping or critic sub-turn that lacks it. Omitted (false) for a
   *  standalone channel (`runAgent`/`runFixTurn` — `spawnAgentDispatch`/
   *  `spawnPreflightFix`/`spawnBrainFix`), whose own run-level rows carry no
   *  `metadata.phase` at all. */
  sessionTurnShape?: boolean;
};

/**
 * Claim `_logs/<logDirName>/turn.pid` for `ownershipMark`, synchronously and
 * with no `await` before the caller's own `spawn()` — a single-threaded
 * bridge can never interleave between this claim and the spawn it guards.
 *
 * While the emergency halt is on (`<forgeRoot>/_queue/halt.json`, ADR 011) the
 * claim throws `Halted` before it writes anything: a refused dispatch leaves
 * the session dir byte-identical.
 *
 * A live turn already holding the slot throws `DispatchInFlight` naming the
 * holder pid, BEFORE anything spawns — never swallowed; every caller's route
 * maps it to HTTP 409 via `sendIfDispatchRefused`. "Live" (row 206 follow-
 * up, m7-e-r206-fixgate-s1 capture) means `isAlive(existingPid, ownershipMark)`
 * AND the holder has NOT already written its own run-level `end`
 * (`holderHasEnded`) — a turn writes `end` and then takes a moment to exit,
 * and `isAlive` alone would read that exit window as still in flight.
 *
 * A STALE slot — a dead/unowned pid, an ENDED one, OR a `CLAIMING_PLACEHOLDER`
 * older than `CLAIM_PLACEHOLDER_STALE_MS` (MEDIUM-2) — is removed first, then
 * re-claimed via an EXCLUSIVE create (`guardedWriteFileExclusive`, the 'wx'
 * flag): atomic even ACROSS OS PROCESSES, so a racing claim can never both
 * believe it won — the loser sees the winner's claim on its next read and
 * refuses instead of spawning a second child.
 *
 * MEDIUM-3 — a containment rejection (`guardedWriteFileExclusive` returning
 * `null`) is NOT raced past: it throws and refuses the dispatch, rather than
 * letting the caller spawn unclaimed. The SAME fail-closed rule governs the
 * mark write below: this claim's own window into `events.jsonl` must never
 * be left pointing at a STALE (too-small) mark, which would let the NEXT
 * claim attempt misread a PRIOR holder's end as this one's own — exactly the
 * row-202 double-start this mark exists to prevent.
 *
 * A turn's own `end` is the fact a reclaim acts on; there is deliberately NO
 * separate "free my claim" step a finishing turn calls on its way out — that
 * step would race the exact same exit window `isAlive` does, and `turn.pid`
 * is read by lifecycle/cancel code that needs the pid to stay in place for
 * as long as it is genuinely the last-known holder.
 */
export function claimDispatchSlot(
  forgeRoot: string,
  logDirName: string,
  ownershipMark: string,
  isAlive: (pid: number, ownershipMark: string) => boolean,
  opts: ClaimDispatchSlotOpts = {},
): void {
  const halt = readHalt(forgeQueueRoot(forgeRoot));
  if (halt !== null) throw new Halted(halt.since);
  const sessionTurnShape = opts.sessionTurnShape ?? false;
  const logsRoot = join(forgeRoot, '_logs');
  const existingPid = readClaimedPid(logsRoot, logDirName);
  if (existingPid !== null) {
    const stillInFlight = isAlive(existingPid, ownershipMark) && !holderHasEnded(logsRoot, logDirName, sessionTurnShape);
    if (stillInFlight) {
      throw new DispatchInFlight(existingPid, ownershipMark);
    }
    guardedUnlink(logsRoot, [logDirName, 'turn.pid']);
  } else {
    // No numeric pid: either nothing claimed it, or a CLAIMING_PLACEHOLDER
    // sits there mid-claim (or abandoned by a crash). Only an ABANDONED
    // placeholder is stale; a fresh one is a genuinely in-flight claim this
    // call must not race past — leave it for the exclusive-create below to
    // refuse honestly.
    const age = claimAgeMs(logsRoot, logDirName);
    if (age !== null && age > CLAIM_PLACEHOLDER_STALE_MS) {
      guardedUnlink(logsRoot, [logDirName, 'turn.pid']);
    }
  }
  let claimed: string | null;
  try {
    claimed = guardedWriteFileExclusive(logsRoot, [logDirName, 'turn.pid'], CLAIMING_PLACEHOLDER);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err;
    // Lost a race for the just-emptied slot — name whoever won it.
    throw new DispatchInFlight(readClaimedPid(logsRoot, logDirName) ?? -1, ownershipMark);
  }
  if (claimed === null) {
    // MEDIUM-3 — containment refused the claim path itself (e.g. a
    // symlinked leaf). Fail closed: refuse the dispatch rather than letting
    // the caller spawn with no claim in place.
    throw new Error(`dispatch claim refused: containment rejected _logs/${logDirName}/turn.pid`);
  }
  // Row 206 follow-up — stamp THIS claim's own mark the instant the slot
  // changed hands: the `events.jsonl` byte size right now, so a LATER claim
  // attempt's `holderHasEnded` can tell "my own end" from "whatever was
  // already there" (the row-202 double-start). A containment rejection here
  // fails the whole claim closed, same as the `turn.pid` write above —
  // leaving a stale mark in its place is worse than refusing outright.
  if (guardedWriteFile(logsRoot, [logDirName, CLAIM_MARK_FILENAME], String(eventsFileSize(logsRoot, logDirName))) === null) {
    guardedUnlink(logsRoot, [logDirName, 'turn.pid']);
    throw new Error(`dispatch claim refused: containment rejected _logs/${logDirName}/${CLAIM_MARK_FILENAME}`);
  }
}

/** Release a claim this call made — after its own spawn attempt failed, or
 *  after the turn it tracked has ended — so a routine failure never
 *  permanently bricks the run id's dispatch slot. A no-op when nothing is
 *  claimed. */
export function releaseDispatchSlot(forgeRoot: string, logDirName: string): void {
  const logsRoot = join(forgeRoot, '_logs');
  guardedUnlink(logsRoot, [logDirName, 'turn.pid']);
  guardedUnlink(logsRoot, [logDirName, CLAIM_MARK_FILENAME]);
}
