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
 *     | { kind: 'reflection-lost'; cause: string }
 *     | { kind: 'merged' }                                       // ROUND 2, D10 below
 *     | { kind: 'work-items'; done: number; total: number };     // ROUND 2, D10 below
 *
 *   export function renderSegment(seg: LedgerSegment): string;
 *   export function renderNarrative(segments: LedgerSegment[]): string | null;
 *
 *   export type LedgerRow = {
 *     id: string;
 *     when: string;              // raw ISO `run.startedAt`, or '' if absent (D7)
 *     what: string;
 *     narrative: string | null;  // renderNarrative(segments) — D3
 *     narrativeKinds: string[];  // ROUND 3, D11 below — the MACHINE surface:
 *                                // segments.map(s => s.kind), same order as
 *                                // narrative's segments; [] iff narrative===null
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
 *
 *   D10 (ROUND 2 amendment) — the round-1 vocabulary was ALL-EXCEPTIONAL: its
 *     five kinds can only say what went WRONG, so a cleanly merged run (the
 *     outcome an operator most wants summarised) rendered `null` — an empty
 *     headline column for exactly the runs that succeeded. Two POSITIVE
 *     segments close that gap:
 *
 *       - `{kind:'merged'}` -> `'merged'`. Grounded, not decorative: I traced
 *         `_queue/done/` + `_queue/merged/` to their ONE production writer
 *         chain — `terminalMove(..., 'merged')` (orchestrator/phases/
 *         closure.ts:334) fires ONLY after `confirm(...)` (defaults to
 *         `confirmPrMerged`, orchestrator/pr.ts:778) returns true, and
 *         `confirmPrMerged` fails CLOSED (`gh pr view --json state` ==
 *         'MERGED', false on every other outcome including `gh` itself being
 *         absent). `promoteMergedToDone` (orchestrator/queue.ts:143) then
 *         moves merged/ -> done/, with exactly two callers
 *         (finalize-merged.ts:252, flow-runner.ts's execReflect via
 *         phases/closure.ts:145), both themselves gated on that same
 *         confirmed-merge boolean. `run-model.ts`'s
 *         `QUEUE_STATE_TO_RUN_STATUS` maps BOTH `merged` and `done` to
 *         `RunStatus: 'complete'` — no other writer of either directory
 *         exists (grepped; the only other references are recovery/count
 *         READS). So `run.status === 'complete' ⟹ a confirmed remote PR
 *         merge`, independently re-verified this round.
 *       - `{kind:'work-items'; done: number; total: number}` -> `'dev
 *         N/M'`, sourced from `run.workItems` (never re-derived — a plain
 *         count of `status === 'complete'` vs `.length`, not a dollar
 *         re-summation, so this is a different act than the D8 rule it
 *         sits beside). Measured non-fabricated per this campaign's
 *         standing refusal precedent: `orchestrator/run-model.test.ts`'s
 *         `complete-release-definition real fixture` test (a REAL 501-line
 *         archived cycle event log, `orchestrator/run-model.fixtures/
 *         complete-release-definition.events.jsonl`) asserts
 *         `run.workItems?.length === 5` and passes (executed this round,
 *         `node --test --experimental-strip-types orchestrator/
 *         run-model.test.ts`, exit 0) — `deriveWorkItems`
 *         (run-model-derive.ts:432) populates it whenever ANY dev-phase
 *         event carries a `WI-*` `work_item_id`, which every real develop
 *         cycle's PM/dev-loop phases do. Both segments are OMITTED (never
 *         rendered as a zero/empty fact) when their source is empty —
 *         `merged` only when `status === 'complete'`; `work-items` only
 *         when `workItems.length > 0` — the same honest-omit discipline D3
 *         already establishes for the five round-1 kinds.
 *
 *   D11 (ROUND 3 — resolves the joiner ambiguity round 2 correctly probed and
 *     left open, see the EXHAUSTIVE battery's "failed alone with an
 *     arrow-shaped note" fixture below): `gate-waiting`/`failed` segments
 *     embed free text from the run (`run.gateNote`/`run.failNote`) that this
 *     module does not author and cannot constrain — so a note containing the
 *     SAME sequence `renderNarrative` uses to JOIN segments (' → ') makes the
 *     rendered narrative string ambiguous to split back apart. The closed-
 *     vocabulary guarantee (D3) was closed at the segment-KIND level but open
 *     at the note-CONTENT level. Two independent surfaces close it, and every
 *     consumer picks the one it actually needs:
 *
 *       1. MACHINE surface (authoritative) — `LedgerRow.narrativeKinds`
 *          (added to the type above) carries the segment KINDS as closed,
 *          structured data — `segments.map(s => s.kind)`, same order as the
 *          segments that produced `narrative`. Automation, journey beats and
 *          any future DOM consumer (`data-narrative-kinds` on
 *          `HistoryLedger.tsx`, pinned in `./history-ledger-render.test.ts`)
 *          assert on THIS array, never by parsing the rendered human string —
 *          it cannot carry free-typed prose because its elements are always
 *          one of the seven closed `LedgerSegment['kind']` literals, the same
 *          closed union the EXHAUSTIVE type-level test below pins.
 *       2. HUMAN surface — `renderSegment` NEUTRALIZES the joiner sequence
 *          inside a free-text note before interpolating it (the joiner
 *          character sequence, not the note's information, is what gets
 *          defused — see the dedicated sanitization test below, right after
 *          the main renderSegment battery). With that fix, the "arrow-shaped
 *          note" fixture in the EXHAUSTIVE battery passes for the RIGHT
 *          reason — its note no longer contains a piece that can be mistaken
 *          for a segment boundary — and stays a genuine regression lock
 *          rather than something to delete or weaken.
 *
 *     Neither existing test was weakened to reach this: the adversarial
 *     fixture stays, `assertOnlyKnownVocabulary` stays exactly as strict.
 *
 *   COMPILE-TIME-BACKSTOP CAVEAT (discovered round 2, RE-VERIFIED round 3).
 *
 *   PLAIN STATEMENT for the next reader, up front: the "exhaustive switch"
 *   test below is an IN-EDITOR AID ONLY. It is not part of any CI step and
 *   not part of any gate. It type-checks in your editor's TS language service
 *   or a manually-run `tsc`, nowhere else. The RUNTIME half of that same
 *   test — the sample-based equality loop — IS the enforced contract (via
 *   `npm run test:ui`), and only for the samples it already lists. Do not
 *   trust the switch statement's mere existence as proof anything is
 *   actually gated — an unlabelled compile-time "backstop" that no gate runs
 *   is decoration, not protection.
 *
 *   The rest of this note is the evidence trail for that statement. Applies
 *   to BOTH the type-level exhaustiveness test below and the sibling
 *   FIELD-PARITY pin in studio-client.test.ts: `forge-ui/tsconfig.json`
 *   itself excludes
 *   `**\/*.test.ts` (`"exclude": ["node_modules", "**\/*.test.ts"]`,
 *   deliberately, per its own inline comment), and the ROOT `tsconfig.json`'s
 *   `include` never lists `forge-ui/**` at all — so NEITHER `tsc` (root
 *   `npm run build`) NOR `next build` (forge-ui's own build, also part of
 *   `npm run build`) ever type-checks this file. Verified directly this
 *   round: `npx tsc --noEmit -p forge-ui/tsconfig.json` (forge-ui's real,
 *   unmodified config) exits 0 with zero errors despite `flow-ledger.test.ts`
 *   / `history-ledger-render.test.ts` importing modules that do not exist on
 *   disk; re-running with `include` widened to cover test files immediately
 *   surfaces those exact missing-module errors, confirming the EXCLUDE (not
 *   some other cause) is what suppresses them. Net effect: the "exhaustive
 *   switch" / "Required<T> fixture" compile-backstop pattern is a real,
 *   useful signal to a human editing this file locally (an editor's TS
 *   language service, or a manually-run broader `tsc`), but it is NOT a CI
 *   gate in this repo today — CI's `npm run build` step will not fail if a
 *   sixth/eighth `LedgerSegment` member (or a new `Run` field) is added
 *   without updating the fixture here. The RUNTIME half of each such test
 *   (the sample-based equality checks) IS CI-enforced via `npm run test:ui`,
 *   but only for the KNOWN samples each test already lists — it cannot, by
 *   construction, catch a member nobody has added a sample for yet. Flagging
 *   for the coordinator: closing this for real needs a CI step that runs
 *   `tsc` over forge-ui's test files too (out of scope for a test-writer to
 *   add unilaterally — it is a build/CI-config change, not an acceptance
 *   test).
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

test('renderSegment: each of the SEVEN known segment kinds renders its exact, pinned string', () => {
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
  // ROUND 2 (D10) — the two POSITIVE-arc segments (see header). KILLS: a
  // renderer with no case for these two kinds (falls through to `undefined`
  // or throws), and one that fabricates punctuation/casing not pinned here
  // ("Merged.", "MERGED", "dev: 3/3").
  expect(renderSegment({ kind: 'merged' })).toBe('merged');
  expect(renderSegment({ kind: 'work-items', done: 3, total: 3 })).toBe('dev 3/3');
  expect(renderSegment({ kind: 'work-items', done: 1, total: 3 })).toBe('dev 1/3');
});

test('ROUND 3 (D11): renderSegment NEUTRALIZES a joiner sequence (" → ") embedded in a free-text note — the closed-vocabulary guarantee is closed at the CONTENT level, not just per-kind', () => {
  // KILLS: `renderSegment` implementations that interpolate `note` verbatim
  // (e.g. template-literal `` `failed: ${note}` `` with no sanitization) — a
  // note containing the exact sequence `renderNarrative` uses to JOIN
  // segments (' → ') makes the rendered narrative string ambiguous to split
  // back apart into its segments. This is EXACTLY the defect the EXHAUSTIVE
  // battery's "failed alone with an arrow-shaped note" fixture below (label:
  // 'failed alone with an arrow-shaped note (must not be mistaken for a
  // joiner)') exists to catch — a naive interpolator makes that fixture fail,
  // for the right reason (see D11 in the header for the two-surface
  // resolution: this test pins the HUMAN surface half; the MACHINE surface
  // half — `narrativeKinds` — is pinned in `./history-ledger-render.test.ts`).
  //
  // Neutralized to ' - ' (a sequence that can never be mistaken for the
  // narrative's own joiner): the note's INFORMATION survives byte-for-byte
  // apart from the joiner substitution; only the arrow sequence is defused.
  expect(renderSegment({ kind: 'failed', note: 'pipeline → CI step 3 timed out' }))
    .toBe('failed: pipeline - CI step 3 timed out');
  expect(renderSegment({ kind: 'gate-waiting', note: 'blocked → needs review' }))
    .toBe('gated: blocked - needs review');
  // Defense in depth: a note with NO surrounding spaces around the arrow
  // (narrower than the narrative's own ' → ' joiner, but still visually a
  // joiner-shaped character to a reader, and still enough to desynchronize a
  // naive split(' → ') if it happened to land adjacent to other spacing) must
  // not survive into rendered output either — no bare '→' character at all.
  expect(renderSegment({ kind: 'failed', note: 'a→b' })).not.toContain('→');
  // A note with NO arrow at all is untouched — sanitization must not mangle
  // ordinary notes (KILLS an overzealous global replace that corrupts
  // unrelated punctuation, e.g. stripping all hyphens or dashes).
  expect(renderSegment({ kind: 'failed', note: 'CI red on merge' })).toBe('failed: CI red on merge');
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
// SEVEN anchored patterns (five round-1 + two round-2 positive-arc kinds,
// D10) — proving no free-typed/authored prose, no eighth segment kind, and
// no D9 violation can reach the rendered output across this whole battery.
// ---------------------------------------------------------------------------

const VOCAB_PATTERNS: RegExp[] = [
  /^gate failed ×\d+$/,
  /^\d+ findings? \(\d+ blocker, \d+ major\)$/,
  /^gated: .+$/,
  /^failed: .+$/,
  /^reflection lost: .+$/,
  /^merged$/,
  /^dev \d+\/\d+$/,
];

function assertOnlyKnownVocabulary(narrative: string | null, label: string): void {
  if (narrative === null) return; // honest-null is always in-vocabulary
  for (const piece of narrative.split(' → ')) {
    const matched = VOCAB_PATTERNS.some((re) => re.test(piece));
    expect(matched, `[${label}] segment "${piece}" matched NO known vocabulary pattern`).toBe(true);
  }
}

// ROUND 3 (D11) NOTE on the 'failed alone with an arrow-shaped note' fixture
// below: round 2 correctly identified that this fixture FAILS against any
// implementation that interpolates `note` raw — `renderSegment` would yield
// "failed: pipeline → CI step 3 timed out", which `assertOnlyKnownVocabulary`
// splits on ' → ' into ["failed: pipeline", "CI step 3 timed out"], and the
// second piece matches no VOCAB_PATTERN. That finding was correctly reported
// rather than silently fixed. KILLS (this round): the fixture is deliberately
// left UNCHANGED and `assertOnlyKnownVocabulary` is deliberately left exactly
// as strict — resolving this by deleting the fixture or loosening the
// assertion would discard the finding. The actual fix lives in
// `renderSegment` itself (pinned by the dedicated sanitization test right
// after the main renderSegment battery, above): the joiner sequence inside a
// free-text note is neutralized before interpolation, so THIS fixture now
// passes for the RIGHT reason (its note no longer contains an unescaped
// joiner) and becomes a genuine regression lock against a future
// implementation that forgets to sanitize.
test('EXHAUSTIVE: every segment kind produced across a wide battery of fixtures matches the closed vocabulary — no free-typed prose can leak through', () => {
  const battery: Array<{ label: string; segments: LedgerSegment[] }> = [
    { label: 'all seven at once (worst case)', segments: [
      { kind: 'work-items', done: 2, total: 3 },
      { kind: 'gate-fails', count: 5 },
      { kind: 'review-findings', total: 9, blocker: 2, major: 3, minor: 4, info: 0 },
      { kind: 'gate-waiting', note: 'comment unresolved' },
      { kind: 'failed', note: 'scope violation' },
      { kind: 'merged' },
      { kind: 'reflection-lost', cause: 'budget-exhausted' },
    ] },
    { label: 'gate-fails alone, count 1', segments: [{ kind: 'gate-fails', count: 1 }] },
    { label: 'review-findings alone, all zero severities except total', segments: [{ kind: 'review-findings', total: 1, blocker: 0, major: 0, minor: 0, info: 1 }] },
    { label: 'gate-waiting alone with punctuation in the note', segments: [{ kind: 'gate-waiting', note: 'AC-2 not met; awaiting fix' }] },
    { label: 'failed alone with an arrow-shaped note (must not be mistaken for a joiner)', segments: [{ kind: 'failed', note: 'pipeline → CI step 3 timed out' }] },
    { label: 'reflection-lost alone', segments: [{ kind: 'reflection-lost', cause: 'interrupted' }] },
    // ROUND 2 (D10) — the two positive-arc kinds, standalone.
    { label: 'merged alone', segments: [{ kind: 'merged' }] },
    { label: 'work-items alone, all done', segments: [{ kind: 'work-items', done: 3, total: 3 }] },
    { label: 'work-items alone, partial progress (an in-flight run)', segments: [{ kind: 'work-items', done: 1, total: 3 }] },
    { label: 'the headline round-2 arc: dev fan-out then merged, nothing exceptional', segments: [{ kind: 'work-items', done: 3, total: 3 }, { kind: 'merged' }] },
    { label: 'empty (nothing to say)', segments: [] },
  ];

  for (const { label, segments } of battery) {
    assertOnlyKnownVocabulary(renderNarrative(segments), label);
  }
});

test('EXHAUSTIVE (type level): LedgerSegment has EXACTLY seven members — this file fails to typecheck if an eighth is added without updating this pin', () => {
  // PLAIN STATEMENT (round 3, re-verified — see the header's
  // "COMPILE-TIME-BACKSTOP CAVEAT" for the full evidence trail): this switch
  // is an IN-EDITOR AID ONLY, not a CI gate, not any gate. Only the RUNTIME
  // loop at the bottom of this test is actually enforced. Read on for why.
  //
  // A compile-time backstop to the runtime battery above: TypeScript's
  // exhaustiveness checking means the `default` branch below only typechecks
  // if `seg` has been narrowed to `never` — i.e. every LedgerSegment member
  // was handled by an EARLIER case. Adding an eighth variant to the real
  // union without updating this switch makes `assertNever`'s argument type
  // mismatch — a real error an editor's TS language service (or a manually
  // run `tsc`) surfaces immediately. CAVEAT (measured this round, see the
  // header's "COMPILE-TIME-BACKSTOP CAVEAT"): this does NOT actually fail
  // `npm run build` in THIS repo's CI — `forge-ui/tsconfig.json` excludes
  // `**/*.test.ts` from its own `include`, and the root `tsconfig.json`
  // never lists `forge-ui/**`, so no CI step ever runs `tsc` over this file.
  // Only the RUNTIME half below (which vitest DOES run in CI, `npm run
  // test:ui`) is actually enforced — and, honestly, only for the samples
  // listed, which is why round 2 adds the two new kinds to the `samples`
  // array below rather than leaving them compile-only.
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
      case 'merged': return renderSegment(seg);
      case 'work-items': return renderSegment(seg);
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
    { kind: 'merged' },
    { kind: 'work-items', done: 2, total: 3 },
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
