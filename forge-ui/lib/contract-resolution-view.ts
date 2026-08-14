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
 * USER-tier "Apply decision" button, which genuinely does dispatch + poll
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
 * The brain-fix route's destination: the project's OWN Brain 3 KB, health
 * tab. Every per-project brain declares `id: <projectId>` in its own
 * `brain/projects/<name>/kb.yaml` (ADR 035, central forge-owned per-project
 * brains) — so the KB id is derived straight from the projectId already in
 * scope, never a separate lookup or an invented id.
 */
export function brainFixHref(projectId: string): string {
  return `/knowledge?id=${encodeURIComponent(projectId)}&tab=health`;
}
