/**
 * The Flow kind's registry — load, parse and serialize `flow.yaml` (ADR 027,
 * ADR 028 §1). Carved out of `orchestrator/studio/registry.ts` (Task 13, M4-flows):
 * the package that owns the flow engine owns loading its definitions, the same
 * split the Agent kind took to `@forge/agents/studio/agent-registry.ts` and the
 * KB kind to `@forge/knowledge/studio/kb-descriptor.ts`.
 *
 * Every function below is BYTE-IDENTICAL to the block it came from; only the
 * imports are re-stated at the new depth. Validation still lives in a separate
 * module, and `FlowDefinition` and its member types stay in `@forge/contracts`
 * — the Flow vocabulary is shared, only the parser is flows'.
 */
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import yaml from 'js-yaml';

import type {
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
  loadYaml,
} from '@forge/kernel/studio/yaml-fields.ts';

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
