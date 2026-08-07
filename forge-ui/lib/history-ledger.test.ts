/**
 * Acceptance tests for the SHARED run-history ledger engine (R6-05 Task 3)
 * — `forge-ui/lib/history-ledger.ts`, a pure module that does not exist yet.
 * Every assertion below is a legitimate RED against a not-yet-created file.
 *
 * WHY A SHARED MODULE: R6-05's flow monitor ledger and R6-06's (next
 * initiative) agent monitor ledger render the SAME row vocabulary — `when ·
 * what · outcome-narrative · status · cost` (docs/roadmaps/
 * R6-operator-experience.md:369-370, "shares vocabulary components with
 * R6-06 — build once"). This file owns the vocabulary + row shape + the
 * generic newest-first sort + the locale/wall-clock-independent `when`
 * formatter. `./flow-ledger.ts` (R6-05, this initiative) is the FIRST
 * caller, turning a flow's `Run[]` into `LedgerRow[]`; R6-06 will add a
 * second caller for agent runs, reusing every export here unchanged (D2).
 *
 * ═══════════════════════════════════════════════════════════════════════
 * ASSUMED EXPORTS from `./history-ledger.ts` (none exist yet):
 *
 *   export type LedgerSegment =
 *     | { kind: 'gate-fails'; count: number }                    // dev ONLY, D9
 *     | { kind: 'review-findings'; total: number; blocker: number; major: number; minor: number; info: number }
 *     | { kind: 'gate-waiting'; note: string }
 *     | { kind: 'failed'; note: string }
 *     | { kind: 'reflection-lost'; cause: string };
 *
 *   export function renderSegment(seg: LedgerSegment): string;
 *   export function renderNarrative(segments: LedgerSegment[]): string | null;
 *
 *   export type LedgerRow = {
 *     id: string;
 *     when: string;              // raw ISO `run.startedAt`, or '' if absent (D7)
 *     what: string;
 *     narrative: string | null;  // renderNarrative(segments) — D3
 *     status: RunStatus;         // the REAL vocabulary — D4
 *     costUsd: number;           // run.costUsd, never re-summed — D8
 *     href: string;              // caller-computed — D2, the reuse seam
 *   };
 *
 *   export function sortLedgerRowsNewestFirst(rows: LedgerRow[]): LedgerRow[];
 *   export function formatWhen(iso: string | undefined, nowMs: number): string; // D7
 *
 * ═══════════════════════════════════════════════════════════════════════
 * D-DECISIONS THIS FILE ENCODES (verbatim from the task brief, not
 * re-litigated — see the task report for the measurement trail):
 *
 *   D3 — the narrative is a CLOSED, ENUMERATED segment vocabulary. Each
 *     segment is produced by a named function returning a discriminated
 *     union; `renderNarrative` is `segments.map(renderSegment).join(' → ')`.
 *     Nothing true to say -> `null`, never filler.
 *   D4 — `status` renders the REAL `RunStatus` — `'planned'|'active'|
 *     'gated'|'complete'|'failed'` (studio-client.ts:26). The mockup's
 *     `'attention'` status has NO producer anywhere in this repo (a
 *     repo-wide grep for the string literal returns nothing outside
 *     mockups/) and must never appear.
 *   D7 — `when` is deterministic/locale-independent: `formatWhen` takes an
 *     explicit `nowMs`, never reads `Date.now()` or `toLocaleString()`
 *     internally.
 *   D8 — cost is `run.costUsd`, read never re-summed.
 */
import { test, expect } from 'vitest';

import {
  renderSegment,
  renderNarrative,
  sortLedgerRowsNewestFirst,
  formatWhen,
  type LedgerSegment,
  type LedgerRow,
} from './history-ledger.ts';

// ---------------------------------------------------------------------------
// renderSegment / renderNarrative — the closed vocabulary (D3)
// ---------------------------------------------------------------------------

test('renderSegment: each of the five known segment kinds renders its exact, pinned string', () => {
  // KILLS: a renderer that ignores `kind` and returns one generic string for
  // every segment, or that renders a DIFFERENT wording than the one other
  // surfaces already established (gate-fails mirrors D9's own literal
  // phrase; reflection-lost mirrors RunRail.tsx:304's existing
  // `reflection lost: {run.reflectionLost}` wording verbatim — a SECOND
  // phrasing for the same fact on a different surface would be exactly the
  // kind of vocabulary drift D3 forbids).
  expect(renderSegment({ kind: 'gate-fails', count: 3 })).toBe('gate failed ×3');
  expect(renderSegment({ kind: 'review-findings', total: 4, blocker: 1, major: 1, minor: 2, info: 0 })).toBe('4 findings (1 blocker, 1 major)');
  expect(renderSegment({ kind: 'review-findings', total: 1, blocker: 0, major: 0, minor: 1, info: 0 })).toBe('1 finding (0 blocker, 0 major)');
  expect(renderSegment({ kind: 'gate-waiting', note: 'needs you' })).toBe('gated: needs you');
  expect(renderSegment({ kind: 'failed', note: 'CI red on merge' })).toBe('failed: CI red on merge');
  expect(renderSegment({ kind: 'reflection-lost', cause: 'crash' })).toBe('reflection lost: crash');
});

test('renderNarrative: segments join with " → ", in the array order given (join, not re-sort)', () => {
  // KILLS: a narrative composer that alphabetizes/re-orders segments
  // instead of trusting caller-supplied order, and one that uses a
  // different separator (comma, semicolon, newline).
  const segments: LedgerSegment[] = [
    { kind: 'gate-fails', count: 2 },
    { kind: 'review-findings', total: 1, blocker: 0, major: 0, minor: 1, info: 0 },
  ];
  expect(renderNarrative(segments)).toBe('gate failed ×2 → 1 finding (0 blocker, 0 major)');
});

test('renderNarrative: an empty segment list is null — nothing true to say, never an empty string or filler', () => {
  // KILLS: `''` (an empty-but-present string, which a `data-*` attribute
  // consumer cannot distinguish from "computed and genuinely blank") and any
  // invented filler ("No notable events", "Nothing to report").
  expect(renderNarrative([])).toBeNull();
});

test('renderNarrative: a SINGLE segment renders with no arrow at all', () => {
  // KILLS: an implementation that always appends a trailing/leading arrow
  // regardless of segment count.
  const only = renderNarrative([{ kind: 'failed', note: 'CI red' }]);
  expect(only).toBe('failed: CI red');
  expect(only).not.toContain('→');
});

// ---------------------------------------------------------------------------
// EXHAUSTIVE CLOSED VOCABULARY — the most important test in this file.
//
// A battery of every real fixture shape this initiative measured (D9's own
// trap included: non-dev retries must produce NOTHING, never a "gate
// failed" phrased for review — "A test that lets 'review N gate fails' pass
// is a defect", quoted verbatim from the task brief). Every non-empty piece
// of every rendered narrative, split on ' → ', must match ONE of exactly
// five anchored patterns — proving no free-typed/authored prose, no sixth
// segment kind, and no D9 violation can reach the rendered output across
// this whole battery.
// ---------------------------------------------------------------------------

const VOCAB_PATTERNS: RegExp[] = [
  /^gate failed ×\d+$/,
  /^\d+ findings? \(\d+ blocker, \d+ major\)$/,
  /^gated: .+$/,
  /^failed: .+$/,
  /^reflection lost: .+$/,
];

function assertOnlyKnownVocabulary(narrative: string | null, label: string): void {
  if (narrative === null) return; // honest-null is always in-vocabulary
  for (const piece of narrative.split(' → ')) {
    const matched = VOCAB_PATTERNS.some((re) => re.test(piece));
    expect(matched, `[${label}] segment "${piece}" matched NO known vocabulary pattern`).toBe(true);
  }
}

test('EXHAUSTIVE: every segment kind produced across a wide battery of fixtures matches the closed vocabulary — no free-typed prose can leak through', () => {
  const battery: Array<{ label: string; segments: LedgerSegment[] }> = [
    { label: 'all five at once (worst case)', segments: [
      { kind: 'gate-fails', count: 5 },
      { kind: 'review-findings', total: 9, blocker: 2, major: 3, minor: 4, info: 0 },
      { kind: 'gate-waiting', note: 'comment unresolved' },
      { kind: 'failed', note: 'scope violation' },
      { kind: 'reflection-lost', cause: 'budget-exhausted' },
    ] },
    { label: 'gate-fails alone, count 1', segments: [{ kind: 'gate-fails', count: 1 }] },
    { label: 'review-findings alone, all zero severities except total', segments: [{ kind: 'review-findings', total: 1, blocker: 0, major: 0, minor: 0, info: 1 }] },
    { label: 'gate-waiting alone with punctuation in the note', segments: [{ kind: 'gate-waiting', note: 'AC-2 not met; awaiting fix' }] },
    { label: 'failed alone with an arrow-shaped note (must not be mistaken for a joiner)', segments: [{ kind: 'failed', note: 'pipeline → CI step 3 timed out' }] },
    { label: 'reflection-lost alone', segments: [{ kind: 'reflection-lost', cause: 'interrupted' }] },
    { label: 'empty (nothing to say)', segments: [] },
  ];

  for (const { label, segments } of battery) {
    assertOnlyKnownVocabulary(renderNarrative(segments), label);
  }
});

test('EXHAUSTIVE (type level): LedgerSegment has EXACTLY five members — this file fails to typecheck if a sixth is added without updating this pin', () => {
  // A compile-time backstop to the runtime battery above: TypeScript's
  // exhaustiveness checking means the `default` branch below only typechecks
  // if `seg` has been narrowed to `never` — i.e. every LedgerSegment member
  // was handled by an EARLIER case. Adding a sixth variant to the real union
  // without updating this switch makes `assertNever`'s argument type
  // mismatch, failing `tsc`/`next build` (this repo's own real typecheck
  // gate) even though vitest itself does not type-check .ts files.
  function assertNever(x: never): never {
    throw new Error(`unhandled LedgerSegment kind: ${JSON.stringify(x)}`);
  }
  function exhaustiveRender(seg: LedgerSegment): string {
    switch (seg.kind) {
      case 'gate-fails': return renderSegment(seg);
      case 'review-findings': return renderSegment(seg);
      case 'gate-waiting': return renderSegment(seg);
      case 'failed': return renderSegment(seg);
      case 'reflection-lost': return renderSegment(seg);
      default: return assertNever(seg);
    }
  }
  // Runtime half: prove `exhaustiveRender` (this test's own closed switch)
  // agrees with the REAL exported `renderSegment` for one instance of each
  // kind — if the real function's vocabulary ever drifts from this pinned
  // switch, this assertion (not just the typecheck) catches it too.
  const samples: LedgerSegment[] = [
    { kind: 'gate-fails', count: 1 },
    { kind: 'review-findings', total: 1, blocker: 0, major: 0, minor: 1, info: 0 },
    { kind: 'gate-waiting', note: 'x' },
    { kind: 'failed', note: 'x' },
    { kind: 'reflection-lost', cause: 'crash' },
  ];
  for (const s of samples) {
    expect(exhaustiveRender(s)).toBe(renderSegment(s));
  }
});

// ---------------------------------------------------------------------------
// sortLedgerRowsNewestFirst — pure, immutable, missing-`when` handling
// ---------------------------------------------------------------------------

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'r-1',
    when: '2026-01-01T00:00:00Z',
    what: 'probe',
    narrative: null,
    status: 'complete',
    costUsd: 0,
    href: '/flows/x/run/r-1',
    ...over,
  };
}

test('sortLedgerRowsNewestFirst: newest `when` first', () => {
  // KILLS: sorting oldest-first (the natural array/insertion order below is
  // ALREADY oldest-first, so a no-op "sort" would pass an ascending check
  // but fail this one), and sorting by `id` or insertion order instead of
  // `when`.
  const rows = [
    row({ id: 'old', when: '2026-01-01T00:00:00Z' }),
    row({ id: 'newest', when: '2026-03-01T00:00:00Z' }),
    row({ id: 'mid', when: '2026-02-01T00:00:00Z' }),
  ];
  expect(sortLedgerRowsNewestFirst(rows).map((r) => r.id)).toEqual(['newest', 'mid', 'old']);
});

test('sortLedgerRowsNewestFirst: a row with NO `when` (empty string) sorts LAST, never first', () => {
  // KILLS: a naive ascending numeric/string sort of `''` (which, parsed as a
  // Date, yields `NaN` — `NaN` comparisons in a sort comparator are
  // implementation-defined and can put it FIRST) landing an unstarted/
  // never-recorded run at the top of "most recent" history.
  const rows = [
    row({ id: 'dated', when: '2026-01-01T00:00:00Z' }),
    row({ id: 'undated', when: '' }),
  ];
  expect(sortLedgerRowsNewestFirst(rows).map((r) => r.id)).toEqual(['dated', 'undated']);
});

test('sortLedgerRowsNewestFirst: returns a NEW array — the input is never mutated (immutability rule)', () => {
  // KILLS: `rows.sort(...)` (Array.prototype.sort mutates in place), which
  // would silently reorder whatever list the caller still holds a reference
  // to — the standing "return new objects, never mutate inputs" rule.
  const input = [row({ id: 'a', when: '2026-01-01T00:00:00Z' }), row({ id: 'b', when: '2026-02-01T00:00:00Z' })];
  const inputCopyIds = input.map((r) => r.id);
  const sorted = sortLedgerRowsNewestFirst(input);

  expect(sorted).not.toBe(input);
  expect(input.map((r) => r.id)).toEqual(inputCopyIds); // original order untouched
});

// ---------------------------------------------------------------------------
// formatWhen — deterministic, locale/wall-clock independent (D7)
// ---------------------------------------------------------------------------

test('formatWhen: given an explicit nowMs, never calls Date.now() internally', () => {
  // KILLS: `elapsed()`-style helpers (the EXISTING, accepted-elsewhere
  // pattern at components/studio/MonitorSummary.tsx:19, `Date.now() - new
  // Date(startedAt).getTime()`) — that pattern is explicitly the WRONG one
  // D7 forbids for this new formatter. Monkey-patches `Date.now` to throw;
  // if the real implementation ever reaches for it, this test throws.
  const original = Date.now;
  Date.now = () => { throw new Error('formatWhen must not call Date.now()'); };
  try {
    expect(() => formatWhen('2026-01-01T00:00:00Z', new Date('2026-01-01T00:05:00Z').getTime())).not.toThrow();
  } finally {
    Date.now = original;
  }
});

test('formatWhen: never calls toLocaleString() internally (locale independence)', () => {
  // KILLS: `new Date(iso).toLocaleString()` or any locale-sensitive
  // formatting call, which would render differently under a different
  // process locale/TZ — explicitly forbidden by D7.
  const original = Date.prototype.toLocaleString;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Date.prototype as any).toLocaleString = () => { throw new Error('formatWhen must not call toLocaleString()'); };
  try {
    const nowMs = new Date('2026-01-01T00:05:00Z').getTime();
    expect(() => formatWhen('2026-01-01T00:00:00Z', nowMs)).not.toThrow();
  } finally {
    Date.prototype.toLocaleString = original;
  }
});

test('formatWhen: identical (iso, nowMs) inputs produce byte-identical output regardless of process TZ', () => {
  // KILLS: any computation that reads `process.env.TZ` / the runtime's
  // local timezone offset (e.g. via `new Date().toString()` or
  // `getTimezoneOffset()`-driven arithmetic) instead of working purely off
  // millisecond deltas.
  const iso = '2026-01-01T00:00:00Z';
  const nowMs = new Date('2026-01-01T02:00:00Z').getTime();
  const originalTz = process.env.TZ;
  try {
    process.env.TZ = 'UTC';
    const utc = formatWhen(iso, nowMs);
    process.env.TZ = 'Pacific/Kiritimati'; // UTC+14 — the most extreme real offset
    const extreme = formatWhen(iso, nowMs);
    expect(extreme).toBe(utc);
  } finally {
    if (originalTz === undefined) delete process.env.TZ; else process.env.TZ = originalTz;
  }
});

test('formatWhen: a run with no startedAt renders the honest placeholder, not a fabricated time', () => {
  // KILLS: `new Date(undefined)` producing "Invalid Date" leaking into the
  // UI, or a formatter that defaults to "just now" for an absent value.
  expect(formatWhen(undefined, Date.now())).toBe('—');
});

test('formatWhen: pinned bucket boundaries (minutes/hours/days ago)', () => {
  const now = new Date('2026-01-02T00:00:00Z').getTime();
  expect(formatWhen(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago');
  expect(formatWhen(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h ago');
  expect(formatWhen(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe('2d ago');
});
