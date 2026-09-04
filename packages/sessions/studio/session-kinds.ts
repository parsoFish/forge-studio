/**
 * The typed session-kind registry (R2-10, PR1: the session-shell backend
 * contract). A "session kind" is one interactive session surface (architect,
 * instructions, project-brain, …) — which agent drives it, which legacy
 * Studio routes it replaces, which of the six SESSION_STAGES it can occupy,
 * and which artifact renderer displays its output.
 *
 * Mirrors flow-trigger.ts's shipped/reserved-row precedent: SESSION_STAGES
 * and SESSION_ARTIFACT_KINDS are frozen, rows-as-data vocabularies. A
 * `reserved` artifact kind PARSES fine (loadSessionKinds is purely
 * structural) but is a lint ERROR on use (validateSessionKinds) — R4-15/16/17/21
 * extend this registry by adding a descriptor (not a page) plus, when they
 * ship, a renderer that promotes the matching row from reserved to live.
 * R4-21's 'file-package' flip was the LAST reserved row — the vocabulary is
 * now 6-live/0-reserved; a future extension re-opens the pattern by adding a
 * new row starting `reserved`.
 *
 * Mirrors template-library.ts's load/validate split (also drawn identically
 * in validate.ts for agents/flows): `loadSessionKinds` throws only on a
 * missing file / unparseable YAML / a missing required scalar — it does NOT
 * enforce closed-vocabulary membership (stage tokens, artifact kinds, agent
 * refs, duplicate ids, slug shape). Those are SEMANTIC checks and live only
 * in `validateSessionKinds`, so the loader stays lenient (AT-16) and the
 * validator is the single place a bad value gets flagged.
 *
 * Binding rule on every validation message here (a brain lesson from a real
 * forge cycle that burned 6 retries on a bare "schema invalid"): a
 * closed-enum rejection must name BOTH the offending value and the allowed
 * set.
 *
 * Agent-ref resolution deliberately does NOT use `listAgentDefinitions()` /
 * `isStudioAgent()` — those exclude `library: false` agents from the
 * composable Studio roster, and `instructions-creator` /
 * `project-brain-builder` are both `library: false` internal agents
 * dispatched by the bridge (see their SKILL.md frontmatter). Using the
 * roster function here would wrongly flag 2 of the 3 real session-kind
 * descriptors (AT-17). Instead this module scans EVERY skill dir's
 * `skills/<slug>/SKILL.md` that carries a `runtime:` block, regardless of
 * the `library` flag.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { reqString, reqObject, stringArray, optString } from '@forge/kernel/studio/yaml-fields.ts';

// ---------------------------------------------------------------------------
// Closed vocabularies (frozen — rows-as-data, mirrors TRIGGER_KINDS)
// ---------------------------------------------------------------------------

/** The session stages, order significant (the session shell's tab/stepper
 *  order). Closed — a descriptor's `stages`/`defaultStage` must draw from
 *  this set (enforced by validateSessionKinds, not the loader).
 *
 *  R4-21: 'authoring' is the vocabulary's FIRST-EVER extension — a 7th
 *  token, appended at the end, backing the new single-stage `authoring`
 *  session kind (creation-agent). It is unrelated to the ordered onboarding
 *  sequence (contract→instructions→secrets→demo→roadmap→brain) the other six
 *  tokens encode.
 *
 *  W6-CR-3 added an 8th token, 'community', mirroring 'authoring's own
 *  precedent, for the single-stage `community-refresh` session kind. That
 *  kind was retired in W8-B5b (superseded by the deterministic `forge
 *  community refresh` mechanism) and 'community' had no other consumer, so
 *  the vocabulary reverts to the 7 tokens above. */
export const SESSION_STAGES = Object.freeze([
  'contract',
  'instructions',
  'secrets',
  'demo',
  'roadmap',
  'brain',
  'authoring',
] as const);
export type SessionStage = (typeof SESSION_STAGES)[number];

/** One artifact-kind row: `live` has a real renderer (deriveSessionArtifact,
 *  session-transcript.ts); `reserved` is vocabulary-reserved so nobody squats
 *  different semantics on the id, but has ZERO renderer implementation
 *  anywhere — using one is a lint error (session-kinds/reserved-artifact-kind),
 *  never a silent stub. */
export type SessionArtifactKindRow = { readonly id: string; readonly status: 'live' | 'reserved' };

// Object.freeze is SHALLOW — freezing the outer array alone leaves each row
// object mutable (`SESSION_ARTIFACT_KINDS[0].status = 'HACKED'` would
// silently succeed), and sessionArtifactKindState reads straight off these
// rows, so an in-process mutation could flip a `reserved` row to `live` for
// the rest of the process. Each row is frozen individually before the outer
// array is frozen, so the whole structure is deep-frozen.
export const SESSION_ARTIFACT_KINDS: readonly SessionArtifactKindRow[] = Object.freeze([
  Object.freeze({ id: 'roadmap-draft', status: 'live' }),
  Object.freeze({ id: 'markdown-draft', status: 'live' }),
  Object.freeze({ id: 'brain-structure', status: 'live' }),
  // R4-21: the creation-agent authoring session's 'file-package' case in
  // deriveSessionArtifact (session-transcript.ts) ships a real renderer —
  // flips reserved→live. Declaration order is unchanged; only status flips.
  // This is the LAST reserved row — the vocabulary is now 6-live/0-reserved.
  Object.freeze({ id: 'file-package', status: 'live' }),
  // R4-17: the onboarding session's 'contract-buildout' case in
  // deriveSessionArtifact (session-transcript.ts) ships a real renderer —
  // flips reserved→live. It consumes ALREADY-DERIVED rows the caller
  // supplies (packages/projects/contract-stages.ts's deriveContractStages) rather than
  // reading sessionDir itself (D4). Declaration order is unchanged; only
  // status flips.
  Object.freeze({ id: 'contract-buildout', status: 'live' }),
  // R4-16: deriveGenerationGallery (session-transcript.ts) ships a real
  // renderer — flips reserved→live. Declaration order is unchanged (still
  // last); only status flips.
  Object.freeze({ id: 'generation-gallery', status: 'live' }),
  // R4-19-F2: the kb-cleanup session's 'cleanup-plan' case in
  // deriveSessionArtifact (session-transcript.ts) ships a real renderer —
  // lands directly as 'live' (never 'reserved') because the renderer lands
  // in the SAME change, mirroring the file-package/contract-buildout rows'
  // own precedent above of landing live rather than staging a reserved row
  // for a later flip.
  Object.freeze({ id: 'cleanup-plan', status: 'live' }),
] as const);
export type SessionArtifactKind = (typeof SESSION_ARTIFACT_KINDS)[number]['id'];

/** Total function over the artifact-kind vocabulary: `live` | `reserved` |
 *  `undefined` for anything unrecognised. Never throws, never guesses. */
export function sessionArtifactKindState(id: string): 'live' | 'reserved' | undefined {
  return SESSION_ARTIFACT_KINDS.find((k) => k.id === id)?.status;
}

// ---------------------------------------------------------------------------
// turnSpec vocabularies (R4-22 WI-1, ADR-043 §1 — docs/decisions/043-generic-
// interactive-surface.md): the additive-optional producer/state-machine half
// of a session-kind descriptor. Each is `readonly { id: string }[]`, rows-as-
// data, mirroring SESSION_ARTIFACT_KINDS's shape exactly — including the same
// deep-freeze discipline (each row frozen individually BEFORE the outer array
// is frozen; a shallow `Object.freeze(array)` alone leaves rows mutable).
// ---------------------------------------------------------------------------

export type TurnStyleRow = { readonly id: string };
export type TurnStepRow = { readonly id: string };
export type FinalizerIdRow = { readonly id: string };
export type SchemaIdRow = { readonly id: string };

/** `structured` drives runStructuredTurn, `agent` drives runAgentTurn
 *  (ADR-043 §1/§2) — exactly the two styles the ADR names, nothing
 *  speculative added.
 *
 *  Typed `readonly TurnStyleRow[]`, exactly as SESSION_ARTIFACT_KINDS above:
 *  the compile-time annotation matches the runtime deep-freeze instead of
 *  being widened to suit a caller's local. Do NOT re-add an `as
 *  TurnStyleRow[]` cast to make a mutable-typed local compile — that strips
 *  the readonly Object.freeze hands back and loosens production typing to
 *  fit a test fixture; type the local `readonly` instead. */
export const TURN_STYLES: readonly TurnStyleRow[] = Object.freeze([
  Object.freeze({ id: 'structured' }),
  Object.freeze({ id: 'agent' }),
]);
export type TurnStyle = (typeof TURN_STYLES)[number]['id'];

export type BashFenceModeRow = { readonly id: string };
/** W7-FIX-A2 (W7A2-03, bead forge-w08) — `turnSpec.bashFence`, the ONE
 *  authored switch for how a write-root-fenced turn treats the `Bash` tool:
 *  `deny` (the default when absent — Bash is refused outright, a fenced kind
 *  has no ungated write-capable tool) or `inspect` (every Bash command is
 *  statically inspected against the write roots — packages/sessions/bash-fence.ts).
 *  Validated by validateSessionKinds; consumed by orchestrator/interactive-
 *  runner.ts → runAgentTurn's `bashFence`. Typed `readonly`, as TURN_STYLES. */
export const BASH_FENCE_MODES: readonly BashFenceModeRow[] = Object.freeze([
  Object.freeze({ id: 'deny' }),
  Object.freeze({ id: 'inspect' }),
]);
export type BashFenceModeId = (typeof BASH_FENCE_MODES)[number]['id'];

/** Exactly the four step kinds the ADR's own worked example exercises
 *  (agent/noop/finalize/terminal) — nothing speculative added beyond it.
 *  Typed `readonly`, as TURN_STYLES. */
export const TURN_STEPS: readonly TurnStepRow[] = Object.freeze([
  Object.freeze({ id: 'agent' }),
  Object.freeze({ id: 'noop' }),
  Object.freeze({ id: 'finalize' }),
  Object.freeze({ id: 'terminal' }),
]);
export type TurnStep = (typeof TURN_STEPS)[number]['id'];

/** Finalizer ids a `step: finalize` phase may name (ADR-043 §5, "the real
 *  bespoke residue") — seeded with the ADR's own worked example (
 *  `copyStagingToLibrary`, authoring's real turnSpec finalizer) plus two more
 *  the ADR §5 registry already names but which, per the 2026-08-14 amendment
 *  §1, never gain a `turnSpec` (demo/instructions are never migrated onto the
 *  primitive): `writeToRepoRoot` (instructions' `finalizing` step —
 *  `withStudioWrite`, packages/sessions/instructions-runner.ts:491) and
 *  `recordLockedDemo` (demo's `locking` step — the deterministic
 *  snapshot-restore lock, packages/sessions/demo-builder-runner.ts:405-409). Both
 *  are used ONLY by `panel.phases` rows (studio/session-kinds.yaml) for
 *  affordance derivation — never by a real `turnSpec`, so `resolveFinalizer`
 *  (packages/sessions/interactive-runner.ts) never has to implement them; adding
 *  them here does not reopen the "gains no new row for kb-cleanup" ratchet's
 *  intent (that test pinned kb-cleanup's OWN phase table needing none, not a
 *  blanket freeze on this registry's size — see its updated comment).
 *
 *  W6-CR-3 added `commitRegistryDraft` alongside — it WAS dispatched via
 *  `turnSpec` (the `community-refresh` kind's `committing` phase), living in
 *  `FINALIZERS` too (`packages/sessions/interactive-finalizers.ts`) and therefore
 *  also in `DISPATCHABLE_FINALIZER_IDS` below, unlike
 *  `writeToRepoRoot`/`recordLockedDemo` immediately above. W8-B5b retired the
 *  `community-refresh` kind (superseded by the deterministic `forge
 *  community refresh` mechanism) and `commitRegistryDraft` with it, so this
 *  row is removed again. Typed `readonly`, as TURN_STYLES. */
export const FINALIZER_IDS: readonly FinalizerIdRow[] = Object.freeze([
  Object.freeze({ id: 'copyStagingToLibrary' }),
  Object.freeze({ id: 'writeToRepoRoot' }),
  Object.freeze({ id: 'recordLockedDemo' }),
]);
export type FinalizerId = (typeof FINALIZER_IDS)[number]['id'];


/** EXPIRY CONDITION (deliberately empty for R4-22 WI-1): the ADR's only
 *  worked example (style: agent) never exercises `schema` at all, and no
 *  `structured`-style turnSpec consumer exists anywhere in the repo yet.
 *  Seed this the moment the first one lands. Until then, this is a
 *  deliberately-green gap-pin, not an oversight: `turnSpec.schema` has no
 *  valid value today, and validateSessionKinds says so honestly (naming the
 *  empty allowed set) rather than skipping the check or pretending
 *  membership that doesn't exist. Typed `readonly`, as TURN_STYLES. */
export const SCHEMA_IDS: readonly SchemaIdRow[] = Object.freeze([] as SchemaIdRow[]);
export type SchemaId = (typeof SCHEMA_IDS)[number]['id'];

export type AwaitsKindRow = { readonly id: string };

/**
 * What a `step: noop` phase is WAITING ON the operator to supply — the
 * closed, frozen vocabulary `deriveSessionAffordances` reads to pick between
 * a `question-form` and a `verdict` affordance (W6-B3 post-merge review
 * finding). REQUIRED on every `step: noop` row (validateSessionKinds below)
 * — replaces a bare `row.phase === 'awaiting-answers'` NAME match, which
 * silently miscategorised any interview-Q&A checkpoint not spelled with
 * that exact literal string as a `verdict` instead of a `question-form`.
 * `awaits` is AUTHORED data (the yaml row states its own kind), the same
 * class as `writes:` — never inferred from the phase name. Exactly the two
 * values every real noop row in this repo needs today; nothing speculative
 * added. Typed `readonly`, as TURN_STYLES. */
export const AWAITS_KINDS: readonly AwaitsKindRow[] = Object.freeze([
  Object.freeze({ id: 'questions' }),
  Object.freeze({ id: 'verdict' }),
]);
export type AwaitsKind = (typeof AWAITS_KINDS)[number]['id'];

/** Total lookups over the turnSpec/panel vocabularies: the matching id, or
 *  `undefined` for anything unrecognised. Never throw, never guess — mirror
 *  sessionArtifactKindState's exact shape. */
export function turnStyleState(id: string): string | undefined {
  return TURN_STYLES.find((s) => s.id === id)?.id;
}
export function bashFenceModeState(id: string): string | undefined {
  return BASH_FENCE_MODES.find((s) => s.id === id)?.id;
}
export function turnStepState(id: string): string | undefined {
  return TURN_STEPS.find((s) => s.id === id)?.id;
}
export function finalizerIdState(id: string): string | undefined {
  return FINALIZER_IDS.find((s) => s.id === id)?.id;
}
export function schemaIdState(id: string): string | undefined {
  return SCHEMA_IDS.find((s) => s.id === id)?.id;
}
export function awaitsKindState(id: string): string | undefined {
  return AWAITS_KINDS.find((s) => s.id === id)?.id;
}

export type VerdictValueRow = { readonly id: string };

/** The closed set of verdict values a `verdict`-kind affordance may declare
 *  in its authored `verdicts:` list (a `noop` row's `awaits: 'verdict'`
 *  case) — reviewer finding (W6-B6 post-merge review): this is the SAME
 *  business rule `cli/bridge-studio-affordances.ts` used to enforce as a
 *  hand-kept, per-session-kind 422 table (kb-cleanup/authoring hardcoded to
 *  approve-only) — a second copy of a server rule that could silently drift
 *  from this one. Now there is exactly ONE source: this vocabulary plus the
 *  authored `verdicts:` field on each phase row (default `['approve',
 *  'reject']` when the row omits it — see `deriveSessionAffordances`); the
 *  write route validates a posted verdict against the SAME derived
 *  `meta.verdicts`, and the client renders its buttons from the SAME field.
 *  Typed `readonly`, as AWAITS_KINDS.
 *
 *  W7-C2 (ADR-043 2026-08-21 amendment; beads forge-4ei, findings
 *  sessions-kinds-09/23, library-24): `revise` joins the vocabulary — the
 *  operator's "apply this feedback and draft again" branch every draft
 *  runner already supports (instructions/demo bespoke routes; the generic
 *  spine's re-run of the row's own agent phase for authoring / kb-cleanup).
 *  A row opts in by DECLARING it in `verdicts:`; the
 *  ADR default for an undeclared row stays `['approve','reject']` — revise
 *  is never fabricated onto a kind whose runner has no revise turn. */
export const VERDICT_VALUES: readonly VerdictValueRow[] = Object.freeze([
  Object.freeze({ id: 'approve' }),
  Object.freeze({ id: 'reject' }),
  Object.freeze({ id: 'revise' }),
]);
export type VerdictValue = (typeof VERDICT_VALUES)[number]['id'];

export function verdictValueState(id: string): string | undefined {
  return VERDICT_VALUES.find((s) => s.id === id)?.id;
}

// ---------------------------------------------------------------------------
// SessionKindDescriptor
// ---------------------------------------------------------------------------

export type SessionKindArtifactRef = {
  readonly kind: string;
  readonly label: string;
};

/** One row of a turnSpec's phase table (ADR-043 §1's worked example).
 *  `writes`/`next`/`finalizer`/`awaits` are genuinely optional AT THE TYPE
 *  LEVEL — a `terminal` phase carries none of them. Structural only: `step`,
 *  `finalizer`, and `awaits` are NOT validated against TURN_STEPS/
 *  FINALIZER_IDS/AWAITS_KINDS here — see validateSessionKinds. `awaits` IS
 *  semantically REQUIRED on every `step: noop` row (validateSessionKinds
 *  enforces this — a noop row omitting it is an error, not a silent gap).
 *
 *  EXPIRY CONDITION (deliberately unvalidated for R4-22 WI-1, matching the
 *  discipline SCHEMA_IDS sets above): `writes` names the staging area(s) an
 *  `agent`-step phase is expected to populate, but no ADR-ratified vocabulary
 *  for its values exists yet, and no consumer reads it back to enforce
 *  anything — inventing a closed set here would be speculative surface, not
 *  a real check. validateSessionKinds does NOT touch `writes` at all. Seed a
 *  vocabulary and a check the moment a real `writes` consumer lands (the
 *  generic runner actually reading/enforcing it); until then this is a
 *  known, deliberate gap, not an oversight. */
export type TurnSpecPhase = {
  readonly phase: string;
  readonly step: string;
  readonly writes?: readonly string[];
  readonly next?: string;
  readonly finalizer?: string;
  /** What a `step: noop` row is waiting on the operator to supply —
   *  `'questions' | 'verdict'` (AWAITS_KINDS). AUTHORED data (like
   *  `writes:`), never inferred from `phase`'s name — this is exactly what
   *  closes the "differently-named question phase silently derives as
   *  verdict" misclassification class (W6-B3 post-merge review). */
  readonly awaits?: string;
  /** Reviewer finding (W6-B6 post-merge review) — the closed set of verdict
   *  values a `verdict`-kind affordance (a `noop` row with `awaits:
   *  'verdict'`) accepts, AUTHORED data like `writes:`/`awaits:` themselves,
   *  never inferred from the session kind's id. Meaningful ONLY on such a
   *  row — `validateSessionKinds` rejects it declared anywhere else.
   *  Omitted (not defaulted) when absent at PARSE time — the semantic
   *  default (`['approve', 'reject']`) is applied by
   *  `deriveSessionAffordances`, never baked in here, mirroring `writes`'s
   *  own omit-don't-default discipline. */
  readonly verdicts?: readonly string[];
  /** Reviewer finding (W6-B9, on W6-B8) — the names of extra POST body
   *  fields a `verdict`-kind affordance's write handler needs BEYOND
   *  `verdict` itself (e.g. authoring's `awaiting-review` row needs an
   *  operator-supplied library `id` — D4, the drafted package cannot name
   *  itself). AUTHORED data, like `verdicts:`/`awaits:` — the closes the
   *  class of defect where a CLIENT guesses at a server-side requirement
   *  with no wire signal (the file-package id-required rule used to be
   *  hardcoded in `SessionInteractivePanel.tsx`, duplicating
   *  `handleAuthoringVerdict`'s own `{kind,id}` check with nothing tying the
   *  two together). Meaningful ONLY on a `noop`+`awaits:'verdict'` row —
   *  `validateSessionKinds` rejects it declared anywhere else, mirroring
   *  `verdicts`' own misplaced-check shape. Structural only here (like
   *  `writes`): there is no closed vocabulary of legal body-field NAMES to
   *  validate entries against — these are arbitrary field names, not a
   *  fixed semantic enum. Omitted (not defaulted) when absent — a row with
   *  no `requires` needs nothing beyond `verdict` itself, so the write
   *  route's generic check simply has nothing to enforce. */
  readonly requires?: readonly string[];
};

/** The additive-optional producer/state-machine half of a session-kind
 *  descriptor (ADR-043 §1) — the "missing half" that turns a read-only
 *  session shell into one that can actually run a turn. Structural only at
 *  load time (AT-R422-6 mirrors AT-16's split for the pre-existing fields):
 *  `style`, each phase's `step`/`finalizer`/`awaits`, and `schema` are
 *  validated ONLY by validateSessionKinds, against TURN_STYLES/TURN_STEPS/
 *  (the DISPATCHABLE subset of) FINALIZER_IDS/SCHEMA_IDS/AWAITS_KINDS
 *  respectively — loadSessionKinds carries the values through unmodified,
 *  however bogus. */
export type TurnSpec = {
  /** The one containment segment (SEC-04 guard root) — e.g. `_authoring`. */
  readonly kindDir: string;
  readonly style: string;
  /** Top-level, not per-phase (a structured-style session carries one
   *  schema) — SCHEMA_IDS ships empty for R4-22 WI-1, see its own doc. */
  readonly schema?: string;
  /** W7-FIX-A2 (W7A2-03) — Bash policy on a fenced `agent` step (see
   *  BASH_FENCE_MODES). Absent ⇒ `deny`. Validated ONLY by
   *  validateSessionKinds; the loader carries any value through. */
  readonly bashFence?: string;
  readonly phases: readonly TurnSpecPhase[];
};

/** The read-half twin of `turnSpec` for a legacy kind (ADR-043 2026-08-15
 *  amendment §2) — `phases` rows use the SAME `TurnSpecPhase` shape and the
 *  SAME frozen vocabulary (TURN_STEPS/FINALIZER_IDS) as `turnSpec.phases`,
 *  but carry no `kindDir`/`style`/`schema`: `panel` is consumed ONLY by
 *  `deriveSessionAffordances` (the read half) and is INVISIBLE to dispatch —
 *  `cmdAgentRun`'s turnSpec-fork condition (packages/agents/agent-run.ts) never looks at
 *  it, so a kind carrying `panel` still dispatches through `AGENT_RUNNERS`
 *  exactly as before this field existed. */
export type SessionKindPanel = {
  readonly phases: readonly TurnSpecPhase[];
};

export type SessionKindDescriptor = {
  readonly id: string;
  /** The agent (skill slug) that drives this session — resolved against
   *  every `skills/*​/SKILL.md` carrying a `runtime:` block, NOT the
   *  library-only Studio roster (see header). */
  readonly agent: string;
  readonly title: string;
  readonly legacyRoutes: readonly string[];
  /** Structural only — NOT validated against SESSION_STAGES at load time
   *  (AT-16); validateSessionKinds enforces the closed vocabulary. */
  readonly stages: readonly string[];
  readonly defaultStage: string;
  readonly artifact: SessionKindArtifactRef;
  /** Additive-optional (ADR-043 §1) — absent on every real session kind
   *  shipped before R4-22 (AT-R422-5); a descriptor with none loads and
   *  validates exactly as before. */
  readonly turnSpec?: TurnSpec;
  /** Additive-optional (ADR-043 2026-08-15 amendment §2) — the read-half twin
   *  of `turnSpec` for a legacy kind (demo/instructions/onboarding). Mutually
   *  exclusive with `turnSpec` — validateSessionKinds rejects a descriptor
   *  carrying both, naming the kind and both fields
   *  (CHECK_TURNSPEC_PANEL_EXCLUSIVE). Architect carries neither, permanently
   *  (amendment §4 — its panel stays bespoke). */
  readonly panel?: SessionKindPanel;
};

// ---------------------------------------------------------------------------
// loadSessionKinds — structural parse only
// ---------------------------------------------------------------------------

const SESSION_KINDS_YAML_RELATIVE = join('studio', 'session-kinds.yaml');

/** `studio/session-kinds.yaml` is a bare top-level YAML SEQUENCE of
 *  descriptor objects (not a mapping) — the shared `loadYaml` helper
 *  (yaml-fields.ts) enforces a mapping root, so this loader parses the file
 *  itself via the same underlying `js-yaml` library rather than hand-rolling
 *  a parser, and enforces a sequence root instead. */
function loadSessionKindsSequence(file: string): unknown[] {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`${file}: cannot read file — ${(err as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`${file}: YAML parse error — ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${file}: YAML root must be a sequence of session-kind descriptors, got ${typeof parsed}`);
  }
  return parsed;
}

/** Structural-only parse of one turnSpec.phases[] row (AT-R422-6): only
 *  `phase`/`step` are required scalars; `writes`/`next`/`finalizer` are
 *  carried through when present and OMITTED (not set to `undefined`) when
 *  absent, so a round-tripped descriptor stays deep-equal to the authored
 *  object — no semantic check on `step`/`finalizer` happens here. */
function parseTurnSpecPhase(raw: unknown, file: string, descIndex: number, phaseIndex: number): TurnSpecPhase {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(
      `${file}: descriptor[${descIndex}].turnSpec.phases[${phaseIndex}] must be a mapping, got ${Array.isArray(raw) ? 'array' : typeof raw}`,
    );
  }
  const p = raw as Record<string, unknown>;
  const phase = reqString(p, 'phase', file);
  const step = reqString(p, 'step', file);
  const writes = p.writes !== undefined ? stringArray(p, 'writes', file) : undefined;
  const next = optString(p, 'next');
  const finalizer = optString(p, 'finalizer');
  const awaits = optString(p, 'awaits');
  const verdicts = p.verdicts !== undefined ? stringArray(p, 'verdicts', file) : undefined;
  const requires = p.requires !== undefined ? stringArray(p, 'requires', file) : undefined;
  return {
    phase,
    step,
    ...(writes !== undefined ? { writes } : {}),
    ...(next !== undefined ? { next } : {}),
    ...(finalizer !== undefined ? { finalizer } : {}),
    ...(awaits !== undefined ? { awaits } : {}),
    ...(verdicts !== undefined ? { verdicts } : {}),
    ...(requires !== undefined ? { requires } : {}),
  };
}

/** Structural-only parse of a descriptor's `turnSpec` (AT-R422-6, mirrors
 *  the AT-16 split): throws only on missing-file-shape problems (not a
 *  mapping, `phases` not an array, missing required scalars) — `style`,
 *  each phase's `step`/`finalizer`/`awaits`, and `schema` are NOT checked
 *  against their closed vocabularies here; that is validateSessionKinds's
 *  job. */
function parseTurnSpec(raw: Record<string, unknown>, file: string, descIndex: number): TurnSpec {
  const kindDir = reqString(raw, 'kindDir', file);
  const style = reqString(raw, 'style', file);
  const schema = optString(raw, 'schema');
  const bashFence = optString(raw, 'bashFence');
  const phasesRaw = raw.phases;
  if (!Array.isArray(phasesRaw)) {
    throw new Error(`${file}: descriptor[${descIndex}].turnSpec.phases must be an array`);
  }
  const phases = phasesRaw.map((p, i) => parseTurnSpecPhase(p, file, descIndex, i));
  return {
    kindDir,
    style,
    ...(schema !== undefined ? { schema } : {}),
    ...(bashFence !== undefined ? { bashFence } : {}),
    phases,
  };
}

/** Structural-only parse of a descriptor's `panel` (mirrors parseTurnSpec's
 *  own split): throws only on missing-file-shape problems (not a mapping,
 *  `phases` not an array, a phase row missing a required scalar) — `step`/
 *  `finalizer` on each row are NOT checked against their closed vocabularies
 *  here; that is validateSessionKinds's job, same as turnSpec.phases. */
function parseSessionKindPanel(raw: Record<string, unknown>, file: string, descIndex: number): SessionKindPanel {
  const phasesRaw = raw.phases;
  if (!Array.isArray(phasesRaw)) {
    throw new Error(`${file}: descriptor[${descIndex}].panel.phases must be an array`);
  }
  const phases = phasesRaw.map((p, i) => parseTurnSpecPhase(p, file, descIndex, i));
  return { phases };
}

function parseSessionKindDescriptor(raw: unknown, index: number, file: string): SessionKindDescriptor {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: descriptor[${index}] must be a mapping, got ${Array.isArray(raw) ? 'array' : typeof raw}`);
  }
  const d = raw as Record<string, unknown>;
  const id = reqString(d, 'id', file);
  const agent = reqString(d, 'agent', file);
  const title = reqString(d, 'title', file);
  const legacyRoutes = stringArray(d, 'legacyRoutes', file);
  const stages = stringArray(d, 'stages', file);
  const defaultStage = reqString(d, 'defaultStage', file);
  const artifactRaw = reqObject(d, 'artifact', file);
  const artifact: SessionKindArtifactRef = {
    kind: reqString(artifactRaw, 'kind', file),
    label: reqString(artifactRaw, 'label', file),
  };
  // Additive-optional (ADR-043 §1): absent on every real session kind
  // shipped before R4-22 — only parse it when the yaml row actually carries
  // one, so descriptors without it are byte-for-byte the same shape as
  // before this initiative (AT-R422-5).
  const turnSpec = d.turnSpec !== undefined ? parseTurnSpec(reqObject(d, 'turnSpec', file), file, index) : undefined;
  // Additive-optional (ADR-043 2026-08-15 amendment §2), same discipline as
  // turnSpec above — only parse it when the yaml row actually carries one.
  const panel = d.panel !== undefined ? parseSessionKindPanel(reqObject(d, 'panel', file), file, index) : undefined;
  return {
    id,
    agent,
    title,
    legacyRoutes,
    stages,
    defaultStage,
    artifact,
    ...(turnSpec !== undefined ? { turnSpec } : {}),
    ...(panel !== undefined ? { panel } : {}),
  };
}

/**
 * Reads `studio/session-kinds.yaml`. Purely structural (mirrors
 * loadFlowDefinition/loadCatalog): throws only on missing file / unparseable
 * YAML / a missing required scalar. Does NOT enforce closed-vocabulary
 * membership — see validateSessionKinds for the semantic pass (AT-16 pins
 * this split: a descriptor with an unknown stage token loads without
 * throwing, unmodified, so validateSessionKinds can flag the SAME evidence).
 */
export function loadSessionKinds(forgeRoot: string): SessionKindDescriptor[] {
  const file = join(forgeRoot, SESSION_KINDS_YAML_RELATIVE);
  const sequence = loadSessionKindsSequence(file);
  return sequence.map((raw, i) => parseSessionKindDescriptor(raw, i, file));
}
