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
 * `events` is a run's FULL raw event stream (unfiltered) — this function
 * does the `message`/`hookId` filtering itself, so a caller never has to
 * duplicate that predicate. Returns `null` when the hook has never fired —
 * never a fabricated all-zero summary, so the detail route's
 * `data-hook-last-fire-*` attributes stay genuinely ABSENT rather than lying
 * with a placeholder value.
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
