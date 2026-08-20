/**
 * DOM contract + acceptance tests for the SHARED ledger render surface
 * (R6-05 Task 4) — `components/studio/HistoryLedger.tsx`, a pure
 * presentational component that does not exist yet. Every assertion below
 * is a legitimate RED against a not-yet-created file.
 *
 * WHY A PURE PRESENTATIONAL COMPONENT: same documented gap as
 * `./flow-run-detail-render.test.ts` (R6-01 WI-2) — no jsdom, no
 * `@testing-library/react` in this repo; `renderToStaticMarkup` is the only
 * available render path, so this component takes fully-resolved `LedgerRow[]`
 * props (from `./flow-ledger.ts`'s `deriveFlowLedgerRows`, this initiative's
 * Task 3) rather than fetching anything itself. It is embedded as a SECTION
 * inside an existing page (`app/flows/[id]/page.tsx`'s monitor tab), not a
 * route of its own — so unlike `FlowRunDetail` (a page-level `<main
 * data-page=...>`), this is a page-level SECTION, matching the existing
 * `<section data-section="run-timeline">` / `<section
 * data-section="run-trigger">` convention already shipped in
 * `components/studio/FlowRunDetail.tsx`.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * AMENDMENT 29 — ELEMENT TYPE, NOT JUST ATTRIBUTES. R6-01 shipped a `<div>`
 * where the DOM contract needed `<main>`, with 45/45 green, because every
 * existing render test in this repo (including `flow-run-detail-render.
 * test.ts`, WHICH THIS FILE'S OWN PRECEDENT COMPONENT'S HEADER NAMES AS THE
 * EXACT GAP: "The pinned render tests assert on the ATTRIBUTES only and are
 * element-agnostic, so they cannot catch this — a `<div>` here passes every
 * unit test") only asserted attribute-substring presence. This file's own
 * `tagOf()` helper extracts the REAL tag name from rendered markup, and
 * every structural test below asserts it explicitly, not just the
 * attributes riding on whatever element happens to carry them.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORTS from `@/components/studio/HistoryLedger` (none exist yet):
 *
 *   export type HistoryLedgerProps = { rows: LedgerRow[]; nowMs: number };
 *   export function HistoryLedger(props: HistoryLedgerProps): JSX.Element
 *
 * ASSUMED data-* CONTRACT (new vocabulary — nothing pre-existing collides,
 * see measurement (d) below):
 *
 *   <section data-section="history-ledger" data-ledger-count={n}>
 *     (n===0) -> <div data-component="history-ledger-empty">...</div>
 *     (n>0)   -> one <a data-ledger-row="true" data-run-id data-run-status
 *                    data-run-when data-ledger-cost-usd href={row.href}>
 *                  per row, in the ROW ARRAY ORDER GIVEN (sorting is
 *                  `deriveFlowLedgerRows`'s job, Task 3 — this component
 *                  trusts its input order, D2's "the component renders
 *                  whatever it is given" extended to ordering too)
 *                [data-ledger-narrative]      ONLY when row.narrative !== null
 *                [data-narrative-kinds]        ONLY when row.narrativeKinds
 *                                               is non-empty (paired 1:1 with
 *                                               data-ledger-narrative — see
 *                                               ROUND 3 (D11) below)
 *
 * ROUND 3 (D11) — `data-narrative-kinds` is the MACHINE surface for the row's
 * narrative: `row.narrativeKinds.join(',')`, verbatim, in array order —
 * NEVER re-derived by parsing `row.narrative`'s human string (that string can
 * embed neutralized-but-still-freeform note text — see `./history-ledger.
 * test.ts`'s D11 note — so parsing it back apart is exactly the fragile
 * approach this attribute exists to make unnecessary). Its elements are
 * always one of the seven CLOSED `LedgerSegment['kind']` literals — the
 * closed-vocabulary guarantee itself is enforced upstream, at the type level
 * and by `./history-ledger.test.ts`'s own EXHAUSTIVE battery (this
 * component's job is purely mechanical: join whatever closed-kind array it
 * is handed, verbatim). Automation, journey beats (R6-05 Task B,
 * `scripts/journeys/flows-run.mjs`) and any future consumer assert on THIS
 * attribute, never on `data-ledger-narrative`'s human string.
 *
 * `data-ledger-cost-usd` is `.toFixed(2)`, matching the established
 * `data-phase-cost-usd`/`data-wi-cost-usd` 2-decimal convention
 * (FlowTopology.tsx:211,412-413) — DELIBERATELY NOT the name
 * `data-run-cost-usd`, which already exists at
 * `components/studio/MonitorSummary.tsx:59,107` on the PAGE-LEVEL summary
 * strip with `.toFixed(4)` precision (measurement (d), task report): reusing
 * that name here, on a DIFFERENT element with a DIFFERENT precision
 * convention, would make `[data-run-cost-usd]` an ambiguous selector across
 * two surfaces that disagree on decimal places.
 *
 * `data-run-when` carries the RAW ISO `row.when` verbatim (D7) — the
 * human-readable relative text ("5m ago") is rendered separately, computed
 * via `formatWhen(row.when, nowMs)` (`./history-ledger.ts`, Task 3) from the
 * REQUIRED `nowMs` prop, never `Date.now()` read inside this component.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { HistoryLedger, type HistoryLedgerProps } from '@/components/studio/HistoryLedger';
import type { LedgerRow } from './history-ledger.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: '2026-01-01T00-00-00_INIT-a',
    when: '2026-01-01T00:00:00Z',
    what: 'Ship the ledger',
    narrative: 'gate failed ×2',
    narrativeKinds: ['gate-fails'], // ROUND 3 (D11) — paired 1:1 with `narrative`
    status: 'complete',
    costUsd: 3.5,
    href: '/flows/forge-develop/run/2026-01-01T00-00-00_INIT-a',
    ...over,
  };
}

const FIXED_NOW = new Date('2026-01-01T03:00:00Z').getTime();

function render(over: Partial<HistoryLedgerProps> = {}): string {
  const props: HistoryLedgerProps = { rows: [row()], nowMs: FIXED_NOW, ...over };
  return renderToStaticMarkup(React.createElement(HistoryLedger as never, props as never));
}

/** The single element carrying `data-run-id="<id>"`, as raw markup — same
 *  extraction technique as `flow-run-detail-render.test.ts`'s `rowMarkup`. */
function rowMarkup(html: string, id: string): string {
  const i = html.indexOf(`data-run-id="${id}"`);
  if (i === -1) throw new Error(`no element with data-run-id="${id}" in rendered markup: ${html}`);
  const start = html.lastIndexOf('<', i);
  const end = html.indexOf('>', i);
  return html.slice(start, end + 1);
}

/** AMENDMENT 29: the real tag name of an opening-tag markup fragment (as
 *  returned by `rowMarkup`, or any `<tag ...>` slice) — e.g. `tagOf('<a
 *  data-run-id="x" href="/y">')` -> `'a'`. Distinguishes `<a>` from `<div>`
 *  from `<section>`, which a plain `.toContain('data-run-id="x"')` check
 *  cannot: that check passes identically no matter which element the
 *  attribute happens to be riding on. */
function tagOf(markup: string): string {
  const m = /^<\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(markup);
  if (!m) throw new Error(`could not extract a tag name from: ${markup}`);
  return m[1].toLowerCase();
}

// ---------------------------------------------------------------------------
// ROOT STRUCTURE — a SECTION, not a route-level main, not a bare div
// ---------------------------------------------------------------------------

test('the ledger root is a <section data-section="history-ledger">, not a <div> or a route-level <main>', () => {
  // KILLS (amendment 29): a `<div data-section="history-ledger">` would pass
  // every attribute-only check below identically. Also kills reusing
  // `<main data-page=...>` (this is an embedded section, not a route) and
  // reusing `data-section="run-timeline"` (a DIFFERENT existing section,
  // R6-01's own — a collision would make the two indistinguishable to any
  // selector scoped to `[data-section="history-ledger"]`).
  const html = render();
  const i = html.indexOf('data-section="history-ledger"');
  expect(i).toBeGreaterThan(-1);
  const start = html.lastIndexOf('<', i);
  const end = html.indexOf('>', i);
  const rootTag = tagOf(html.slice(start, end + 1));

  expect(rootTag).toBe('section');
  expect(html).not.toContain('data-section="run-timeline"');
  expect(html).not.toContain('data-page="history-ledger"');
});

test('the root carries the row count as machine-readable data, matching the actual number of rows rendered', () => {
  const html = render({ rows: [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })] });
  expect(html).toContain('data-ledger-count="3"');
  expect((html.match(/data-ledger-row="true"/g) ?? []).length).toBe(3);
});

// ---------------------------------------------------------------------------
// EMPTY STATE — honest, not a fabricated row
// ---------------------------------------------------------------------------

test('zero rows renders the honest empty state, never a fabricated placeholder row', () => {
  const html = render({ rows: [] });
  expect(html).toContain('data-ledger-count="0"');
  expect(html).toContain('data-component="history-ledger-empty"');
  expect(html).not.toContain('data-ledger-row="true"');
});

// ---------------------------------------------------------------------------
// ROW ELEMENT — amendment 29: a REAL <a href>, not a <div onClick>
// ---------------------------------------------------------------------------

test('AMENDMENT 29: each row renders as a REAL <a href> anchor, not a <div> with only a DOM attribute pretending to be a link', () => {
  // KILLS: `<div data-ledger-row="true" data-run-id="...">` (or any
  // non-anchor element) carrying the row facts with navigation bolted on via
  // an onClick handler this static-markup test cannot see anyway — that
  // shape is invisible to keyboard nav, screen readers, and cmd-click/
  // open-in-new-tab, and it is EXACTLY the class of defect amendment 29
  // exists to catch: every attribute-only assertion below would pass
  // identically whether this is an `<a>` or a `<div>`.
  const html = render();
  const markup = rowMarkup(html, '2026-01-01T00-00-00_INIT-a');

  expect(tagOf(markup)).toBe('a');
  expect(markup).toContain('href="/flows/forge-develop/run/2026-01-01T00-00-00_INIT-a"');
});

test('the row anchor renders whatever href it is given, verbatim — the component never reconstructs it (D2, the R6-06 reuse seam)', () => {
  // KILLS: the component building its own `/flows/.../run/...` URL from
  // `row.id`/some other field instead of trusting `row.href` — which is
  // EXACTLY what would break the moment R6-06 (agent monitor) reuses this
  // component and needs a DIFFERENT link shape (an agent run, a standalone
  // dispatch, or a session — none of which are `/flows/...` URLs).
  const html = render({ rows: [row({ id: 'sentinel', href: '/agents/some-agent/run/RUN-99?SENTINEL=1' })] });
  const markup = rowMarkup(html, 'sentinel');

  expect(markup).toContain('href="/agents/some-agent/run/RUN-99?SENTINEL=1"');
});

test("each row carries its own id/status/when/cost on ONE element — the run-level facts are not scattered or borrowed from a sibling", () => {
  const html = render({
    rows: [
      row({ id: 'a', status: 'gated', when: '2026-01-01T00:00:00Z', costUsd: 1.5 }),
      row({ id: 'b', status: 'failed', when: '2026-02-01T00:00:00Z', costUsd: 0 }),
    ],
  });

  const a = rowMarkup(html, 'a');
  expect(a).toContain('data-run-status="gated"');
  expect(a).toContain('data-run-when="2026-01-01T00:00:00Z"');
  expect(a).toContain('data-ledger-cost-usd="1.50"');

  const b = rowMarkup(html, 'b');
  expect(b).toContain('data-run-status="failed"');
  expect(b).toContain('data-run-when="2026-02-01T00:00:00Z"');
  expect(b).toContain('data-ledger-cost-usd="0.00"');
});

test('cost uses the 2-decimal convention, under its OWN attribute name — never data-run-cost-usd (the colliding, differently-precisioned page-level name)', () => {
  // KILLS: reusing `data-run-cost-usd` (MonitorSummary.tsx:59,107, already
  // shipped at 4-decimal precision on the page's summary strip) for this
  // row-level, 2-decimal fact — see measurement (d), task report. Also
  // kills a raw/unformatted float and a "$"-prefixed value inside the
  // attribute (the established convention: bare .toFixed(2) in data-*,
  // "$"-prefixed only in human-visible text — flow-run-detail-render.
  // test.ts:265-275).
  const html = render({ rows: [row({ id: 'a', costUsd: 3.5 })] });
  const a = rowMarkup(html, 'a');

  expect(a).toContain('data-ledger-cost-usd="3.50"');
  expect(a).not.toContain('data-run-cost-usd');
  expect(a).not.toContain('data-ledger-cost-usd="3.5"');
  expect(a).not.toContain('data-ledger-cost-usd="$3.50"');
});

test('D4: status renders the REAL RunStatus vocabulary — the mockup\'s "attention" status never appears, for any row', () => {
  const statuses: LedgerRow['status'][] = ['planned', 'active', 'gated', 'complete', 'failed'];
  const html = render({ rows: statuses.map((status, i) => row({ id: `s${i}`, status })) });

  for (let i = 0; i < statuses.length; i++) {
    expect(rowMarkup(html, `s${i}`)).toContain(`data-run-status="${statuses[i]}"`);
  }
  expect(html).not.toContain('attention');
  expect(html).not.toContain('data-run-status="attention"');
});

// ---------------------------------------------------------------------------
// NARRATIVE — honest-null, never a placeholder
// ---------------------------------------------------------------------------

test('a row with a real narrative carries it on data-ledger-narrative, verbatim (not re-derived here)', () => {
  const html = render({ rows: [row({ id: 'a', narrative: 'SENTINEL-NARRATIVE' })] });
  expect(rowMarkup(html, 'a')).toContain('data-ledger-narrative="SENTINEL-NARRATIVE"');
});

test('a row with narrative: null emits NO narrative attribute — honest-empty, never "" or invented filler text', () => {
  // KILLS: `data-ledger-narrative=""` and rendered filler ("No events",
  // "—") standing in for a genuinely quiet run.
  const html = render({ rows: [row({ id: 'a', narrative: null })] });
  const markup = rowMarkup(html, 'a');
  expect(markup).not.toContain('data-ledger-narrative');
});

// ---------------------------------------------------------------------------
// ROUND 3 (D11) — data-narrative-kinds: the MACHINE surface. Automation and
// journey beats assert on THIS, never by parsing data-ledger-narrative's
// human string (see the header note above for the full rationale).
// ---------------------------------------------------------------------------

test('D11: data-narrative-kinds carries row.narrativeKinds verbatim, comma-joined, in the ARRAY ORDER GIVEN — the component never re-derives it from the human narrative string', () => {
  // KILLS: a component that parses `row.narrative` (splitting on ' → ' or
  // similar) to reconstruct the kinds instead of trusting the caller-supplied
  // `narrativeKinds` array directly — exactly the D2 "renders whatever it is
  // given, verbatim" discipline already pinned for `href`, extended here. The
  // narrative TEXT below is a sentinel that does NOT correspond to the kinds
  // (deliberately mismatched) — a parse-the-string implementation would
  // produce something other than the exact kinds list asserted here, proving
  // this attribute is sourced from `narrativeKinds`, not from `narrative`.
  const html = render({
    rows: [row({
      id: 'a',
      narrative: 'SENTINEL TEXT UNRELATED TO THE KINDS BELOW',
      narrativeKinds: ['work-items', 'review-findings', 'merged'],
    })],
  });
  expect(rowMarkup(html, 'a')).toContain('data-narrative-kinds="work-items,review-findings,merged"');
});

test('D11: data-narrative-kinds preserves the given order — a re-sorted/alphabetized rendering would desync it from data-ledger-narrative\'s own segment order', () => {
  // KILLS: `[...kinds].sort().join(',')` or any other reordering — the whole
  // point of this attribute is that its Nth element corresponds to the Nth
  // segment in the human narrative; alphabetizing ('failed' < 'gate-fails' <
  // 'merged' < 'work-items') would silently break that correspondence for
  // any narrative whose kinds aren't already alphabetical.
  const html = render({
    rows: [row({ id: 'a', narrative: 'x', narrativeKinds: ['merged', 'gate-fails', 'failed'] })],
  });
  expect(rowMarkup(html, 'a')).toContain('data-narrative-kinds="merged,gate-fails,failed"');
});

test('D11: a row with narrativeKinds: [] (paired with narrative: null) emits NO data-narrative-kinds attribute — honest-empty, matching data-ledger-narrative\'s own omission', () => {
  // KILLS: `data-narrative-kinds=""` standing in for "nothing to say" — the
  // same honest-omit discipline `data-ledger-narrative`'s own null-handling
  // test above already establishes, applied to the machine surface too.
  const html = render({ rows: [row({ id: 'a', narrative: null, narrativeKinds: [] })] });
  const markup = rowMarkup(html, 'a');
  expect(markup).not.toContain('data-narrative-kinds');
});

test('D11: all seven closed-vocabulary kinds render as their exact literal strings, comma-joined — this component never transforms/renames a kind', () => {
  // Not a re-test of the CLOSED-vocabulary guarantee itself (that a free-typed
  // eighth kind can never be produced is enforced upstream, at the type level
  // and by `./history-ledger.test.ts`'s own EXHAUSTIVE battery) — this proves
  // ONLY that when this component is handed the seven real kind literals, it
  // reproduces them byte-for-byte (no casing change, no synonym substitution,
  // no JSON-stringify quoting that would break a naive `split(',')` consumer).
  const allSeven = ['work-items', 'gate-fails', 'review-findings', 'gate-waiting', 'failed', 'merged', 'reflection-lost'];
  const html = render({ rows: [row({ id: 'a', narrative: 'x', narrativeKinds: allSeven })] });
  const markup = rowMarkup(html, 'a');
  expect(markup).toContain(`data-narrative-kinds="${allSeven.join(',')}"`);
  expect(markup).not.toContain('"['); // no JSON-array quoting leaking into the attribute
});

// ---------------------------------------------------------------------------
// WHEN — raw ISO in the attribute, formatted text separately, via nowMs (D7)
// ---------------------------------------------------------------------------

test('data-run-when carries the raw ISO verbatim regardless of nowMs', () => {
  const html = render({ rows: [row({ id: 'a', when: '2026-01-01T00:00:00Z' })], nowMs: FIXED_NOW });
  expect(rowMarkup(html, 'a')).toContain('data-run-when="2026-01-01T00:00:00Z"');
});

// ---------------------------------------------------------------------------
// R6-06 (D8) — NEW conditional attributes: data-ledger-link-kind,
// data-trigger-kind/data-trigger-source/data-trigger-scope. Naming choice
// for the trigger attributes is DELIBERATE, not invented fresh: mirrors
// `FlowRunDetail.tsx`'s ALREADY-SHIPPED `data-trigger-kind`/
// `data-trigger-source`/`data-trigger-scope` vocabulary verbatim (see that
// component's header + `flow-run-detail-render.test.ts:304`'s own explicit
// "KILLS: inventing a parallel vocabulary" precedent) — reused here on the
// ROW element instead of a page-level `<section data-section="run-trigger">`.
// `data-ledger-link-kind` (not the bare `data-link-kind`) follows this
// component's OWN established `data-ledger-*` prefix for facts this ledger
// layer adds that don't already exist as a `Run` field (`data-ledger-
// cost-usd`, `data-ledger-narrative` — as opposed to `data-run-*`, reserved
// for facts copied straight off `Run`).
// ---------------------------------------------------------------------------

test('R6-06 D8: a row with linkKind set renders data-ledger-link-kind with the exact value, verbatim', () => {
  // KILLS: the CURRENT component (HistoryLedger.tsx), which has no
  // `data-ledger-link-kind` attribute at all — legitimate RED against a
  // not-yet-extended file. Also kills a renamed/synonym attribute
  // (`data-link-kind`, `data-row-kind`) that would silently miss any
  // automation/journey selector written against this exact name.
  const html = render({ rows: [row({ id: 'a', linkKind: 'standalone' } as never)] });
  const markup = rowMarkup(html, 'a');
  expect(markup).toContain('data-ledger-link-kind="standalone"');
});

test('R6-06 D8: all three real linkKind values render their own exact literal, on the correct row, never scrambled across neighbours', () => {
  const html = render({
    rows: [
      row({ id: 'a', linkKind: 'flow-node' } as never),
      row({ id: 'b', linkKind: 'standalone' } as never),
      row({ id: 'c', linkKind: 'session' } as never),
    ],
  });
  expect(rowMarkup(html, 'a')).toContain('data-ledger-link-kind="flow-node"');
  expect(rowMarkup(html, 'b')).toContain('data-ledger-link-kind="standalone"');
  expect(rowMarkup(html, 'c')).toContain('data-ledger-link-kind="session"');
});

test('R6-06 D8 BYTE-IDENTICAL-WHEN-ABSENT: a row with linkKind left undefined (every EXISTING R6-05 flow-ledger row) renders NO data-ledger-link-kind attribute at all', () => {
  // KILLS: a component that always renders SOME value for this attribute
  // (`data-ledger-link-kind="undefined"`, `data-ledger-link-kind=""`) —
  // every row R6-05's flow monitor already renders on production today has
  // no `linkKind` (flow-ledger.ts never sets it, per flow-ledger.test.ts's
  // own new pin) — this component must render those rows BYTE-IDENTICALLY
  // to how it renders them today, not grow a stray empty attribute.
  const html = render({ rows: [row({ id: 'a', linkKind: undefined } as never)] });
  const markup = rowMarkup(html, 'a');
  expect(markup).not.toContain('data-ledger-link-kind');
});

test('R6-06 D8: a row with trigger set renders data-trigger-kind/data-trigger-source/data-trigger-scope on the ROW element, mirroring FlowRunDetail.tsx\'s established vocabulary exactly', () => {
  const html = render({
    rows: [row({ id: 'a', trigger: { kind: 'schedule', source: 'cron:0 9 * * 1', scope: 'gitpulse' } } as never)],
  });
  const markup = rowMarkup(html, 'a');
  expect(markup).toContain('data-trigger-kind="schedule"');
  expect(markup).toContain('data-trigger-source="cron:0 9 * * 1"');
  expect(markup).toContain('data-trigger-scope="gitpulse"');
});

test('R6-06 D8: an UNSCOPED trigger renders data-trigger-scope="" — not omitted, not the string "null" — matching FlowRunDetail.tsx\'s own pinned convention for the identical fact', () => {
  const html = render({
    rows: [row({ id: 'a', trigger: { kind: 'webhook', source: 'gh-webhook', scope: null } } as never)],
  });
  const markup = rowMarkup(html, 'a');
  expect(markup).toContain('data-trigger-kind="webhook"');
  expect(markup).toContain('data-trigger-scope=""');
  expect(markup).not.toContain('data-trigger-scope="null"');
  expect(markup).not.toContain('data-trigger-scope="undefined"');
});

test('R6-06 D8 BYTE-IDENTICAL-WHEN-ABSENT: a row with trigger left undefined renders NONE of the three data-trigger-* attributes — every EXISTING R6-05 flow-ledger row (none of which set trigger before this initiative) is unaffected', () => {
  const html = render({ rows: [row({ id: 'a', trigger: undefined } as never)] });
  const markup = rowMarkup(html, 'a');
  expect(markup).not.toContain('data-trigger-kind');
  expect(markup).not.toContain('data-trigger-source');
  expect(markup).not.toContain('data-trigger-scope');
});

test('R6-06 D8 BYTE-IDENTICAL-WHEN-ABSENT (full regression lock): a row shaped EXACTLY like an R6-05-era row (no linkKind, no trigger) renders a markup fragment containing NONE of the four new attribute names anywhere', () => {
  // The single strongest form of this pin: not just "the specific new
  // attributes are absent from THIS row's own tag" but "nothing in the
  // rendered fragment for this row even contains the new attribute NAME
  // substrings" — catches an implementation that renders them elsewhere in
  // the row's markup (e.g. on a child <span>) rather than omitting them
  // outright.
  const html = render({ rows: [row({ id: 'a' })] }); // the plain R6-05 fixture — unmodified
  const markup = rowMarkup(html, 'a');
  for (const attr of ['data-ledger-link-kind', 'data-trigger-kind', 'data-trigger-source', 'data-trigger-scope']) {
    expect(markup).not.toContain(attr);
  }
});

// ---------------------------------------------------------------------------
// Honest-absent cost (server-facing rule restated at the render layer): a
// row whose cost genuinely does not exist yet (a session/standalone entry
// with no log dir) must never render as an authoritative "$0.00".
// ---------------------------------------------------------------------------

test('R6-06: a row with costUsd: null renders NO data-ledger-cost-usd attribute and no "$0.00"/"0.00" text — never a fabricated authoritative zero for a cost that genuinely does not exist yet', () => {
  // KILLS: the CURRENT component's unconditional `row.costUsd.toFixed(2)`
  // (HistoryLedger.tsx:100,126) — calling `.toFixed(2)` on `null` THROWS at
  // runtime (a `TypeError`), which is itself proof this is unhandled today;
  // a "fix" that instead defaults null to 0 before formatting would render
  // the exact fabricated "$0.00" this test forbids.
  const html = render({ rows: [row({ id: 'a', costUsd: null } as never)] });
  const markup = rowMarkup(html, 'a');
  expect(markup).not.toContain('data-ledger-cost-usd="0.00"');
  expect(markup).not.toContain('data-ledger-cost-usd="null"');
  expect(html).not.toContain('$0.00');
});

// ---------------------------------------------------------------------------
// W6-IA-4 — showKindChip: OPTIONAL, byte-identical-when-absent, mirroring
// this file's own established discipline for `linkKind`/`trigger` above.
// ---------------------------------------------------------------------------

test('W6-IA-4: showKindChip omitted (every EXISTING caller — flow monitor, agents index, agent detail) renders NO data-ledger-kind attribute at all', () => {
  const html = render({ rows: [row({ id: 'a' })] });
  const markup = rowMarkup(html, 'a');
  expect(markup).not.toContain('data-ledger-kind');
  expect(html).not.toContain('data-ledger-kind-badge');
});

test('W6-IA-4: showKindChip: true renders data-ledger-kind="flow" for a row with linkKind undefined (a flow-ledger.ts row)', () => {
  const html = render({ rows: [row({ id: 'a', linkKind: undefined } as never)], showKindChip: true });
  const markup = rowMarkup(html, 'a');
  expect(markup).toContain('data-ledger-kind="flow"');
});

test('W6-IA-4: showKindChip: true renders data-ledger-kind="agent" for every agent-sourced linkKind', () => {
  const html = render({
    rows: [
      row({ id: 'a', linkKind: 'standalone' } as never),
      row({ id: 'b', linkKind: 'flow-node' } as never),
      row({ id: 'c', linkKind: 'session' } as never),
    ],
    showKindChip: true,
  });
  expect(rowMarkup(html, 'a')).toContain('data-ledger-kind="agent"');
  expect(rowMarkup(html, 'b')).toContain('data-ledger-kind="agent"');
  expect(rowMarkup(html, 'c')).toContain('data-ledger-kind="agent"');
});

test('W6-IA-4: showKindChip: true renders a visible [data-ledger-kind-badge] per row, and false/omitted renders none', () => {
  const withChip = render({ rows: [row({ id: 'a' })], showKindChip: true });
  expect((withChip.match(/data-ledger-kind-badge/g) ?? []).length).toBe(1);

  const withoutChip = render({ rows: [row({ id: 'a' })], showKindChip: false });
  expect(withoutChip).not.toContain('data-ledger-kind-badge');
});

test('the SAME row renders DIFFERENT visible relative-time text for a DIFFERENT nowMs — proving nowMs is actually threaded through, not ignored', () => {
  // KILLS: a component that accepts the `nowMs` prop but never uses it
  // (e.g. calling `Date.now()` internally instead, D7's exact violation) —
  // that bug would render byte-identical text regardless of what nowMs is
  // passed, which this test would catch by comparing two renders.
  const soon = render({ rows: [row({ id: 'a', when: '2026-01-01T00:00:00Z' })], nowMs: new Date('2026-01-01T00:05:00Z').getTime() });
  const later = render({ rows: [row({ id: 'a', when: '2026-01-01T00:00:00Z' })], nowMs: new Date('2026-01-03T00:00:00Z').getTime() });

  expect(rowMarkup(soon, 'a')).not.toBe(rowMarkup(later, 'a'));
});

// ---------------------------------------------------------------------------
// W7-B1 (home-sessions-33) — ONE vocabulary on data-run-status. A session
// row's own status.json phase (an OPEN per-runner vocabulary, D12 — a
// deliberate design the ROW keeps verbatim) no longer leaks raw into the
// CLOSED data-run-status DOM contract: the attribute carries the mapped
// run-vocab value, and the raw phase rides its own data-session-phase.
// ---------------------------------------------------------------------------

test('W7-B1 (home-sessions-33): a session row maps its phase onto the run vocabulary for data-run-status and carries the raw phase on data-session-phase', () => {
  const html = render({ rows: [row({ id: 's1', linkKind: 'session', status: 'gathering', narrative: null, narrativeKinds: [] })] });
  const markup = rowMarkup(html, 's1');
  expect(markup).toContain('data-run-status="active"');
  expect(markup).toContain('data-session-phase="gathering"');
  // The visible chip still shows the operator the REAL phase, verbatim.
  expect(html).toContain('gathering');
});

test('W7-B1: a session row at a done-terminal phase reads complete; a stopped-terminal phase reads failed — never an in-flight claim for a finished session', () => {
  const done = rowMarkup(render({ rows: [row({ id: 'd', linkKind: 'session', status: 'committed', narrative: null, narrativeKinds: [] })] }), 'd');
  expect(done).toContain('data-run-status="complete"');
  expect(done).toContain('data-session-phase="committed"');
  const stopped = rowMarkup(render({ rows: [row({ id: 'x', linkKind: 'session', status: 'cancelled', narrative: null, narrativeKinds: [] })] }), 'x');
  expect(stopped).toContain('data-run-status="failed"');
  expect(stopped).toContain('data-session-phase="cancelled"');
});

test('W7-B1: non-session rows are byte-untouched — no data-session-phase, status verbatim', () => {
  const flow = rowMarkup(render({ rows: [row({ id: 'f', status: 'gated' })] }), 'f');
  expect(flow).toContain('data-run-status="gated"');
  expect(flow).not.toContain('data-session-phase');
  const standalone = rowMarkup(render({ rows: [row({ id: 's', linkKind: 'standalone', status: 'done' })] }), 's');
  expect(standalone).toContain('data-run-status="done"');
  expect(standalone).not.toContain('data-session-phase');
});
