/**
 * Forge Studio filesystem registry (ADR 027).
 * Loads and serializes Agent (SKILL.md), Flow, KB, Catalog, and Projects
 * definitions from disk. Validation lives in a separate module (Task 2).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve, relative, sep } from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { listSkillMdDirs, listSkillDirs, PROJECT_ID_RE } from '../skill-path.ts';
import { skillTrustState } from './skill-library.ts';
import { parseMaterials } from './materials.ts';
import { ARTIFACT_KINDS, DEMO_STEP_KINDS, INSTRUCTION_SEED_KINDS, INSTRUCTION_SEED_SCOPES } from './types.ts';
import { BAND_GUARD_IDS } from '../agent-bands.ts';
import { parseConnectionEntries } from './connection-catalog.ts';
import type {
  AgentBudgets,
  AgentComposition,
  AgentDefinition,
  AgentFanout,
  AgentRuntime,
  ArtifactTemplate,
  Catalog,
  CatalogGuardEntry,
  CommunitySkill,
  CommunityRegistry,
  CommunityRegistryItem,
  CommunityRegistrySignals,
  CatalogModel,
  CatalogSdk,
  DemoElementDefinition,
  FlowDefinition,
  FlowEdge,
  FlowKickoff,
  FlowKickoffKind,
  FlowNode,
  FlowTrigger,
  InstructionSeed,
  ProjectRef,
} from './types.ts';

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
} from './yaml-fields.ts';

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
} from './kb-descriptor.ts';

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
export { serializeAgentDefinition } from './skill-md-fidelity.ts';

export function listAgentDefinitions(skillsDir: string): AgentDefinition[] {
  const defs: AgentDefinition[] = [];
  for (const dir of listSkillMdDirs(skillsDir)) {
    const skillMdPath = join(dir, 'SKILL.md');
    if (!isStudioAgent(skillMdPath)) continue;
    defs.push(loadAgentDefinition(skillMdPath));
  }

  return defs.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Plain composable skills (skills/<slug>/SKILL.md with NO runtime block AND not
 *  library:false) — the filesystem half of the unified skill library (R3-01-F2).
 *  Studio agents (runtime-bearing) are the agent roster, not palette skill chips;
 *  a plain skill opting out with library:false is hidden from the palette too.
 *  R3-01-F3/F4: a `draft` or `needs-review` skill is ALSO excluded — this is the
 *  palette enforcement point for the trust pipeline (skillTrustState); do not
 *  add a second, divergent copy of this rule anywhere else. */
export function listPlainSkills(forgeRoot: string): { id: string; name: string; desc?: string }[] {
  const out: { id: string; name: string; desc?: string }[] = [];
  for (const dir of listSkillDirs(forgeRoot)) {
    const skillMdPath = join(dir, 'SKILL.md');
    try {
      const { data } = matter(readFileSync(skillMdPath, 'utf8'));
      const d = (data ?? {}) as Record<string, unknown>;
      if ('runtime' in d) continue;                     // runtime block ⇒ a studio agent, not a plain skill
      if (d['library'] === false) continue;             // library:false ⇒ plain skill opted out of the palette (R3-01-F2)
      const id = basename(dir);
      if (skillTrustState(forgeRoot, id) !== 'ready') continue; // draft/needs-review ⇒ not palette-visible (R3-01-F3/F4)
      const name = typeof d['name'] === 'string' && d['name'] ? d['name'] as string : id;
      const desc = typeof d['description'] === 'string' ? d['description'] as string : undefined;
      out.push({ id, name, desc });
    } catch { /* unreadable/malformed ⇒ skip */ }
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The curated "out of the box" starter agents (ADR-033) under
 * `studio/starters/agents/`. These are templates the New-Agent picker offers —
 * not live agents (lint does not scan them). Returns [] if the dir is absent so
 * a checkout without starters degrades gracefully rather than throwing.
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

// Artifact templates — studio/artifact-templates/<id>.md (gray-matter, ADR-027 amendment).
export function loadArtifactTemplate(mdPath: string): ArtifactTemplate {
  let raw: string;
  try {
    raw = readFileSync(mdPath, 'utf8');
  } catch (err) {
    throw new Error(`${mdPath}: cannot read file — ${(err as Error).message}`);
  }
  const { data, content } = matter(raw);
  const d = data as Record<string, unknown>;
  const schemaRaw =
    d['schema'] && typeof d['schema'] === 'object' && !Array.isArray(d['schema'])
      ? (d['schema'] as Record<string, unknown>)
      : {};
  return {
    id: reqString(d, 'id', mdPath),
    name: reqString(d, 'name', mdPath),
    kind: oneOf(reqString(d, 'kind', mdPath), ARTIFACT_KINDS, mdPath, 'kind'),
    producer: optString(d, 'producer'),
    consumer: optString(d, 'consumer'),
    schema: {
      requiredFiles: stringArray(schemaRaw, 'requiredFiles', mdPath),
      requiredFields: stringArray(schemaRaw, 'requiredFields', mdPath),
      gitInvariants: stringArray(schemaRaw, 'gitInvariants', mdPath),
    },
    body: content.trim(),
    path: mdPath,
  };
}

export function listArtifactTemplates(studioRoot: string): ArtifactTemplate[] {
  const dir = join(studioRoot, 'studio', 'artifact-templates');
  let files: string[];
  try {
    // README.md documents the directory (R3-06) — it is not a template
    // definition and carries no gray-matter frontmatter, so it is excluded
    // by name rather than treated as a malformed entry. Matched
    // case-insensitively (a readme.md/Readme.md variant would otherwise slip
    // this check and, if it ever carried valid frontmatter, become a
    // phantom template) — mirrors the identical exclusion in
    // template-library.ts's listPlanningEntries; the two must stay identical.
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && !/^readme\.md$/i.test(f));
  } catch {
    return []; // absent dir → no templates (tolerated)
  }
  return files.map((f) => loadArtifactTemplate(join(dir, f)));
}

/**
 * Load one demo-element definition (`studio/demo-elements/<id>.md`) — a member of
 * the forge demo-element library (a skill-creating skill). Throws on a malformed
 * file so `forge studio lint` surfaces it.
 */
export function loadDemoElement(mdPath: string): DemoElementDefinition {
  let raw: string;
  try {
    raw = readFileSync(mdPath, 'utf8');
  } catch (err) {
    throw new Error(`${mdPath}: cannot read file — ${(err as Error).message}`);
  }
  const { data, content } = matter(raw);
  const d = data as Record<string, unknown>;
  return {
    id: reqString(d, 'id', mdPath),
    name: reqString(d, 'name', mdPath),
    phase: oneOf(reqString(d, 'phase', mdPath), DEMO_STEP_KINDS, mdPath, 'phase'),
    description: reqString(d, 'description', mdPath),
    configHint: optString(d, 'configHint') ?? '',
    body: content.trim(),
    path: mdPath,
  };
}

/** List the forge demo-element library (`studio/demo-elements/*.md`). Absent ⇒ []. */
export function listDemoElements(studioRoot: string): DemoElementDefinition[] {
  const dir = join(studioRoot, 'studio', 'demo-elements');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  return files.map((f) => loadDemoElement(join(dir, f))).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Instruction seeds (R3-05) — studio/instruction-seeds/<id>.md (gray-matter).
// A vetted, composable AGENTS.md building block. Lenient-parse-then-lint: a
// malformed seed throws here so `forge studio lint` surfaces it, and the enum
// fields are checked at load (kind/scope) mirroring artifact-template `kind`.
// ---------------------------------------------------------------------------

/** Load one instruction seed (`studio/instruction-seeds/<id>.md`). Throws on a malformed file. */
export function loadInstructionSeed(mdPath: string): InstructionSeed {
  let raw: string;
  try {
    raw = readFileSync(mdPath, 'utf8');
  } catch (err) {
    throw new Error(`${mdPath}: cannot read file — ${(err as Error).message}`);
  }
  const { data, content } = matter(raw);
  const d = data as Record<string, unknown>;
  return {
    id: reqString(d, 'id', mdPath),
    title: reqString(d, 'title', mdPath),
    kind: oneOf(reqString(d, 'kind', mdPath), INSTRUCTION_SEED_KINDS, mdPath, 'kind'),
    appliesTo: stringArray(d, 'appliesTo', mdPath),
    scope: oneOf(reqString(d, 'scope', mdPath), INSTRUCTION_SEED_SCOPES, mdPath, 'scope'),
    provenance: reqString(d, 'provenance', mdPath),
    body: content.trim(),
    path: mdPath,
  };
}

/** List the forge instruction-seed library (`studio/instruction-seeds/*.md`). Absent ⇒ []. */
export function listInstructionSeeds(studioRoot: string): InstructionSeed[] {
  const dir = join(studioRoot, 'studio', 'instruction-seeds');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return []; // absent dir → no seeds (tolerated)
  }
  return files.map((f) => loadInstructionSeed(join(dir, f))).sort((a, b) => a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

function parseCatalogSdks(raw: unknown, file: string): CatalogSdk[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: sdks[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    return {
      id: reqString(e, 'id', file),
      name: reqString(e, 'name', file),
      available: typeof e['available'] === 'boolean' ? e['available'] : false,
    };
  });
}

function parseCatalogModels(raw: unknown, file: string): CatalogModel[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: models[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    return {
      id: reqString(e, 'id', file),
      name: reqString(e, 'name', file),
      sdk: reqString(e, 'sdk', file),
      tier: reqString(e, 'tier', file),
      costIn: optNumber(e, 'costIn'),
      costOut: optNumber(e, 'costOut'),
    };
  });
}

/**
 * Parse `catalog.yaml`'s `guards:` section. `kind` is DERIVED from
 * `BAND_GUARD_IDS`, never read from the file — a declared `kind:` value in the
 * YAML (if present) is parsed and then discarded, never merged or trusted
 * (ADR-027 R3-03 amendment).
 */
function parseCatalogGuards(raw: unknown, file: string): CatalogGuardEntry[] {
  if (!Array.isArray(raw)) return [];
  const bandIds = new Set<string>(BAND_GUARD_IDS as readonly string[]);
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: guards[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    const id = reqString(e, 'id', file);
    return {
      id,
      name: reqString(e, 'name', file),
      desc: optString(e, 'desc'),
      kind: bandIds.has(id) ? 'band' : 'toggle',
    };
  });
}

// catalog.yaml is hand-edited (git changes); no serializer by design (ADR-027 §5).
export function loadCatalog(catalogYamlPath: string): Catalog {
  const d = loadYaml(catalogYamlPath);
  return {
    sdks: parseCatalogSdks(d['sdks'], catalogYamlPath),
    models: parseCatalogModels(d['models'], catalogYamlPath),
    tools: parseConnectionEntries(d['tools'], catalogYamlPath, 'tools', { readCapabilities: false }),
    mcps: parseConnectionEntries(d['mcps'], catalogYamlPath, 'mcps', { readCapabilities: true }),
    guards: parseCatalogGuards(d['guards'], catalogYamlPath),
    path: catalogYamlPath,
  };
}

// ---------------------------------------------------------------------------
// Community registry (W6-CR-1) — studio/community/registry.yaml, the
// declared-list source of truth for community items, superseding
// catalog.yaml's former `community-skills:` section (parseCommunitySkills
// above, removed by this migration).
// ---------------------------------------------------------------------------

/** Mirrors community-index.ts's COMMUNITY_KINDS / types.ts's
 *  COMMUNITY_REGISTRY_KINDS exactly — kept as an independent literal here too
 *  (registry.ts sits BELOW community-index.ts in the import graph) so `oneOf`
 *  can validate the field without introducing a new cross-module edge for one
 *  four-string list. */
const COMMUNITY_REGISTRY_KIND_VALUES = ['skill', 'hook', 'mcp', 'tool'] as const;

function parseCommunityRegistrySignals(raw: unknown, file: string, itemId: string): CommunityRegistrySignals {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: items "${itemId}".signals must be a mapping`);
  }
  const s = raw as Record<string, unknown>;
  const stars = s['stars'];
  if (stars !== null && typeof stars !== 'number') {
    throw new Error(`${file}: items "${itemId}".signals.stars must be a number or null`);
  }
  const starsDisplay = s['starsDisplay'];
  if (starsDisplay !== null && typeof starsDisplay !== 'string') {
    throw new Error(`${file}: items "${itemId}".signals.starsDisplay must be a string or null`);
  }
  const attributedTo = s['attributedTo'];
  if (attributedTo !== null && typeof attributedTo !== 'string') {
    throw new Error(`${file}: items "${itemId}".signals.attributedTo must be a string or null`);
  }
  return { stars, starsDisplay, attributedTo };
}

function parseNullableString(raw: unknown, file: string, field: string): string | null {
  if (raw !== null && typeof raw !== 'string') {
    throw new Error(`${file}: field "${field}" must be a string or null`);
  }
  return raw;
}

function parseCommunityRegistryItem(raw: unknown, i: number, file: string): CommunityRegistryItem {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${file}: items[${i}] must be a mapping`);
  }
  const e = raw as Record<string, unknown>;
  const id = reqString(e, 'id', file);
  const kind = oneOf(reqString(e, 'kind', file), COMMUNITY_REGISTRY_KIND_VALUES, file, 'kind');
  return {
    id,
    kind,
    name: reqString(e, 'name', file),
    desc: optString(e, 'desc'),
    category: reqString(e, 'category', file),
    sourceUrl: reqString(e, 'sourceUrl', file),
    provenance: reqString(e, 'provenance', file),
    tier: optString(e, 'tier'),
    signals: parseCommunityRegistrySignals(e['signals'], file, id),
    upstreamUpdatedAt: parseNullableString(e['upstreamUpdatedAt'], file, `items[${i}] ("${id}").upstreamUpdatedAt`),
    fetchedAt: parseNullableString(e['fetchedAt'], file, `items[${i}] ("${id}").fetchedAt`),
    fetchedBy: reqString(e, 'fetchedBy', file),
  };
}

export function communityRegistryPath(forgeRoot: string): string {
  return join(forgeRoot, 'studio', 'community', 'registry.yaml');
}

/** Throws on ANY structural violation (missing/malformed meta, non-array
 *  items, a malformed item) — callers that want to TOLERATE a missing file
 *  check existsSync first (mirrors loadCatalog's own bare-throw contract;
 *  `communitySkillsFromRegistry` below is the tolerant-to-missing wrapper
 *  most callers actually want). */
export function loadCommunityRegistry(registryYamlPath: string): CommunityRegistry {
  const d = loadYaml(registryYamlPath);
  const meta = reqObject(d, 'meta', registryYamlPath);
  const schemaVersion = reqNumber(meta, 'schemaVersion', registryYamlPath);
  const lastRefresh = parseNullableString(meta['lastRefresh'], registryYamlPath, 'meta.lastRefresh');
  const rawItems = d['items'];
  if (!Array.isArray(rawItems)) {
    throw new Error(`${registryYamlPath}: "items" must be an array`);
  }
  return {
    schemaVersion,
    lastRefresh,
    items: rawItems.map((item, i) => parseCommunityRegistryItem(item, i, registryYamlPath)),
    path: registryYamlPath,
  };
}

/** Renders one `CommunityRegistryItem` back to the plain-object shape
 *  `js-yaml` dumps — optional fields (`desc`/`tier`) are OMITTED (never
 *  written as `null`/`undefined`) when absent, mirroring
 *  `serializeFlowDefinition`'s own "spread in only when defined" discipline
 *  rather than trusting `yaml.dump` to drop `undefined` values on its own. */
function serializeCommunityRegistryItem(item: CommunityRegistryItem): Record<string, unknown> {
  const out: Record<string, unknown> = { id: item.id, kind: item.kind, name: item.name };
  if (item.desc !== undefined) out.desc = item.desc;
  out.category = item.category;
  out.sourceUrl = item.sourceUrl;
  out.provenance = item.provenance;
  if (item.tier !== undefined) out.tier = item.tier;
  out.signals = {
    stars: item.signals.stars,
    starsDisplay: item.signals.starsDisplay,
    attributedTo: item.signals.attributedTo,
  };
  out.upstreamUpdatedAt = item.upstreamUpdatedAt;
  out.fetchedAt = item.fetchedAt;
  out.fetchedBy = item.fetchedBy;
  return out;
}

/**
 * W7-B3 — the ONE serializer for the whole registry document, shared by
 * `commitRegistryDraft` (orchestrator/interactive-finalizers.ts) and the
 * Studio CRUD routes (cli/bridge-studio-writes.ts). Pure: takes the parsed
 * shape, returns the YAML text; the CALLER owns the temp-then-rename write.
 * Symmetric with `loadCommunityRegistry` above so a round-trip
 * (serialize → load) is the natural structural validation.
 */
export function serializeCommunityRegistry(doc: {
  schemaVersion: number;
  lastRefresh: string | null;
  items: readonly CommunityRegistryItem[];
}): string {
  return yaml.dump(
    {
      meta: { schemaVersion: doc.schemaVersion, lastRefresh: doc.lastRefresh },
      items: doc.items.map(serializeCommunityRegistryItem),
    },
    { lineWidth: 100, quotingType: '"', forceQuotes: false },
  );
}

/** Projects a registry item down onto the LEGACY `CommunitySkill` shape every
 *  existing consumer already depends on (skill-library.ts, validate.ts,
 *  community-index.ts, community-install.ts, the bridge routes) — `stars`
 *  here is always the curated DISPLAY string, never the parsed numeric
 *  `signals.stars` (types.ts's CommunitySkill doc).
 *
 *  W6-CR-2: `item.fetchedAt`/`item.fetchedBy`/`item.upstreamUpdatedAt`/
 *  `item.signals.stars` (the numeric figure) now thread straight through —
 *  every registry-sourced item genuinely HAS these facts (required fields on
 *  `CommunityRegistryItem`), so there is nothing to fabricate here; a
 *  vendored-only skill/hook or a connection (no registry row at all) is
 *  built directly as a `CommunityItem` in community-index.ts, never through
 *  this function, and gets its own honest fetchedAt:null/fetchedBy:'local'
 *  treatment there. */
function toCommunitySkill(item: CommunityRegistryItem): CommunitySkill {
  return {
    id: item.id,
    name: item.name,
    provenance: item.provenance,
    source: item.sourceUrl,
    category: item.category,
    tier: item.tier,
    stars: item.signals.starsDisplay ?? undefined,
    starsNumeric: item.signals.stars,
    desc: item.desc,
    upstreamUpdatedAt: item.upstreamUpdatedAt,
    fetchedAt: item.fetchedAt,
    fetchedBy: item.fetchedBy,
  };
}

/** Every `kind: skill` row of studio/community/registry.yaml, in the LEGACY
 *  `CommunitySkill` shape. Tolerant of a MISSING file (returns `[]` — the
 *  fresh/half-onboarded shape every other studio/community/*.yaml reader
 *  already tolerates, see community-index.ts's listCommunityHubs); a file
 *  that EXISTS but fails to parse (missing required field, bad kind vocab,
 *  malformed signals, ...) throws loud, naming the file + the real error —
 *  a corrupt registry must never render identically to an honest empty one. */
export function communitySkillsFromRegistry(forgeRoot: string): CommunitySkill[] {
  const registryPath = communityRegistryPath(forgeRoot);
  if (!existsSync(registryPath)) return [];
  return loadCommunityRegistry(registryPath)
    .items.filter((item) => item.kind === 'skill')
    .map(toCommunitySkill);
}

// ---------------------------------------------------------------------------
// Project discovery (disk scan — replaces the studio/projects.yaml registry)
//
// A project is any immediate sub-directory of the projects root that carries a
// `.forge/project.json` contract file. The id IS the directory name, verbatim
// (case-preserving, `PROJECT_ID_RE` — W7-A4); the path is the project dir
// relative to forgeRoot. Dirs
// without a `.forge/project.json` are surfaced (hasConfig: false) so the
// operator/lint can warn rather than silently drop a half-onboarded project.
// ---------------------------------------------------------------------------

export type DiscoveredProject = ProjectRef & {
  /** True iff `<dir>/.forge/project.json` exists. */
  hasConfig: boolean;
  /** Absolute path to the project dir. */
  absPath: string;
};

/**
 * R2-08-F1 (N1, round-4): the ONE normalizer for "directory/raw name → project
 * id" — `discoverProjects` below is its original (and still primary) caller,
 * but `forge studio lint`'s `trigger-projects` membership check validates
 * `triggers[].projects` against IDS THIS FUNCTION PRODUCES. Every site that
 * resolves an `eventProject` (a raw directory name / `ProjectBinding.name` /
 * a flow's own `project:` field — none of which are guaranteed pre-normalized)
 * MUST run it through this SAME function before comparing against a declared
 * scope, or lint and dispatch silently read different evidence (rule 2).
 * Extracted so there is exactly one place to drift from, not a copy re-typed
 * at each call site (the second copy would be the same defect one layer down).
 *
 * W7-A4 (findings projects-02 / projects-34, bead forge-9bd): a project id IS
 * its directory name, case-preserving, matched exactly (`PROJECT_ID_RE`) — so
 * for any name that already satisfies the rule this is the IDENTITY
 * (`trafficGame` → `trafficGame`, never `trafficgame`). The old lowercasing
 * published an id no `:id` route could resolve back to the directory. A name
 * that fails the rule (whitespace, `.`, `/`) is not a project — discovery
 * skips it; this still returns a rule-shaped best effort (case preserved,
 * illegal characters folded to `-`) so scope comparisons stay total. Note the
 * best-effort form MAY collide with a differently-named real project (`my
 * proj` → `my-proj`); callers comparing scopes must treat it as a hint, never
 * as proof of identity (W7-FIX-A4 / W7A4-08).
 */
export function normalizeProjectId(name: string): string {
  if (PROJECT_ID_RE.test(name)) return name;
  return name.replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^[-_]+|-$/g, '');
}

/**
 * Scan `projectsDir` for project sub-directories. Pure + total: a missing or
 * unreadable projects root yields an empty list (a fresh box has no projects,
 * which is a working state, not an error). Entries are sorted by id so callers
 * get deterministic output.
 *
 * @param projectsDir - absolute path to the projects root (see resolveProjectsDir)
 * @param forgeRoot   - absolute forge root, used to relativise `path`
 */
export function discoverProjects(projectsDir: string, forgeRoot: string): DiscoveredProject[] {
  let entries: string[];
  try {
    entries = readdirSync(projectsDir, { withFileTypes: true })
      // Skip dot-prefixed dirs — a `.staging-<id>-*` in-flight/orphaned create
      // (SEC-05 4on reopen-1) must NEVER surface as a project. A real project id
      // is slug-validated (no leading dot), so this drops only non-projects.
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }

  const root = resolve(forgeRoot);
  const found: DiscoveredProject[] = [];
  for (const name of entries) {
    // W7-A4: the id IS the directory name — a name that fails the id rule
    // (whitespace, `.`, a leading `-`, …) can never be resolved by a `:id`
    // route, so it is not a project and is never listed (a listed id must be
    // routable; knowledge-03's "listed but every route 400s" shape).
    if (!PROJECT_ID_RE.test(name)) continue;
    const id = name;
    const absPath = join(projectsDir, name);
    const rel = relative(root, absPath);
    // Skip any dir that resolves outside the forge root (defensive; should not
    // happen for a sub-dir of projectsDir, but guards a symlinked projectsDir).
    const path = rel && !rel.startsWith('..') ? rel.split(sep).join('/') : absPath;
    const hasConfig = existsSync(join(absPath, '.forge', 'project.json'));
    found.push({ id, path, hasConfig, absPath });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}
