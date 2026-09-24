/**
 * forge-8vfn.5.16 (M7-C U2) — folds a run's `hook.fire` events (`packages/
 * agents/studio/hook-dispatch.ts`'s `emitHookFire`) into "did this hook
 * fire, when last, what outcome, how many times". No DOM/network/fs — the
 * route does the guarded scan; this stays unit-testable without one.
 */
import { selectRecentEntries, type EventLogEntry } from '@forge/kernel';

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

/** `events` may be BOUNDED. `null` on no match, never a fabricated summary;
 *  naming `fireCount` honestly (`recentFireCount` vs all-time) is the caller's job. */
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

// Bounded scan (T2 review of 95cb287f). Mechanics: @forge/kernel/guarded-
// scan.ts; rationale: request-path-sinks.md's "M7-C U2" section.

/** Page size — never open more cycle dirs than this per request. */
export const HOOK_FIRE_SCAN_MAX_CYCLES = 50;

/** IO a route wires with guarded kernel primitives, a test with fakes. */
export type HookFireScanDeps = {
  listCycleIds: () => readonly string[];
  /** Guarded directory mtime; `null` when unknown (sorts last). */
  mtimeOf: (cycleId: string) => number | null;
  /** A BOUNDED read of one cycle's `events.jsonl`; `null` when absent. */
  readTail: (cycleId: string) => string | null;
};

/** Newest `maxCycles` first, reads at most that many, folds the result. A
 *  fire only in an older-than-window cycle is invisible by design. */
export function scanHookFireSummary(
  hookId: string,
  deps: HookFireScanDeps,
  maxCycles: number = HOOK_FIRE_SCAN_MAX_CYCLES,
): HookFireSummary | null {
  const recent = selectRecentEntries(deps.listCycleIds(), deps.mtimeOf, maxCycles);
  const events: EventLogEntry[] = [];
  for (const cycleId of recent) {
    const raw = deps.readTail(cycleId);
    if (raw === null) continue;
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      // A truncated leading line from a tail read is expected, not an error.
      try { events.push(JSON.parse(line) as EventLogEntry); } catch { continue; }
    }
  }
  return deriveHookFireSummary(events, hookId);
}
