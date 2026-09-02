/**
 * Forge Studio filesystem registry (ADR 027).
 * Loads and serializes Agent (SKILL.md), Flow, KB, Catalog, and Projects
 * definitions from disk. Validation lives in a separate module (Task 2).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { listSkillMdDirs } from '@forge/agents/skill-path.ts';
import { parseMaterials } from '@forge/agents/studio/materials.ts';
import type {
  AgentBudgets,
  AgentComposition,
  AgentDefinition,
  AgentFanout,
  AgentRuntime,
  FlowDefinition,
  FlowEdge,
  FlowKickoff,
  FlowKickoffKind,
  FlowNode,
  FlowTrigger,
} from '@forge/contracts/studio/types.ts';

import {
  reqString,
  optString,
  reqNumber,
  optNumber,
  optBool,
  stringArray,
  reqObject,
  oneOf,
  loadYaml,
} from '@forge/kernel/studio/yaml-fields.ts';

// The KB descriptor's load / serialize / process-resolution live in
// ./kb-descriptor.ts (extracted to keep this file under the 800-line cap).
// Re-exported here so existing importers keep resolving them from './registry.ts'.
export {
  loadKbDescriptor,
  serializeKbDescriptor,
  resolveKbProcesses,
  deriveKbUsageDefaults,
  DEFAULT_KB_LINT,
  DEFAULT_KB_INGEST,
  DEFAULT_KB_CONSOLIDATE,
} from '@forge/knowledge/studio/kb-descriptor.ts';

// The Skill / Template / Catalog / Community kinds moved to
// `packages/library/studio/{skill,artifact,catalog,community}-registry.ts`
// (M4 library-by-kind carve, PR 3 / Part 2) — library's own object kinds
// (spec §3.1). Re-exported here so the small set of remaining importers
// INSIDE this legacy tree (orchestrator/'s own test suites, which use a
// short relative path rather than the package specifier and so were not
// individually repointed — see the carve spec's §C) keep resolving them from
// './registry.ts'; every other importer was repointed directly to the new
// files and does not go through this re-export.
export { listPlainSkills } from '@forge/library/studio/skill-registry.ts';
export {
  loadArtifactTemplate,
  listArtifactTemplates,
  loadDemoElement,
  listDemoElements,
  loadInstructionSeed,
  listInstructionSeeds,
} from '@forge/library/studio/artifact-registry.ts';
export { loadCatalog } from '@forge/library/studio/catalog-registry.ts';
export {
  communityRegistryPath,
  loadCommunityRegistry,
  serializeCommunityRegistry,
  resolveCommunitySource,
  communitySkillsFromRegistry,
  COMMUNITY_REGISTRY_SCHEMA_VERSION,
} from '@forge/library/studio/community-registry.ts';

// ---------------------------------------------------------------------------
// Union-field guard helpers live in ./yaml-fields.ts (oneOf, loadYaml)
// ---------------------------------------------------------------------------

const BRAIN_ACCESS = ['mandatory', 'advisory', 'none'] as const;
const MODEL_STRATEGIES = ['fixed', 'range'] as const;
// R2-01-F5: the ONLY four `surface` values seen across the real roster
// (verified 2026-07-18). Checked at LINT time (validateAgent), not load time —
// unlike BRAIN_ACCESS/MODEL_STRATEGIES above, a bad value here should report
// with full lint context (agent:<slug>) instead of crashing the loader,
// mirroring the kb.backend / flow.kickoff.kind precedent. Exported so
// validate.ts (the enum check) and derive.ts (the execution-path mapping)
// share this one source instead of duplicating the literal list.
export const SURFACE_KINDS = ['unattended', 'interactive', 'operator-triggered', 'both'] as const;

// R2-01-F2: the declared phase-executor allowlist. These are the ONLY
// `AgentDefinition.executor` values the flow engine recognises as a
// phase-specific NodeKind — the DECLARED replacement for the old hardcoded
// AGENT_KIND object literal. Set via `executor:` frontmatter on the phase
// SKILL.md files; an agent def with no `executor` resolves to the generic
// 'agent' kind instead. Lives here (not flow-runner.ts) so validate.ts can
// import it for the executor/enum lint check without creating a circular
// import (flow-runner.ts already imports FROM validate.ts for
// findFanOutViolations).
//
// R4-01-F2 (ADR-039) retired the enum row by row as each phase moved to
// declared dispatch (loopStrategy + band guards): 'reflect' with the reflector
// migration, 'pm' with the plan agent, 'dev' with the ralph loopStrategy
// routing. 'unifier' was the LAST row — retired in R4-01-F4 (the develop flow's
// successor demo + adversarial-review nodes replace it). No phase executors
// remain: every phase is now a generic agent or a band guard, so any `executor:`
// declaration on an agent def is invalid (validate.ts rejects it).
export const PHASE_EXECUTOR_KINDS = [] as const;

// ---------------------------------------------------------------------------
// Agent / SKILL.md
// ---------------------------------------------------------------------------

/** Shared frontmatter read for `isStudioAgent`/`isUnfilteredStudioAgent` —
 *  one file read + gray-matter parse, not two independently-maintained
 *  copies. Returns `null` for an unreadable file or non-object frontmatter
 *  (both callers treat that as "not a studio agent"). */
function readAgentFrontmatter(skillMdPath: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(skillMdPath, 'utf8');
    const { data } = matter(raw, {}); // {} opts out of gray-matter's parse cache — see skill-library.ts header
    if (data == null || typeof data !== 'object') return null;
    return data as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function isStudioAgent(skillMdPath: string): boolean {
  const d = readAgentFrontmatter(skillMdPath);
  if (!d) return false;
  // D4: a `provenance:`/`quarantined:` block ⇒ this went through the install
  // pipeline and can never be a studio agent again, whatever its `runtime:` looks like.
  if ('provenance' in d || 'quarantined' in d) return false;
  // A studio (library) agent has a `runtime` block — UNLESS it opts out with
  // `library: false`. Internal/system agents (e.g. brain-fix, dispatched by
  // the bridge, never composed into a flow) set that flag so they keep a
  // runtime spec for deriveAgentSpec but stay out of the composable roster.
  return 'runtime' in d && d.library !== false;
}

/**
 * Same "is this a real, non-quarantined studio agent" check as
 * `isStudioAgent`, WITHOUT the `library:false` roster gate.
 *
 * `library:false` keeps an agent OUT of the composable-roster listing
 * (`listAgentDefinitions`) — it says nothing about whether the SKILL.md
 * itself is a valid studio agent with a real capability envelope to read.
 * Every kickoff-only system agent (demo-builder, instructions-creator,
 * brain-maintenance, creation-agent, project-brain-builder) sets
 * `library:false` for exactly that roster reason, yet still declares a real
 * `runtime:` block the session-kickoff page's model-tier picker needs (W6-B6
 * fix). Used by the capability-only route (`GET
 * /api/studio/agents/:slug/capability`, cli/bridge-studio-agent-capability.ts)
 * that resolves ONE named slug directly, never the filtered roster.
 */
export function isUnfilteredStudioAgent(skillMdPath: string): boolean {
  const d = readAgentFrontmatter(skillMdPath);
  if (!d) return false;
  if ('provenance' in d || 'quarantined' in d) return false;
  return 'runtime' in d;
}

export function loadAgentDefinition(skillMdPath: string): AgentDefinition {
  let raw: string;
  try {
    raw = readFileSync(skillMdPath, 'utf8');
  } catch (err) {
    throw new Error(`${skillMdPath}: cannot read file — ${(err as Error).message}`);
  }

  const { data, content } = matter(raw);
  const d = data as Record<string, unknown>;

  if (!('runtime' in d)) {
    throw new Error(`${skillMdPath}: not a studio SKILL.md — frontmatter has no "runtime" block`);
  }

  const name = reqString(d, 'name', skillMdPath);
  const description = reqString(d, 'description', skillMdPath);
  const phase = optString(d, 'phase');
  const surface = optString(d, 'surface');
  const executor = optString(d, 'executor');
  const purpose = reqString(d, 'purpose', skillMdPath);
  const brainAccess = oneOf(reqString(d, 'brainAccess', skillMdPath), BRAIN_ACCESS, skillMdPath, 'brainAccess');
  const interactivity = reqString(d, 'interactivity', skillMdPath);

  const rawComposition = d['composition'];
  const comp: Record<string, unknown> =
    rawComposition != null && typeof rawComposition === 'object' && !Array.isArray(rawComposition)
      ? (rawComposition as Record<string, unknown>)
      : {};
  // ADR-027 R3-03 amendment ("R3-03, 2026-08-04"): composition.hooks is
  // REINTRODUCED with a narrowed meaning — library lifecycle-hook ids only,
  // resolved against the hooks registry (orchestrator/studio/hook-library.ts),
  // never a platform guard id. Symmetric enforcement of the split
  // (guard-in-hooks / hook-in-guards / unknown-hook-ref) is a lint concern
  // (lintHookComposition), not a load-time throw — a load-time throw here
  // would make it impossible to even SURFACE the wrong-field lint finding for
  // an otherwise well-formed agent def.
  const composition: AgentComposition = {
    skills: stringArray(comp, 'skills', skillMdPath),
    tools: stringArray(comp, 'tools', skillMdPath),
    mcps: stringArray(comp, 'mcps', skillMdPath),
    guards: stringArray(comp, 'guards', skillMdPath),
    hooks: stringArray(comp, 'hooks', skillMdPath),
  };

  const rawRuntime = reqObject(d, 'runtime', skillMdPath);
  const runtime: AgentRuntime = {
    sdk: reqString(rawRuntime, 'sdk', skillMdPath),
    strategy: oneOf(reqString(rawRuntime, 'strategy', skillMdPath), MODEL_STRATEGIES, skillMdPath, 'strategy'),
    model: optString(rawRuntime, 'model'),
    range: rawRuntime['range'] !== undefined ? stringArray(rawRuntime, 'range', skillMdPath) : undefined,
    loopStrategy: optString(rawRuntime, 'loopStrategy'),
  };

  const rawBudgets = d['budgets'];
  const budgetsRaw: Record<string, unknown> =
    rawBudgets != null && typeof rawBudgets === 'object' && !Array.isArray(rawBudgets)
      ? (rawBudgets as Record<string, unknown>)
      : {};
  const budgets: AgentBudgets = {
    iterationFloor: optNumber(budgetsRaw, 'iterationFloor'),
    iterationCap: optNumber(budgetsRaw, 'iterationCap'),
    maxTurnsPerIteration: optNumber(budgetsRaw, 'maxTurnsPerIteration'),
    wedgeKillMs: optNumber(budgetsRaw, 'wedgeKillMs'),
    maxTurns: optNumber(budgetsRaw, 'maxTurns'),
    maxBudgetUsd: optNumber(budgetsRaw, 'maxBudgetUsd'),
    maxBudgetUsdShare: optNumber(budgetsRaw, 'maxBudgetUsdShare'),
  };

  // R2-03-F2 — optional fanout capability block. Absent ⇒ not fanout-capable.
  const rawFanout = d['fanout'];
  const fanout: AgentFanout | undefined =
    rawFanout != null && typeof rawFanout === 'object' && !Array.isArray(rawFanout)
      ? {
          drivingArtifact: reqString(rawFanout as Record<string, unknown>, 'drivingArtifact', skillMdPath),
          isolation: reqString(rawFanout as Record<string, unknown>, 'isolation', skillMdPath),
          concurrencyCap: optNumber(rawFanout as Record<string, unknown>, 'concurrencyCap'),
          perItemGate: optString(rawFanout as Record<string, unknown>, 'perItemGate'),
        }
      : undefined;

  const allowedTools = stringArray(d, 'allowed-tools', skillMdPath);
  const disallowedTools = stringArray(d, 'disallowed-tools', skillMdPath);
  const library = optBool(d, 'library');

  // R2-09 D1 — lenient on VALUES (an unknown material string survives; lint's
  // job, not the loader's), strict on SHAPE (parseMaterials throws on a
  // non-array/non-string entry). Rethrown with the file path so this loader's
  // error messages stay consistent with every other field in this function.
  let materials: string[] | undefined;
  try {
    materials = parseMaterials(d['materials']);
  } catch (err) {
    throw new Error(`${skillMdPath}: ${(err as Error).message}`);
  }

  const slug = basename(dirname(skillMdPath));

  return {
    slug,
    name,
    description,
    library,
    phase,
    surface,
    executor,
    purpose,
    composition,
    runtime,
    ...(fanout ? { fanout } : {}),
    ...(materials !== undefined ? { materials } : {}),
    brainAccess,
    interactivity,
    budgets,
    allowedTools,
    disallowedTools,
    body: content,
    path: skillMdPath,
  };
}

// Agent SKILL.md byte-fidelity serialization (projectAgentFrontmatter,
// deepValueEqual, normalizeAbsentOptionalArrays, serializeAgentDefinition)
// lives in ./skill-md-fidelity.ts (extracted to keep this file under the
// 800-line cap — 2026-08-05, finding C/11). Re-exported here so existing
// importers keep resolving `serializeAgentDefinition` from './registry.ts';
// it remains the ONE canonical serializer (ADR-027).
export { serializeAgentDefinition } from '@forge/agents/studio/skill-md-fidelity.ts';

export function listAgentDefinitions(skillsDir: string): AgentDefinition[] {
  const defs: AgentDefinition[] = [];
  for (const dir of listSkillMdDirs(skillsDir)) {
    const skillMdPath = join(dir, 'SKILL.md');
    if (!isStudioAgent(skillMdPath)) continue;
    defs.push(loadAgentDefinition(skillMdPath));
  }

  return defs.sort((a, b) => a.slug.localeCompare(b.slug));
}

// listPlainSkills moved to `packages/library/studio/skill-registry.ts` (M4
// library-by-kind carve, PR 3 / Part 2) — library's own Skill kind.

/**
 * The curated "out of the box" starter agents (ADR-033) under
 * `studio/starters/agents/`. These are templates the New-Agent picker offers,
 * copied into `skills/<name>/` on install rather than run in place — but
 * `forge studio lint` DOES scan this tree directly too (`lintSkillToolFence`
 * of `cli/studio-lint-tool-fence.ts`'s `lintStarterAgentToolFence`, added
 * forge-6gv.18): a template that violates the tool-fence rule fails the gate
 * at source, before any operator ever installs it. Returns [] if the dir is
 * absent so a checkout without starters degrades gracefully rather than
 * throwing.
 */
export function listStarterAgents(forgeRoot: string): AgentDefinition[] {
  const dir = join(resolve(forgeRoot), 'studio', 'starters', 'agents');
  try {
    return listAgentDefinitions(dir);
  } catch {
    return [];
  }
}

/**
 * The curated starter flow (plan → dev → review + verdict gate) the New-Flow
 * canvas seeds from (ADR-033). Returns null if absent so the builder falls back
 * to a blank canvas.
 */
export function loadStarterFlow(forgeRoot: string): FlowDefinition | null {
  const flowPath = join(resolve(forgeRoot), 'studio', 'starters', 'flows', 'basic.yaml');
  try {
    return loadFlowDefinition(flowPath);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Flow
// ---------------------------------------------------------------------------

function parseFlowNode(raw: unknown, file: string, index: number): FlowNode {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: nodes[${index}] must be a mapping`);
  }
  const n = raw as Record<string, unknown>;
  const id = reqString(n, 'id', file);
  const agent = optString(n, 'agent');
  const gate = optString(n, 'gate');
  const fanOut = optString(n, 'fanOut');
  const resumable = optBool(n, 'resumable');
  const x = optNumber(n, 'x');
  const y = optNumber(n, 'y');
  return { id, agent, gate, fanOut, resumable, x, y };
}

function parseFlowEdge(raw: unknown, file: string, index: number): FlowEdge {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: edges[${index}] must be a mapping`);
  }
  const e = raw as Record<string, unknown>;
  return {
    from: reqString(e, 'from', file),
    to: reqString(e, 'to', file),
    artifact: reqString(e, 'artifact', file),
  };
}

function parseFlowTrigger(raw: unknown, file: string, index: number): FlowTrigger {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: triggers[${index}] must be a mapping`);
  }
  const t = raw as Record<string, unknown>;
  // R2-04 (ADR-041): the `target: {kind, ref}` shape replaced the legacy
  // `flow: <id>` key one-shot — fail loud on a stale declaration rather than
  // guessing (no back-compat parsing; the seed files migrated in the same change).
  if ('flow' in t && !('target' in t)) {
    throw new Error(
      `${file}: triggers[${index}] uses the retired "flow:" key — declare "target: { kind: flow, ref: <id> }" (ADR-041)`,
    );
  }
  const rawTarget = t['target'];
  if (rawTarget === null || typeof rawTarget !== 'object' || Array.isArray(rawTarget)) {
    throw new Error(`${file}: triggers[${index}].target must be a mapping { kind, ref }`);
  }
  const tt = rawTarget as Record<string, unknown>;
  const kind = reqString(tt, 'kind', file);
  if (kind !== 'flow' && kind !== 'agent') {
    throw new Error(`${file}: triggers[${index}].target.kind must be "flow" or "agent" (got "${kind}")`);
  }
  const out: FlowTrigger = {
    on: reqString(t, 'on', file),
    target: { kind, ref: reqString(tt, 'ref', file) },
  };
  // Per-kind config blocks — parsed leniently here (shape coherence is the
  // `trigger-*` lint family's job, so authoring surfaces get findings, not throws).
  if (typeof t['schedule'] === 'string') out.schedule = t['schedule'];
  if (t['concurrency'] === 'allow' || t['concurrency'] === 'forbid' || t['concurrency'] === 'replace') {
    out.concurrency = t['concurrency'];
  }
  if (t['webhook'] !== null && typeof t['webhook'] === 'object' && !Array.isArray(t['webhook'])) {
    const w = t['webhook'] as Record<string, unknown>;
    out.webhook = {
      id: typeof w['id'] === 'string' ? w['id'] : '',
      // Preserve the raw provider string (do NOT coerce a typo to 'github') so
      // the `trigger-webhook` provider-enum lint can actually reach + reject an
      // invalid value; a non-string becomes '' (also lint-rejected).
      provider: (typeof w['provider'] === 'string' ? w['provider'] : '') as 'github' | 'gitea' | 'gitlab',
      events: Array.isArray(w['events'])
        ? (w['events'] as unknown[]).filter(
            (e): e is 'push' | 'release' | 'pull_request' | 'issues' =>
              e === 'push' || e === 'release' || e === 'pull_request' || e === 'issues',
          )
        : [],
      secretEnv: typeof w['secretEnv'] === 'string' ? w['secretEnv'] : '',
      ...(typeof w['secretEnvPrevious'] === 'string' ? { secretEnvPrevious: w['secretEnvPrevious'] } : {}),
      sources: Array.isArray(w['sources'])
        ? (w['sources'] as unknown[]).filter((s): s is string => typeof s === 'string')
        : [],
    };
  }
  // R4-09-F3: reflect mode. Preserve the raw string (do NOT coerce) so the
  // `trigger-mode` enum lint can reach + reject an invalid value.
  if (typeof t['mode'] === 'string') out.mode = t['mode'] as FlowTrigger['mode'];
  // R2-08-F1 (ADR-027 amendment): `projects:` — fail LOUD on a malformed
  // declaration rather than silently coercing it away, unlike the lenient
  // per-kind blocks above. A silently-dropped/mis-shaped scope is exactly the
  // declared-data-fails-open antipattern this field exists to prevent, so
  // this one throws at load instead of leaving it for lint to catch later.
  // Absent stays absent (unscoped) — never defaulted to `[]` here.
  if ('projects' in t) {
    const rawProjects = t['projects'];
    if (!Array.isArray(rawProjects)) {
      throw new Error(
        `${file}: triggers[${index}].projects must be an array of project ids (got ${typeof rawProjects})`,
      );
    }
    const projects: string[] = [];
    for (const p of rawProjects) {
      if (typeof p !== 'string') {
        throw new Error(
          `${file}: triggers[${index}].projects entries must all be strings (got ${JSON.stringify(p)})`,
        );
      }
      projects.push(p);
    }
    out.projects = projects;
  }
  // agent-complete only (R2-08-F2): preserve the raw string (do NOT coerce a
  // non-string away) so the `trigger-agent-complete` lint can reach + reject
  // a missing/malformed value rather than it silently meaning "fires for all".
  if (typeof t['agent'] === 'string') out.agent = t['agent'];
  if (typeof t['note'] === 'string') out.note = t['note'];
  return out;
}

export function loadFlowDefinition(flowYamlPath: string): FlowDefinition {
  const d = loadYaml(flowYamlPath);

  const id = reqString(d, 'id', flowYamlPath);
  const name = reqString(d, 'name', flowYamlPath);
  const version = reqNumber(d, 'version', flowYamlPath);
  const goal = reqString(d, 'goal', flowYamlPath);
  const costCeilingUsd = reqNumber(d, 'costCeilingUsd', flowYamlPath);
  const origin = reqString(d, 'origin', flowYamlPath);

  const project =
    d['project'] === null || d['project'] === undefined
      ? null
      : typeof d['project'] === 'string'
        ? d['project']
        : null;

  const kb =
    d['kb'] === null || d['kb'] === undefined
      ? null
      : typeof d['kb'] === 'string'
        ? d['kb']
        : null;

  const disposable = optBool(d, 'disposable');

  const rawNodes = d['nodes'];
  if (!Array.isArray(rawNodes) || rawNodes.length === 0) {
    throw new Error(`${flowYamlPath}: "nodes" must be a non-empty array`);
  }
  const nodes: FlowNode[] = rawNodes.map((n, i) => parseFlowNode(n, flowYamlPath, i));

  const rawEdges = d['edges'];
  if (!Array.isArray(rawEdges)) {
    throw new Error(`${flowYamlPath}: "edges" must be an array`);
  }
  const edges: FlowEdge[] = rawEdges.map((e, i) => parseFlowEdge(e, flowYamlPath, i));

  const rawTriggers = d['triggers'];
  const triggers: FlowTrigger[] =
    rawTriggers === undefined || rawTriggers === null
      ? []
      : Array.isArray(rawTriggers)
        ? rawTriggers.map((t, i) => parseFlowTrigger(t, flowYamlPath, i))
        : (() => {
            throw new Error(`${flowYamlPath}: "triggers" must be an array`);
          })();

  // kickoff (Stage C, optional). Parsed leniently — the `kind` enum is a lint
  // concern (validateFlow), not a load crash, mirroring kb.backend.
  const rawKickoff = d['kickoff'];
  let kickoff: FlowKickoff | undefined;
  if (rawKickoff !== undefined && rawKickoff !== null) {
    if (typeof rawKickoff !== 'object' || Array.isArray(rawKickoff)) {
      throw new Error(`${flowYamlPath}: "kickoff" must be a mapping`);
    }
    const k = rawKickoff as Record<string, unknown>;
    kickoff = { kind: reqString(k, 'kind', flowYamlPath) as FlowKickoffKind };
  }

  return { id, name, version, goal, project, kb, costCeilingUsd, origin, disposable, nodes, edges, triggers, kickoff, path: flowYamlPath };
}

// consumed by the M2 bridge PUT routes (no production call site until then)
export function serializeFlowDefinition(def: FlowDefinition): string {
  // Strip path before serializing; fixed key order; lineWidth 100
  const { path: _path, ...rest } = def;

  // Build plain object with explicit key order
  const out: Record<string, unknown> = {};
  out['id'] = rest.id;
  out['name'] = rest.name;
  out['version'] = rest.version;
  out['goal'] = rest.goal;
  out['project'] = rest.project;
  out['kb'] = rest.kb;
  out['costCeilingUsd'] = rest.costCeilingUsd;
  out['origin'] = rest.origin;
  if (rest.disposable !== undefined) out['disposable'] = rest.disposable;
  out['nodes'] = rest.nodes.map(({ id, agent, gate, fanOut, resumable, x, y }) => {
    const n: Record<string, unknown> = { id };
    if (agent !== undefined) n['agent'] = agent;
    if (gate !== undefined) n['gate'] = gate;
    if (fanOut !== undefined) n['fanOut'] = fanOut;
    if (resumable !== undefined) n['resumable'] = resumable;
    if (typeof x === 'number') n['x'] = Math.round(x);
    if (typeof y === 'number') n['y'] = Math.round(y);
    return n;
  });
  out['edges'] = rest.edges;
  out['triggers'] = rest.triggers;
  if (rest.kickoff !== undefined) out['kickoff'] = { kind: rest.kickoff.kind };

  return yaml.dump(out, { lineWidth: 100, quotingType: '"', forceQuotes: false });
}

/**
 * List the ids of every registered flow (`studio/flows/<id>/flow.yaml`) —
 * directory presence only, no flow.yaml load/validate. Used by the R1-01 KB
 * binding cross-reference checks (the KB create route; studio-lint.ts reuses
 * its own already-computed flow-directory listing inline) so both share one
 * definition of "a registered flow id".
 */
export function listFlowIds(forgeRoot: string): string[] {
  const flowsDir = join(resolve(forgeRoot), 'studio', 'flows');
  try {
    return readdirSync(flowsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// Artifact templates / demo elements / instruction seeds moved to
// `packages/library/studio/artifact-registry.ts`; Catalog moved to
// `packages/library/studio/catalog-registry.ts`; the whole Community block
// moved to `packages/library/studio/community-registry.ts` (M4
// library-by-kind carve, PR 3 / Part 2) — all three are library's own kinds.

// Project discovery (id normalisation + disk scan) — kernel owns these now
// (M4 ruling 18); this re-export keeps the ~30 legacy call sites unchanged
// until their own lanes repoint directly to @forge/kernel.
export { normalizeProjectId, discoverProjects, type DiscoveredProject } from '@forge/kernel';
