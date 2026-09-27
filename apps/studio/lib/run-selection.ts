/**
 * run-selection — which run `/flows/[id]`'s monitor shows, and the sticky
 * pick that survives a reload (`app/flows/[id]/page.tsx`).
 *
 * forge-8vfn.8.1.44 (row 156, ruling 1852): `pickDefaultRun` never picks a
 * FAILED run, so it must stay a fallback under an explicit pick, never the
 * whole story. Extracted out of the page component so both the page and a
 * render test can exercise the SAME sticky read/write and default-pick logic
 * — a test that reimplements this inline would only prove a second selection
 * mechanism agrees with itself, not that the real one works.
 */
import type { Run } from './studio-client';

export function runSelectionStorageKey(flowId: string): string {
  return `forge-run-sel:${flowId}`;
}

/** Priority: gated → active → first complete → first planned. Never failed —
 *  callers that must reach a failed run route through an explicit pick
 *  (sticky selection or `preserveRunId`), not this fallback. */
export function pickDefaultRun(runs: Run[]): Run | null {
  const gated = runs.find((r) => r.status === 'gated');
  const active = runs.find((r) => r.status === 'active');
  const complete = runs.find((r) => r.status === 'complete');
  const planned = runs.find((r) => r.status === 'planned');
  return gated ?? active ?? complete ?? planned ?? runs[0] ?? null;
}

/** `sessionStorage` throws in a private window / blocked-site-data browser —
 *  a page that cannot remember a selection must still render. */
export function readStickyRunSelection(flowId: string): string | null {
  try {
    return sessionStorage.getItem(runSelectionStorageKey(flowId));
  } catch {
    return null;
  }
}

export function writeStickyRunSelection(flowId: string, runId: string): void {
  try {
    sessionStorage.setItem(runSelectionStorageKey(flowId), runId);
  } catch {
    /* sessionStorage unavailable (SSR/private mode) — non-fatal */
  }
}

/**
 * Selection precedence: an explicit preserve id (a run just enqueued) → the
 * sticky pick (survives reloads) → `pickDefaultRun`'s gated-first fallback.
 * Without the sticky layer, every page load yanks focus back to the top
 * "needs you" run.
 */
export function resolveInitialRun(
  runs: Run[],
  opts: { preserveRunId?: string; sticky: string | null },
): Run | null {
  return (
    (opts.preserveRunId ? runs.find((r) => r.id === opts.preserveRunId) : undefined) ??
    (opts.sticky ? runs.find((r) => r.id === opts.sticky) : undefined) ??
    pickDefaultRun(runs)
  );
}
