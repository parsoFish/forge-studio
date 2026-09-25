/**
 * Pure view-state derivation for the /hooks library page + /hooks/[id]
 * detail page (R3-03-F4).
 *
 * Mirrors skill-library-view.ts's testability convention: no DOM, no React,
 * no network. Immutability: every function returns NEW arrays/objects,
 * never mutates its input. Types come from ./hook-client.ts — this module
 * assumes a parsed, already-trustworthy `HookLibraryEntry`/`HookDetail` and
 * never re-derives `carriedBy`/`scanVerdict`/`trust` from raw JSON itself.
 *
 * See apps/studio/tests/unit/hook-library-view.test.ts's header for the full proposed
 * DOM-as-metrics contract this module's outputs feed.
 */

import type { HookLibraryEntry, HookLibraryEntryOk, HookDetail, HookScanReport, HookScanFinding } from './hook-client';

// ---------------------------------------------------------------------------
// filterHooks — matches ok:true entries on name+description; ok:false
// entries match on id (their only real text field). Empty query returns a
// NEW array of every entry.
// ---------------------------------------------------------------------------

export function filterHooks(entries: readonly HookLibraryEntry[], query: string): HookLibraryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => {
    if (!e.ok) return e.id.toLowerCase().includes(q);
    const name = e.name.toLowerCase();
    const description = e.description.toLowerCase();
    return name.includes(q) || description.includes(q);
  });
}

// ---------------------------------------------------------------------------
// carriedByCountOf — derived from carriedBy.length, present on both branches
// of the discriminated union.
// ---------------------------------------------------------------------------

export function carriedByCountOf(entry: HookLibraryEntry): number {
  return entry.carriedBy.length;
}

// ---------------------------------------------------------------------------
// needsReviewCountOf — root-level summary stat, derived from the array,
// never a declared/independently-tracked count.
// ---------------------------------------------------------------------------

export function needsReviewCountOf(entries: readonly HookLibraryEntry[]): number {
  return entries.filter((e) => e.ok && e.trust === 'needs-review').length;
}

// ---------------------------------------------------------------------------
// communityHooksToUnion — W7-B3 (library-11): /hooks unions the community
// index's hook items the way /skills unions community skills. Pure pick of
// the community hooks the LOCAL library does not already carry (an installed
// community hook already appears as a local row — never doubled). The facts
// come from the community index route (the one executed-per-item source);
// this only joins.
// ---------------------------------------------------------------------------

export function communityHooksToUnion<T extends { id: string; kind: string }>(
  items: readonly T[],
  localHookIds: ReadonlySet<string>,
): T[] {
  return items.filter((item) => item.kind === 'hook' && !localHookIds.has(item.id));
}

// ---------------------------------------------------------------------------
// hookBadges — derived from real fields only. A 'blocked' badge PERSISTS
// even after override — the verdict is never laundered, at the view layer
// either.
//
// W8-B4 (library-09, S2 PARTIAL): 'approved' has its OWN positive arm,
// mirroring InstallStateBadge's positive-state precedent
// (components/studio/LibraryHub.tsx) — every member of HookTrust
// ('needs-review' | 'approved' | 'overridden', hook-client.ts) now maps to a
// real, visible badge here. Before this arm, an approved hook rendered
// badge-less: the operator could only read approval as the ABSENCE of a red
// badge, indistinguishable from "nothing rendered for some other reason".
// Both call sites (components/studio/HookLibraryResults.tsx's HookCard,
// components/studio/LibraryHub.tsx's ShelfHookCard) render whatever this
// returns generically — fixed once, here, for both.
// ---------------------------------------------------------------------------

export type HookBadge = 'needs-review' | 'approved' | 'blocked' | 'overridden' | 'unbound';

export function hookBadges(entry: HookLibraryEntryOk): HookBadge[] {
  const badges: HookBadge[] = [];
  if (entry.trust === 'needs-review') badges.push('needs-review');
  if (entry.trust === 'approved') badges.push('approved');
  if (entry.trust === 'overridden') badges.push('overridden');
  if (entry.scanVerdict === 'blocked') badges.push('blocked');
  // forge-6gv.8.1 (library-10): dispatch (M7-C U2/B6) makes an unbound hook
  // genuinely unable to fire — the index/card says so, not just the detail
  // page's "Unbound" copy.
  if (entry.carriedBy.length === 0) badges.push('unbound');
  return badges;
}

// ---------------------------------------------------------------------------
// buildHookScanPanel — the SECURITY SCAN panel view model. A declared:true
// finding is DOWNGRADED, never hidden — visible and counted like any other.
// ---------------------------------------------------------------------------

export type HookScanPanel = {
  verdict: HookScanReport['verdict'];
  findings: HookScanFinding[];
  findingCount: number;
  criticalCount: number;
  infoCount: number;
};

export function buildHookScanPanel(scan: HookScanReport): HookScanPanel {
  const findings = [...scan.findings];
  return {
    verdict: scan.verdict,
    findings,
    findingCount: findings.length,
    criticalCount: findings.filter((f) => f.severity === 'critical').length,
    infoCount: findings.filter((f) => f.severity === 'info').length,
  };
}

// ---------------------------------------------------------------------------
// buildHookDetailView — the whole /hooks/[id] page's view model in one call.
// ---------------------------------------------------------------------------

export type HookDetailView = {
  id: string;
  name: string;
  description: string;
  on: HookDetail['on'];
  matcher?: string;
  permissions: HookDetail['permissions'];
  carriedBy: string[];
  carriedByCount: number;
  carriedByDerivation: HookDetail['carriedByDerivation'];
  scanVerdict: HookDetail['scanVerdict'];
  trust: HookDetail['trust'];
  runnable: boolean;
  /** forge-8vfn.8.3.7 — server-attested, rendered by ProvenanceBadge. */
  origin: HookDetail['origin'];
  files: HookDetail['files'];
  scan: HookScanPanel;
  /** W7-B4 (library-09): the recorded approval — present iff a live ledger
   *  entry exists; the resolved-state panel renders it. */
  approval?: HookDetail['approval'];
  /** forge-8vfn.5.16 (M7-C U2) — always present; 0 = "scanned the recent
   *  window, found no fire" (T2 review of 95cb287f: the route's scan is
   *  bounded, so this is a count within that window, not all-time). */
  recentFireCount: number;
  /** Present iff the hook has fired within the scanned (recent) window;
   *  never fabricated. */
  lastFireAt?: HookDetail['lastFireAt'];
  lastFireOutcome?: HookDetail['lastFireOutcome'];
  /** forge-6gv.8.1 (library-33) — an operator's past test-fires, newest
   *  first. Always an array; never dropped or re-ordered by this layer. */
  testFireRuns: HookDetail['testFireRuns'];
};

export function buildHookDetailView(detail: HookDetail): HookDetailView {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    on: detail.on,
    ...(detail.matcher !== undefined ? { matcher: detail.matcher } : {}),
    permissions: detail.permissions,
    carriedBy: detail.carriedBy,
    carriedByCount: detail.carriedBy.length,
    carriedByDerivation: detail.carriedByDerivation,
    scanVerdict: detail.scanVerdict,
    trust: detail.trust,
    runnable: detail.runnable,
    origin: detail.origin,
    files: detail.files,
    scan: buildHookScanPanel(detail.scan),
    ...(detail.approval !== undefined ? { approval: detail.approval } : {}),
    recentFireCount: detail.recentFireCount,
    ...(detail.lastFireAt !== undefined ? { lastFireAt: detail.lastFireAt } : {}),
    ...(detail.lastFireOutcome !== undefined ? { lastFireOutcome: detail.lastFireOutcome } : {}),
    testFireRuns: detail.testFireRuns,
  };
}

// ---------------------------------------------------------------------------
// testFireDisabledReason (forge-6gv.8.1, library-33) — the test-fire button's
// disabled state. Approval is required (mirrors `canApprove`/`canOverride`'s
// own `trust === 'needs-review'` test); BINDING is deliberately NOT checked
// — an operator testing an unbound hook before binding it is the point.
// ---------------------------------------------------------------------------

export function testFireDisabledReason(view: HookDetailView): string | null {
  if (view.trust !== 'needs-review') return null;
  return view.scanVerdict === 'blocked'
    ? 'This hook is blocked — approve or override it before test-firing.'
    : 'Approve this hook before test-firing it.';
}
