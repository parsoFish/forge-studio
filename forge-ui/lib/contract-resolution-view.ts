/**
 * Pure view logic for `ContractResolutionPanel.tsx` (Stage D guided
 * contract resolution) — extracted so it is unit-testable without a browser
 * (no jsdom in this repo; mirrors the established `run-panel-view.ts`
 * convention: pure logic extracted from a component, unit-tested, then
 * thinly wired into JSX).
 */
import type { ClauseRoute } from './studio-client';

/**
 * The agent-tier "resolve" button's label — MUST say what actually happens
 * for this clause's route. None of the three real agent routes runs an
 * agent turn from this click: each just navigates the operator to the
 * matching builder (or the Knowledge tab) to drive it themselves, so the
 * label must never claim "with agent" (that phrase is reserved for the
 * USER-tier "Apply with agent" button, which genuinely does dispatch + poll
 * an agent — see ContractResolutionPanel.tsx's `submitUser`).
 */
const AGENT_ROUTE_LABEL: Partial<Record<ClauseRoute, string>> = {
  instructions: 'Open in instructions builder…',
  'demo-builder': 'Open in demo builder…',
  'brain-fix': 'Open in Knowledge…',
};

/** Honest label for the agent-tier "resolve" button. Falls back to a
 *  still-honest generic label if `route` is absent (should never happen for
 *  a real agent-tier clause — ContractResolutionPanel's own `agent` filter
 *  only ever includes clauses the server classified with a route). */
export function agentResolveLabel(route: ClauseRoute | undefined): string {
  return (route && AGENT_ROUTE_LABEL[route]) || 'Open in builder…';
}

/**
 * The brain-fix route's destination: the health tab of a SPECIFIC, REAL KB
 * — `kbId` must be the project's actual bound KB id (`KbBind`'s `kb` state,
 * threaded into `ContractResolutionPanel` as `boundKbId`), never derived
 * from the project id. A project's KB binding is operator-rebindable (the
 * `KbBind` select) and can be rebound to any KB or unbound entirely
 * (`cli/bridge-studio-writes.ts` deliberately leaves it `null` when no KB
 * seed landed) — id-equals-projectId is only ever true for the DEFAULT
 * binding a fresh project scaffold happens to create, never a guarantee.
 * Guessing wrong here is not merely a broken link: `/knowledge`'s own
 * `?id=` resolution (`app/knowledge/page.tsx`) silently falls back to
 * `allKbs[0]` when the given id doesn't match a real KB, so a stale/wrong
 * id renders a DIFFERENT KB with no indication anything went wrong. See
 * `isAgentRouteBlocked` for the honest alternative when there is no real
 * bound KB to link to at all.
 */
export function brainFixHref(kbId: string): string {
  return `/knowledge?id=${encodeURIComponent(kbId)}&tab=health`;
}

/** Shown next to the brain-fix resolve button when it's disabled for lack
 *  of a bound KB — the honest alternative to guessing a destination. */
export const BRAIN_FIX_UNBOUND_HINT = 'No KB bound — bind one in the Knowledge panel above.';

/**
 * Whether an agent-tier clause's resolve button must be disabled rather
 * than clicked. Only the brain-fix route can be blocked, and only when the
 * project has no real bound KB (`boundKbId === null`) — every other route
 * (instructions/demo-builder) has nowhere it can silently go wrong, since
 * those builders don't depend on a KB binding at all.
 */
export function isAgentRouteBlocked(route: ClauseRoute | undefined, boundKbId: string | null): boolean {
  return route === 'brain-fix' && !boundKbId;
}
