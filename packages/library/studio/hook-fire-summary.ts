/**
 * forge-8vfn.5.16 (M7-C U2) — pure reducer over a run's raw event stream,
 * folding every `message:"hook.fire"` event (emitted by
 * `packages/agents/studio/hook-dispatch.ts`'s `emitHookFire`) that names ONE
 * hook down into "did this hook ever fire, when did it last fire, with what
 * outcome, and how many times total".
 *
 * No DOM, no network, no filesystem — the caller (`bridge-studio-hooks-
 * detail.ts`'s `handleHookDetail`) does the guarded log scan and hands this
 * function the parsed events. Kept separate from that route so the folding
 * logic is unit-testable without a real forge root.
 */
import type { EventLogEntry } from '@forge/kernel';

export type HookFireOutcome = 'ran' | 'refused' | 'timeout' | 'error';

export type HookFireSummary = {
  lastFireAt: string;
  lastFireOutcome: HookFireOutcome;
  fireCount: number;
};

const KNOWN_OUTCOMES: readonly HookFireOutcome[] = ['ran', 'refused', 'timeout', 'error'];

function isHookFireOutcome(value: unknown): value is HookFireOutcome {
  return typeof value === 'string' && (KNOWN_OUTCOMES as readonly string[]).includes(value);
}

/**
 * `events` is the (possibly BOUNDED — see `scanHookFireSummary` below) set
 * of events the caller collected — this function does the `message`/
 * `hookId` filtering itself, so a caller never has to duplicate that
 * predicate. Returns `null` when no matching fire is present in `events` —
 * never a fabricated all-zero summary, so the detail route's
 * `data-hook-last-fire-*` attributes stay genuinely ABSENT rather than lying
 * with a placeholder value. `fireCount` counts fires WITHIN `events` — when
 * the caller is `scanHookFireSummary`, that means within the scanned
 * (recent) window, not necessarily all-time; the route names that honestly
 * on the wire (`recentFireCount`), not here, since this function has no
 * opinion about how its input was gathered.
 */
export function deriveHookFireSummary(events: readonly EventLogEntry[], hookId: string): HookFireSummary | null {
  const fires = events.filter((e) => e.message === 'hook.fire' && (e.metadata as Record<string, unknown> | undefined)?.['hookId'] === hookId);
  if (fires.length === 0) return null;

  const latest = fires.reduce((a, b) => (b.started_at > a.started_at ? b : a));
  const rawOutcome = (latest.metadata as Record<string, unknown> | undefined)?.['outcome'];

  return {
    lastFireAt: latest.started_at,
    // An unrecognised outcome string is treated as 'error' — never silently
    // dropped, and never trusted as 'ran' when it is not a known-good value.
    lastFireOutcome: isHookFireOutcome(rawOutcome) ? rawOutcome : 'error',
    fireCount: fires.length,
  };
}

// ---------------------------------------------------------------------------
// Bounded scan — T2 review of 95cb287f (forge-8vfn.5.16). GET
// /api/studio/hooks/:id used to open EVERY cycle's events.jsonl, the same
// unbounded request-path scan class #834 (forge-hqkm/omk0) fixed for the KB
// ingest-activity route and the standalone agent-history routes. Hook fires
// can originate from ANY agent spawn (flow cycles, one-shot `_agent-*` runs,
// interactive session kinds, bridge writes) — unlike ingest-activity's
// `reflect.kb-ingest`, which only ever comes from a flow cycle's reflector
// phase (an ISO-prefixed, lexically-sortable id) — so cycle recency here
// cannot be read off the id string and must come from directory mtime,
// mirroring `packages/agents/bridge-agents-history-rows.ts`'s
// `sortEntriesByMtimeDesc` (M7-C #834).
// ---------------------------------------------------------------------------

/** M7-C U2 review — page size. Neither this route nor its client passes a
 *  `limit`, so this is a named constant: never open more cycle dirs than
 *  this to answer one request. */
export const HOOK_FIRE_SCAN_MAX_CYCLES = 50;

/** Sorts `cycleIds` newest-first by the injected `mtimeOf`, then keeps the
 *  newest `max`. Pure + injectable (mirrors `sortEntriesByMtimeDesc`) so a
 *  test can prove the bound with a counting fake rather than a real forge
 *  root full of timestamped directories. */
export function selectRecentCycles(
  cycleIds: readonly string[],
  mtimeOf: (cycleId: string) => number,
  max: number,
): string[] {
  return cycleIds.slice().sort((a, b) => mtimeOf(b) - mtimeOf(a)).slice(0, max);
}

/** The IO a real route wires with guarded filesystem primitives, and a test
 *  wires with counting/scripted fakes — the seam `scanHookFireSummary`
 *  needs to be provably bounded without a real forge root. */
export type HookFireScanDeps = {
  /** A cheap directory-name enumeration (e.g. `listCycles`) — never itself
   *  reads a cycle's contents. */
  listCycleIds: () => readonly string[];
  /** Directory mtime, guarded (e.g. `resolveGuardedPath` + `statSync`). */
  mtimeOf: (cycleId: string) => number;
  /** A BOUNDED read of one cycle's `events.jsonl` — the whole file when it
   *  is small, a guarded tail when it is not (e.g. `guardedReadFileTail`);
   *  `null` when absent/rejected. Never a raw unbounded `readFileSync`. */
  readTail: (cycleId: string) => string | null;
};

/**
 * The bounded engine: select the newest `maxCycles` cycles (never fewer IO
 * calls to determine recency than there are candidates — mtime is metadata,
 * not a full read — but never MORE than `maxCycles` calls to `readTail`,
 * which is the expensive one), parse whichever lines are real JSON, and fold
 * through `deriveHookFireSummary`. A fire recorded only in a cycle OLDER
 * than the window is invisible by design — the honest cost of bounding.
 */
export function scanHookFireSummary(
  hookId: string,
  deps: HookFireScanDeps,
  maxCycles: number = HOOK_FIRE_SCAN_MAX_CYCLES,
): HookFireSummary | null {
  const recent = selectRecentCycles(deps.listCycleIds(), deps.mtimeOf, maxCycles);
  const events: EventLogEntry[] = [];
  for (const cycleId of recent) {
    const raw = deps.readTail(cycleId);
    if (raw === null) continue;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as EventLogEntry);
      } catch {
        continue; // a truncated leading line from a tail read is expected, not an error
      }
    }
  }
  return deriveHookFireSummary(events, hookId);
}
