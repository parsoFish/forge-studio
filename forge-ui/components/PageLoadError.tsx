'use client';

/**
 * PageLoadError — the ONE page-level "this route's own read failed" state
 * (W7-FIX-A1, review-sweep A1-01 / A1-02 + the demo-showcase gate regression).
 *
 * A detail route (`/agents/<id>`, `/projects/<id>`, `/flows/<id>`,
 * `/projects/<id>/showcase`) whose roster/definition read THREW knows
 * neither that the object exists nor that it does not. It must therefore
 * render neither the object (a blank builder for a real agent — A1-01) nor
 * the shared `NotFound` ("No project <id>" — A1-02) nor a plausible empty
 * state. It has SETTLED — into an honest failure — so it keeps its OWN
 * `data-page` value (automation still knows which route it is on) with
 * `data-page-ready="true"` and `data-fetch-status="error"`, and renders the
 * shared `FetchErrorState` body with a Retry (re-runs the page's load) and a
 * way back.
 *
 * DOM contract (docs/forge-ui-dom-and-harness.md → "Shared — page load error"):
 *
 *   <main data-page=<route's own page> data-page-ready="true"
 *         data-fetch-status="error" data-load-error="true" {...rootAttrs}>
 *     <StudioNav/>                                     nav intact — never a bare page
 *     [data-component="page-load-error"]
 *       [role="alert"][data-component="fetch-error"]   the shared failure body
 *         [data-fetch-reachable][data-fetch-http-status?] + [data-action="retry-fetch"]
 *       a[data-action="load-error-back"][href=backHref] always a way back
 *
 * Pages ALSO subscribe to bridge recovery (`useBridgeRecovery(reload)`) so a
 * blip self-heals without the operator pressing Retry (crosscut-22).
 */
import Link from 'next/link';

import { StudioNav } from '@/components/StudioNav';
import { FetchErrorState } from '@/components/FetchErrorState';

export type PageLoadErrorProps = {
  /** The route's OWN `data-page` value (`agents`, `projects`, `flow-monitor`, `project-showcase`, …). */
  page: string;
  /** Extra root attributes the route always carries (`data-project-id`, `data-flow-id`, …). */
  rootAttrs?: Record<string, string>;
  /** What was being read — `agent "developer-ralph"`, `project "gitpulse"`. */
  what: string;
  /** Verbatim message (from `fetchErrorPropsFrom(err)`). */
  error: string;
  /** HTTP status iff the bridge answered. */
  status?: number;
  onRetry: () => void;
  backHref: string;
  backLabel: string;
};

export function PageLoadError({ page, rootAttrs, what, error, status, onRetry, backHref, backLabel }: PageLoadErrorProps) {
  return (
    <main
      data-page={page}
      data-page-ready="true"
      data-fetch-status="error"
      data-load-error="true"
      {...(rootAttrs ?? {})}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div
        data-component="page-load-error"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '48px 24px' }}
      >
        <div style={{ width: '100%', maxWidth: 720 }}>
          <FetchErrorState what={what} error={error} status={status} onRetry={onRetry} />
        </div>
        <Link
          href={backHref}
          data-action="load-error-back"
          style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
        >
          &larr; {backLabel}
        </Link>
      </div>
    </main>
  );
}
