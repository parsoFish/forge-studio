/**
 * Pure view-state derivation for `PhaseDrawer`'s phase-log panel (forge-7wc).
 *
 * THE DEFECT: `PhaseDrawer.tsx`'s identity-change fetch (Effect 1) wrapped
 * its async IIFE in try/finally with NO catch — a rejected `fetchPhaseLog`
 * became an unhandled promise rejection, and the pane fell back to
 * `logLines.length === 0 && !logLoading`, the SAME branch a genuinely empty
 * log renders. An operator watching an idle/terminal node whose log fetch
 * failed saw "no log lines for this phase" — a small lie: nothing was ever
 * fetched, but that reads identically to "this phase produced no output".
 *
 * THE FIX, split for testability (no jsdom in this repo — see this file's
 * sibling `use-phase-log.ts` for the effect wiring this drives): a rejected
 * fetch is now a THIRD, distinct state (`error`), checked before the empty
 * branch, so it can never be mistaken for one. Pure, no React, no network —
 * mirrors this repo's `session-shell-view.ts` / `monitor-view.ts`
 * convention.
 */

export type PhaseLogPanelState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'lines' };

/**
 * `loading` wins outright (a fetch in flight makes the previous error/empty
 * verdict stale). Then `error` — checked BEFORE `empty` so a rejected fetch
 * can never read as "genuinely nothing to show" (the defect this module
 * exists to close). Only once neither is true does line count decide
 * empty-vs-populated.
 */
export function derivePhaseLogPanelState(input: {
  loading: boolean;
  error: string | null;
  lineCount: number;
}): PhaseLogPanelState {
  if (input.loading) return { kind: 'loading' };
  if (input.error !== null) return { kind: 'error', message: input.error };
  if (input.lineCount === 0) return { kind: 'empty' };
  return { kind: 'lines' };
}

/**
 * Normalize whatever `fetchPhaseLog` rejected with into a message an
 * operator can read. Never throws, never returns an empty string (an empty
 * message would render as a blank error state — no better than the silent
 * pane this replaces).
 */
export function phaseLogErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim().length > 0) return err.message;
  if (typeof err === 'string' && err.trim().length > 0) return err;
  return 'Could not load this phase’s log.';
}
