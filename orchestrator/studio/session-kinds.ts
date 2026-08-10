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
 * structural) but is a lint ERROR on use (validateSessionKinds) — R4-15/16/17
 * extend this registry by adding a descriptor (not a page) plus, when they
 * ship, a renderer that promotes the matching row from reserved to live.
 * Zero stub renderers exist anywhere for the three reserved kinds today.
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
import type { Finding } from './validate.ts';

// ---------------------------------------------------------------------------
// Closed vocabularies (frozen — rows-as-data, mirrors TRIGGER_KINDS)
// ---------------------------------------------------------------------------

/** The six session stages, order significant (the session shell's tab/stepper
 *  order). Closed — a descriptor's `stages`/`defaultStage` must draw from
 *  this set (enforced by validateSessionKinds, not the loader). */
export const SESSION_STAGES = Object.freeze([
  'contract',
  'instructions',
  'secrets',
  'demo',
  'roadmap',
  'brain',
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
  Object.freeze({ id: 'file-package', status: 'reserved' }),
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
 *  bespoke residue") — seeded with the ADR's own worked example only. Typed `readonly`, as TURN_STYLES. */
export const FINALIZER_IDS: readonly FinalizerIdRow[] = Object.freeze([
  Object.freeze({ id: 'copyStagingToLibrary' }),
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

/** Total lookups over the four turnSpec vocabularies: the matching id, or
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
 *  `writes`/`next`/`finalizer` are genuinely optional — a `terminal` or
 *  `noop` phase carries neither. Structural only: `step` and `finalizer`
 *  are NOT validated against TURN_STEPS/FINALIZER_IDS here — see
 *  validateSessionKinds. */
export type TurnSpecPhase = {
  readonly phase: string;
  readonly step: string;
  readonly writes?: readonly string[];
  readonly next?: string;
  readonly finalizer?: string;
};

/** The additive-optional producer/state-machine half of a session-kind
 *  descriptor (ADR-043 §1) — the "missing half" that turns a read-only
 *  session shell into one that can actually run a turn. Structural only at
 *  load time (AT-R422-6 mirrors AT-16's split for the pre-existing fields):
 *  `style`, each phase's `step`/`finalizer`, and `schema` are validated ONLY
 *  by validateSessionKinds, against TURN_STYLES/TURN_STEPS/FINALIZER_IDS/
 *  SCHEMA_IDS respectively — loadSessionKinds carries the values through
 *  unmodified, however bogus. */
export type TurnSpec = {
  /** The one containment segment (SEC-04 guard root) — e.g. `_authoring`. */
  readonly kindDir: string;
  readonly style: string;
  /** Top-level, not per-phase (a structured-style session carries one
   *  schema) — SCHEMA_IDS ships empty for R4-22 WI-1, see its own doc. */
  readonly schema?: string;
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
  return {
    phase,
    step,
    ...(writes !== undefined ? { writes } : {}),
    ...(next !== undefined ? { next } : {}),
    ...(finalizer !== undefined ? { finalizer } : {}),
  };
}

/** Structural-only parse of a descriptor's `turnSpec` (AT-R422-6, mirrors
 *  the AT-16 split): throws only on missing-file-shape problems (not a
 *  mapping, `phases` not an array, missing required scalars) — `style`,
 *  each phase's `step`/`finalizer`, and `schema` are NOT checked against
 *  their closed vocabularies here; that is validateSessionKinds's job. */
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
  return { id, agent, title, legacyRoutes, stages, defaultStage, artifact, ...(turnSpec !== undefined ? { turnSpec } : {}) };
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

    // turnSpec (R4-22 WI-1, ADR-043 §1): additive-optional, so a descriptor
    // with none skips this block entirely (AT-R422-5) — no finding, no
    // default. Every closed-vocabulary rejection below names BOTH the
    // offending value AND the allowed set (the file's binding rule, header
    // comment), even when that set is empty (SCHEMA_IDS today).
    if (d.turnSpec !== undefined) {
      const ts = d.turnSpec;

      if (turnStyleState(ts.style) === undefined) {
        findings.push(
          err(
            obj,
            CHECK_TURNSPEC_UNKNOWN_STYLE,
            `Session kind "${d.id}" declares turnSpec.style "${ts.style}" — must be one of ${allowedIdsSummary(TURN_STYLES)}`,
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

      for (const phase of ts.phases) {
        if (turnStepState(phase.step) === undefined) {
          findings.push(
            err(
              obj,
              CHECK_TURNSPEC_UNKNOWN_STEP,
              `Session kind "${d.id}" turnSpec phase "${phase.phase}" declares step "${phase.step}" — must be one of ${allowedIdsSummary(TURN_STEPS)}`,
            ),
          );
        }
        if (phase.finalizer !== undefined && finalizerIdState(phase.finalizer) === undefined) {
          findings.push(
            err(
              obj,
              CHECK_TURNSPEC_UNKNOWN_FINALIZER,
              `Session kind "${d.id}" turnSpec phase "${phase.phase}" declares finalizer "${phase.finalizer}" — must be one of ${allowedIdsSummary(FINALIZER_IDS)}`,
            ),
          );
        }
      }
    }
  }

  return findings;
}
