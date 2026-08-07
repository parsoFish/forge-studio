/**
 * Client-side status-aware `found` resolver for the flow run-detail page
 * (R6-01 WI-2 / F4, route `/flows/[id]/run/[runId]`) —
 * `resolveFlowRunDetailFromResponse(status, body)`.
 *
 * THE DEFECT THIS CLOSES: `studio-client.ts`'s existing `fetchRun` — and
 * `studioGet` itself — collapse FOUR distinct unhappy paths (no bridge
 * configured, ANY `!res.ok`, a 404, a thrown network/parse error) into one
 * `null`. That convention is correct for `fetchRun`'s existing callers and
 * this file does not touch `fetchRun` or `studio-client.ts` — those callers
 * must not change behaviour. It is wrong as the source of `found` for the
 * run-detail PAGE: collapsing a transient bridge outage into "not found"
 * would render an ERROR state as an authoritative NEGATIVE FACT ("this run
 * never existed").
 *
 * The resolver is DELIBERATELY THREE-STATE:
 *   status === 404             -> { kind: 'not-found' }
 *   status in [200, 300)       -> { kind: 'found', run } (a 2xx body missing
 *                                  a parseable `run` key is an ANOMALY, not a
 *                                  degrade-to-found — the server's own
 *                                  contract is "200 always carries { run }")
 *   anything else              -> { kind: 'unresolved' } — neither a positive
 *                                  nor a negative fact; a caller must render
 *                                  this as NEITHER the timeline NOR the
 *                                  not-found body.
 *
 * See `./flow-run-detail-client.test.ts` for the full pinned contract.
 *
 * `fetchFlowRunDetail(id)` is the real fetch wrapper: no bridge configured,
 * OR a thrown `fetch()`, OR a thrown/failed `res.json()` all resolve via the
 * pure resolver above called with the sentinel `status: 0` (never a real
 * 2xx/404) and `body: null` — this wrapper is not pinned by a test (no
 * jsdom/mocked-fetch harness in this repo for this seam — the same
 * documented gap `./run-view-client.ts`'s own `fetchRunDetail` carries).
 *
 * `fetchReviewFindings(runId)` reuses the SAME artifact-fetch shape
 * `app/artifact/page.tsx`'s own (unexported) `fetchJsonArtifact` already
 * established — `GET /api/artifact/:runId/:filename`, `resolveBridgeUrl` +
 * `fetch` + degrade-to-null on any failure — rather than inventing a second
 * one, per this task's brief.
 */

import { resolveBridgeUrl } from './bridge-client';
import { parseRun, type Run } from './studio-client';
import type { ReviewFindingsDoc } from '@/components/ReviewFindingsPanel';

export type FlowRunDetailResolution =
  | { kind: 'found'; run: Run }
  | { kind: 'not-found' }
  | { kind: 'unresolved' };

/**
 * Pure: status decides FIRST, before body is ever inspected, in both
 * directions — a 404 wins even over a plausible-looking body, and a 2xx
 * with a malformed/absent body never silently degrades to not-found.
 */
export function resolveFlowRunDetailFromResponse(status: number, body: unknown): FlowRunDetailResolution {
  if (status === 404) return { kind: 'not-found' };

  if (status >= 200 && status < 300) {
    const parsed = body && typeof body === 'object' ? (body as { run?: unknown }) : undefined;
    const rawRun = parsed?.run;
    if (!rawRun || typeof rawRun !== 'object') return { kind: 'unresolved' };
    return { kind: 'found', run: parseRun(rawRun) };
  }

  return { kind: 'unresolved' };
}

/** Fetch + resolve one runId's flow run-detail. See header for the sentinel-0 convention. */
export async function fetchFlowRunDetail(id: string): Promise<FlowRunDetailResolution> {
  const base = await resolveBridgeUrl();
  if (!base) return resolveFlowRunDetailFromResponse(0, null);
  try {
    const res = await fetch(`${base}/api/runs/${encodeURIComponent(id)}`);
    const body = await res.json();
    return resolveFlowRunDetailFromResponse(res.status, body);
  } catch {
    return resolveFlowRunDetailFromResponse(0, null);
  }
}

/**
 * Fetch `review-findings.json` for a run, via the SAME established
 * `/api/artifact/:runId/:filename` path `app/artifact/page.tsx` already
 * uses — null on any failure (no bridge, non-2xx, thrown fetch/parse),
 * matching that helper's own degrade-to-null convention exactly.
 */
export async function fetchReviewFindings(runId: string): Promise<ReviewFindingsDoc | null> {
  try {
    const base = await resolveBridgeUrl();
    if (!base) return null;
    const res = await fetch(`${base}/api/artifact/${encodeURIComponent(runId)}/review-findings.json`);
    if (!res.ok) return null;
    return (await res.json()) as ReviewFindingsDoc;
  } catch {
    return null;
  }
}
