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
 * See forge-ui/lib/hook-library-view.test.ts's header for the full proposed
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
// hookBadges — derived from real fields only. A 'blocked' badge PERSISTS
// even after override — the verdict is never laundered, at the view layer
// either.
// ---------------------------------------------------------------------------

export type HookBadge = 'needs-review' | 'blocked' | 'overridden';

export function hookBadges(entry: HookLibraryEntryOk): HookBadge[] {
  const badges: HookBadge[] = [];
  if (entry.trust === 'needs-review') badges.push('needs-review');
  if (entry.trust === 'overridden') badges.push('overridden');
  if (entry.scanVerdict === 'blocked') badges.push('blocked');
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
  files: HookDetail['files'];
  scan: HookScanPanel;
  /** W7-B4 (library-09): the recorded approval — present iff a live ledger
   *  entry exists; the resolved-state panel renders it. */
  approval?: HookDetail['approval'];
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
    files: detail.files,
    scan: buildHookScanPanel(detail.scan),
    ...(detail.approval !== undefined ? { approval: detail.approval } : {}),
  };
}
