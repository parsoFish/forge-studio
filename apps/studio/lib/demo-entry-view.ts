/**
 * Pure view logic for the demo-builder entrypoints (W6-B10 — the R1-03-F2
 * reversal: the inline `DemoBuilderPanel` is retired, `/sessions/demo/<sid>`
 * (the generic session shell, W6-B6) is the ONE session screen). Extracted so
 * the routing decision is unit-testable without a browser (no jsdom in this
 * repo; mirrors `contract-resolution-view.ts`'s own convention).
 */
import type { DemoSessionSummary } from './bridge-client';

/**
 * An in-flight demo session for a project — not yet locked or abandoned.
 * Shared by the project page's own resume-on-mount lookup and the roadmap
 * canvas's "demo builder →" entrypoint (`InitiativeDetail`'s
 * `[data-link="demo-builder"]`), so both answer "does this project have a
 * demo session in progress right now" from the ONE predicate, never two
 * hand-kept copies.
 */
export function findInFlightDemoSession(
  sessions: readonly DemoSessionSummary[],
  projectId: string,
): DemoSessionSummary | null {
  return sessions.find((s) => s.project === projectId && s.phase !== 'locked' && s.phase !== 'abandoned') ?? null;
}

/**
 * The honest destination for the roadmap canvas's "demo builder →" link.
 * Demo sessions are PROJECT-scoped, not initiative-scoped
 * (`DemoSessionSummary` carries no `initiative` field) — there is no "this
 * initiative's demo session" to look up, so the rule is: resume the
 * project's in-flight session if one exists, else send the operator to the
 * kickoff screen prefilled with the project (the initiative id rides along
 * as a query-string hint only, for the kickoff screen's own context — never
 * used to look anything up).
 */
export function resolveDemoEntryHref(
  sessions: readonly DemoSessionSummary[],
  projectId: string,
  initiativeId: string,
): string {
  const inFlight = findInFlightDemoSession(sessions, projectId);
  if (inFlight) {
    return `/sessions/demo/${encodeURIComponent(inFlight.sessionId)}?project=${encodeURIComponent(projectId)}`;
  }
  return `/sessions/demo/new?project=${encodeURIComponent(projectId)}&initiative=${encodeURIComponent(initiativeId)}`;
}
