/**
 * Shared run-history ledger engine (R6-05 Task 3, D2).
 *
 * SURFACE-AGNOSTIC ON PURPOSE: this module owns the row vocabulary — `when ·
 * what · outcome-narrative · status · cost` — shared by R6-05's flow-monitor
 * ledger and R6-06's (next initiative) agent-monitor ledger. It contains
 * NOTHING flow-specific (D2): no knowledge of `Run.phaseMeta`, no href
 * construction, no flow topology. `./flow-ledger.ts` is the FIRST caller,
 * turning a flow's `Run[]` into `LedgerRow[]`; R6-06 will add a second
 * caller for agent runs, reusing every export here unchanged. `href` is
 * always computed by the CALLER (D2, the reuse seam) so a different surface
 * can point rows at a different destination without touching this file.
 *
 * See `./history-ledger.test.ts` for the full acceptance contract.
 */

import type { RunPhaseStatus, RunStatus } from './studio-client';

// ---------------------------------------------------------------------------
// LedgerSegment — the closed, seven-member outcome-narrative vocabulary (D3)
// ---------------------------------------------------------------------------

/**
 * A single fact in a run's outcome narrative. CLOSED union — exactly TEN
 * members (D3; widened from seven by R6-06 D6/D7 + R6-06 ROUND 2 — see
 * `./history-ledger.test.ts`'s EXHAUSTIVE type-level pin, which fails to
 * typecheck if an eleventh member is added without updating it there).
 * Segment ORDER (produced by a caller's derivation, e.g.
 * `./flow-ledger.ts`'s `deriveFlowLedgerSegments` for the run-level five, or
 * `./agent-ledger.ts`'s `deriveAgentNodeLedgerSegments` for the per-NODE
 * three) is the run's own chronology: work-items → gate-fails →
 * review-findings → gate-waiting|failed → merged → reflection-lost (run
 * level); in-flow → gate-fails|node-errors → review-findings (node level).
 */
export type LedgerSegment =
  | { kind: 'work-items'; done: number; total: number }
  /** dev node ONLY — D9. Never derived from any other node's `retries`. */
  | { kind: 'gate-fails'; count: number }
  | { kind: 'review-findings'; total: number; blocker: number; major: number; minor: number; info: number }
  | { kind: 'gate-waiting'; note: string }
  | { kind: 'failed'; note: string }
  | { kind: 'merged' }
  | { kind: 'reflection-lost'; cause: string }
  /** R6-06 D6/D7 — a standalone (non-flow) worker dispatch. Bare, context-
   *  free positive marker; never combined with any run-level kind above
   *  (a standalone dispatch is not a flow run at all). */
  | { kind: 'standalone' }
  /** R6-06 ROUND 2 — every flow-node row's own `run.flowId` (a fact about
   *  the ROW, not `phaseMeta[nodeId]` — always populated for a flow-node
   *  row, independent of that node's own execution facts). */
  | { kind: 'in-flow'; flowId: string }
  /** R6-06 ROUND 2 — a NON-`dev` node's own `retries` (an `error`-typed
   *  event count, D9's sibling rule). NEVER emitted for the `dev` node,
   *  where `gate-fails` owns that number. */
  | { kind: 'node-errors'; count: number };

/** The narrative's own joiner sequence — also the sequence `renderSegment`
 *  must neutralize inside any free-text note it interpolates (D11). */
const NARRATIVE_JOINER = ' → ';

/** Defuse the narrative's own joiner character out of caller-supplied free
 *  text (D11) — the note's INFORMATION survives byte-for-byte, only the
 *  arrow character itself is replaced, so a note can never be mistaken for a
 *  segment boundary when the rendered narrative is split back apart. */
function neutralizeJoiner(note: string): string {
  return note.split('→').join('-');
}

/**
 * Render one segment to its exact, pinned human-readable string. The
 * closed-vocabulary guarantee (D3) is closed at the CONTENT level too
 * (D11): `gate-waiting`/`failed` notes are free text this module does not
 * author, so the joiner sequence is neutralized before interpolation.
 */
export function renderSegment(seg: LedgerSegment): string {
  switch (seg.kind) {
    case 'work-items':
      return `dev ${seg.done}/${seg.total}`;
    case 'gate-fails':
      return `gate failed ×${seg.count}`;
    case 'review-findings':
      return `${seg.total} finding${seg.total === 1 ? '' : 's'} (${seg.blocker} blocker, ${seg.major} major)`;
    case 'gate-waiting':
      return `gated: ${neutralizeJoiner(seg.note)}`;
    case 'failed':
      return `failed: ${neutralizeJoiner(seg.note)}`;
    case 'merged':
      return 'merged';
    case 'reflection-lost':
      // Mirrors RunRail.tsx:304's existing "reflection lost: {cause}" wording
      // verbatim — a second phrasing for the same fact would be vocabulary
      // drift D3 forbids. `cause` is free text this module does not author
      // (same as `gate-waiting`/`failed`'s `note`), so it is neutralized
      // before interpolation too (D11, ROUND 5) — the joiner sequence must
      // never appear inside a segment's own content, or a narrative split
      // back apart by " → " desynchronizes into an extra, spurious piece.
      return `reflection lost: ${neutralizeJoiner(seg.cause)}`;
    // R6-06 D6/D7 — a bare, context-free positive marker. No free text to
    // neutralize (nothing but a fixed literal).
    case 'standalone':
      return 'standalone';
    // R6-06 ROUND 2 — `flowId` is a caller-controlled identifier (a flow
    // definition's own `id`, e.g. 'forge-develop'), never run-supplied free
    // text, so no neutralization applies (same reasoning as 'merged').
    case 'in-flow':
      return `in ${seg.flowId}`;
    // R6-06 ROUND 2 — deliberately DIFFERENT wording from `gate-fails`
    // ('gate failed ×N'): D9 forbids calling a non-dev node's error count a
    // gate outcome, so the rendered text must never contain the word 'gate'.
    case 'node-errors':
      return `errored ×${seg.count}`;
    default: {
      const exhaustive: never = seg;
      return exhaustive;
    }
  }
}

/**
 * Compose the full narrative string from a caller-ordered segment list.
 * Joins with " → " in the ARRAY order given — never re-sorted. Nothing true
 * to say (`[]`) renders `null`, never an empty string or invented filler.
 */
export function renderNarrative(segments: LedgerSegment[]): string | null {
  if (segments.length === 0) return null;
  return segments.map(renderSegment).join(NARRATIVE_JOINER);
}

// ---------------------------------------------------------------------------
// LedgerRow — the shared row shape
// ---------------------------------------------------------------------------

/**
 * R6-06 D8/D12 — the closed union of THREE REAL status vocabularies a row
 * can honestly carry, one per execution path: a flow run's own `RunStatus`
 * (`flow-ledger.ts`), a flow NODE's own `RunPhaseStatus` (`agent-ledger.ts`'s
 * flow-node entries), or a standalone dispatch's own closed vocabulary. A
 * session's own `status.json` phase is not a closed set forge controls (D12:
 * "never coerced into a RunStatus/RunPhaseStatus literal — carried verbatim,
 * not mapped"), so the trailing `string` covers it — never a fabricated
 * mapping onto one of the other three vocabularies.
 *
 * ⚑ R6-06 Task 4b — this trailing `| string` is DELIBERATE, not an
 * oversight, and it is measured, not lazy: a session's `phase` is closed PER
 * RUNNER (e.g. `ArchitectPhase`, `orchestrator/architect-runner.ts:101`) but
 * OPEN across the four-and-growing runners `agent-ledger.ts` aggregates
 * session rows from, so closing this type-level union would make the type
 * itself dishonest (it would have to enumerate every runner's phase set and
 * stay in permanent lockstep with each new one). Because a trailing `string`
 * absorbs every literal listed before it, THIS TYPE CANNOT FAIL A TYPE
 * CHECK for any status value, on ANY `linkKind` — it is not the enforcement
 * point. The three vocabularies above ARE enforced, at runtime, by
 * `agent-ledger.ts`'s `isValidLedgerRow`/`isStatusValidForLinkKind`
 * (`resolveAgentHistoryFromResponse`'s per-row validation, Task 4): a
 * flow-node row's status must be a real `RunPhaseStatus`, a standalone row's
 * must be one of its own five literals, and ONLY a session row's status is
 * left open, on purpose. A type that can never fail, with no comment saying
 * so, reads as an oversight to the next person — this paragraph is that
 * comment.
 */
export type LedgerRowStatus =
  | RunStatus
  | RunPhaseStatus
  | 'running'
  | 'done'
  | 'failed'
  | 'suppressed'
  | 'budget-exceeded'
  | string;

/** R6-06 D8 — which of the three execution paths produced this row.
 *  Optional: `flow-ledger.ts`'s rows never set it (D8 — that caller's rows
 *  are already scoped to "inside a flow run" by construction). */
export type LedgerRowLinkKind = 'flow-node' | 'standalone' | 'session';

/** R6-06 D8 — mirrors `Run.trigger` (`studio-client.ts`) verbatim; the SAME
 *  shape `FlowRunDetail.tsx`'s `data-trigger-kind/source/scope` already
 *  renders, now also reaching the ledger row. */
export type LedgerRowTrigger = { kind: string; source: string; scope: string | null };

// ---------------------------------------------------------------------------
// W7-B1 (home-sessions-33) — the session-phase → run-vocabulary map for the
// `data-run-status` DOM attribute.
// ---------------------------------------------------------------------------

/** Terminal phases that mean "finished successfully" vs "stopped", across
 *  the session runners (studio/session-kinds.yaml's `step: terminal` rows +
 *  the universal `cancelled`). ONE source: `session-lifecycle-client.ts`'s
 *  terminal copy ("Done — committed" vs "Cancelled — …") imports these SAME
 *  sets, so the ledger's mapped status and the lifecycle sentence can never
 *  disagree about what counts as done. Declared here (the pure, transport-
 *  free module) so this file never has to import the cancel client.
 *  Review round 1: `applying` added (kb-cleanup's yaml-declared terminal
 *  phase — it was silently mapping to a forever-"active" ledger row), and
 *  the whole union is now yaml-parity-pinned: `history-ledger.test.ts`
 *  scans the REAL registry's `step: terminal` rows and asserts every one
 *  maps to complete|failed — a future kind's new terminal token turns the
 *  suite red instead of drifting. */
export const SESSION_DONE_PHASES: ReadonlySet<string> = new Set(['committed', 'locked', 'applying', 'applied', 'complete']);
export const SESSION_STOPPED_PHASES: ReadonlySet<string> = new Set(['rejected', 'abandoned', 'cancelled', 'failed']);

/**
 * Map a session's own status.json phase (an OPEN per-runner vocabulary —
 * D12, deliberately carried verbatim on `LedgerRow.status`) onto the CLOSED
 * run vocabulary the `data-run-status` DOM contract promises
 * (home-sessions-33: eight vocabularies were leaking into one attribute).
 * Done-terminal → 'complete'; stopped-terminal → 'failed'; anything else —
 * including a future runner's unknown token — → 'active': "in flight as far
 * as this surface can honestly tell", the least-claiming in-flight value.
 * The RAW phase always rides alongside on `data-session-phase`, so nothing
 * is lost — only the closed attribute stops lying. Used ONLY at the DOM
 * boundary (HistoryLedger.tsx); `LedgerRow.status` itself is untouched.
 */
export function sessionPhaseRunStatus(phase: string): 'active' | 'complete' | 'failed' {
  if (SESSION_DONE_PHASES.has(phase)) return 'complete';
  if (SESSION_STOPPED_PHASES.has(phase)) return 'failed';
  return 'active';
}

/**
 * WI-1b (ON-7) — a session's own phase, classified into the THREE-way
 * terminal outcome vocabulary `data-lifecycle-terminal-outcome`
 * (`SessionLifecycleBar.tsx`) and `home-view.ts`'s failed-hex derivation
 * both need — declared here (the pure, transport-free module, same reason
 * `sessionPhaseRunStatus` lives here) so neither client can drift from the
 * other about what counts as a failure.
 *
 * `SESSION_DONE_PHASES` → 'succeeded'. `'cancelled'` is carved OUT of
 * `SESSION_STOPPED_PHASES` into its own 'cancelled' outcome — it is the
 * operator's own deliberate stop (it already has distinct, non-alarming UI
 * treatment: `describeCancelOutcome`/`CancelOutcomeNotice` in
 * `session-lifecycle-client.ts`), never a system failure. Every OTHER
 * `SESSION_STOPPED_PHASES` member (`rejected`, `abandoned`, `failed`) is a
 * real "did not succeed" outcome → 'failed'. Anything not in either set
 * (a future runner's own unclassified terminal token — none exist today;
 * `history-ledger.test.ts`'s yaml-parity scan asserts every REAL registry
 * terminal phase already lands in `SESSION_DONE_PHASES ∪
 * SESSION_STOPPED_PHASES`) also falls to 'failed': fail CLOSED, never claim
 * a 'succeeded' this function has no positive evidence for.
 */
export function sessionTerminalOutcome(phase: string): 'succeeded' | 'failed' | 'cancelled' {
  if (SESSION_DONE_PHASES.has(phase)) return 'succeeded';
  if (phase === 'cancelled') return 'cancelled';
  return 'failed';
}

export type LedgerRow = {
  id: string;
  /** Raw ISO `run.startedAt`, or '' if absent (D7) — formatting is a
   *  presentation-time concern (`formatWhen`), never baked in here. */
  when: string;
  what: string;
  /** `renderNarrative(segments)` — D3. */
  narrative: string | null;
  /**
   * ROUND 3 (D11) — the MACHINE surface: `segments.map(s => s.kind)`, the
   * SAME order as the segments that produced `narrative`, from the SAME
   * derivation call so the two can never disagree. `[]` iff `narrative ===
   * null`.
   */
  narrativeKinds: string[];
  /** The REAL status vocabulary for this row's own execution path — D4/D8.
   *  Never the mockup's invented 'attention' status. */
  status: LedgerRowStatus;
  /** `run.costUsd` (flow-node: the NODE's own `phaseMeta[nodeId].costUsd`),
   *  read never re-summed — D8. `null` when the cost genuinely does not
   *  exist yet (e.g. a session with no log dir) — NEVER a fabricated
   *  `0`/`$0.00` standing in for an absent fact. */
  costUsd: number | null;
  /** Caller-computed — D2, the reuse seam. */
  href: string;
  /** R6-06 D8 — OPTIONAL: which execution path this row came from. Absent
   *  on every existing (pre-R6-06) flow-ledger row (byte-identical-when-
   *  absent regression lock). */
  linkKind?: LedgerRowLinkKind;
  /** R6-06 D8 — OPTIONAL: this row's own provenance, when the run/entry
   *  carries one. Absent on every existing (pre-R6-06) flow-ledger row. */
  trigger?: LedgerRowTrigger;
  /** W7-B5 (agents-04) — OPTIONAL: WHICH agent(s) this row belongs to, for
   *  cross-agent ledgers (the /agents + Home recent-runs sections, fed by
   *  the aggregate route). Rendered as a leading chip by `HistoryLedger`
   *  when present. Absent on every single-agent/flow-scoped ledger, whose
   *  rows render byte-identically to before this field existed. */
  agent?: string;
};

// ---------------------------------------------------------------------------
// parseWhenMs — the ONE seam shared by sortLedgerRowsNewestFirst/formatWhen
// ---------------------------------------------------------------------------

/**
 * Turn a raw `when`/`iso` string into a valid epoch-ms, or `null` if it
 * carries no usable time. `null` covers every "no real time" shape alike —
 * absent, empty, whitespace-only, or genuinely unparsable — by validating
 * the PARSE RESULT (`Number.isFinite`) rather than the input's truthiness.
 * A truthy-but-unparsable string (`'garbage'`) or a whitespace-only one
 * (`'   '`, itself truthy in JS) must be treated exactly like an absent
 * value everywhere "do we have a real time" is asked — that was the shared
 * root cause of two prior defects here (a truthiness guard standing in for
 * a validity check), one per caller. Both callers below go through this
 * single helper so the definition of "valid" can never diverge between
 * them again.
 *
 * EXPORTED (W8-C3): `./projects-index-activity.ts` asks the same question of a
 * cycle's timestamps when picking a project's most-recent activity. It reuses
 * this rather than re-deriving "is this a real time", for exactly the reason
 * above — a second definition is a second thing to drift.
 */
export function parseWhenMs(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = new Date(trimmed).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// ---------------------------------------------------------------------------
// sortLedgerRowsNewestFirst — pure, immutable, missing/invalid-`when` handling
// ---------------------------------------------------------------------------

/**
 * Sort rows newest-`when`-first, returning a NEW array (never mutates the
 * input — the standing "return new objects, never mutate inputs" rule). A
 * row with no USABLE `when` — empty, whitespace-only, or unparsable —
 * sorts LAST, never first: a naive sort keyed on `new Date(x).getTime()`
 * yields `NaN` for any of those shapes, and `NaN` comparator behaviour is
 * implementation-defined, which could land such a row at the top of "most
 * recent" history instead of the bottom.
 */
export function sortLedgerRowsNewestFirst(rows: LedgerRow[]): LedgerRow[] {
  return [...rows].sort((a, b) => {
    const aMs = parseWhenMs(a.when);
    const bMs = parseWhenMs(b.when);
    if (aMs === null && bMs === null) return 0;
    if (aMs === null) return 1;
    if (bMs === null) return -1;
    return bMs - aMs;
  });
}

// ---------------------------------------------------------------------------
// formatWhen — deterministic, locale/wall-clock independent (D7)
// ---------------------------------------------------------------------------

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Format an ISO timestamp relative to an explicit `nowMs` — never reads
 * `Date.now()` or calls `toLocaleString()` internally (D7), so the result
 * is byte-identical regardless of process TZ/locale. A run with no usable
 * `startedAt` — absent, empty, whitespace-only, or unparsable — renders the
 * honest placeholder `'—'`, never a fabricated time or an `Invalid Date`
 * leak (validated via the same `parseWhenMs` seam `sortLedgerRowsNewestFirst`
 * uses, so the two can never disagree on what counts as a real time).
 */
export function formatWhen(iso: string | undefined, nowMs: number): string {
  const thenMs = parseWhenMs(iso);
  if (thenMs === null) return '—';
  const diffMs = nowMs - thenMs;
  const diffMinutes = Math.floor(diffMs / MINUTE_MS);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMs / HOUR_MS);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffMs / DAY_MS);
  return `${diffDays}d ago`;
}

// ---------------------------------------------------------------------------
// ledgerRowKind — W6-IA-4 Home merged-ledger "kind chip" (flow|agent)
// ---------------------------------------------------------------------------

/** The two-way split `HistoryLedger`'s optional `showKindChip` renders,
 *  DERIVED from the row's own existing `linkKind` field — never a new
 *  stored fact. `linkKind === undefined` is exactly `flow-ledger.ts`'s own
 *  convention (D8: "that caller's rows are already scoped to 'inside a
 *  flow run' by construction" — flow-ledger.ts NEVER sets it), so an
 *  absent `linkKind` means "this row came from a flow-run derivation" ->
 *  'flow'. Every agent-sourced `linkKind` value (`'flow-node'` — an
 *  agent's own participation in a flow node, `'standalone'`, `'session'`)
 *  is bucketed 'agent' — none of them are a flow-level row. */
export type LedgerRowKind = 'flow' | 'agent';

export function ledgerRowKind(row: Pick<LedgerRow, 'linkKind'>): LedgerRowKind {
  return row.linkKind === undefined ? 'flow' : 'agent';
}
