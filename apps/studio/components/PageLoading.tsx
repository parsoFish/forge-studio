'use client';

/**
 * PageLoading — a detail route whose own reads have not settled yet
 * (forge-nk1y.9). The sibling of `PageLoadError`.
 *
 * Until its reads settle a route knows nothing about its object, so it renders
 * none of it: not an empty name field, not a readiness checklist computed from
 * `useState` defaults, not a "no runnable flow is installed" reason. Those read
 * as the object's truth — the capstone saw exactly that on `/projects/gitweave`
 * while the bridge held a full contract. It says it is loading and names the
 * reads still outstanding, so a stalled read is diagnosable from the page.
 *
 * DOM contract:
 *
 *   <main data-page=<route's own page> data-page-ready="false"
 *         data-fetch-status="loading" data-waiting-on=<the unsettled read names> {...rootAttrs}>
 *     <StudioNav/>
 *     [data-component="page-loading"][role="status"]
 */
import { StudioNav } from '@/components/StudioNav';
import { MAIN_CONTENT_ID } from '@/lib/main-landmark';
import { routeReady } from '@/lib/route-readiness';

export type PageLoadingProps = {
  /** The route's OWN `data-page` value. */
  page: string;
  /** Extra root attributes the route always carries (`data-project-id`, …). */
  rootAttrs?: Record<string, string>;
  /** What is loading — `project "gitweave"`. */
  what: string;
  /** The named reads not yet settled (empty before the load starts). */
  waitingOn: readonly string[];
};

export function PageLoading({ page, rootAttrs, what, waitingOn }: PageLoadingProps) {
  return (
    <main
      id={MAIN_CONTENT_ID}
      data-page={page}
      data-page-ready={routeReady('loading') ? 'true' : 'false'}
      data-fetch-status="loading"
      data-waiting-on={waitingOn.join(', ')}
      {...(rootAttrs ?? {})}
      style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}
    >
      <StudioNav />
      <div
        data-component="page-loading"
        role="status"
        style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 24px', color: 'var(--dim)', fontSize: 13 }}
      >
        Loading {what}…{waitingOn.length > 0 ? ` waiting on ${waitingOn.join(', ')}.` : ''}
      </div>
    </main>
  );
}
