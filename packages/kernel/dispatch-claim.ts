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
import { statSync } from 'node:fs';
import { join } from 'node:path';

import { resolveGuardedPath, guardedReadFile, guardedWriteFileExclusive, guardedUnlink } from './path-guard.ts';
import { DispatchInFlight } from './http-envelope.ts';

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

/**
 * Claim `_logs/<logDirName>/turn.pid` for `ownershipMark`, synchronously and
 * with no `await` before the caller's own `spawn()` — a single-threaded
 * bridge can never interleave between this claim and the spawn it guards.
 *
 * A live turn already holding the slot (`isAlive(existingPid, ownershipMark)`
 * true) throws `DispatchInFlight` naming the holder pid, BEFORE anything
 * spawns — never swallowed; every caller's route maps it to HTTP 409 via
 * `sendIfDispatchInFlight`.
 *
 * A STALE slot — a dead/unowned pid, OR a `CLAIMING_PLACEHOLDER` older than
 * `CLAIM_PLACEHOLDER_STALE_MS` (MEDIUM-2) — is removed first, then
 * re-claimed via an EXCLUSIVE create (`guardedWriteFileExclusive`, the 'wx'
 * flag): atomic even ACROSS OS PROCESSES, so a racing claim can never both
 * believe it won — the loser sees the winner's claim on its next read and
 * refuses instead of spawning a second child.
 *
 * MEDIUM-3 — a containment rejection (`guardedWriteFileExclusive` returning
 * `null`) is NOT raced past: it throws and refuses the dispatch, rather than
 * letting the caller spawn unclaimed.
 */
export function claimDispatchSlot(
  forgeRoot: string,
  logDirName: string,
  ownershipMark: string,
  isAlive: (pid: number, ownershipMark: string) => boolean,
): void {
  const logsRoot = join(forgeRoot, '_logs');
  const existingPid = readClaimedPid(logsRoot, logDirName);
  if (existingPid !== null) {
    if (isAlive(existingPid, ownershipMark)) {
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
}

/** Release a claim this call made — after its own spawn attempt failed, or
 *  after the turn it tracked has ended — so a routine failure never
 *  permanently bricks the run id's dispatch slot. A no-op when nothing is
 *  claimed. */
export function releaseDispatchSlot(forgeRoot: string, logDirName: string): void {
  guardedUnlink(join(forgeRoot, '_logs'), [logDirName, 'turn.pid']);
}
