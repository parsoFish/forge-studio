/**
 * kb-drain-view.ts (W6-B13) — pure, DOM-free derivation helpers for
 * `KbDrainPanel.tsx`, extracted the same way `run-panel-view.ts` /
 * `kb-consolidate.ts` extract RunPanel's/the maintenance panel's own async
 * or derivation logic: no jsdom is installed in this repo (see
 * `RunPanel.tsx`'s own header comment), so a `.tsx` file with hooks can only
 * be verified by `tsc` + `next build`; anything decision-shaped belongs in a
 * plain function here instead, where it's directly unit-testable.
 */

import type { KbDrainPerFinding, KbDrainState } from './studio-client';

/** Mirrors `cli/bridge-studio-kb-drain.ts`'s `KB_DRAIN_MAX_ROUNDS` — a
 *  display-only constant (not imported: that module touches `node:fs` and
 *  forge-ui never cross-imports from `cli/`, this repo's own boundary
 *  convention — see every other client-side type mirror in
 *  `./studio-client.ts`'s header comment). Keep in sync by hand; a drift
 *  only ever shows a wrong "round N/5" label, never a wrong drain decision
 *  (the server is the sole authority on when to stop). */
export const KB_DRAIN_MAX_ROUNDS_DISPLAY = 5;

/** The states this module adds on top of the server's own `KbDrainState`:
 *  `'timed-out'` — the poll gave up watching while the run was still
 *  genuinely running server-side (see `lib/agent-dispatch.ts`'s
 *  `pollKbDrain`); `'unreadable'` (W7-B2) — the bridge ANSWERED the status
 *  read with a 4xx ("unknown drain run"), so there is no run state to show
 *  at all: the one honest fact is the failed read itself, never the
 *  fabricated `'running'` a failed read arrives wrapped in (the wire vocab
 *  has no 'unknown' token — `failedKbDrainStatus`, studio-client.ts). */
export type KbDrainDisplayState = KbDrainState | 'timed-out' | 'unreadable' | 'attaching' | 'idle';

const SERVER_TERMINAL_STATES = new Set<KbDrainState>([
  'green', 'needs-you', 'no-progress', 'round-cap', 'cost-ceiling', 'cancelled', 'failed',
]);

/** True for any state that will never change without a fresh dispatch —
 *  every real server terminal, PLUS this UI's own `'timed-out'` and
 *  `'unreadable'` (nothing here will resolve either further without an
 *  explicit re-check or a fresh dispatch). `'running'`/`'attaching'`/
 *  `'idle'` are the only non-terminal states. */
export function isKbDrainTerminal(state: KbDrainDisplayState): boolean {
  return state === 'timed-out' || state === 'unreadable' || SERVER_TERMINAL_STATES.has(state as KbDrainState);
}

/** W7-B2 (the ledger's deferred "pollKbDrain 'unknown' vocab" item) — the
 *  ONE place a polled/fetched status becomes a display state. A failed read
 *  (`ok:false`) carries a fabricated `state:'running'`; the read's own HTTP
 *  status tells the two failure classes apart (the same A1-10 line
 *  `isStillWatching` draws): a bridge-ANSWERED 4xx is `'unreadable'` — a
 *  terminal fact, the poll has stopped — while a transport blip / 5xx passes
 *  through as `'running'` because the poll genuinely is still watching. */
export function deriveDrainDisplayState(
  status: { ok: boolean; state: KbDrainState | 'timed-out'; status?: number } | null,
  attaching: boolean,
): KbDrainDisplayState {
  if (!status) return attaching ? 'attaching' : 'idle';
  if (status.ok === false && status.status !== undefined && status.status < 500) return 'unreadable';
  return status.state;
}

export type DrainStateCopy = { label: string; detail: string };

/** Operator-facing label + explanation for every state the panel can show.
 *  Pure text derivation — the panel renders this verbatim, never re-deciding
 *  wording at the call site (keeps every terminal's copy in one place). */
export function drainStateCopy(state: KbDrainDisplayState, costUsd: number): DrainStateCopy {
  switch (state) {
    case 'idle':
      return { label: 'not yet run', detail: 'Click "Drain to green" to fix every auto- and agent-tier lint finding, round by round.' };
    case 'attaching':
      return { label: 'checking…', detail: 'Checking for an in-progress or previous drain run.' };
    case 'running':
      return { label: 'running', detail: 'Applying auto-fixes, then one agent turn per residual finding, round by round.' };
    case 'green':
      return { label: 'green ✓', detail: 'Every auto- and agent-tier finding cleared.' };
    case 'needs-you':
      return { label: 'needs you', detail: 'Auto/agent tiers are clean — the finding(s) below need an operator decision the drain loop never makes on its own.' };
    case 'no-progress':
      return { label: 'no progress', detail: 'The last round cleared nothing new (or is oscillating between the same findings) — more rounds would not help. Address what remains manually, or re-run once something has changed.' };
    case 'round-cap':
      return { label: 'round cap', detail: `Ran the full ${KB_DRAIN_MAX_ROUNDS_DISPLAY}-round budget with findings still remaining — re-run to continue with a fresh budget.` };
    case 'cost-ceiling':
      return { label: 'cost ceiling', detail: `Hit this run's cost ceiling ($${costUsd.toFixed(2)} spent) — re-run to continue with a fresh budget.` };
    case 'cancelled':
      return { label: 'cancelled', detail: 'Stopped on your request — the rounds that already ran are kept below; re-run whenever you like.' };
    case 'failed':
      return { label: 'failed', detail: 'The run crashed unexpectedly — see the activity log below for what happened.' };
    case 'timed-out':
      return { label: 'watch timed out', detail: 'The drain keeps running on the server — this browser just stopped watching. Re-check to pick it back up.' };
    case 'unreadable':
      return { label: 'status unreadable', detail: 'The bridge answered this run’s status read with an error — the run’s state can’t be shown (it may have been cleaned up, or never existed). Re-check, or re-run the drain.' };
    default:
      return { label: state, detail: '' };
  }
}

export type KbDrainTiers = {
  auto: KbDrainPerFinding[];
  agent: KbDrainPerFinding[];
  user: KbDrainPerFinding[];
};

/** Split a run's flat `perFinding` list by resolution tier — the panel
 *  renders auto+agent as "this round's progress" and user as the
 *  needs-you walkthrough. */
export function findingsByTier(perFinding: readonly KbDrainPerFinding[]): KbDrainTiers {
  return {
    auto: perFinding.filter((f) => f.tier === 'auto'),
    agent: perFinding.filter((f) => f.tier === 'agent'),
    user: perFinding.filter((f) => f.tier === 'user'),
  };
}

export type UserTierStep = {
  finding: KbDrainPerFinding | null;
  /** True once the operator has stepped past every user-tier finding —
   *  distinct from `finding === null && total === 0` (nothing to review at
   *  all): this is "reviewed all N, none resolved yet," the explicit
   *  completion state sweep finding C9#3 was missing (the old
   *  LintResolutionPanel clamped `idx` to the last item forever instead). */
  done: boolean;
  total: number;
};

/** Resolve which user-tier finding the walkthrough should show for the
 *  operator's current step index. Never clamps back to the last item —
 *  stepping past the end reaches an explicit `done: true` instead. */
export function resolveUserTierStep(userFindings: readonly KbDrainPerFinding[], idx: number): UserTierStep {
  const total = userFindings.length;
  if (total === 0) return { finding: null, done: false, total };
  if (idx >= total) return { finding: null, done: true, total };
  return { finding: userFindings[idx], done: false, total };
}

/** W7-B2 (knowledge-12): the distinct rounds present in an accumulated
 *  `perFinding` list, ascending — the panel groups rows under a per-round
 *  header. A pre-W7 status file without `round` tags yields `[0]`-style
 *  grouping via the `?? 0` default (rendered as one untagged group). */
export function findingRounds(perFinding: readonly KbDrainPerFinding[]): number[] {
  return [...new Set(perFinding.map((f) => f.round ?? 0))].sort((a, b) => a - b);
}

/** W7-B2 (knowledge-14): elapsed-time label for a run — `null` when the
 *  status predates `startedAt` (never a fabricated 0s). */
export function formatDrainElapsed(startedAt: string | undefined, nowMs: number): string | null {
  if (!startedAt) return null;
  const startMs = new Date(startedAt).getTime();
  if (!Number.isFinite(startMs) || nowMs < startMs) return null;
  const totalSec = Math.floor((nowMs - startMs) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
