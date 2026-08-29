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
 *     `'attention'` status (recorded in docs/reference/studio-copy.md) has
 *     NO producer anywhere in this repo and must never appear.
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
  ledgerRowKind,
  // W7-B1 (home-sessions-33) — resolves to `undefined` until history-ledger
  // ships it (the repo's missing-named-export convention), so only the new
  // tests that CALL it go red.
  sessionPhaseRunStatus,
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

// ---------------------------------------------------------------------------
// R6-06 (D6/D7) — the segment vocabulary EXTENDS additively: an EIGHTH
// member, {kind:'standalone'}. A standalone worker dispatch (R6-06's own
// execution path — cli/ui-bridge-agent-history.test.ts) carries no run-level
// facts to narrate (no work-items/gate-fails/review-findings/merged/etc — it
// isn't a flow run at all), so this is a bare, context-free POSITIVE marker
// the mockup puts in the row's free-text `sub` column, per D7 — never a
// bespoke badge (no view file renders one for it). Lowercase, no
// punctuation, matching the established style of the other positive-arc
// kind ('merged').
// ---------------------------------------------------------------------------

test("R6-06 D6/D7: renderSegment renders the EIGHTH segment kind, {kind:'standalone'}, as the exact literal string 'standalone'", () => {
  // KILLS: the CURRENT implementation's `default` branch (history-ledger.ts's
  // `renderSegment`, `const exhaustive: never = seg; return exhaustive;`) —
  // called with a kind the switch doesn't recognise, this literally returns
  // the raw segment OBJECT, not a string, so `.toBe('standalone')` fails for
  // the right reason against HEAD. Cast needed because the current
  // `LedgerSegment` type doesn't include this member yet (D6: adding a
  // member requires updating the type — an implementer's job, not this
  // test's; the cast lets this file pin the RUNTIME contract ahead of the
  // type update, same technique flow-ledger.test.ts already uses for
  // `run.trigger` before its type existed).
  expect(renderSegment({ kind: 'standalone' } as LedgerSegment)).toBe('standalone');
});

// ---------------------------------------------------------------------------
// R6-06 ROUND 2 — the vocabulary widens AGAIN: a NINTH member,
// {kind:'in-flow'; flowId}, and a TENTH, {kind:'node-errors'; count}.
//
// Round 1 measured (correctly) that none of the ORIGINAL seven kinds has a
// legitimate source in a generic flow-NODE's own `RunPhaseMeta`, and
// concluded a generic node's narrative stays `null` forever. The
// measurement was right; the conclusion was incomplete — it left the
// ledger's headline outcome column blank for exactly the rows an operator
// most wants summarised (see `agent-ledger.test.ts`'s corrected header for
// the full re-measurement). Two more facts ARE honestly available from a
// flow-node row's own data, independent of which node it is:
//
//   - `in-flow` — every flow-node row's own `run.flowId`, always present
//     (`Run.flowId: string`, non-optional — `studio-client.ts:55`) — the
//     mockup's own opening beat for an agent-history row was literally "in
//     forge-develop · …" (recorded in docs/reference/studio-copy.md as
//     `AGENT_HISTORY.developer`). Lowercase 'in', matching this file's own
//     established lowercase-no-punctuation style for positive-arc kinds
//     ('merged', 'standalone') rather than the mockup's literal "STANDALONE"
//     caps (already deliberately not carried over for 'standalone' either).
//   - `node-errors` — a NON-`dev` node's own `retries` (an `error`-typed
//     event count — `run-model-derive.ts:161-163`), when > 0. The rule that
//     `retries` is a GATE signal only on the `dev` node (D9) forbids calling
//     this a *gate* outcome; it does not forbid calling it what it actually
//     is — a real, counted fact about that node's own execution. Explicitly
//     NEVER emitted for `dev` (gate-fails owns that number there — the
//     positive-control tests below pin the two kinds as mutually exclusive
//     by node, not just independently truthy).
// ---------------------------------------------------------------------------

test("R6-06 ROUND 2: renderSegment renders the NINTH segment kind, {kind:'in-flow', flowId}, as 'in <flowId>' — the mockup's own opening beat for an agent-history row (AGENT_HISTORY.developer's 'in forge-develop · …')", () => {
  // KILLS: the `default` branch returning the raw object (same mechanism as
  // the 'standalone' test above) — legitimate RED against HEAD, which has
  // neither this kind nor a case for it.
  expect(renderSegment({ kind: 'in-flow', flowId: 'forge-architect' } as LedgerSegment)).toBe('in forge-architect');
  expect(renderSegment({ kind: 'in-flow', flowId: 'forge-develop' } as LedgerSegment)).toBe('in forge-develop');
});

test("R6-06 ROUND 2: renderSegment renders the TENTH segment kind, {kind:'node-errors', count}, as 'errored ×N' — NEVER the word 'gate' (that vocabulary is gate-fails' alone, D9)", () => {
  expect(renderSegment({ kind: 'node-errors', count: 2 } as LedgerSegment)).toBe('errored ×2');
  expect(renderSegment({ kind: 'node-errors', count: 1 } as LedgerSegment)).toBe('errored ×1');
  // Never the gate-fails wording — a node-errors segment describing the SAME
  // shape of fact (a retry count) as gate-fails must render with visibly
  // DIFFERENT text, since D9 forbids calling a non-dev node's error count a
  // gate outcome. Guards against a copy-paste that reuses gate-fails' exact
  // string for the new kind.
  expect(renderSegment({ kind: 'node-errors', count: 2 } as LedgerSegment)).not.toBe(renderSegment({ kind: 'gate-fails', count: 2 }));
  expect(renderSegment({ kind: 'node-errors', count: 2 } as LedgerSegment)).not.toContain('gate');
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

test('ROUND 5: renderSegment NEUTRALIZES the joiner sequence in reflection-lost\'s `cause` too — the same free-text field as gate-waiting/failed, left unguarded by ROUND 3', () => {
  // KILLS: the CURRENT implementation (history-ledger.ts:72-76) — `case
  // 'reflection-lost': return \`reflection lost: ${seg.cause}\`;` —
  // interpolates `seg.cause` RAW, unlike its two siblings just above
  // (`gate-waiting`/`failed`, both call `neutralizeJoiner(seg.note)` first).
  // This is the campaign's "the fix ships its own instance of the defect it
  // closed" class: D11 (ROUND 3, see the test just above this one and the
  // header) closed the joiner-ambiguity hole for exactly TWO of the THREE
  // free-text-bearing segment kinds and never extended it to
  // `reflection-lost`. The `assertOnlyKnownVocabulary` battery below was
  // built precisely to catch this class, but until this round had no
  // `reflection-lost` fixture containing an arrow, so it missed this
  // instance — see the battery addition below.
  //
  // FALLBACK CHOSEN: identical to `gate-waiting`/`failed` — the same
  // `neutralizeJoiner` (history-ledger.ts:48-50, `note.split('→').join('-')`)
  // applied to `seg.cause`, so 'crash → retry loop' becomes
  // 'crash - retry loop', matching the ROUND 3 test's own expected values
  // above byte-for-byte in style.
  //
  // REACHABILITY (honest): NOT wire-reachable today. Every real
  // `reflection-lost` cause is one of a fixed short label set (`crash`,
  // `interrupted`, `manifest-unreadable`, `budget-exhausted`, `max-turns`,
  // `error`, `brain-gate-failed`) — none contain '→'. Fixed anyway because
  // this module is the declared SHARED SEAM the next initiative (R6-06)
  // reuses against a different data source (module header, lines 1-15), and
  // a module whose docstring's closed-vocabulary promise (D11) silently
  // covers two of three free-text kinds is exactly the kind of latent gap
  // this campaign keeps paying for once real data diverges from today's
  // fixed labels.
  expect(renderSegment({ kind: 'reflection-lost', cause: 'crash → retry loop' }))
    .toBe('reflection lost: crash - retry loop');
});

test('ROUND 5: renderNarrative — reflection-lost with an arrow-shaped cause must not desynchronize a narrative into a THIRD piece', () => {
  // KILLS: same root cause as the test above, demonstrated at the
  // `renderNarrative` level exactly as the adversarial review reproduced
  // it. A 2-segment narrative (work-items, reflection-lost) whose cause
  // contains ' → ' currently renders as
  // "dev 1/2 → reflection lost: crash → retry loop", which splits on the
  // narrative's own joiner (' → ') into THREE pieces
  // (['dev 1/2', 'reflection lost: crash', 'retry loop']) instead of two —
  // the exact ambiguity D11 exists to prevent, reproduced live against the
  // CURRENT implementation (confirmed via direct execution before writing
  // this test).
  // REACHABILITY: same honest caveat as the test above — not reachable via
  // the one real caller today; fixed because this is the shared seam.
  const narrative = renderNarrative([
    { kind: 'work-items', done: 1, total: 2 },
    { kind: 'reflection-lost', cause: 'crash → retry loop' },
  ]);
  expect(narrative).toBe('dev 1/2 → reflection lost: crash - retry loop');
  expect(narrative?.split(' → ')).toHaveLength(2);
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
  // R6-06 (D6/D7) — the eighth kind. See the dedicated test above.
  /^standalone$/,
  // R6-06 ROUND 2 — the ninth and tenth kinds. See the dedicated tests above.
  /^in [a-z0-9-]+$/,
  /^errored ×\d+$/,
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
    // ROUND 5 — closes the exact gap named in this battery's own header
    // comment ("the closed-vocabulary mechanism actually covers the kind it
    // currently misses"): the ORIGINAL battery had a 'failed alone with an
    // arrow-shaped note' fixture (above) and a 'gate-waiting' one (D11,
    // ROUND 3), but never one for `reflection-lost` — the THIRD free-text-
    // bearing kind. See the dedicated renderSegment/renderNarrative tests
    // above for the full KILLS detail; this entry is what makes THIS
    // EXHAUSTIVE test itself (not just the dedicated tests) fail against the
    // unguarded implementation, the same way the pre-existing 'failed'
    // fixture already does for its own kind.
    { label: 'ROUND 5: reflection-lost alone with an arrow-shaped cause (must not be mistaken for a joiner)', segments: [{ kind: 'reflection-lost', cause: 'crash → retry loop' }] },
    // ROUND 2 (D10) — the two positive-arc kinds, standalone.
    { label: 'merged alone', segments: [{ kind: 'merged' }] },
    { label: 'work-items alone, all done', segments: [{ kind: 'work-items', done: 3, total: 3 }] },
    { label: 'work-items alone, partial progress (an in-flight run)', segments: [{ kind: 'work-items', done: 1, total: 3 }] },
    { label: 'the headline round-2 arc: dev fan-out then merged, nothing exceptional', segments: [{ kind: 'work-items', done: 3, total: 3 }, { kind: 'merged' }] },
    { label: 'empty (nothing to say)', segments: [] },
    // R6-06 (D6/D7) — the eighth kind. Pinned ALONE only, deliberately: a
    // standalone worker dispatch is not a flow run at all, so it can never
    // ALSO carry a work-items/gate-fails/review-findings/merged/
    // reflection-lost fact (those are all flow-run-scoped, per
    // flow-ledger.ts's own derivation) — combining {kind:'standalone'} with
    // any other kind in one fixture would teach an implementer a combination
    // that can never occur in production, exactly the "fixture that could
    // never exist" this campaign has already refused elsewhere (see
    // flow-ledger.test.ts's own "ONE COMBINATION IN THE BRIEF CANNOT
    // ACTUALLY OCCUR" note for the established precedent this mirrors).
    { label: 'R6-06: standalone alone', segments: [{ kind: 'standalone' }] as LedgerSegment[] },
    // R6-06 ROUND 2 — the ninth/tenth kinds, `agent-ledger.ts`'s own
    // per-NODE derivation (`deriveAgentNodeLedgerSegments`). These CAN
    // co-occur with each other (unlike 'standalone', which never co-occurs
    // with anything) because a single flow-node row's own segments are
    // `in-flow` (always) plus AT MOST ONE of {gate-fails (dev only),
    // node-errors (every other node)} plus review-findings
    // (adversarial-review only, independent of retries) — see
    // `agent-ledger.test.ts` for the full per-node derivation contract this
    // vocabulary-level battery only needs to prove RENDERS, not derives.
    { label: 'R6-06 ROUND 2: in-flow alone (a generic node, nothing else to report)', segments: [{ kind: 'in-flow', flowId: 'forge-architect' }] as LedgerSegment[] },
    { label: 'R6-06 ROUND 2: in-flow + gate-fails (the dev node, inside a flow)', segments: [{ kind: 'in-flow', flowId: 'forge-develop' }, { kind: 'gate-fails', count: 2 }] as LedgerSegment[] },
    { label: 'R6-06 ROUND 2: in-flow + node-errors (a non-dev node with error retries)', segments: [{ kind: 'in-flow', flowId: 'forge-architect' }, { kind: 'node-errors', count: 3 }] as LedgerSegment[] },
    { label: 'R6-06 ROUND 2: in-flow + review-findings (adversarial-review, no retries)', segments: [{ kind: 'in-flow', flowId: 'forge-develop' }, { kind: 'review-findings', total: 2, blocker: 0, major: 1, minor: 1, info: 0 }] as LedgerSegment[] },
    { label: 'R6-06 ROUND 2: in-flow + node-errors + review-findings (adversarial-review with BOTH retries AND findings — the canonical-order case)', segments: [{ kind: 'in-flow', flowId: 'forge-develop' }, { kind: 'node-errors', count: 1 }, { kind: 'review-findings', total: 2, blocker: 0, major: 1, minor: 1, info: 0 }] as LedgerSegment[] },
  ];

  for (const { label, segments } of battery) {
    assertOnlyKnownVocabulary(renderNarrative(segments), label);
  }
});

test('EXHAUSTIVE (type level): LedgerSegment has EXACTLY TEN members (R6-06 D6/D7 added "standalone"; R6-06 ROUND 2 added "in-flow"/"node-errors") — this file fails to typecheck if an eleventh is added without updating this pin', () => {
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
      // R6-06 (D6/D7) — the eighth member.
      case 'standalone': return renderSegment(seg);
      // R6-06 ROUND 2 — the ninth and tenth members.
      case 'in-flow': return renderSegment(seg);
      case 'node-errors': return renderSegment(seg);
      default: return assertNever(seg);
    }
  }
  // Runtime half — HONEST CAVEAT (re-verified this round): because every
  // case above does nothing but forward to the real `renderSegment`, this
  // loop's `.toBe()` comparison is calling the SAME function with the SAME
  // input on both sides — it is a tautology for whatever `renderSegment`
  // currently returns, string or not (a pure function called twice with the
  // same argument returns the same value by construction). Its actual
  // signal is narrower than the comment above ("agrees with the real
  // renderSegment") implies: what it REALLY proves is that `exhaustiveRender`
  // does not fall through to the `default: assertNever(seg)` throw for any
  // listed sample — i.e. this TEST FILE's own switch has a case for every
  // kind in `samples`. Kept exactly as the prior rounds authored it
  // (unchanged pattern, only extended) rather than silently strengthened,
  // per this campaign's discipline against modifying an existing pinned
  // test's assertion shape while "just adding a case" — the type-level
  // exhaustiveness check above (in-editor only, not gate-enforced — see the
  // header's CAVEAT) remains the real reason this test exists.
  const samples: LedgerSegment[] = [
    { kind: 'gate-fails', count: 1 },
    { kind: 'review-findings', total: 1, blocker: 0, major: 0, minor: 1, info: 0 },
    { kind: 'gate-waiting', note: 'x' },
    { kind: 'failed', note: 'x' },
    { kind: 'reflection-lost', cause: 'crash' },
    { kind: 'merged' },
    { kind: 'work-items', done: 2, total: 3 },
    // R6-06 (D6/D7) — the eighth member. Cast needed until the real
    // LedgerSegment type union is updated (same reasoning as the dedicated
    // renderSegment test above).
    { kind: 'standalone' } as LedgerSegment,
    // R6-06 ROUND 2 — the ninth and tenth members. Same cast-until-typed
    // reasoning.
    { kind: 'in-flow', flowId: 'forge-architect' } as LedgerSegment,
    { kind: 'node-errors', count: 2 } as LedgerSegment,
  ];
  for (const s of samples) {
    expect(exhaustiveRender(s)).toBe(renderSegment(s));
  }
});

// ---------------------------------------------------------------------------
// R6-06 (D8/D12) — NOTE, not a test: `LedgerRow` gains two OPTIONAL fields
// (`linkKind?: 'flow-node' | 'standalone' | 'session'`, `trigger?: {kind,
// source, scope}`) and `status` WIDENS from `RunStatus` alone to a closed
// union of THREE vocabularies (RunStatus | RunPhaseStatus |
// 'running'|'done'|'failed'|'suppressed'|'budget-exceeded' | string — a
// session's own status.json phase). None of that changes any function in
// THIS file's behaviour (`renderNarrative`/`sortLedgerRowsNewestFirst`/
// `formatWhen` never read `.status`/`.linkKind`/`.trigger` at all — they are
// generic over the ROW SHAPE, per D2's original "surface-agnostic" design),
// so there is nothing new to pin here at the runtime level. The BEHAVIOURAL
// pins for these fields live where they are actually produced/consumed:
//   - `agent-ledger.test.ts` — linkKind/trigger/widened-status VALUES
//     (deriveAgentLedgerRows, the new R6-06 caller).
//   - `flow-ledger.test.ts` — trigger attachment on the EXISTING caller
//     (D8: "trigger attachment on BOTH ledgers") + the byte-identical-when-
//     absent regression lock.
//   - `history-ledger-render.test.ts` — HistoryLedger.tsx's new conditional
//     `data-*` attributes for linkKind/trigger, and the SAME byte-identical-
//     when-absent pin at the DOM layer.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// sortLedgerRowsNewestFirst — pure, immutable, missing-`when` handling
// ---------------------------------------------------------------------------

function row(over: Partial<LedgerRow> = {}): LedgerRow {
  return {
    id: 'r-1',
    when: '2026-01-01T00:00:00Z',
    what: 'probe',
    narrative: null,
    narrativeKinds: [],
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

test('ROUND 5: sortLedgerRowsNewestFirst — a MALFORMED (non-empty, unparsable) `when` sorts LAST too, not just an empty string', () => {
  // KILLS: the CURRENT implementation (history-ledger.ts:136-137) — `const
  // aMs = a.when ? new Date(a.when).getTime() : null;` — only special-cases
  // the EMPTY string. A truthy-but-unparsable string ('garbage') does NOT
  // take the `: null` branch, so `new Date('garbage').getTime()` (NaN)
  // flows straight into the `bMs - aMs` comparator. This is the EXACT bug
  // the function's own docstring (history-ledger.ts:130-132, "A row with no
  // `when` ... sorts LAST, never first ... could land an unstarted run at
  // the top of 'most recent' history") promises never happens — reproduced
  // directly by running this exact `[...rows].sort()` call against this
  // repo's Node runtime before writing this test: the malformed row lands
  // FIRST, not last.
  // FALLBACK CHOSEN: same as the empty-string case immediately above (and
  // pinned by the sibling test right above this one) — an unparsable `when`
  // is treated as `null` and sorted LAST, matching the docstring's own
  // stated contract rather than inventing a new rule.
  // REACHABILITY (honest): NOT wire-reachable today — the only caller
  // (flow-ledger.ts) feeds `run.startedAt ?? ''`, whose sole producer is
  // `new Date().toISOString()`, always either empty or parseable. Fixed
  // anyway because this module is the declared SHARED SEAM the next
  // initiative (R6-06) reuses against a different data source, and a
  // docstring that lies about its own contract is exactly what this
  // campaign keeps paying for.
  const rows = [
    row({ id: 'bad', when: 'garbage' }),
    row({ id: 'old', when: '2020-01-01T00:00:00Z' }),
    row({ id: 'new', when: '2026-08-07T00:00:00Z' }),
  ];
  expect(sortLedgerRowsNewestFirst(rows).map((r) => r.id)).toEqual(['new', 'old', 'bad']);
});

test('ROUND 5: sortLedgerRowsNewestFirst — a WHITESPACE-ONLY `when` (e.g. \' \') is a THIRD instance of the same root cause and also sorts LAST', () => {
  // KILLS: the same root cause as the malformed-`when` test above, via a
  // different value shape — a whitespace-only string is TRUTHY in
  // JavaScript (`'   ' ? x : y` takes the truthy branch), so it bypasses
  // the `: null` guard exactly like 'garbage' does, and
  // `new Date('   ').getTime()` is also NaN. Verified directly (not
  // assumed): reproducing this file's exact sort call with a 3-row fixture
  // shaped identically to the malformed-`when` repro above lands the
  // whitespace row FIRST — this is not a hypothetical extrapolation, it
  // reproduces the identical front-of-list placement.
  // REACHABILITY: same honest caveat as the test above — not reachable via
  // the one real caller today; fixed because this is the shared seam.
  const rows = [
    row({ id: 'ws', when: '   ' }),
    row({ id: 'old', when: '2020-01-01T00:00:00Z' }),
    row({ id: 'new', when: '2026-08-07T00:00:00Z' }),
  ];
  expect(sortLedgerRowsNewestFirst(rows).map((r) => r.id)).toEqual(['new', 'old', 'ws']);
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

test('ROUND 5: formatWhen — an unparsable (non-empty) `iso` returns the SAME honest placeholder as an absent one, never a fabricated "NaNd ago"', () => {
  // KILLS: the CURRENT implementation (history-ledger.ts:161) — `if (!iso)
  // return '—';` — which only special-cases the falsy (empty-string/
  // undefined) case. A non-empty but unparsable ISO string flows straight
  // past that guard into `new Date(iso).getTime()` (NaN), and NaN
  // propagates through the minute/hour/day bucket arithmetic
  // (history-ledger.ts:163-169) to print the literal string "NaNd ago" —
  // reproduced directly against this exact function body before writing
  // this test. This is precisely the "Invalid Date leak" the function's own
  // docstring (history-ledger.ts:156-158, "never a fabricated time or an
  // `Invalid Date` leak") promises never happens.
  // FALLBACK CHOSEN: '—' — the SAME sentinel this function already returns
  // for the falsy/absent case (history-ledger.ts:161, and pinned by the
  // "honest placeholder" test above), read directly from the existing
  // source rather than inventing a new one.
  // REACHABILITY (honest): NOT wire-reachable today — the only caller feeds
  // `run.startedAt ?? ''`, whose sole producer is `new
  // Date().toISOString()`. Fixed anyway because this module is the declared
  // shared seam R6-06 reuses, and the docstring must not lie about its own
  // contract.
  const now = Date.now();
  expect(formatWhen('not-a-date', now)).toBe('—');
});

test('ROUND 5: formatWhen — a WHITESPACE-ONLY `iso` is a THIRD instance of the same root cause and also returns \'—\'', () => {
  // KILLS: same root cause as the test above — '   ' is truthy so bypasses
  // `if (!iso)`, and `new Date('   ').getTime()` is also NaN, producing the
  // same fabricated "NaNd ago". Verified directly before writing this test.
  const now = Date.now();
  expect(formatWhen('   ', now)).toBe('—');
});

// ---------------------------------------------------------------------------
// W6-IA-4: ledgerRowKind — the Home merged-ledger "kind chip" (flow|agent)
// ---------------------------------------------------------------------------

test('ledgerRowKind: linkKind undefined (every flow-ledger.ts row) is "flow"', () => {
  expect(ledgerRowKind({ linkKind: undefined })).toBe('flow');
});

test('ledgerRowKind: every agent-sourced linkKind ("flow-node", "standalone", "session") is "agent" — none of them a flow-level row', () => {
  expect(ledgerRowKind({ linkKind: 'flow-node' })).toBe('agent');
  expect(ledgerRowKind({ linkKind: 'standalone' })).toBe('agent');
  expect(ledgerRowKind({ linkKind: 'session' })).toBe('agent');
});

// ---------------------------------------------------------------------------
// W7-B1 (home-sessions-33) — sessionPhaseRunStatus: the ONE session-phase →
// run-vocabulary map for data-run-status. The row's own `status` keeps the
// raw phase (D12's open-vocabulary design is untouched); only the DOM
// attribute goes through this map, in HistoryLedger.
// ---------------------------------------------------------------------------

test('W7-B1 sessionPhaseRunStatus: done-terminal phases -> "complete" (the same set describeLifecycle\'s terminal copy calls Done; "applying" — kb-cleanup\'s yaml terminal — included, review round 1)', () => {
  for (const phase of ['committed', 'locked', 'applying', 'applied', 'complete']) {
    expect(sessionPhaseRunStatus(phase), phase).toBe('complete');
  }
});

test('W7-B1 review round 1 — yaml parity pin: EVERY `step: terminal` phase in the REAL studio/session-kinds.yaml (plus the universal "cancelled") maps to complete|failed, never a forever-"active" row for a finished session', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const yamlPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'studio', 'session-kinds.yaml');
  const src = readFileSync(yamlPath, 'utf8');
  const terminalPhases = new Set<string>(['cancelled']);
  for (const m of src.matchAll(/-\s*\{\s*phase:\s*([A-Za-z0-9-]+)\s*,\s*step:\s*terminal\b/g)) {
    terminalPhases.add(m[1]);
  }
  // Sanity: the scanner found a plausible set (8+ distinct terminal tokens
  // today) — a yaml shape change that breaks the scanner fails HERE.
  expect(terminalPhases.size).toBeGreaterThanOrEqual(8);
  for (const phase of terminalPhases) {
    expect(['complete', 'failed'], `terminal phase "${phase}" must map off "active"`).toContain(sessionPhaseRunStatus(phase));
  }
});

test('W7-B1 sessionPhaseRunStatus: stopped-terminal phases -> "failed"', () => {
  for (const phase of ['rejected', 'abandoned', 'cancelled', 'failed']) {
    expect(sessionPhaseRunStatus(phase), phase).toBe('failed');
  }
});

test('W7-B1 sessionPhaseRunStatus: any other phase (gathering/drafting/awaiting-verdict/a future runner\'s token) -> "active" — in flight as far as this surface can honestly tell', () => {
  for (const phase of ['gathering', 'drafting', 'exploring', 'generating', 'awaiting-verdict', 'some-future-phase']) {
    expect(sessionPhaseRunStatus(phase), phase).toBe('active');
  }
});
