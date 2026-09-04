/**
 * `deriveSessionAffordances` — the READ-half affordance view.
 *
 * ADR-043 §1 "affordances are derived, not authored", plus the 2026-08-15
 * wave-6 amendment §1: the shell read route computes `affordances[]`
 * server-side from the phase table, and the client renders what it is handed
 * and never re-derives.
 *
 * Split out of `studio/session-kinds.ts` (M4 exit row 5). It is the cleanest of
 * this package's seams: the whole module depends on exactly ONE name from the
 * parent — `SessionKindDescriptor`, a type — and nothing in the parent or in
 * the validator half references anything declared here.
 *
 * It does not import the validator and the validator does not import it. The
 * two halves that left this file were never coupled to each other, only to the
 * parser they both stand on, which is what stayed behind.
 */
import type { SessionKindDescriptor } from './session-kinds.ts';

export type SessionAffordanceKind = 'question-form' | 'verdict' | 'staged-review' | 'next-turn';

/** One derived affordance the CURRENT phase makes available. JSON-serializable
 *  (no functions, no class instances) — the bridge threads this straight onto
 *  the wire (packages/sessions/bridge-studio-sessions.ts), and B6's UI renders each `kind`
 *  with its own component; it never re-derives from the phase table itself
 *  (the "derived, not authored" discipline, ADR-043 §1). */
export type SessionAffordance = {
  /** Stable within one call — `${phase}-${kind}` — never a UUID, so the same
   *  phase/kind pair always yields the same id (usable as a React key with no
   *  separate id-generation scheme). */
  readonly id: string;
  readonly kind: SessionAffordanceKind;
  /** The phase row this affordance was derived from — lets a caller trace an
   *  affordance back to its source row without re-deriving it. */
  readonly phase: string;
  /** Present only when the source row carries the corresponding field
   *  (`writes` for `staged-review`, `next` for `next-turn`, `requires` for
   *  `verdict` — W6-B9) — omitted, never defaulted, mirroring this file's
   *  own `writes`/`next`/`finalizer`/`requires` omit-don't-default
   *  discipline in `parseTurnSpecPhase`. `verdicts` (W6-B6 post-merge
   *  review) is the ONE exception to "never defaulted": a `verdict`-kind
   *  affordance ALWAYS carries it — `row.verdicts` when the row declares
   *  one, else the ADR default `['approve', 'reject']` — so a consumer (the
   *  write route, the panel) never has to re-implement that default itself;
   *  this is the single, derived source of the business rule "which verdict
   *  values are legal for THIS phase", never a second, hand-kept copy.
   *  `requires` (W6-B9, reviewer finding on W6-B8) is the equally single
   *  source of "which extra POST body fields this verdict needs beyond
   *  `verdict` itself" — a `verdict`-kind affordance carries it only when
   *  `row.requires` declares one (e.g. authoring's `awaiting-review` row
   *  needs `['id']`); a row declaring none needs nothing beyond `verdict`,
   *  so the key is simply absent, never a fabricated `[]`. The write route's
   *  generic body-shape check and the panel's approve-gate BOTH read this
   *  SAME field — closes the class of defect where the client guessed at a
   *  server-side requirement with no wire signal tying the two together. */
  readonly meta?: { readonly writes?: readonly string[]; readonly next?: string; readonly verdicts?: readonly string[]; readonly requires?: readonly string[] };
};

/**
 * Derives the operator-facing affordance view for `currentPhase`, from
 * WHICHEVER phase table the descriptor carries — `turnSpec.phases` (a real
 * dispatchable kind) or `panel.phases` (a legacy kind's read-only twin,
 * ADR-043 2026-08-15 amendment §2). A descriptor with NEITHER (architect,
 * permanently bespoke per amendment §4) yields `[]` — the honest "this kind
 * has no derivable affordances" answer, never a guess. `validateSessionKinds`
 * already guarantees a descriptor never carries both, so there is no
 * ambiguity about which table to read.
 *
 * Mapping (ADR-043 §1's "affordances are derived, not authored" clause):
 *   - no row matches `currentPhase`     → `[]` (unknown/undeclared phase —
 *     fail closed, never fabricate an affordance for a phase the table
 *     doesn't name)
 *   - `row.step === 'terminal'`         → `[]` (ADR: "terminal ⇒ none" —
 *     checked FIRST, so a terminal row can never leak a stray affordance
 *     even if it also happened to carry `writes`/`next`)
 *   - `row.step === 'noop'`             → one operator-decision affordance,
 *     resolved through `row.awaits` (AWAITS_KINDS) — AUTHORED, VALIDATED
 *     data, never the phase's own NAME. `validateSessionKinds` REQUIRES
 *     `awaits` on every `noop` row (CHECK_*_NOOP_MISSING_AWAITS), so by the
 *     time a real, linted table reaches this function `row.awaits` is
 *     guaranteed to be `'questions'` or `'verdict'`, the only two members of
 *     the vocabulary: `awaits: 'questions'` → `question-form`, `awaits:
 *     'verdict'` → `verdict` (every other `awaiting-*` gate: awaiting-review,
 *     awaiting-verdict, awaiting-approval, …). This closes a real
 *     misclassification class a prior revision of this function had: a bare
 *     `row.phase === 'awaiting-answers'` NAME match silently mis-derived
 *     `verdict` for ANY interview Q&A checkpoint not spelled with that exact
 *     literal string — a differently-named question phase (e.g.
 *     `awaiting-input`) now derives correctly via its own `awaits: questions`
 *     row, with no dependence on how the phase happens to be spelled. A
 *     `verdict` affordance ALWAYS carries `meta.verdicts` (W6-B6 post-merge
 *     review) — `row.verdicts` verbatim when the row declares one (e.g.
 *     kb-cleanup/authoring's `['approve']`, no rejection path), else the ADR
 *     default `['approve', 'reject']` — the ONE place this default is
 *     computed, so the write route and the panel never keep their own copy.
 *   - `row.writes` has entries (any step) → `staged-review`, carrying
 *     `meta.writes` verbatim
 *   - `row.next` is defined (any step)    → `next-turn`, carrying `meta.next`
 *     verbatim (the phase the row advances to)
 *
 * A single row can yield more than one affordance — e.g. an `agent` step that
 * both `writes` a staging area AND declares `next` (authoring's `analyzing`
 * row yields `[staged-review, next-turn]`) — order is always
 * `[question-form|verdict, staged-review, next-turn]` for a stable UI layout.
 */
export function deriveSessionAffordances(descriptor: SessionKindDescriptor, currentPhase: string): SessionAffordance[] {
  const phases = descriptor.turnSpec?.phases ?? descriptor.panel?.phases;
  if (phases === undefined) return [];

  const row = phases.find((p) => p.phase === currentPhase);
  if (row === undefined) return [];
  if (row.step === 'terminal') return [];

  const affordances: SessionAffordance[] = [];

  if (row.step === 'noop') {
    const kind: SessionAffordanceKind = row.awaits === 'questions' ? 'question-form' : 'verdict';
    if (kind === 'verdict') {
      // W6-B6 post-merge review: the ADR's own default when a row declares
      // no `verdicts:` — `deriveSessionAffordances` is the ONE place this
      // default is applied; `cli/bridge-studio-affordances.ts`'s write route
      // and `SessionInteractivePanel` both consume this SAME derived value,
      // never a second, hand-kept copy of "which kinds are approve-only".
      const verdicts = row.verdicts ?? ['approve', 'reject'];
      // W6-B9 (reviewer finding on W6-B8) — `requires` has NO default (unlike
      // `verdicts`): a row declaring none needs nothing beyond `verdict`
      // itself, so the key is simply omitted, never a fabricated `[]`.
      affordances.push({
        id: `${row.phase}-${kind}`,
        kind,
        phase: row.phase,
        meta: { verdicts, ...(row.requires !== undefined ? { requires: row.requires } : {}) },
      });
    } else {
      affordances.push({ id: `${row.phase}-${kind}`, kind, phase: row.phase });
    }
  }

  if (row.writes !== undefined && row.writes.length > 0) {
    affordances.push({ id: `${row.phase}-staged-review`, kind: 'staged-review', phase: row.phase, meta: { writes: row.writes } });
  }

  if (row.next !== undefined) {
    affordances.push({ id: `${row.phase}-next-turn`, kind: 'next-turn', phase: row.phase, meta: { next: row.next } });
  }

  return affordances;
}
