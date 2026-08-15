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

import { existsSync, readFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import yaml from 'js-yaml';
import matter from 'gray-matter';

import { reqString, reqObject, stringArray, optString } from './yaml-fields.ts';
import { listSkillMdDirs, skillsDir, SLUG_RE } from '../skill-path.ts';
import { FINALIZERS } from '../interactive-finalizers.ts';
import type { Finding } from './validate.ts';

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
 *  W6-CR-3: 'community' is the SECOND extension, an 8th token, mirroring
 *  'authoring's own precedent exactly — a single-stage session kind
 *  (community-refresh) with no natural fit among the ordered onboarding
 *  sequence, appended at the end rather than squeezed into that ordering. */
export const SESSION_STAGES = Object.freeze([
  'contract',
  'instructions',
  'secrets',
  'demo',
  'roadmap',
  'brain',
  'authoring',
  'community',
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
  // supplies (cli/contract-stages.ts's deriveContractStages) rather than
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
 *  `withStudioWrite`, orchestrator/instructions-runner.ts:491) and
 *  `recordLockedDemo` (demo's `locking` step — the deterministic
 *  snapshot-restore lock, orchestrator/demo-builder-runner.ts:405-409). Both
 *  are used ONLY by `panel.phases` rows (studio/session-kinds.yaml) for
 *  affordance derivation — never by a real `turnSpec`, so `resolveFinalizer`
 *  (orchestrator/interactive-runner.ts) never has to implement them; adding
 *  them here does not reopen the "gains no new row for kb-cleanup" ratchet's
 *  intent (that test pinned kb-cleanup's OWN phase table needing none, not a
 *  blanket freeze on this registry's size — see its updated comment).
 *
 *  W6-CR-3: `commitRegistryDraft` is added alongside — it IS dispatched via
 *  `turnSpec` (the `community-refresh` kind's `committing` phase), so it
 *  lives in `FINALIZERS` too (`orchestrator/interactive-finalizers.ts`) and
 *  therefore also in `DISPATCHABLE_FINALIZER_IDS` below, unlike
 *  `writeToRepoRoot`/`recordLockedDemo` immediately above. Typed `readonly`,
 *  as TURN_STYLES. */
export const FINALIZER_IDS: readonly FinalizerIdRow[] = Object.freeze([
  Object.freeze({ id: 'copyStagingToLibrary' }),
  Object.freeze({ id: 'writeToRepoRoot' }),
  Object.freeze({ id: 'recordLockedDemo' }),
  Object.freeze({ id: 'commitRegistryDraft' }),
]);
export type FinalizerId = (typeof FINALIZER_IDS)[number]['id'];

/**
 * The DISPATCHABLE finalizer id set — derived DIRECTLY from
 * `orchestrator/interactive-finalizers.ts`'s `FINALIZERS` registry keys, not
 * a hand-maintained mirror (that module has no import path back to this one
 * — it only imports node builtins + `cli/studio-path-guard.ts`, which itself
 * imports only node builtins — so this is a plain, cycle-free import, not a
 * duplicated literal).
 *
 * Reviewer finding (W6-B3 post-merge review): a `turnSpec.phases` row naming
 * a `finalize` step is REAL dispatchable data — `runInteractiveTurn`
 * (orchestrator/interactive-runner.ts) resolves its `finalizer` id via
 * `resolveFinalizer`, which throws `InteractiveFinalizerError` at SPAWN TIME
 * for any id `FINALIZERS` does not carry. `FINALIZER_IDS` above is the
 * DESCRIPTIVE, ADR-043 §5 vocabulary (every finalizer the ADR names, whether
 * or not it is wired to the primitive yet) — validating a `turnSpec` row
 * against that WIDER set would lint-approve `writeToRepoRoot`/
 * `recordLockedDemo`, both of which are real, but neither of which
 * `FINALIZERS` implements (demo/instructions never migrate onto `turnSpec`,
 * 2026-08-14 amendment §1) — a shared vocabulary must never lint-approve
 * what dispatch will throw on. `panel.phases` rows are NEVER dispatched
 * (invisible to `cmdAgentRun`'s turnSpec fork — ADR-043 2026-08-15 amendment
 * §2), so they correctly keep validating against the full descriptive
 * `FINALIZER_IDS`.
 */
const DISPATCHABLE_FINALIZER_IDS: readonly FinalizerIdRow[] = Object.freeze(FINALIZERS.map((row) => Object.freeze({ id: row.id })));

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
 *  Typed `readonly`, as AWAITS_KINDS. */
export const VERDICT_VALUES: readonly VerdictValueRow[] = Object.freeze([
  Object.freeze({ id: 'approve' }),
  Object.freeze({ id: 'reject' }),
]);
export type VerdictValue = (typeof VERDICT_VALUES)[number]['id'];

export function verdictValueState(id: string): string | undefined {
  return VERDICT_VALUES.find((s) => s.id === id)?.id;
}

/** Renders a closed-vocabulary's allowed set for an error message — honest
 *  even when the set is empty (SCHEMA_IDS today), never silently omitted. */
function allowedIdsSummary(rows: readonly { readonly id: string }[]): string {
  return rows.length > 0 ? rows.map((r) => r.id).join('|') : '(none registered yet)';
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
  readonly phases: readonly TurnSpecPhase[];
};

/** The read-half twin of `turnSpec` for a legacy kind (ADR-043 2026-08-15
 *  amendment §2) — `phases` rows use the SAME `TurnSpecPhase` shape and the
 *  SAME frozen vocabulary (TURN_STEPS/FINALIZER_IDS) as `turnSpec.phases`,
 *  but carry no `kindDir`/`style`/`schema`: `panel` is consumed ONLY by
 *  `deriveSessionAffordances` (the read half) and is INVISIBLE to dispatch —
 *  `cmdAgentRun`'s turnSpec-fork condition (cli/agent-run.ts) never looks at
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
  const phasesRaw = raw.phases;
  if (!Array.isArray(phasesRaw)) {
    throw new Error(`${file}: descriptor[${descIndex}].turnSpec.phases must be an array`);
  }
  const phases = phasesRaw.map((p, i) => parseTurnSpecPhase(p, file, descIndex, i));
  return {
    kindDir,
    style,
    ...(schema !== undefined ? { schema } : {}),
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

// ---------------------------------------------------------------------------
// Agent-ref resolution — every skills/*/SKILL.md with a runtime: block,
// regardless of `library: false` (see header rationale; AT-12, AT-17).
// ---------------------------------------------------------------------------

function discoverRuntimeAgentIds(forgeRoot: string): Set<string> {
  const ids = new Set<string>();
  for (const dir of listSkillMdDirs(skillsDir(forgeRoot))) {
    const skillMdPath = join(dir, 'SKILL.md');
    try {
      const raw = readFileSync(skillMdPath, 'utf8');
      const { data } = matter(raw, {});
      if (data !== null && typeof data === 'object' && !Array.isArray(data) && 'runtime' in (data as Record<string, unknown>)) {
        ids.add(basename(dir));
      }
    } catch {
      // Unreadable/unparseable SKILL.md — simply doesn't resolve as a known
      // agent here. Surfacing SKILL.md-level parse errors is studio-lint's
      // agent-loading section's job (section 1), not this validator's.
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// validateSessionKinds — semantic rules
// ---------------------------------------------------------------------------

function err(object: string, check: string, message: string): Finding {
  return { level: 'error', object, check, message };
}

const CHECK_LOAD_ERROR = 'session-kinds/load-error';
const CHECK_SLUG = 'session-kinds/slug';
const CHECK_DUPLICATE_ID = 'session-kinds/duplicate-id';
const CHECK_UNKNOWN_AGENT = 'session-kinds/unknown-agent';
const CHECK_EMPTY_STAGES = 'session-kinds/empty-stages';
const CHECK_UNKNOWN_STAGE = 'session-kinds/unknown-stage';
const CHECK_DEFAULT_STAGE_NOT_IN_STAGES = 'session-kinds/default-stage-not-in-stages';
const CHECK_UNKNOWN_ARTIFACT_KIND = 'session-kinds/unknown-artifact-kind';
const CHECK_RESERVED_ARTIFACT_KIND = 'session-kinds/reserved-artifact-kind';
const CHECK_LEGACY_ROUTE_NOT_FOUND = 'session-kinds/legacy-route-not-found';
const CHECK_TURNSPEC_UNKNOWN_STYLE = 'session-kinds/turnspec-unknown-style';
const CHECK_TURNSPEC_UNKNOWN_STEP = 'session-kinds/turnspec-unknown-step';
const CHECK_TURNSPEC_UNKNOWN_FINALIZER = 'session-kinds/turnspec-unknown-finalizer';
const CHECK_TURNSPEC_UNKNOWN_SCHEMA = 'session-kinds/turnspec-unknown-schema';
// R4-22 WI-1 adversarial-review round (AT-R422-11..18): turnSpec.phases is a
// STATE MACHINE, and its graph coherence was validated nowhere — every check
// below was confirmed by execution to load clean, zero findings, before this
// round. See the file header CRITICAL note for kindDir/SLUG_RE.
const CHECK_TURNSPEC_UNSAFE_KIND_DIR = 'session-kinds/turnspec-unsafe-kind-dir';
const CHECK_TURNSPEC_DANGLING_NEXT = 'session-kinds/turnspec-dangling-next';
const CHECK_TURNSPEC_FINALIZE_MISSING_FINALIZER = 'session-kinds/turnspec-finalize-missing-finalizer';
const CHECK_TURNSPEC_NO_TERMINAL_PHASE = 'session-kinds/turnspec-no-terminal-phase';
const CHECK_TURNSPEC_DUPLICATE_PHASE = 'session-kinds/turnspec-duplicate-phase';
const CHECK_TURNSPEC_EMPTY_PHASES = 'session-kinds/turnspec-empty-phases';
const CHECK_TURNSPEC_STRUCTURED_UNSUPPORTED = 'session-kinds/turnspec-structured-unsupported';
// W6-B3 (ADR-043 2026-08-15 amendment §2) — panel.phases reuses the SAME
// phase-row vocab checks as turnSpec.phases (validatePhaseTable below is
// shared by both), under a "panel-" prefix so a panel-side rejection is
// never confused with a turnSpec-side one in test/log output. No panel
// analog exists for kindDir/style/schema/structured-unsupported — panel
// carries none of those fields.
const CHECK_PANEL_UNKNOWN_STEP = 'session-kinds/panel-unknown-step';
const CHECK_PANEL_UNKNOWN_FINALIZER = 'session-kinds/panel-unknown-finalizer';
const CHECK_PANEL_DANGLING_NEXT = 'session-kinds/panel-dangling-next';
const CHECK_PANEL_FINALIZE_MISSING_FINALIZER = 'session-kinds/panel-finalize-missing-finalizer';
const CHECK_PANEL_NO_TERMINAL_PHASE = 'session-kinds/panel-no-terminal-phase';
const CHECK_PANEL_DUPLICATE_PHASE = 'session-kinds/panel-duplicate-phase';
const CHECK_PANEL_EMPTY_PHASES = 'session-kinds/panel-empty-phases';
// W6-B3 post-merge review — `awaits` (a `step: noop` row's REQUIRED,
// AUTHORED "what is the operator being asked for" field, AWAITS_KINDS)
// mirrors `finalizer`'s own two-check shape exactly: an UNKNOWN value (the
// key is present but not in AWAITS_KINDS) vs a MISSING one (a noop row that
// omits the key entirely) are distinct failure modes, distinct checks — see
// CHECK_TURNSPEC_UNKNOWN_FINALIZER / CHECK_TURNSPEC_FINALIZE_MISSING_FINALIZER
// for the precedent this pair follows.
const CHECK_TURNSPEC_UNKNOWN_AWAITS = 'session-kinds/turnspec-unknown-awaits';
const CHECK_TURNSPEC_NOOP_MISSING_AWAITS = 'session-kinds/turnspec-noop-missing-awaits';
const CHECK_PANEL_UNKNOWN_AWAITS = 'session-kinds/panel-unknown-awaits';
const CHECK_PANEL_NOOP_MISSING_AWAITS = 'session-kinds/panel-noop-missing-awaits';
// W6-B6 post-merge review — `verdicts` (a `noop`+`awaits:'verdict'` row's
// OPTIONAL, AUTHORED "which verdict values are legal here" field,
// VERDICT_VALUES) mirrors `awaits`'s own two-check shape: an UNKNOWN value
// (a `verdicts` entry outside VERDICT_VALUES) vs a MISPLACED declaration (a
// `verdicts` key present on a row that is NOT a `noop`+`awaits:'verdict'`
// row, where the field is meaningless) are distinct failure modes, distinct
// checks.
const CHECK_TURNSPEC_UNKNOWN_VERDICT = 'session-kinds/turnspec-unknown-verdict';
const CHECK_TURNSPEC_VERDICTS_MISPLACED = 'session-kinds/turnspec-verdicts-misplaced';
const CHECK_PANEL_UNKNOWN_VERDICT = 'session-kinds/panel-unknown-verdict';
const CHECK_PANEL_VERDICTS_MISPLACED = 'session-kinds/panel-verdicts-misplaced';
// W6-B9 (reviewer finding on W6-B8) — `requires` (a `noop`+`awaits:'verdict'`
// row's OPTIONAL, AUTHORED "which extra POST body fields this verdict needs"
// field) mirrors `verdicts`' OWN misplaced-check half only — there is no
// "unknown value" counterpart (no closed vocabulary of legal body-field
// NAMES exists, mirroring `writes`' own structural-only, unchecked-value
// discipline; see TurnSpecPhase.requires's own doc comment).
const CHECK_TURNSPEC_REQUIRES_MISPLACED = 'session-kinds/turnspec-requires-misplaced';
const CHECK_PANEL_REQUIRES_MISPLACED = 'session-kinds/panel-requires-misplaced';
// The turnSpec⊕panel mutual-exclusion check (ADR-043 2026-08-15 amendment
// §2): a descriptor carrying BOTH is rejected with exactly one finding
// naming the kind and both fields — see the exclusivity guard in the main
// loop below, which skips both the turnSpec AND panel blocks entirely when
// both are present, so this is the ONLY finding a doubly-declared descriptor
// ever produces.
const CHECK_TURNSPEC_PANEL_EXCLUSIVE = 'session-kinds/turnspec-panel-exclusive';

/** True if `seg` contains any C0 control character (codepoint 0-31
 *  inclusive), mirroring cli/studio-path-guard.ts's own CONTROL_CHAR_RE
 *  scan for the same range — written here as an explicit codepoint scan,
 *  not a `/[\u0000-\u001f]/`-style character-class literal, so this source
 *  file itself never has to carry a raw control byte inside a regex
 *  literal. */
function hasControlChar(seg: string): boolean {
  for (let i = 0; i < seg.length; i++) {
    if (seg.charCodeAt(i) <= 0x1f) return true;
  }
  return false;
}

/**
 * turnSpec.kindDir must be a safe single path segment — it becomes
 * `resolveGuardedPath(projectRoot, [kindDir, sessionId])` in the generic
 * runner (docs/decisions/043-generic-interactive-surface.md §1), the SEC-04
 * containment guard root. `d.id` one screen down is validated against
 * SLUG_RE (CHECK_SLUG) but SLUG_RE requires a leading `a-z` letter, and
 * every REAL kindDir value in this design is underscore-prefixed
 * (`_authoring`, `_architect`, `_demo`) — reusing SLUG_RE for kindDir would
 * reject every legitimate shipped value. This mirrors `isSafeSegment` in
 * cli/studio-path-guard.ts EXACTLY (no separators, no "." or "..", no C0
 * control characters) — the same predicate `resolveGuardedPath` itself
 * relies on one layer further down. NOT imported from that module because
 * `isSafeSegment` is not exported there (an internal helper of a file this
 * initiative's file-boundary does not touch); kept in exact lockstep by
 * design — any future edit to isSafeSegment must be mirrored here too.
 */
function isSafeKindDirSegment(seg: string): boolean {
  return (
    seg.length > 0 &&
    seg !== '.' &&
    seg !== '..' &&
    !seg.includes('/') &&
    !seg.includes('\\') &&
    !seg.includes(sep) &&
    !hasControlChar(seg)
  );
}

/** Check-id bundle for `validatePhaseTable` below — one per phase-row-level
 *  rule, so a caller (turnSpec vs panel) supplies its own check-id family
 *  while sharing every byte of the actual rule logic. */
type PhaseTableCheckIds = {
  readonly unknownStep: string;
  readonly unknownFinalizer: string;
  readonly finalizeMissingFinalizer: string;
  readonly danglingNext: string;
  readonly duplicatePhase: string;
  readonly noTerminalPhase: string;
  readonly emptyPhases: string;
  readonly unknownAwaits: string;
  readonly noopMissingAwaits: string;
  readonly unknownVerdict: string;
  readonly verdictsMisplaced: string;
  readonly requiresMisplaced: string;
};

const TURNSPEC_PHASE_CHECK_IDS: PhaseTableCheckIds = {
  unknownStep: CHECK_TURNSPEC_UNKNOWN_STEP,
  unknownFinalizer: CHECK_TURNSPEC_UNKNOWN_FINALIZER,
  finalizeMissingFinalizer: CHECK_TURNSPEC_FINALIZE_MISSING_FINALIZER,
  danglingNext: CHECK_TURNSPEC_DANGLING_NEXT,
  duplicatePhase: CHECK_TURNSPEC_DUPLICATE_PHASE,
  noTerminalPhase: CHECK_TURNSPEC_NO_TERMINAL_PHASE,
  emptyPhases: CHECK_TURNSPEC_EMPTY_PHASES,
  unknownAwaits: CHECK_TURNSPEC_UNKNOWN_AWAITS,
  noopMissingAwaits: CHECK_TURNSPEC_NOOP_MISSING_AWAITS,
  unknownVerdict: CHECK_TURNSPEC_UNKNOWN_VERDICT,
  verdictsMisplaced: CHECK_TURNSPEC_VERDICTS_MISPLACED,
  requiresMisplaced: CHECK_TURNSPEC_REQUIRES_MISPLACED,
};

const PANEL_PHASE_CHECK_IDS: PhaseTableCheckIds = {
  unknownStep: CHECK_PANEL_UNKNOWN_STEP,
  unknownFinalizer: CHECK_PANEL_UNKNOWN_FINALIZER,
  finalizeMissingFinalizer: CHECK_PANEL_FINALIZE_MISSING_FINALIZER,
  danglingNext: CHECK_PANEL_DANGLING_NEXT,
  duplicatePhase: CHECK_PANEL_DUPLICATE_PHASE,
  noTerminalPhase: CHECK_PANEL_NO_TERMINAL_PHASE,
  emptyPhases: CHECK_PANEL_EMPTY_PHASES,
  unknownAwaits: CHECK_PANEL_UNKNOWN_AWAITS,
  noopMissingAwaits: CHECK_PANEL_NOOP_MISSING_AWAITS,
  unknownVerdict: CHECK_PANEL_UNKNOWN_VERDICT,
  verdictsMisplaced: CHECK_PANEL_VERDICTS_MISPLACED,
  requiresMisplaced: CHECK_PANEL_REQUIRES_MISPLACED,
};

/**
 * Shared phase-row-level validation for BOTH `turnSpec.phases` and
 * `panel.phases` (ADR-043 2026-08-15 amendment §2 — panel reuses the SAME
 * frozen phase-row vocabulary as turnSpec, never a forked copy; AT-R422-13..18
 * originally lived inline in the turnSpec block only — this extraction keeps
 * every one of those six rules byte-identical for turnSpec while giving panel
 * the same coverage under its own `panel-*` check-id family, so a panel-side
 * rejection is never confused with a turnSpec-side one). `tableLabel`
 * ("turnSpec.phases" | "panel.phases") is the only thing that varies in the
 * message text. `writes` is deliberately NOT validated here — see
 * TurnSpecPhase's own EXPIRY CONDITION doc comment (no `writes` vocabulary
 * exists yet, for either table).
 *
 * `allowedFinalizers` (W6-B3 post-merge review): the caller supplies its OWN
 * finalizer set rather than this function reading a fixed global — `turnSpec`
 * (real dispatch, `resolveFinalizer` in orchestrator/interactive-runner.ts)
 * must validate against `DISPATCHABLE_FINALIZER_IDS` (derived from
 * `orchestrator/interactive-finalizers.ts`'s `FINALIZERS` registry — the set
 * dispatch will actually resolve), while `panel` (never dispatched) validates
 * against the full descriptive `FINALIZER_IDS`. A shared vocabulary must
 * never lint-approve a value dispatch will throw on.
 */
function validatePhaseTable(
  d: SessionKindDescriptor,
  phases: readonly TurnSpecPhase[],
  obj: string,
  tableLabel: string,
  checkIds: PhaseTableCheckIds,
  allowedFinalizers: readonly FinalizerIdRow[],
  findings: Finding[],
): void {
  // empty-phases (AT-R422-17): a state machine with zero rows can never run a
  // single turn — the direct analog of CHECK_EMPTY_STAGES above.
  if (phases.length === 0) {
    findings.push(err(obj, checkIds.emptyPhases, `Session kind "${d.id}" declares an empty ${tableLabel} list — at least one phase is required`));
  }

  // Real phase-name set for the dangling-next check below (the direct analog
  // of `defaultStage ∈ stages`, this is `next ∈ phase-names`) — built once,
  // ahead of the loop, over every declared phase (including any duplicate, so
  // a `next` that only a duplicate row satisfies still resolves).
  const phaseNames = [...new Set(phases.map((p) => p.phase))];
  const phaseNameSet = new Set(phaseNames);
  const seenPhaseNames = new Set<string>();

  for (const phase of phases) {
    if (turnStepState(phase.step) === undefined) {
      findings.push(
        err(
          obj,
          checkIds.unknownStep,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares step "${phase.step}" — must be one of ${allowedIdsSummary(TURN_STEPS)}`,
        ),
      );
    }
    if (phase.finalizer !== undefined && !allowedFinalizers.some((row) => row.id === phase.finalizer)) {
      findings.push(
        err(
          obj,
          checkIds.unknownFinalizer,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares finalizer "${phase.finalizer}" — must be one of ${allowedIdsSummary(allowedFinalizers)}`,
        ),
      );
    }

    // finalize-missing-finalizer (AT-R422-14): the check above only ever
    // fires when `finalizer` IS present (`phase.finalizer !== undefined`) — a
    // `step: finalize` phase that omits the KEY entirely never enters that
    // branch. `'finalizer' in phase` distinguishes "key absent" from "key
    // present, value undefined" (parseTurnSpecPhase only ever sets the key
    // when the source YAML carries one — AT-R422-6/19).
    if (phase.step === 'finalize' && !('finalizer' in phase)) {
      findings.push(
        err(obj, checkIds.finalizeMissingFinalizer, `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" has step "finalize" but is missing the required "finalizer" field`),
      );
    }

    // unknown-awaits (W6-B3 post-merge review): the check above's finalizer
    // shape, applied to `awaits` — fires only when the key IS present with a
    // value outside AWAITS_KINDS.
    if (phase.awaits !== undefined && awaitsKindState(phase.awaits) === undefined) {
      findings.push(
        err(
          obj,
          checkIds.unknownAwaits,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares awaits "${phase.awaits}" — must be one of ${allowedIdsSummary(AWAITS_KINDS)}`,
        ),
      );
    }

    // noop-missing-awaits (W6-B3 post-merge review): mirrors
    // finalize-missing-finalizer's exact shape — a `step: noop` phase that
    // omits `awaits` ENTIRELY (the key itself absent, `'awaits' in phase` is
    // false) is an error naming the kind, the phase, and the allowed set. No
    // fallback, no silent misclassification: `deriveSessionAffordances`
    // trusts `awaits` is present on every noop row it is asked to derive,
    // and this is the check that makes that trust safe.
    if (phase.step === 'noop' && !('awaits' in phase)) {
      findings.push(
        err(
          obj,
          checkIds.noopMissingAwaits,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" has step "noop" but is missing the required "awaits" field — must be one of ${allowedIdsSummary(AWAITS_KINDS)}`,
        ),
      );
    }

    // W6-B6 post-merge review — verdicts-misplaced: `verdicts` is meaningful
    // ONLY on a `noop` row whose `awaits` is `'verdict'` (the row
    // `deriveSessionAffordances` turns into a `verdict`-kind affordance) —
    // declared anywhere else it can never be read, so it is rejected as
    // dead, confusing authored data rather than silently ignored.
    if (phase.verdicts !== undefined && !(phase.step === 'noop' && phase.awaits === 'verdict')) {
      findings.push(
        err(
          obj,
          checkIds.verdictsMisplaced,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares "verdicts" but is not a "noop" step with awaits "verdict" — "verdicts" is only meaningful there`,
        ),
      );
    }

    // unknown-verdict: mirrors unknown-awaits's exact shape — each entry of
    // a present `verdicts` list must be a real VERDICT_VALUES member.
    if (phase.verdicts !== undefined) {
      for (const v of phase.verdicts) {
        if (verdictValueState(v) === undefined) {
          findings.push(
            err(
              obj,
              checkIds.unknownVerdict,
              `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares verdict "${v}" — must be one of ${allowedIdsSummary(VERDICT_VALUES)}`,
            ),
          );
        }
      }
    }

    // W6-B9 (reviewer finding on W6-B8) — requires-misplaced: mirrors
    // verdicts-misplaced's exact shape. `requires` is meaningful ONLY on a
    // `noop` row whose `awaits` is `'verdict'` — declared anywhere else it
    // can never be read (deriveSessionAffordances only ever attaches
    // `meta.requires` off a verdict-kind row), so it is rejected as dead,
    // confusing authored data rather than silently ignored. No
    // unknown-value counterpart exists (see TurnSpecPhase.requires's own
    // doc comment — structural only, like `writes`).
    if (phase.requires !== undefined && !(phase.step === 'noop' && phase.awaits === 'verdict')) {
      findings.push(
        err(
          obj,
          checkIds.requiresMisplaced,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" declares "requires" but is not a "noop" step with awaits "verdict" — "requires" is only meaningful there`,
        ),
      );
    }

    // dangling-next (AT-R422-13): mirrors CHECK_DEFAULT_STAGE_NOT_IN_STAGES's
    // shape/message style — `next ∈ phase-names` is the direct structural
    // analog of `defaultStage ∈ stages`.
    if (phase.next !== undefined && !phaseNameSet.has(phase.next)) {
      findings.push(
        err(
          obj,
          checkIds.danglingNext,
          `Session kind "${d.id}" ${tableLabel} phase "${phase.phase}" next "${phase.next}" is not a member of its own declared phases [${phaseNames.join(', ')}]`,
        ),
      );
    }

    // duplicate-phase (AT-R422-16): mirrors CHECK_DUPLICATE_ID's shape/message
    // style.
    if (seenPhaseNames.has(phase.phase)) {
      findings.push(err(obj, checkIds.duplicatePhase, `Session kind "${d.id}" ${tableLabel} declares duplicate phase name "${phase.phase}"`));
    } else {
      seenPhaseNames.add(phase.phase);
    }
  }

  // no-terminal-phase (AT-R422-15): the table as a WHOLE, not any single row
  // — the generic runner's dispatch loop (or, for panel, the derivation fn)
  // needs a legal phase to stop advancing from.
  if (!phases.some((p) => p.step === 'terminal')) {
    findings.push(
      err(obj, checkIds.noTerminalPhase, `Session kind "${d.id}" ${tableLabel} has no phase with step "terminal" — the state machine has no legal stopping point`),
    );
  }
}

const FORGE_UI_APP_DIRNAME = join('forge-ui', 'app');

/** A `legacyRoutes` entry ("/architect/[sessionId]/interview") maps 1:1 onto a
 *  Next.js App Router directory ("forge-ui/app/architect/[sessionId]/interview")
 *  — route path segments ARE the directory names, including literal
 *  `[sessionId]` dynamic-segment folders. An entry with no non-empty segments
 *  (blank or "/") never resolves.
 *
 *  Containment (AT-amendment-3, A1 / AT-61..67): `path.join()` normalises
 *  `..` segments BEFORE `existsSync` ever runs, so a naive
 *  `join(appDir, ...segments)` can resolve anywhere on the filesystem —
 *  including, with enough repeated `..`, an arbitrary absolute path once the
 *  climb clamps past the real filesystem root. Two independent guards apply,
 *  mirroring the `resolveSafeSessionDir` / `safeReadFileInSession`
 *  containment pattern used elsewhere in this PR: (1) the join-normalised
 *  candidate must equal `appDir` or start with `appDir + sep`; (2) ANY raw
 *  segment that is literally `..` is rejected outright, even when the
 *  resulting path would numerically round-trip back inside `appDir` — a
 *  `legacyRoutes` value is a declared Studio route path, not a filesystem
 *  expression to be evaluated (T2 ruling, AT-67), so an escape-and-return
 *  string like "../app/foo/[sessionId]" is refused on its own terms rather
 *  than accidentally accepted because it normalises back inside.
 *
 *  Honest limit (accepted, not fixed): this checks that the DIRECTORY
 *  exists, not that it still hosts a live route (a `page.tsx`/`route.ts`
 *  file). A directory left behind after its page file was deleted still
 *  passes — see AT coverage; a follow-up, stated rather than implied away. */
function legacyRouteResolves(forgeRoot: string, route: string): boolean {
  const segments = route.trim().replace(/^\//, '').split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return false;
  if (segments.includes('..')) return false;
  const appDir = join(forgeRoot, FORGE_UI_APP_DIRNAME);
  const candidate = join(appDir, ...segments);
  if (candidate !== appDir && !candidate.startsWith(appDir + sep)) return false;
  return existsSync(candidate);
}

/**
 * All semantic rules over `studio/session-kinds.yaml`: closed-vocabulary
 * membership (stages, artifact kinds), cross-field consistency
 * (defaultStage ∈ stages), slug shape, duplicate ids, and agent-ref
 * resolution (against every runtime-bearing SKILL.md, not the library-only
 * roster). A load failure (missing file / unparseable YAML) returns EXACTLY
 * one `session-kinds/load-error` finding, never a silently empty list.
 */
export function validateSessionKinds(forgeRoot: string): Finding[] {
  let descriptors: SessionKindDescriptor[];
  try {
    descriptors = loadSessionKinds(forgeRoot);
  } catch (loadErr) {
    return [err('studio:session-kinds', CHECK_LOAD_ERROR, (loadErr as Error).message)];
  }

  const findings: Finding[] = [];
  const knownAgentIds = discoverRuntimeAgentIds(forgeRoot);
  const seenIds = new Set<string>();
  const allowedStages = SESSION_STAGES.join('|');
  const allowedArtifactKinds = SESSION_ARTIFACT_KINDS.map((k) => k.id).join('|');

  for (const d of descriptors) {
    const obj = `session-kind:${d.id}`;

    if (seenIds.has(d.id)) {
      findings.push(err(obj, CHECK_DUPLICATE_ID, `Duplicate session-kind id "${d.id}"`));
    } else {
      seenIds.add(d.id);
    }

    if (!SLUG_RE.test(d.id)) {
      findings.push(err(obj, CHECK_SLUG, `Session-kind id "${d.id}" does not match ${SLUG_RE}`));
    }

    if (!knownAgentIds.has(d.agent)) {
      const allowedAgents = [...knownAgentIds].sort().join(', ');
      findings.push(
        err(
          obj,
          CHECK_UNKNOWN_AGENT,
          `Session kind "${d.id}" references unknown agent "${d.agent}" — no skills/*/SKILL.md with a runtime: block resolves to this id; known agents: ${allowedAgents}`,
        ),
      );
    }

    if (d.stages.length === 0) {
      findings.push(err(obj, CHECK_EMPTY_STAGES, `Session kind "${d.id}" declares an empty stages list — at least one stage is required`));
    }

    // legacyRoutes: an empty LIST is legal (a future kind may have no
    // predecessor route) — but every entry PRESENT must be non-blank and
    // resolve to a real forge-ui/app/ route directory (previously parsed,
    // typed, and echoed by tests but never actually checked here).
    for (const route of d.legacyRoutes) {
      if (!legacyRouteResolves(forgeRoot, route)) {
        findings.push(
          err(
            obj,
            CHECK_LEGACY_ROUTE_NOT_FOUND,
            `Session kind "${d.id}" declares legacyRoutes entry "${route}" which does not resolve to a real forge-ui/app/ route directory`,
          ),
        );
      }
    }

    for (const stage of d.stages) {
      if (!(SESSION_STAGES as readonly string[]).includes(stage)) {
        findings.push(
          err(obj, CHECK_UNKNOWN_STAGE, `Session kind "${d.id}" declares unknown stage "${stage}" — must be one of ${allowedStages}`),
        );
      }
    }

    if (!d.stages.includes(d.defaultStage)) {
      findings.push(
        err(
          obj,
          CHECK_DEFAULT_STAGE_NOT_IN_STAGES,
          `Session kind "${d.id}" defaultStage "${d.defaultStage}" is not a member of its own declared stages [${d.stages.join(', ')}]`,
        ),
      );
    }

    const artifactState = sessionArtifactKindState(d.artifact.kind);
    if (artifactState === undefined) {
      findings.push(
        err(
          obj,
          CHECK_UNKNOWN_ARTIFACT_KIND,
          `Session kind "${d.id}" declares unknown artifact kind "${d.artifact.kind}" — must be one of ${allowedArtifactKinds}`,
        ),
      );
    } else if (artifactState === 'reserved') {
      findings.push(
        err(
          obj,
          CHECK_RESERVED_ARTIFACT_KIND,
          `Session kind "${d.id}" declares reserved artifact kind "${d.artifact.kind}" — it parses fine but has no renderer implementation anywhere; wire the renderer (and flip it live in SESSION_ARTIFACT_KINDS) before using it`,
        ),
      );
    }

    // turnSpec ⊕ panel (W6-B3, ADR-043 2026-08-15 amendment §2): mutually
    // exclusive — a descriptor carrying BOTH gets exactly ONE finding, naming
    // the kind and both fields, and neither block below runs at all (running
    // them would produce a pile of secondary findings on a descriptor that is
    // already fundamentally malformed, obscuring the one finding that
    // actually matters).
    if (d.turnSpec !== undefined && d.panel !== undefined) {
      findings.push(
        err(
          obj,
          CHECK_TURNSPEC_PANEL_EXCLUSIVE,
          `Session kind "${d.id}" declares BOTH "turnSpec" and "panel" — these are mutually exclusive (turnSpec drives dispatch, panel is its read-only twin for a legacy kind); remove one`,
        ),
      );
    } else {
      // turnSpec (R4-22 WI-1, ADR-043 §1): additive-optional, so a descriptor
      // with none skips this block entirely (AT-R422-5) — no finding, no
      // default. Every closed-vocabulary rejection below names BOTH the
      // offending value AND the allowed set (the file's binding rule, header
      // comment), even when that set is empty (SCHEMA_IDS today).
      if (d.turnSpec !== undefined) {
        const ts = d.turnSpec;

        // kindDir (AT-R422-11, 12): the ONE containment segment (ADR-043 §1)
        // — checked BEFORE anything else in this block, matching the
        // review's finding that this is the single most important gap. See
        // isSafeKindDirSegment's own doc comment for why SLUG_RE/CHECK_SLUG
        // (the sibling check on `d.id` above) cannot be reused here.
        if (!isSafeKindDirSegment(ts.kindDir)) {
          findings.push(
            err(
              obj,
              CHECK_TURNSPEC_UNSAFE_KIND_DIR,
              `Session kind "${d.id}" declares turnSpec.kindDir "${ts.kindDir}" — not a safe single path segment (no "/", "\\", ".", "..", or control characters)`,
            ),
          );
        }

        if (turnStyleState(ts.style) === undefined) {
          findings.push(
            err(
              obj,
              CHECK_TURNSPEC_UNKNOWN_STYLE,
              `Session kind "${d.id}" declares turnSpec.style "${ts.style}" — must be one of ${allowedIdsSummary(TURN_STYLES)}`,
            ),
          );
        }

        // structured-unsupported (AT-R422-18): "structured" IS a member of
        // TURN_STYLES (the unknown-style check above stays silent for it),
        // but SCHEMA_IDS ships deliberately EMPTY for R4-22 WI-1 — no schema
        // id can ever validate, so a structured turnSpec can NEVER be made
        // valid. Saying nothing would be a silent pass on a value that is
        // honestly unusable; this fires unconditionally on style:
        // "structured" while SCHEMA_IDS.length === 0, and self-expires
        // (mirrors the SCHEMA_IDS EXPIRY CONDITION comment above) the moment
        // a first schema id is seeded — at that point this becomes a real
        // membership check instead of a blanket one.
        if (ts.style === 'structured' && SCHEMA_IDS.length === 0) {
          findings.push(
            err(
              obj,
              CHECK_TURNSPEC_STRUCTURED_UNSUPPORTED,
              `Session kind "${d.id}" declares turnSpec.style "structured" but no schema is registered yet (SCHEMA_IDS is empty) — a structured turnSpec cannot be made valid until a schema id is seeded`,
            ),
          );
        }

        if (ts.schema !== undefined && schemaIdState(ts.schema) === undefined) {
          findings.push(
            err(
              obj,
              CHECK_TURNSPEC_UNKNOWN_SCHEMA,
              `Session kind "${d.id}" declares turnSpec.schema "${ts.schema}" — must be one of ${allowedIdsSummary(SCHEMA_IDS)}`,
            ),
          );
        }

        validatePhaseTable(d, ts.phases, obj, 'turnSpec.phases', TURNSPEC_PHASE_CHECK_IDS, DISPATCHABLE_FINALIZER_IDS, findings);

        // `writes` (each phase's optional staging-area list) is deliberately
        // NOT validated anywhere in this block — see TurnSpecPhase's own
        // EXPIRY CONDITION doc comment above for why and when.
      }

      // panel (W6-B3, ADR-043 2026-08-15 amendment §2): additive-optional,
      // same discipline as turnSpec above — a descriptor with none skips this
      // block entirely, no finding, no default. Only the phase-row-level
      // checks apply (panel carries no kindDir/style/schema to validate).
      if (d.panel !== undefined) {
        validatePhaseTable(d, d.panel.phases, obj, 'panel.phases', PANEL_PHASE_CHECK_IDS, FINALIZER_IDS, findings);
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// deriveSessionAffordances — the read-half affordance view (ADR-043 §1
// "affordances are derived, not authored" + the 2026-08-15 wave-6 amendment
// §1: the shell read route computes `affordances[]` server-side from the
// phase table; the client renders what it is handed and never re-derives).
// ---------------------------------------------------------------------------

export type SessionAffordanceKind = 'question-form' | 'verdict' | 'staged-review' | 'next-turn';

/** One derived affordance the CURRENT phase makes available. JSON-serializable
 *  (no functions, no class instances) — the bridge threads this straight onto
 *  the wire (cli/bridge-studio-sessions.ts), and B6's UI renders each `kind`
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
