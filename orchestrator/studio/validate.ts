/**
 * Forge Studio definition validation (ADR 027, §6).
 * Pure semantic checks — no I/O, no mutation of inputs.
 * Consumed by: bridge PUT routes (M2) and `forge studio lint` (Task 5).
 *
 * validateKb intentionally checks only the slug and backend; the binding shape is enforced at load time in registry.ts.
 */

import { DEMO_STEP_KINDS } from './types.ts';
import { FLOW_KICKOFF_KINDS } from './types.ts';
import { KB_BACKENDS } from './types.ts';
import { SURFACE_KINDS, PHASE_EXECUTOR_KINDS } from './registry.ts';
import { agentCapabilityDescriptor } from './derive.ts';
import type {
  AgentDefinition,
  ArtifactTemplate,
  Catalog,
  FlowDefinition,
  KbDescriptor,
  ProjectDefinition,
} from './types.ts';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export type Finding = {
  level: 'error' | 'flag';
  object: string; // e.g. 'agent:developer-ralph', 'flow:forge-develop', 'kb:cycles', 'catalog', 'projects'
  check: string;  // e.g. 'readiness/purpose', 'acyclic', 'zero-gate', 'slug'
  message: string;
};

export const SLUG_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function err(object: string, check: string, message: string): Finding {
  return { level: 'error', object, check, message };
}

function flag(object: string, check: string, message: string): Finding {
  return { level: 'flag', object, check, message };
}

function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

// ---------------------------------------------------------------------------
// Fan-out predicate (G6) — shared by validateFlow (lint) and the flow engine
// (orchestrator/flow-runner.ts, runtime enforcement). A node declaring
// `fanOut` must have at least one inbound edge whose `artifact` matches the
// declaration. A node with zero inbound edges (a flow's entry node) can never
// satisfy this, so fanOut on an entry node is always a violation — this one
// predicate is what makes that true for both lint and runtime. Extracted so
// the two call sites can never drift from each other.
// ---------------------------------------------------------------------------

export type FanOutViolation = { nodeId: string; fanOut: string };

export function findFanOutViolations(flow: FlowDefinition): FanOutViolation[] {
  const violations: FanOutViolation[] = [];
  for (const node of flow.nodes) {
    if (node.fanOut) {
      const hasMatchingInbound = flow.edges.some(
        (e) => e.to === node.id && e.artifact === node.fanOut,
      );
      if (!hasMatchingInbound) {
        violations.push({ nodeId: node.id, fanOut: node.fanOut });
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// validateAgent
// ---------------------------------------------------------------------------

export function validateAgent(
  def: AgentDefinition,
  validModelIds?: ReadonlySet<string>,
): Finding[] {
  const findings: Finding[] = [];
  const obj = `agent:${def.slug}`;

  // slug
  if (!SLUG_RE.test(def.slug)) {
    findings.push(err(obj, 'slug', `Slug "${def.slug}" does not match ${SLUG_RE}`));
  }

  // readiness/purpose — error
  if (!def.purpose.trim()) {
    findings.push(err(obj, 'readiness/purpose', 'Agent purpose is missing or blank'));
  }

  // readiness/skill — flag (empty skills is valid for agents like pm that delegate via sub-agents)
  if (def.composition.skills.length === 0) {
    findings.push(flag(obj, 'readiness/skill', 'No composed skills — at least one skill is recommended'));
  }

  // readiness/hook — flag (same reasoning; mock renders this progressively, not a hard blocker)
  if (def.composition.hooks.length === 0) {
    findings.push(flag(obj, 'readiness/hook', 'No observability hooks — at least event-log is recommended'));
  }

  // readiness/process — error
  if (!def.body.trim()) {
    findings.push(err(obj, 'readiness/process', 'Agent process body is missing or blank'));
  }

  // readiness/interactivity — error
  if (!def.interactivity.trim()) {
    findings.push(err(obj, 'readiness/interactivity', 'Agent interactivity description is missing or blank'));
  }

  // surface/enum — error (R2-01-F5). `surface` is optional — absent is legal
  // (e.g. architect has no surface field at all). Parsed leniently at load
  // (registry.ts), so a bad value is a lint error here, not a load crash
  // (kb.backend / flow.kickoff.kind precedent).
  if (def.surface !== undefined && def.surface.trim() !== '' && !(SURFACE_KINDS as readonly string[]).includes(def.surface)) {
    findings.push(
      err(obj, 'surface/enum', `unknown surface "${def.surface}" — must be one of ${SURFACE_KINDS.join('|')}`),
    );
  }

  // executor/enum — error (R2-01-F2 review finding). `executor` is optional —
  // absent is legal (most roster agents have none; they run via the generic
  // F1 execAgent path). Parsed leniently at load (registry.ts), so a bad
  // value is a lint error here, not a load crash — otherwise a typo'd
  // executor silently resolves to NodeKind 'unknown' at runtime (the node
  // is never executed, only an error-severity log) with no lint signal.
  if (
    def.executor !== undefined &&
    def.executor.trim() !== '' &&
    !(PHASE_EXECUTOR_KINDS as readonly string[]).includes(def.executor)
  ) {
    findings.push(
      err(obj, 'executor/enum', `unknown executor "${def.executor}" — must be one of ${PHASE_EXECUTOR_KINDS.join('|')}`),
    );
  }

  // readiness/runtime — error
  const rt = def.runtime;
  const runtimeOk =
    rt.strategy === 'fixed'
      ? Boolean(rt.model && rt.model.trim())
      : rt.strategy === 'range'
        ? Array.isArray(rt.range) && rt.range.length > 0
        : false;

  if (!runtimeOk) {
    const detail =
      rt.strategy === 'fixed'
        ? 'strategy:fixed requires a non-empty model'
        : rt.strategy === 'range'
          ? 'strategy:range requires a non-empty range array'
          : `unknown strategy "${rt.strategy}"`;
    findings.push(err(obj, 'readiness/runtime', `Runtime not fully configured — ${detail}`));
  }

  // runtime model-catalog — error (only when the caller supplies the catalog
  // model-id set). Every referenced model id (fixed model, range entries) must
  // exist in catalog.models, so a mistyped tier is caught at lint time rather
  // than at spawn.
  if (validModelIds) {
    if (rt.strategy === 'fixed' && rt.model && !validModelIds.has(rt.model)) {
      findings.push(err(obj, 'runtime/model-catalog', `Runtime model "${rt.model}" is not in catalog.models`));
    }
    if (rt.strategy === 'range' && Array.isArray(rt.range)) {
      for (const id of rt.range) {
        if (!validModelIds.has(id)) {
          findings.push(err(obj, 'runtime/range-catalog', `Range model "${id}" is not in catalog.models`));
        }
      }
    }
  }

  // composition array entries: each must match a safe identifier regex
  const COMP_ENTRY_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  const compArrays: [string, string[]][] = [
    ['composition/skills', def.composition.skills],
    ['composition/tools', def.composition.tools],
    ['composition/mcps', def.composition.mcps],
    ['composition/hooks', def.composition.hooks],
  ];
  for (const [field, entries] of compArrays) {
    for (const entry of entries) {
      if (typeof entry !== 'string' || !COMP_ENTRY_RE.test(entry)) {
        findings.push(err(obj, field, `Entry "${entry}" in ${field} must match ${COMP_ENTRY_RE}`));
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// validateLibraryFlag (R3-01-F2)
// `library` must be an explicit boolean in every skill's SKILL.md
// frontmatter — never left unset. Deliberately takes raw frontmatter data
// rather than a loaded AgentDefinition: unlike validateAgent, this must run
// against every skill dir the scan reaches, including ones that never pass
// isStudioAgent/loadAgentDefinition at all (no `runtime` block, or an
// explicit `library: false`) — a `library: false` skill must still be
// reachable to prove it's explicit.
// ---------------------------------------------------------------------------

export function validateLibraryFlag(entryName: string, data: unknown): Finding[] {
  const value =
    data != null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)['library']
      : undefined;

  if (typeof value !== 'boolean') {
    return [
      err(
        `agent:${entryName}`,
        'library',
        `"library" must be an explicit boolean (true/false) in SKILL.md frontmatter — found ${
          value === undefined ? 'unset' : JSON.stringify(value)
        }`,
      ),
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// validateFlow
// ---------------------------------------------------------------------------

export function validateFlow(
  flow: FlowDefinition,
  agents: ReadonlyMap<string, AgentDefinition>,
): Finding[] {
  const findings: Finding[] = [];
  const obj = `flow:${flow.id}`;

  // slug
  if (!SLUG_RE.test(flow.id)) {
    findings.push(err(obj, 'slug', `Flow id "${flow.id}" does not match ${SLUG_RE}`));
  }

  // version: must be an integer >= 1
  if (!Number.isInteger(flow.version) || flow.version < 1) {
    findings.push(
      err(obj, 'version', `Flow version must be an integer >= 1, got ${flow.version}`),
    );
  }

  // duplicate node ids
  const nodeIds = flow.nodes.map((n) => n.id);
  for (const dup of findDuplicates(nodeIds)) {
    findings.push(err(obj, 'node-ids', `Duplicate node id "${dup}"`));
  }

  const nodeIdSet = new Set(nodeIds);

  // node shape: must have at least agent or gate
  for (const node of flow.nodes) {
    if (!node.agent && !node.gate) {
      findings.push(
        err(obj, 'node-shape', `Node "${node.id}" has neither "agent" nor "gate" — one is required`),
      );
    }
  }

  // agent-ref: node.agent must exist in agents map
  for (const node of flow.nodes) {
    if (node.agent && !agents.has(node.agent)) {
      findings.push(
        err(obj, 'agent-ref', `Node "${node.id}" references unknown agent "${node.agent}"`),
      );
    }
  }

  // node-executor (R2-01-F2, AC #2; sourced from the R2-02-F1 capability
  // descriptor as of R2-02-F3): a node whose agent resolves to a real def
  // but that def is INTERACTIVE (agentCapabilityDescriptor(def).interactive)
  // and carries no declared `executor` (i.e. not one of the four legacy
  // phase executors) can never be executed by the flow engine — interactive
  // agents run through the interactive-session runner, not a flow node.
  // Sourced from the same descriptor the BUILD-tab palette/drop gate reads
  // client-side, so lint and the UI never disagree. The `!def` case is
  // already covered by agent-ref above.
  for (const node of flow.nodes) {
    if (!node.agent) continue;
    const def = agents.get(node.agent);
    if (!def) continue;
    if (agentCapabilityDescriptor(def).interactive && def.executor === undefined) {
      findings.push(
        err(
          obj,
          'node-executor',
          `Node "${node.id}" references interactive agent "${node.agent}" — interactive agents run through the interactive-session runner, not a flow node`,
        ),
      );
    }
  }

  // edge-ref: from/to must be known node ids
  for (const edge of flow.edges) {
    if (!nodeIdSet.has(edge.from)) {
      findings.push(
        err(
          obj,
          'edge-ref',
          `Edge references unknown source node "${edge.from}" (→ "${edge.to}")`,
        ),
      );
    }
    if (!nodeIdSet.has(edge.to)) {
      findings.push(
        err(
          obj,
          'edge-ref',
          `Edge references unknown target node "${edge.to}" (from "${edge.from}")`,
        ),
      );
    }
  }

  // acyclic: Kahn's algorithm over node ids
  {
    // Build adjacency and in-degree from edges (only over known nodes to avoid noise from
    // edge-ref errors above)
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const id of nodeIds) {
      inDegree.set(id, 0);
      adj.set(id, []);
    }
    for (const edge of flow.edges) {
      if (nodeIdSet.has(edge.from) && nodeIdSet.has(edge.to)) {
        adj.get(edge.from)!.push(edge.to);
        inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
      }
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    let processed = 0;
    let head = 0;
    while (head < queue.length) {
      const current = queue[head];
      head += 1;
      processed++;
      for (const neighbor of adj.get(current) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }
    if (processed < nodeIds.length) {
      findings.push(
        err(obj, 'acyclic', `Flow "${flow.id}" contains a cycle — not a valid DAG`),
      );
    }
  }

  // fan-out: node.fanOut must match artifact of ≥1 inbound edge (G6 — the
  // runtime enforces this SAME predicate at flow start; see
  // orchestrator/flow-runner.ts and findFanOutViolations above)
  for (const violation of findFanOutViolations(flow)) {
    findings.push(
      err(
        obj,
        'fan-out',
        `Node "${violation.nodeId}" declares fanOut:"${violation.fanOut}" but no inbound edge carries artifact "${violation.fanOut}"`,
      ),
    );
  }

  // kickoff (Stage C, optional): kind must be in the enum. Loader parses it
  // leniently so a typo is a lint error here, not a load crash (kb.backend precedent).
  if (flow.kickoff !== undefined && !(FLOW_KICKOFF_KINDS as readonly string[]).includes(flow.kickoff.kind)) {
    findings.push(
      err(obj, 'kickoff/kind', `Flow kickoff.kind "${flow.kickoff.kind}" must be one of ${FLOW_KICKOFF_KINDS.join('|')}`),
    );
  }

  // zero-gate: at least one node must carry a gate, unless disposable:true
  const hasGate = flow.nodes.some((n) => Boolean(n.gate));
  if (!hasGate && !flow.disposable) {
    findings.push(
      err(
        obj,
        'zero-gate',
        `Flow "${flow.id}" has no human gate nodes and is not marked disposable:true — ` +
          'zero-gate flows are rejected to prevent unbounded unattended spending (brain: v1 review-spin incident)',
      ),
    );
  }

  return findings;
}

// ---------------------------------------------------------------------------
// validateKb
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// validateArtifactTemplate / validateArtifactRef (ADR-027 amendment)
// ---------------------------------------------------------------------------

export function validateArtifactTemplate(t: ArtifactTemplate): Finding[] {
  const findings: Finding[] = [];
  const obj = `artifact-template:${t.id}`;
  if (!SLUG_RE.test(t.id)) {
    findings.push(err(obj, 'slug', `Artifact template id "${t.id}" does not match ${SLUG_RE}`));
  }
  for (const [field, slug] of [
    ['producer', t.producer],
    ['consumer', t.consumer],
  ] as const) {
    if (slug !== undefined && !SLUG_RE.test(slug)) {
      findings.push(err(obj, `${field}/slug`, `${field} "${slug}" does not match ${SLUG_RE}`));
    }
  }
  return findings;
}

/**
 * Every FlowEdge.artifact label SHOULD resolve to a registered artifact template.
 * Advisory (flag) — promotable to error once all seed flows ship templates.
 */
export function validateArtifactRef(flow: FlowDefinition, templateIds: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  for (const edge of flow.edges) {
    if (!templateIds.has(edge.artifact)) {
      findings.push(
        flag(
          `flow:${flow.id}`,
          'artifact/no-template',
          `Edge ${edge.from}→${edge.to} artifact "${edge.artifact}" has no registered template in studio/artifact-templates/`,
        ),
      );
    }
  }
  return findings;
}

export function validateKb(kb: KbDescriptor): Finding[] {
  const findings: Finding[] = [];
  const obj = `kb:${kb.id}`;

  if (!SLUG_RE.test(kb.id)) {
    findings.push(err(obj, 'slug', `KB id "${kb.id}" does not match ${SLUG_RE}`));
  }

  // backend (optional) must be a known storage backend. Loader parses it leniently
  // so a typo is a lint error here, not a load crash.
  if (kb.backend !== undefined && !(KB_BACKENDS as readonly string[]).includes(kb.backend)) {
    findings.push(
      err(obj, 'backend', `KB backend "${kb.backend}" must be one of ${KB_BACKENDS.join('|')}`),
    );
  }

  // Note: the `binding` shape (kind enum + ref presence) is already
  // load-guarded in registry (parseKbBinding); we do not duplicate it here.
  // Binding *cross-reference* checks (dangling ref, exactly-one-unique) live
  // in cli/studio-lint.ts, which has the full KB roster + discovered
  // flows/projects needed to check them.

  return findings;
}

// ---------------------------------------------------------------------------
// validateCatalog
// ---------------------------------------------------------------------------

export function validateCatalog(c: Catalog): Finding[] {
  const findings: Finding[] = [];
  const obj = 'catalog';

  // unique-ids within each section
  // Note: catalog entry ids are free-form display ids (model ids contain dots/uppercase —
  // e.g. "claude-sonnet-4-6"), deliberately not slug-checked.
  const sections: [string, { id: string }[]][] = [
    ['sdks', c.sdks],
    ['models', c.models],
    ['tools', c.tools],
    ['mcps', c.mcps],
    ['hooks', c.hooks],
  ];

  for (const [section, entries] of sections) {
    for (const dup of findDuplicates(entries.map((e) => e.id))) {
      findings.push(
        err(obj, 'unique-ids', `Duplicate id "${dup}" in catalog.${section}`),
      );
    }
  }

  // model-sdk: every model's sdk must be among declared sdk ids
  const sdkIds = new Set(c.sdks.map((s) => s.id));
  for (const model of c.models) {
    if (!sdkIds.has(model.sdk)) {
      findings.push(
        err(
          obj,
          'model-sdk',
          `Model "${model.id}" references unknown sdk "${model.sdk}" — not in catalog.sdks`,
        ),
      );
    }
  }

  // community-skills: curated OOTB showcase entries. Unique slug ids; recommended
  // tier (if present) must be a real model tier; composedBy entries are slugs.
  const TIERS = new Set(['haiku', 'sonnet', 'opus']);
  const communitySkills = c.communitySkills ?? [];
  for (const dup of findDuplicates(communitySkills.map((s) => s.id))) {
    findings.push(err(obj, 'unique-ids', `Duplicate id "${dup}" in catalog.communitySkills`));
  }
  for (const s of communitySkills) {
    if (!SLUG_RE.test(s.id)) {
      findings.push(err(obj, 'community-skill/slug', `Community skill id "${s.id}" does not match ${SLUG_RE}`));
    }
    if (s.tier !== undefined && !TIERS.has(s.tier)) {
      findings.push(
        err(obj, 'community-skill/tier', `Community skill "${s.id}" tier "${s.tier}" must be one of haiku|sonnet|opus`),
      );
    }
    for (const slug of s.composedBy ?? []) {
      if (!SLUG_RE.test(slug)) {
        findings.push(
          err(obj, 'community-skill/composed-by', `Community skill "${s.id}" composedBy "${slug}" does not match ${SLUG_RE}`),
        );
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// validateProject
// ---------------------------------------------------------------------------

export function validateProject(def: ProjectDefinition): Finding[] {
  const findings: Finding[] = [];
  const obj = `project:${def.id}`;

  // slug
  if (!SLUG_RE.test(def.id)) {
    findings.push(err(obj, 'slug', `Project id "${def.id}" does not match ${SLUG_RE}`));
  }

  // northStar: empty → flag; >140 → error
  if (!def.northStar.trim()) {
    findings.push(flag(obj, 'readiness/north-star', 'Project northStar is missing or blank'));
  } else if (def.northStar.length > 140) {
    findings.push(
      err(
        obj,
        'readiness/north-star',
        `Project northStar must be ≤ 140 characters (got ${def.northStar.length})`,
      ),
    );
  }

  // demoProcess: each step's kind must be in the enum
  for (let i = 0; i < def.demoProcess.length; i++) {
    const step = def.demoProcess[i];
    if (!DEMO_STEP_KINDS.includes(step.kind)) {
      findings.push(
        err(
          obj,
          'demoProcess/kind',
          `demoProcess[${i}].kind "${step.kind}" must be one of capture|verify|present`,
        ),
      );
    }
  }

  // skills: all entries must be strings
  for (let i = 0; i < def.skills.length; i++) {
    if (typeof def.skills[i] !== 'string') {
      findings.push(
        err(obj, 'skills/type', `skills[${i}] must be a string (got ${typeof def.skills[i]})`),
      );
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// validateDiscoveredProjects
// ---------------------------------------------------------------------------

/**
 * Validate the disk-discovered project set (B1 — projects are auto-discovered
 * from `<projectsDir>/*` rather than a `studio/projects.yaml` registry). The
 * caller supplies the `discoverProjects` result. Errors: a project id that
 * cannot form a slug (the dir name produced an empty/invalid id) or a duplicate
 * id (two dirs slug to the same id). Flag (warn): a project dir without a
 * `.forge/project.json` — a half-onboarded project forge will skip until its
 * contract file lands.
 */
export function validateDiscoveredProjects(
  projects: ReadonlyArray<{ id: string; path: string; hasConfig: boolean }>,
): Finding[] {
  const findings: Finding[] = [];
  const obj = 'projects';

  // unique-ids
  for (const dup of findDuplicates(projects.map((p) => p.id))) {
    findings.push(err(obj, 'unique-ids', `Duplicate project id "${dup}" (two project dirs slug to the same id)`));
  }

  for (const project of projects) {
    // slug per project id (defensive — discoverProjects already slugifies)
    if (!SLUG_RE.test(project.id)) {
      findings.push(err(obj, 'slug', `Project id "${project.id}" does not match ${SLUG_RE}`));
    }
    // half-onboarded: a dir without the contract file is a warn, not an error.
    if (!project.hasConfig) {
      findings.push(
        flag(
          obj,
          'missing-config',
          `Project dir "${project.path}" has no .forge/project.json — forge will skip it until the contract file is added (run \`forge preflight ${project.id}\` / the forge-onboard-project skill).`,
        ),
      );
    }
  }

  return findings;
}
