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

import { reqString, reqObject, stringArray } from './yaml-fields.ts';
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
// SessionKindDescriptor
// ---------------------------------------------------------------------------

export type SessionKindArtifactRef = {
  readonly kind: string;
  readonly label: string;
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
  return { id, agent, title, legacyRoutes, stages, defaultStage, artifact };
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
  }

  return findings;
}
