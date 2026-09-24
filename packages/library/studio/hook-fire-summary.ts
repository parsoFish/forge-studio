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
 * `events` is whatever set the caller collected (possibly BOUNDED — see
 * `scanHookFireSummary`) — filters on `message`/`hookId` itself. `null` when
 * no match — never a fabricated all-zero summary. `fireCount` counts fires
 * WITHIN `events`; naming that honestly on the wire (`recentFireCount` vs
 * all-time) is the caller's job, not this pure function's.
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

// Bounded scan — T2 review of 95cb287f (forge-8vfn.5.16), same class #834
// (forge-hqkm/omk0) fixed elsewhere. Full rationale: docs/reference/
// request-path-sinks.md's "M7-C U2" section.

/** Page size — never open more cycle dirs than this per request. */
export const HOOK_FIRE_SCAN_MAX_CYCLES = 50;

/** Newest-`max` by the injected `mtimeOf` (mirrors `sortEntriesByMtimeDesc`) —
 *  injectable so a test can prove the bound with a counting fake. */
export function selectRecentCycles(
  cycleIds: readonly string[],
  mtimeOf: (cycleId: string) => number,
  max: number,
): string[] {
  return cycleIds.slice().sort((a, b) => mtimeOf(b) - mtimeOf(a)).slice(0, max);
}

/** The IO a route wires with guarded fs primitives, and a test wires with
 *  counting fakes to prove `scanHookFireSummary` is bounded. */
export type HookFireScanDeps = {
  /** Cheap directory-name enumeration (e.g. `listCycles`); never reads. */
  listCycleIds: () => readonly string[];
  /** Directory mtime, guarded (e.g. `resolveGuardedPath` + `statSync`). */
  mtimeOf: (cycleId: string) => number;
  /** A BOUNDED read of one cycle's `events.jsonl` (e.g.
   *  `guardedReadFileTail`); `null` when absent/rejected. */
  readTail: (cycleId: string) => string | null;
};

/** Selects the newest `maxCycles`, reads at most that many via `readTail`,
 *  and folds through `deriveHookFireSummary`. A fire only in an
 *  older-than-window cycle is invisible by design. */
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
