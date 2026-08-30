/**
 * Acceptance tests for forge-ui/lib/hook-library-view.ts (R3-03-F4) — DOES
 * NOT EXIST YET. Vitest cannot even collect this file until it lands
 * (module-not-found is the expected red — mirrors
 * skill-library-view.test.ts's own header note).
 *
 * Pure view-state derivation for the `/hooks` library page + `/hooks/[id]`
 * detail page — no DOM, no React, no network (mirrors skill-library-view.ts's
 * cycle-grouping.ts/flow-view-state.ts testability convention). This repo's
 * vitest config is `{ environment: 'node', include: ['lib/**\/*.test.ts'] }`
 * with NO jsdom — a standing decision the operator has already declined once
 * this initiative; nothing here needs it.
 *
 * Types (`HookLibraryEntry`, `HookLibraryEntryOk`, `HookDetail`,
 * `HookScanReport`, `HookTrust`, `HookScanVerdict`, ...) come from
 * `./hook-client.ts` — see that module's own test file
 * (forge-ui/lib/hook-client.test.ts) for the transport-parse contract; this
 * file assumes a parsed, already-trustworthy `HookLibraryEntry`/`HookDetail`
 * as input and never re-derives `carriedBy`/`scanVerdict`/`trust` from raw
 * JSON itself.
 *
 * ===========================================================================
 * PROPOSED DOM-AS-METRICS CONTRACT (R3-03-F4) — single source for the
 * implementer AND for the docs/forge-ui-dom-and-harness.md update (which the
 * operator owns, not this file). Mirrors the `/skills` contract's STYLE
 * exactly (see that doc's §skills, ~L247-294) — deviations from it are
 * called out explicitly below, not silently forced into the skills shape.
 *
 * `/hooks` — the hooks library page:
 *   main[data-page="hook-library"][data-page-ready][data-hook-count]
 *        [data-needs-review-count]
 *   DEVIATION FROM SKILLS: skills split into Local/Community sections
 *   (`data-local-count`/`data-community-count`) because a REAL second source
 *   (studio/catalog.yaml community-skills + an install pipeline) exists for
 *   skills. No analogous community-hook catalog or install pipeline exists in
 *   the merged core (hook-library.ts only reads studio/hooks/* on disk) — the
 *   roadmap's own R3-07 (cross-kind community browser, unbuilt, session-gated
 *   on "at least one owning pipeline landed") is where that surfaces later.
 *   Forcing a Local/Community split here would fabricate a distinction with
 *   no backing data, so `/hooks` in THIS round is a SINGLE flat, already-
 *   server-sorted list — no grouping function in hook-library-view.ts.
 *   `data-needs-review-count` replaces the local/community pair with a real,
 *   actionable summary stat this library DOES have data for (derived, per
 *   card below, never a declared field — see `needsReviewCountOf`).
 *   Per card: [data-card-type="hook"][data-hook-id][data-hook-event]
 *             [data-hook-verdict][data-hook-trust][data-hook-carried-by-count]
 *   (exactly as specified — `data-hook-event` carries the raw
 *   HookLifecycleEvent, e.g. "PreToolUse"; `data-hook-verdict` the raw F2
 *   scan verdict "blocked"|"findings"|"clean"; `data-hook-trust` the F2/F3
 *   approval-pipeline label "needs-review"|"approved"|"overridden" — TWO
 *   distinct axes, not one collapsed into the other: a hook can be
 *   trust="overridden" while verdict stays "blocked" forever, by design).
 *   [data-action="new-hook"] is the ONE place "New hook" lives (mirrors
 *   skills' D8 `data-action="new-skill"`), linking to `/hooks/new`.
 *
 * `/hooks/[id]` — the hook detail page:
 *   main[data-page="hook-detail"][data-hook-id][data-page-ready]
 *        [data-hook-event][data-hook-verdict][data-hook-trust][data-hook-runnable]
 *   (event/verdict/trust/runnable present ONLY once a real value is known —
 *   ABSENT while loading, on a bridge-fetch error, and for an unknown id —
 *   mirrors skills' "no fabricated trust value" rule exactly.)
 *   Package: [data-component="file-package"][data-file-count][data-active-file]
 *   with per-tab [data-file-tab][data-file-path] — REUSES
 *   forge-ui/components/studio/FilePackage.tsx verbatim (kind-agnostic, R3-01
 *   built it explicitly to be reused; a hook clone of it would be exactly the
 *   antipattern the task brief warns against).
 *   Carried-by: [data-section="carried-by"][data-carried-by-count] with
 *   per-agent [data-carried-by-agent] (an empty list renders an explicit
 *   "Unbound — bind it from an agent's builder" message, mirrors skills'
 *   used-by empty state verbatim — binding is Agent-Builder-only, round-4
 *   mockup rule).
 *   Security scan (the mockup's SECURITY SCAN panel — F2's verdict
 *   rendering, REQUIRED here, unlike skills' scan which is facts-only/no
 *   verdict — see hook-scan.ts's own header contrasting the two):
 *     [data-section="scan-report"][data-scan-verdict][data-finding-count]
 *          [data-critical-count]
 *     per finding: [data-finding-category][data-finding-severity]
 *          [data-finding-declared="true"|"false"]
 *   A `declared="true"` finding renders with visibly LOWER-emphasis styling
 *   (e.g. dimmed/info-colored, never hidden or filtered out of the DOM) —
 *   the load-bearing correction this initiative made earlier: declared
 *   downgrades severity, it never removes the finding from view.
 *   Approval actions (gated on trust, never both enabled at once):
 *     [data-action="approve-hook"] — enabled only when scanVerdict !== 'blocked'
 *          and trust === 'needs-review'
 *     [data-action="override-hook-block"] + [data-field="override-reason"]
 *          — enabled only when scanVerdict === 'blocked'
 *   A hook whose trust is "approved" or "overridden" shows neither action —
 *   already resolved.
 *
 * `/hooks/new` — the authoring surface (mirrors `/skills/new` exactly):
 *   main[data-page="hook-builder"][data-page-ready="true"][data-section="hook-new"]
 *   fields: [data-field="hook-name"|"hook-description"|"hook-on"|"hook-matcher"
 *            |"hook-script-body"|"hook-permissions-env"|"hook-permissions-read"
 *            |"hook-permissions-network"]
 *   [data-action="create-hook"]
 *   No install/marketplace affordance on this page or on `/hooks` (unlike
 *   skills' `data-action="install-skill"`) — R3-03-F4's "marketplace install"
 *   clause is descoped to R3-07 (the cross-kind community browser), which the
 *   roadmap itself says routes hook installs through F2's scan+approval gate
 *   unchanged once it exists; there is no community-hook data source to
 *   install FROM yet in the merged core. Flagging per the task brief's rule
 *   6: this is a place where forcing the skills parallel would not fit.
 *
 * Agent Builder drop zone — coexistence, not replacement:
 *   The existing zone carries [data-accepts="guard"] (platform dispatch-key
 *   vocabulary — forge-ui/components/studio/agent-builder/DropZone.tsx,
 *   CatalogPalette.tsx's `Kind = 'skill'|'tool'|'mcp'|'guard'`). This
 *   initiative adds a DISTINCT [data-accepts="hook"] zone alongside it — the
 *   two must never merge into one vocabulary (the entire reason `composition
 *   .hooks` was split from `composition.guards` earlier in this initiative,
 *   see hook-library.ts's `checkHookComposition`/`lintHookComposition`: a
 *   guard id under composition.hooks, or a hook id under composition.guards,
 *   is a lint ERROR — symmetric, both directions). PRODUCTION GAPS the
 *   implementer must close for this to be real (not this file's job to
 *   pin — no jsdom, cannot render DropZone.tsx here — noted for the
 *   implementer + the operator's doc update):
 *     - `CatalogPalette.tsx`'s `Kind` union has no `'hook'` member yet.
 *     - `studio-client.ts`'s `Catalog` type has no `hooks?: CatalogItem[]`
 *       field yet — the palette has nothing to read a hooks group from.
 *     - `DropZone.tsx`'s `kindOf(id)` prefix-sniffs `sk-/skill-`,
 *       `tl-/tool-`, `mcp-`, `gd-/guard-` — needs an `hk-/hook-` case added.
 * ===========================================================================
 */
import { test, expect } from 'vitest';
import {
  filterHooks,
  carriedByCountOf,
  needsReviewCountOf,
  hookBadges,
  buildHookScanPanel,
  buildHookDetailView,
} from './hook-library-view.ts';
import type { HookLibraryEntry, HookLibraryEntryOk, HookDetail } from './hook-client.ts';

// ---------------------------------------------------------------------------
// Fixture helper
// ---------------------------------------------------------------------------

function okEntry(overrides: Partial<HookLibraryEntryOk> & { id: string }): HookLibraryEntryOk {
  return {
    ok: true,
    name: overrides.id,
    description: '',
    on: 'PreToolUse',
    permissions: { env: [], read: [], network: false },
    carriedBy: [],
    carriedByDerivation: { source: 'skills/*/SKILL.md (composition.hooks)', scanned: 0 },
    scanVerdict: 'clean',
    trust: 'needs-review',
    runnable: false,
    ...overrides,
  };
}

function malformedEntry(id: string): HookLibraryEntry {
  return {
    ok: false,
    id,
    carriedBy: [],
    carriedByDerivation: { source: 'skills/*/SKILL.md (composition.hooks)', scanned: 0 },
    error: `${id}: malformed`,
  };
}

// ---------------------------------------------------------------------------
// filterHooks — matches ok:true entries on name+description; ok:false
// entries match on id (the only text field they have); empty query returns
// everything, a NEW array, input untouched.
// ---------------------------------------------------------------------------

test('filterHooks: matches ok:true entries on name + description, case-insensitive', () => {
  const entries = [
    okEntry({ id: 'pre-pr-security-review', name: 'pre-pr-security-review', description: 'Run security-review before gh pr create.' }),
    okEntry({ id: 'post-merge-brain-ingest', name: 'post-merge-brain-ingest', description: 'Queue a reflector pass.' }),
  ];
  expect(filterHooks(entries, 'security').map((e) => e.id)).toEqual(['pre-pr-security-review']);
  expect(filterHooks(entries, 'SECURITY').map((e) => e.id)).toEqual(['pre-pr-security-review']);
  expect(filterHooks(entries, 'reflector').map((e) => e.id), 'matches on description too').toEqual(['post-merge-brain-ingest']);
});

test('filterHooks: an ok:false entry matches on its id (its only real text field)', () => {
  const entries = [malformedEntry('broken-hook-xyz'), okEntry({ id: 'unrelated-hook' })];
  expect(filterHooks(entries, 'broken-hook').map((e) => e.id)).toEqual(['broken-hook-xyz']);
});

test('filterHooks: empty query returns all entries as a NEW array; input untouched', () => {
  const entries = [okEntry({ id: 'a' }), malformedEntry('b')];
  const all = filterHooks(entries, '');
  expect(all).toEqual(entries);
  expect(all).not.toBe(entries);
  const snapshot = [...entries];
  filterHooks(entries, 'a');
  expect(entries).toEqual(snapshot);
});

// ---------------------------------------------------------------------------
// carriedByCountOf — derived from the array length, works for both branches
// of the discriminated union (carriedBy exists on ok:true AND ok:false).
// ---------------------------------------------------------------------------

test('carriedByCountOf: derives from carriedBy.length, never an independently-set field', () => {
  expect(carriedByCountOf(okEntry({ id: 'a', carriedBy: ['agent-1', 'agent-2'] }))).toBe(2);
  expect(carriedByCountOf(okEntry({ id: 'b', carriedBy: [] }))).toBe(0);
  expect(carriedByCountOf(malformedEntry('c'))).toBe(0);
});

// ---------------------------------------------------------------------------
// needsReviewCountOf — root-level summary stat, derived from the array,
// never a declared/independently-tracked count (mirrors GroupedSkillLibrary's
// counts-derived-from-arrays invariant).
// ---------------------------------------------------------------------------

test('needsReviewCountOf: counts ok:true entries with trust === "needs-review" only', () => {
  const entries: HookLibraryEntry[] = [
    okEntry({ id: 'a', trust: 'needs-review' }),
    okEntry({ id: 'b', trust: 'approved' }),
    okEntry({ id: 'c', trust: 'needs-review' }),
    okEntry({ id: 'd', trust: 'overridden' }),
    malformedEntry('e'), // malformed entries have no trust — never counted either way
  ];
  expect(needsReviewCountOf(entries)).toBe(2);
});

test('needsReviewCountOf: zero when nothing needs review (empty library or all resolved)', () => {
  expect(needsReviewCountOf([])).toBe(0);
  expect(needsReviewCountOf([okEntry({ id: 'a', trust: 'approved' })])).toBe(0);
});

// ---------------------------------------------------------------------------
// hookBadges — derived from real fields only (mirrors skillBadges). A
// 'blocked' badge PERSISTS even after override (proves override never
// launders the verdict, at the view layer too).
// ---------------------------------------------------------------------------

// W8-B4 (library-09, S2 PARTIAL): approval was invisible on the index — the
// card carried data-hook-trust="approved" in the DOM but hookBadges() had no
// 'approved' arm, so the operator read approval only as the ABSENCE of a red
// badge. Mirrors InstallStateBadge's positive-state precedent
// (components/studio/LibraryHub.tsx): a resolved-good state gets its own
// visible badge, not silence.
test('hookBadges: an approved, clean hook gets a positive "approved" badge (library-09) — approval is no longer only the absence of a red badge', () => {
  expect(hookBadges(okEntry({ id: 'a', trust: 'approved', scanVerdict: 'clean' }))).toEqual(['approved']);
});

test('hookBadges: a never-approved hook gets "needs-review"', () => {
  expect(hookBadges(okEntry({ id: 'a', trust: 'needs-review', scanVerdict: 'clean' }))).toEqual(['needs-review']);
});

test('hookBadges: a never-approved BLOCKED hook gets BOTH "needs-review" and "blocked"', () => {
  expect(hookBadges(okEntry({ id: 'a', trust: 'needs-review', scanVerdict: 'blocked' }))).toEqual(['needs-review', 'blocked']);
});

test('hookBadges: an overridden hook STILL carries "blocked" alongside "overridden" — the verdict is never laundered, even in the view', () => {
  expect(hookBadges(okEntry({ id: 'a', trust: 'overridden', scanVerdict: 'blocked' }))).toEqual(['overridden', 'blocked']);
});

// ---------------------------------------------------------------------------
// buildHookScanPanel — the SECURITY SCAN panel view model. A declared:true
// finding is DOWNGRADED, never hidden — this is the deliberate correction
// the task brief calls load-bearing; pinned exhaustively here.
// ---------------------------------------------------------------------------

test('buildHookScanPanel: a declared:true finding is visible and counted, not filtered out', () => {
  const panel = buildHookScanPanel({
    verdict: 'findings',
    findings: [
      { category: 'env-read', severity: 'info', message: 'declared read of GH_TOKEN', match: 'GH_TOKEN', declared: true },
      { category: 'network-egress', severity: 'critical', message: 'undeclared curl', match: 'curl', declared: false },
    ],
  });
  expect(panel.verdict).toBe('findings');
  expect(panel.findingCount).toBe(2);
  expect(panel.findings).toHaveLength(2);
  expect(panel.findings.some((f) => f.declared === true)).toBe(true);
  expect(panel.criticalCount).toBe(1);
  expect(panel.infoCount).toBe(1);
});

test('buildHookScanPanel: an empty findings list is a genuinely clean panel, not an "unknown" one', () => {
  const panel = buildHookScanPanel({ verdict: 'clean', findings: [] });
  expect(panel.verdict).toBe('clean');
  expect(panel.findingCount).toBe(0);
  expect(panel.criticalCount).toBe(0);
  expect(panel.infoCount).toBe(0);
  expect(panel.findings).toEqual([]);
});

test('buildHookScanPanel: verdict "blocked" survives into the view model even when every finding is declared (declared never suppresses a block)', () => {
  // Mirrors hook-scan.ts's own D-G rule: a file-read finding on a curated
  // dangerous path blocks by itself and is NEVER downgraded by declaration.
  const panel = buildHookScanPanel({
    verdict: 'blocked',
    findings: [
      { category: 'file-read', severity: 'critical', message: 'reads ~/.ssh', match: '~/.ssh', declared: true },
    ],
  });
  expect(panel.verdict).toBe('blocked');
  expect(panel.findings[0]!.declared).toBe(true);
  expect(panel.criticalCount).toBe(1);
});

// ---------------------------------------------------------------------------
// buildHookDetailView — the whole /hooks/[id] page's view model in one call.
// ---------------------------------------------------------------------------

function detailFixture(overrides: Partial<HookDetail> = {}): HookDetail {
  return {
    ...okEntry({ id: 'demo-hook', name: 'demo-hook', carriedBy: ['developer-ralph'] }),
    // W8-F2: `hash`/`packageHash` are required on the detail wire — see
    // hook-client.ts's HookPackageFile. Display-only provenance; the view
    // model passes them through and gates nothing on them.
    packageHash: 'sha256:' + 'a'.repeat(64),
    files: [
      { path: 'hook.yaml', body: 'id: demo-hook\n', hash: 'sha256:' + 'b'.repeat(64) },
      { path: 'scripts/run.sh', body: '#!/usr/bin/env bash\necho ok\n', hash: 'sha256:' + 'c'.repeat(64) },
    ],
    scan: { verdict: 'clean', findings: [] },
    ...overrides,
  };
}

test('buildHookDetailView: carries id/on/trust/runnable through, plus a derived carriedByCount and scan panel', () => {
  const view = buildHookDetailView(detailFixture({ trust: 'approved', runnable: true, on: 'SessionEnd' }));
  expect(view.id).toBe('demo-hook');
  expect(view.on).toBe('SessionEnd');
  expect(view.trust).toBe('approved');
  expect(view.runnable).toBe(true);
  expect(view.carriedByCount).toBe(1);
  expect(view.scan.verdict).toBe('clean');
});

test('buildHookDetailView: an unbound hook (carriedBy empty) still reports a real derivation, not an unknown state', () => {
  const view = buildHookDetailView(detailFixture({ carriedBy: [] }));
  expect(view.carriedBy).toEqual([]);
  expect(view.carriedByCount).toBe(0);
  expect(view.carriedByDerivation.scanned).toBeGreaterThanOrEqual(0);
});

// ---------------------------------------------------------------------------
// W7-B3 (library-11): /hooks unions the community index's hook items the way
// /skills unions community skills — this pure predicate picks the community
// hooks the LOCAL library does not already carry (an installed community
// hook is already a local row; showing it twice would double-count).
// ---------------------------------------------------------------------------

import { communityHooksToUnion } from './hook-library-view.ts';

const communityHookItem = (id: string, installState: string) =>
  ({ id, kind: 'hook', installState } as { id: string; kind: string; installState: string });

test('W7-B3 communityHooksToUnion: keeps hook items absent from the local library', () => {
  const items = [communityHookItem('block-protected-branch-push', 'not-installed'), { id: 'a-skill', kind: 'skill', installState: 'not-installed' }];
  const localIds = new Set(['some-local-hook']);
  expect(communityHooksToUnion(items as never, localIds).map((i) => i.id)).toEqual(['block-protected-branch-push']);
});

test('W7-B3 communityHooksToUnion: an id already in the local library is never doubled', () => {
  const items = [communityHookItem('block-protected-branch-push', 'installed')];
  expect(communityHooksToUnion(items as never, new Set(['block-protected-branch-push']))).toEqual([]);
});

test('W7-B3 communityHooksToUnion: non-hook kinds never leak in', () => {
  const items = [{ id: 'handoff', kind: 'skill', installState: 'not-installed' }];
  expect(communityHooksToUnion(items as never, new Set())).toEqual([]);
});
