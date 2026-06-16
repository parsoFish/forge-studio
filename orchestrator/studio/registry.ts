/**
 * Forge Studio filesystem registry (ADR 027).
 * Loads and serializes Agent (SKILL.md), Flow, KB, Catalog, and Projects
 * definitions from disk. Validation lives in a separate module (Task 2).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { ARTIFACT_KINDS } from './types.ts';
import type {
  AgentBudgets,
  AgentComposition,
  AgentDefinition,
  AgentRuntime,
  ArtifactTemplate,
  Catalog,
  CommunitySkill,
  CatalogEntry,
  CatalogModel,
  CatalogSdk,
  FlowDefinition,
  FlowEdge,
  FlowNode,
  FlowTrigger,
  KbDescriptor,
  ProjectRef,
  ProjectsRegistry,
} from './types.ts';

// ---------------------------------------------------------------------------
// Typed field-extraction helpers (modelled on orchestrator/manifest.ts)
// ---------------------------------------------------------------------------

function reqString(data: Record<string, unknown>, key: string, file: string): string {
  const v = data[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`${file}: required string field "${key}" is missing or empty`);
  }
  return v;
}

function optString(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function reqNumber(data: Record<string, unknown>, key: string, file: string): number {
  const v = data[key];
  if (typeof v !== 'number') {
    throw new Error(`${file}: required number field "${key}" is missing or not a number`);
  }
  return v;
}

function optNumber(data: Record<string, unknown>, key: string): number | undefined {
  const v = data[key];
  return typeof v === 'number' ? v : undefined;
}

function optBool(data: Record<string, unknown>, key: string): boolean | undefined {
  const v = data[key];
  return typeof v === 'boolean' ? v : undefined;
}

function stringArray(data: Record<string, unknown>, key: string, file: string): string[] {
  const v = data[key];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new Error(`${file}: field "${key}" must be an array of strings`);
  }
  return (v as unknown[]).map((item, i) => {
    if (typeof item !== 'string') {
      throw new Error(`${file}: field "${key}[${i}]" must be a string`);
    }
    return item;
  });
}

function reqObject(data: Record<string, unknown>, key: string, file: string): Record<string, unknown> {
  const v = data[key];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error(`${file}: required object field "${key}" is missing or not an object`);
  }
  return v as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sentinel error class — used inside loadYaml to avoid double-wrapping
// ---------------------------------------------------------------------------

class RegistryError extends Error {}

// ---------------------------------------------------------------------------
// Union-field guard helper
// ---------------------------------------------------------------------------

const BRAIN_ACCESS = ['mandatory', 'advisory', 'none'] as const;
const MODEL_STRATEGIES = ['fixed', 'range'] as const;
const KB_SCOPES = ['project', 'flow', 'agent-integration'] as const;

function oneOf<T extends string>(value: string, allowed: readonly T[], file: string, key: string): T {
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new RegistryError(`${file}: field "${key}" must be one of ${allowed.join('|')}, got "${value}"`);
}

function loadYaml(file: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`${file}: cannot read file — ${(err as Error).message}`);
  }
  try {
    const parsed = yaml.load(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new RegistryError(`${file}: YAML root must be a mapping`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof RegistryError) throw err;
    throw new Error(`${file}: YAML parse error — ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Agent / SKILL.md
// ---------------------------------------------------------------------------

export function isStudioAgent(skillMdPath: string): boolean {
  try {
    const raw = readFileSync(skillMdPath, 'utf8');
    const { data } = matter(raw);
    return data != null && typeof data === 'object' && 'runtime' in data;
  } catch {
    return false;
  }
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
  const purpose = reqString(d, 'purpose', skillMdPath);
  const brainAccess = oneOf(reqString(d, 'brainAccess', skillMdPath), BRAIN_ACCESS, skillMdPath, 'brainAccess');
  const interactivity = reqString(d, 'interactivity', skillMdPath);

  const rawComposition = d['composition'];
  const comp: Record<string, unknown> =
    rawComposition != null && typeof rawComposition === 'object' && !Array.isArray(rawComposition)
      ? (rawComposition as Record<string, unknown>)
      : {};
  const composition: AgentComposition = {
    skills: stringArray(comp, 'skills', skillMdPath),
    tools: stringArray(comp, 'tools', skillMdPath),
    mcps: stringArray(comp, 'mcps', skillMdPath),
    hooks: stringArray(comp, 'hooks', skillMdPath),
  };

  const rawRuntime = reqObject(d, 'runtime', skillMdPath);
  const runtime: AgentRuntime = {
    sdk: reqString(rawRuntime, 'sdk', skillMdPath),
    strategy: oneOf(reqString(rawRuntime, 'strategy', skillMdPath), MODEL_STRATEGIES, skillMdPath, 'strategy'),
    model: optString(rawRuntime, 'model'),
    range: rawRuntime['range'] !== undefined ? stringArray(rawRuntime, 'range', skillMdPath) : undefined,
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
  };

  const allowedTools = stringArray(d, 'allowed-tools', skillMdPath);
  const disallowedTools = stringArray(d, 'disallowed-tools', skillMdPath);

  const slug = basename(dirname(skillMdPath));

  return {
    slug,
    name,
    description,
    phase,
    surface,
    purpose,
    composition,
    runtime,
    brainAccess,
    interactivity,
    budgets,
    allowedTools,
    disallowedTools,
    body: content,
    path: skillMdPath,
  };
}

// consumed by the M2 bridge PUT routes (no production call site until then)
export function serializeAgentDefinition(def: AgentDefinition): string {
  // Fixed key order: name, description, phase?, surface?, purpose, composition,
  // runtime, brainAccess, interactivity, allowed-tools, disallowed-tools, budgets
  const data: Record<string, unknown> = {};
  data['name'] = def.name;
  data['description'] = def.description;
  if (def.phase !== undefined) data['phase'] = def.phase;
  if (def.surface !== undefined) data['surface'] = def.surface;
  data['purpose'] = def.purpose;
  data['composition'] = def.composition;

  const runtime: Record<string, unknown> = {
    sdk: def.runtime.sdk,
    strategy: def.runtime.strategy,
  };
  if (def.runtime.model !== undefined) runtime['model'] = def.runtime.model;
  if (def.runtime.range !== undefined) runtime['range'] = def.runtime.range;
  data['runtime'] = runtime;

  data['brainAccess'] = def.brainAccess;
  data['interactivity'] = def.interactivity;
  data['allowed-tools'] = def.allowedTools;
  data['disallowed-tools'] = def.disallowedTools;

  // Omit budgets keys that are undefined
  const budgets: Record<string, unknown> = {};
  if (def.budgets.iterationFloor !== undefined) budgets['iterationFloor'] = def.budgets.iterationFloor;
  if (def.budgets.iterationCap !== undefined) budgets['iterationCap'] = def.budgets.iterationCap;
  if (def.budgets.maxTurnsPerIteration !== undefined)
    budgets['maxTurnsPerIteration'] = def.budgets.maxTurnsPerIteration;
  if (def.budgets.wedgeKillMs !== undefined) budgets['wedgeKillMs'] = def.budgets.wedgeKillMs;
  data['budgets'] = budgets;

  const safeBody = def.body.replace(/^-{3,}/gm, (m) => m.replace(/-/g, '–'));
  return matter.stringify('\n' + safeBody.replace(/^\n+/, ''), data);
}

export function listAgentDefinitions(skillsDir: string): AgentDefinition[] {
  let entries: string[];
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    throw new Error(`${skillsDir}: cannot read skills directory — ${(err as Error).message}`);
  }

  const defs: AgentDefinition[] = [];
  for (const entry of entries) {
    const skillMdPath = join(skillsDir, entry, 'SKILL.md');
    if (!isStudioAgent(skillMdPath)) continue;
    defs.push(loadAgentDefinition(skillMdPath));
  }

  return defs.sort((a, b) => a.slug.localeCompare(b.slug));
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
  return { id, agent, gate, fanOut, resumable };
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
  return {
    on: reqString(t, 'on', file),
    flow: reqString(t, 'flow', file),
  };
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

  return { id, name, version, goal, project, kb, costCeilingUsd, origin, disposable, nodes, edges, triggers, path: flowYamlPath };
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
  out['nodes'] = rest.nodes.map(({ id, agent, gate, fanOut, resumable }) => {
    const n: Record<string, unknown> = { id };
    if (agent !== undefined) n['agent'] = agent;
    if (gate !== undefined) n['gate'] = gate;
    if (fanOut !== undefined) n['fanOut'] = fanOut;
    if (resumable !== undefined) n['resumable'] = resumable;
    return n;
  });
  out['edges'] = rest.edges;
  out['triggers'] = rest.triggers;

  return yaml.dump(out, { lineWidth: 100, quotingType: '"', forceQuotes: false });
}

// ---------------------------------------------------------------------------
// KB descriptor
// ---------------------------------------------------------------------------

// kb.yaml is hand-edited (git changes); no serializer by design (ADR-027 §5).
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
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return []; // absent dir → no templates (tolerated)
  }
  return files.map((f) => loadArtifactTemplate(join(dir, f)));
}

export function loadKbDescriptor(kbYamlPath: string): KbDescriptor {
  const d = loadYaml(kbYamlPath);
  return {
    id: reqString(d, 'id', kbYamlPath),
    name: reqString(d, 'name', kbYamlPath),
    scope: oneOf(reqString(d, 'scope', kbYamlPath), KB_SCOPES, kbYamlPath, 'scope'),
    desc: reqString(d, 'desc', kbYamlPath),
    backend: optString(d, 'backend'),
    path: kbYamlPath,
  };
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

function parseCatalogEntries(raw: unknown, file: string, key: string): CatalogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: ${key}[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    return {
      id: reqString(e, 'id', file),
      name: reqString(e, 'name', file),
      desc: optString(e, 'desc'),
    };
  });
}

function parseCommunitySkills(raw: unknown, file: string): CommunitySkill[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error(`${file}: "community-skills" must be an array`);
  }
  return raw.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${file}: community-skills[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    return {
      id: reqString(e, 'id', file),
      name: reqString(e, 'name', file),
      provenance: reqString(e, 'provenance', file),
      source: reqString(e, 'source', file),
      category: reqString(e, 'category', file),
      tier: optString(e, 'tier'),
      composedBy: stringArray(e, 'composedBy', file),
      stars: optString(e, 'stars'),
      desc: optString(e, 'desc'),
    };
  });
}

// catalog.yaml is hand-edited (git changes); no serializer by design (ADR-027 §5).
export function loadCatalog(catalogYamlPath: string): Catalog {
  const d = loadYaml(catalogYamlPath);
  return {
    sdks: parseCatalogSdks(d['sdks'], catalogYamlPath),
    models: parseCatalogModels(d['models'], catalogYamlPath),
    tools: parseCatalogEntries(d['tools'], catalogYamlPath, 'tools'),
    mcps: parseCatalogEntries(d['mcps'], catalogYamlPath, 'mcps'),
    hooks: parseCatalogEntries(d['hooks'], catalogYamlPath, 'hooks'),
    communitySkills: parseCommunitySkills(d['community-skills'], catalogYamlPath),
    path: catalogYamlPath,
  };
}

// ---------------------------------------------------------------------------
// Projects registry
// ---------------------------------------------------------------------------

export function loadProjectsRegistry(projectsYamlPath: string): ProjectsRegistry {
  const d = loadYaml(projectsYamlPath);
  const rawProjects = d['projects'];
  if (!Array.isArray(rawProjects)) {
    throw new Error(`${projectsYamlPath}: "projects" must be an array`);
  }
  const projects: ProjectRef[] = rawProjects.map((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`${projectsYamlPath}: projects[${i}] must be a mapping`);
    }
    const e = item as Record<string, unknown>;
    return {
      id: reqString(e, 'id', projectsYamlPath),
      path: reqString(e, 'path', projectsYamlPath),
    };
  });
  return { projects, path: projectsYamlPath };
}
