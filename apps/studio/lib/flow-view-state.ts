/**
 * flow-view-state — the flow-switch staleness guard for /flows/[id]/page.tsx.
 *
 * The monitor page loads `flow` + `runs` + `activeRun` + `ready` via one
 * async `loadData()` call keyed on the route `id` (its effect re-runs and
 * re-subscribes on `[id]` change, so the SUBSCRIPTION is correctly scoped —
 * this module fixes the STATE side of the same race). Between the route
 * `id` changing and that call resolving, the plain `useState` values still
 * hold the PREVIOUS flow's run model: its hexes, node statuses, and run
 * list. Node ids are frequently shared across flows (a threaded spine run's
 * `dev`/`review`/`unifier` nodes recur in forge-develop and its sibling
 * flows), so rendering the old `activeRun` against the new `flow`'s
 * topology doesn't just look stale — it can paint statuses for nodes that
 * belong to a different graph entirely.
 *
 * `resolveFlowViewState` is the pure derivation the page calls on every
 * render (not inside an effect) so the mismatched window resets to a clean
 * loading state atomically, in the same render pass that picks up the new
 * `id` — no flash of the previous flow's data is ever committed to the DOM.
 * Pure + synchronous: no DOM, no React, no network. Same testability
 * convention as `lib/monitor-layout.ts` / `lib/dep-layout.ts`.
 */

import type { Flow, Run } from './studio-client';

export interface FlowViewState {
  flow: Flow | null;
  runs: Run[];
  activeRun: Run | null;
  ready: boolean;
}

const LOADING_VIEW_STATE: FlowViewState = { flow: null, runs: [], activeRun: null, ready: false };

/**
 * Given the route's current flow `id` and the page's held state, returns the
 * state that is safe to render: the input unchanged when it already belongs
 * to `id` (or nothing has loaded yet), otherwise a fresh loading state so a
 * flow switch never renders a previous flow's run model under the new one.
 */
export function resolveFlowViewState(id: string, state: FlowViewState): FlowViewState {
  if (state.flow !== null && state.flow.id !== id) {
    return LOADING_VIEW_STATE;
  }
  return state;
}
