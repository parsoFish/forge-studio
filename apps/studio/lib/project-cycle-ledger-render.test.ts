/**
 * AT-F2-2 (R4-12-F2) — the NON-EMPTY ledger row on the REAL client path
 * (rule 38, the campaign's #1 recurring defect: R6-06 shipped
 * non-functional because the ONE non-empty row never actually reached the
 * client — the ledger existed, the derivation existed, but nothing on the
 * page wired `fetchCycles()` output through the transform into
 * `<HistoryLedger>`). This file is the immutable gate that closes that
 * shape for the PROJECT page.
 *
 * WHAT THIS PINS (the derivation → render chain, end to end):
 *
 *     fetchCycles()  ──►  deriveProjectCycleLedgerRows(cycles)  ──►  <HistoryLedger rows={…}>
 *      (REAL, from            (REAL shared adapter — new,              (SHARED presentational
 *       bridge-client,         `@/lib/project-cycle-ledger`;           component, unchanged;
 *       network stubbed)       derives NOTHING itself in the          `@/components/studio/
 *                              component — the row transform            HistoryLedger`)
 *                              is a caller ON the fetch path)
 *
 * KILLS (each is the current, pre-impl state — every assertion below is a
 * legitimate RED against files that DO NOT EXIST YET):
 *   - "the project page fetches cycles but never mounts HistoryLedger"
 *     (grep confirms `app/projects/[id]/page.tsx` references no ledger today).
 *   - "the ledger is mounted but fed a constructed `rows` prop / an inline
 *     private re-derivation, so the SHARED adapter has zero callers on the
 *     fetch path" — this file passes RAW `cycles` (never `rows`) and asserts
 *     `deriveProjectCycleLedgerRows` is actually invoked (spy) on that path.
 *   - "the row renders but points nowhere real" — the `href` is pinned
 *     byte-exact to the flow-run detail route.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CONTRACT THIS FILE DEFINES for the implementer to build to (nothing here
 * exists yet — mirrors how `run-panel-render.test.ts` pins NEW props/hooks
 * as the contract, and how `agent-ledger.test.ts` pins ASSUMED exports):
 *
 *   NEW lib  `@/lib/project-cycle-ledger.ts`:
 *     import type { Cycle } from '@/lib/bridge-client';
 *     import type { LedgerRow } from '@/lib/history-ledger';
 *     export function deriveProjectCycleLedgerRows(cycles: Cycle[]): LedgerRow[];
 *       // one LedgerRow per Cycle, newest-first (reuse the shared
 *       // sortLedgerRowsNewestFirst), with:
 *       //   id     = cycle.cycleId
 *       //   href   = `/flows/forge-develop/run/${cycle.cycleId}`   (the SAME
 *       //            flow-run-detail route RunRail/flow-ledger already point at)
 *       //   status = cycle.status  (carried VERBATIM — D4: a row's status is
 *       //            the cycle's own status, never a fabricated 'attention')
 *       //   when   = cycle.startedAt ?? ''  (raw ISO — formatting is
 *       //            presentation-time, D7)
 *
 *   NEW component `@/components/studio/project-builder/ProjectCycleLedger.tsx`
 *   (the "exact subtree the page uses to mount HistoryLedger" — a thin
 *   presentational wrapper, so it IS unit-renderable here even though the
 *   full page's fetch lives in a useEffect that never runs under
 *   renderToStaticMarkup):
 *     export function ProjectCycleLedger(props: { cycles: Cycle[]; nowMs: number }): JSX.Element;
 *       // returns <HistoryLedger rows={deriveProjectCycleLedgerRows(props.cycles)} nowMs={props.nowMs} />
 *       // NOTE: its prop is `cycles`, NOT `rows` — it is structurally
 *       // impossible for a caller to bypass the transform by handing it
 *       // pre-built rows. The page mounts <ProjectCycleLedger cycles={…}
 *       // nowMs={Date.now()} /> with `cycles` = fetchCycles() output for
 *       // this project, populated in the page's existing cycles-load effect.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HARNESS BOUNDARY (disclosed, per the AT-F2-4 hand-off the task calls for):
 * this repo has NO jsdom / NO @testing-library/react — components are
 * asserted on `renderToStaticMarkup` output, under which `useEffect` NEVER
 * runs (see `run-panel-render.test.ts`'s header). The project page loads
 * cycles in a `useEffect` (`fetchCycles()` → state), so a full-page render
 * here would only ever show the page's INITIAL (empty) state — it CANNOT
 * demonstrate a populated ledger no matter how correctly the page is wired.
 * Therefore this file renders the exact subtree the page mounts
 * (`ProjectCycleLedger`) fed the REAL `fetchCycles()` output, which
 * exercises `fetchCycles → deriveProjectCycleLedgerRows → HistoryLedger`
 * faithfully. The remaining, un-unit-testable link — that the PAGE itself
 * mounts `ProjectCycleLedger` with the fetched cycles — MUST be carried by
 * AT-F2-4 (the ui:journey page-integration beat, which drives the real
 * page in a real browser where the effect runs). This file's own comment
 * IS that hand-off.
 *
 * `fetchCycles()` is exercised for REAL (not a `vi.mock`'d bridge-client):
 * `window` + `fetch` are stubbed so the genuine `resolveBridgeUrl` →
 * `/api/cycles` path runs. Both stubbing shapes were probed against the
 * real modules before this file landed.
 *
 * RUN: cd forge-ui && npx vitest run lib/project-cycle-ledger-render.test.ts
 */

import { test, expect, vi, afterEach } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { fetchCycles, type Cycle, type CycleListSnapshot } from '@/lib/bridge-client';
// NEW — neither exists yet. A missing MODULE (not just a missing named
// export) throws at collection, so this whole file goes RED until both land
// — exactly the "adapter missing / page doesn't mount HistoryLedger" state
// this gate is meant to catch.
import * as projectCycleLedger from '@/lib/project-cycle-ledger';
import { ProjectCycleLedger } from '@/components/studio/project-builder/ProjectCycleLedger';

// ---------------------------------------------------------------------------
// Fixture — the SAME completed gitpulse cycle the adapter test uses (a real,
// archived, merged cycle from the gitpulse verify-cycle ground). It is an
// ARCHIVED/recent cycle, so it arrives in `snapshot.recent`, not `.live`.
// ---------------------------------------------------------------------------

const CYCLE_ID = '2026-07-11T07-29-19_INIT-2026-07-11-exclude-path-filter';
const EXPECTED_HREF = `/flows/forge-develop/run/${CYCLE_ID}`;

const MERGED_GITPULSE_CYCLE: Cycle = {
  cycleId: CYCLE_ID,
  initiativeId: 'INIT-2026-07-11-exclude-path-filter',
  project: 'gitpulse',
  status: 'merged',
  startedAt: '2026-07-11T07:29:19Z',
  endedAt: '2026-07-11T08:15:00Z',
};

const NON_EMPTY_SNAPSHOT: CycleListSnapshot = {
  live: [],
  recent: [MERGED_GITPULSE_CYCLE],
};

// Fixed "now" — HistoryLedger only reads nowMs for the relative-time display
// (`formatWhen`), never for any attribute this file asserts; pinned so the
// render is deterministic regardless of wall clock.
const FIXED_NOW = Date.parse('2026-07-11T09:00:00Z');

// ---------------------------------------------------------------------------
// REAL fetchCycles harness — stub `window` + `fetch` so the genuine
// `resolveBridgeUrl()` (bridge-client) resolves a base URL and the real
// `fetchCycles()` hits our stubbed `/api/cycles`. This is deliberately NOT a
// `vi.mock('./bridge-client.ts', …)`: mocking the module would replace the
// very `fetchCycles` this gate is meant to exercise. `resolveBridgeUrl`
// memoises its resolved base at module scope, so the first successful call
// caches it for the rest of the file — every test still stubs `fetch` for
// its own `/api/cycles` reply.
// ---------------------------------------------------------------------------

function stubBridge(snapshot: CycleListSnapshot): ReturnType<typeof vi.fn> {
  vi.stubGlobal('window', { location: { protocol: 'http:', hostname: 'localhost' } });
  const fakeFetch = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes('/api/forge-config')) {
      return { ok: true, json: async () => ({ bridgePort: 4123 }) } as unknown as Response;
    }
    if (u.includes('/api/cycles')) {
      return { ok: true, json: async () => snapshot } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal('fetch', fakeFetch);
  return fakeFetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tiny string-based DOM helpers (test-local; the component is untouched —
// this file only reads its rendered markup). Mirrors the helpers in
// `run-panel-render.test.ts`.
// ---------------------------------------------------------------------------

/** The smallest `<tag …>` opening substring containing `marker`. Safe here:
 *  HistoryLedger's `<a>` attributes (data-*, href, title, inline style)
 *  carry no nested `<`/`>`. */
function tagContaining(html: string, marker: string): string {
  const idx = html.indexOf(marker);
  if (idx === -1) return '';
  const start = html.lastIndexOf('<', idx);
  const end = html.indexOf('>', idx);
  if (start === -1 || end === -1) return '';
  return html.slice(start, end + 1);
}

function attrValue(tag: string, attr: string): string | null {
  const m = tag.match(new RegExp(`${attr}="([^"]*)"`));
  return m ? m[1] : null;
}

// ===========================================================================
// AT-F2-2 — the non-empty row reaches the client on the REAL fetch path
// ===========================================================================

test('AT-F2-2: fetchCycles() → deriveProjectCycleLedgerRows → <HistoryLedger> renders exactly the archived merged cycle as one clickable ledger row (kills "the ledger exists but nothing renders it from the real cycles fetch")', async () => {
  stubBridge(NON_EMPTY_SNAPSHOT);

  // REAL client path: the genuine bridge-client fetchCycles, not a mock.
  const snap = await fetchCycles();
  const cycles = [...snap.live, ...snap.recent];
  expect(cycles.some((c) => c.cycleId === CYCLE_ID)).toBe(true);

  // Render the exact subtree the page mounts. Pass RAW `cycles` — NEVER a
  // constructed `rows` prop (ProjectCycleLedger has no such prop): the
  // transform must run ON this render path to produce any row at all.
  const html = renderToStaticMarkup(
    React.createElement(ProjectCycleLedger, { cycles, nowMs: FIXED_NOW }),
  );

  // The shared ledger section is present and reports a NON-EMPTY count.
  expect(html).toContain('data-section="history-ledger"');
  const countStr = attrValue(tagContaining(html, 'data-section="history-ledger"'), 'data-ledger-count');
  expect(countStr).not.toBeNull();
  expect(Number(countStr)).toBeGreaterThanOrEqual(1);

  // The honest-empty placeholder must NOT be what rendered.
  expect(html).not.toContain('data-component="history-ledger-empty"');

  // One real, clickable ledger row for the fixture cycle.
  const rowTag = tagContaining(html, 'data-ledger-row="true"');
  expect(rowTag).not.toBe('');
  // A REAL <a href> — not a <div onClick> (attribute-only checks can't tell
  // them apart; the tag name is the discriminator, per HistoryLedger's own
  // amendment-29 contract).
  expect(rowTag.startsWith('<a')).toBe(true);

  // data-run-id = the cycle id, verbatim.
  expect(attrValue(rowTag, 'data-run-id')).toBe(CYCLE_ID);

  // data-run-status present AND carrying a real, non-empty status (never
  // blank / "undefined" / the mockup's fabricated 'attention').
  const status = attrValue(rowTag, 'data-run-status');
  expect(status).not.toBeNull();
  expect((status ?? '').length).toBeGreaterThan(0);
  expect(status).not.toBe('undefined');

  // href points at the flow-run detail route, byte-exact.
  expect(attrValue(rowTag, 'href')).toBe(EXPECTED_HREF);
});

// ===========================================================================
// AT-F2-2 (rule-38 core): the SHARED adapter is an actual caller ON the
// fetch path — not bypassed by a constructed rows prop or an inline copy.
// ===========================================================================

test('AT-F2-2: rendering the page subtree over fetchCycles() output INVOKES the shared deriveProjectCycleLedgerRows on that path (kills "mounted HistoryLedger with a hand-built rows prop / a private inline re-derivation, so the adapter has no caller")', async () => {
  stubBridge(NON_EMPTY_SNAPSHOT);

  // Spy on the SHARED transform (spy retains the original implementation, so
  // real rows still render — verified separately below). Cross-module spy
  // interception of a component's named import was probed against the real
  // modules in this repo's vitest before this file landed.
  const spy = vi.spyOn(projectCycleLedger, 'deriveProjectCycleLedgerRows');

  const snap = await fetchCycles();
  const cycles = [...snap.live, ...snap.recent];

  const html = renderToStaticMarkup(
    React.createElement(ProjectCycleLedger, { cycles, nowMs: FIXED_NOW }),
  );

  // The transform ran on the fetch-derived cycles — i.e. the wrapper mounts
  // HistoryLedger via the shared adapter, it does not sidestep it.
  expect(spy).toHaveBeenCalled();
  const firstArg = spy.mock.calls[0]?.[0] as Cycle[] | undefined;
  expect(Array.isArray(firstArg)).toBe(true);
  expect((firstArg ?? []).some((c) => c.cycleId === CYCLE_ID)).toBe(true);

  // …and that invocation actually produced a rendered row (the adapter is a
  // caller that MATTERS, not a call whose output is discarded).
  expect(html).toContain('data-ledger-row="true"');
  expect(html).toContain(`href="${EXPECTED_HREF}"`);
});

// ===========================================================================
// Adapter-over-fetch consistency: the row the component renders is exactly
// what the shared transform yields for the fetched cycles — ties the
// rendered surface to the exported derivation, independent of the spy.
// ===========================================================================

test('AT-F2-2: the rendered row equals deriveProjectCycleLedgerRows(fetchCycles output) — the render surface is the shared transform applied to the real cycles, not a fabricated stand-in', async () => {
  stubBridge(NON_EMPTY_SNAPSHOT);

  const snap = await fetchCycles();
  const cycles = [...snap.live, ...snap.recent];

  // Direct call to the shared adapter over the SAME fetched cycles.
  const rows = projectCycleLedger.deriveProjectCycleLedgerRows(cycles);
  expect(rows.length).toBeGreaterThanOrEqual(1);
  const row = rows.find((r) => r.id === CYCLE_ID);
  expect(row).toBeDefined();
  expect(row?.href).toBe(EXPECTED_HREF);

  const html = renderToStaticMarkup(
    React.createElement(ProjectCycleLedger, { cycles, nowMs: FIXED_NOW }),
  );
  const rowTag = tagContaining(html, 'data-ledger-row="true"');
  // The component's rendered row carries the adapter's own id / status / href.
  expect(attrValue(rowTag, 'data-run-id')).toBe(row?.id);
  expect(attrValue(rowTag, 'data-run-status')).toBe(String(row?.status));
  expect(attrValue(rowTag, 'href')).toBe(row?.href);
});
