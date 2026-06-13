/**
 * Forge Studio definition validation (ADR 027, §6).
 * Pure semantic checks — no I/O, no mutation of inputs.
 * Consumed by: bridge PUT routes (M2) and `forge studio lint` (Task 5).
 */

import type {
  AgentDefinition,
  Catalog,
  FlowDefinition,
  KbDescriptor,
  ProjectsRegistry,
} from './types.ts';

// ---------------------------------------------------------------------------
// Public API types
// ---------------------------------------------------------------------------

export type Finding = {
  level: 'error' | 'flag';
  object: string; // e.g. 'agent:developer-ralph', 'flow:forge-cycle', 'kb:cycles', 'catalog', 'projects'
  check: string;  // e.g. 'readiness/purpose', 'acyclic', 'zero-gate', 'slug'
  message: string;
};

export const SLUG_RE = /^[a-z][a-z0-9-]*$/;

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
// validateAgent
// ---------------------------------------------------------------------------

export function validateAgent(def: AgentDefinition): Finding[] {
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

  return findings;
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
    while (queue.length > 0) {
      const current = queue.shift()!;
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

  // fan-out: node.fanOut must match artifact of ≥1 inbound edge
  for (const node of flow.nodes) {
    if (node.fanOut) {
      const hasMatchingInbound = flow.edges.some(
        (e) => e.to === node.id && e.artifact === node.fanOut,
      );
      if (!hasMatchingInbound) {
        findings.push(
          err(
            obj,
            'fan-out',
            `Node "${node.id}" declares fanOut:"${node.fanOut}" but no inbound edge carries artifact "${node.fanOut}"`,
          ),
        );
      }
    }
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

export function validateKb(kb: KbDescriptor): Finding[] {
  const findings: Finding[] = [];
  const obj = `kb:${kb.id}`;

  if (!SLUG_RE.test(kb.id)) {
    findings.push(err(obj, 'slug', `KB id "${kb.id}" does not match ${SLUG_RE}`));
  }

  // Note: scope enum is already load-guarded in registry (oneOf check);
  // we do not duplicate it here.

  return findings;
}

// ---------------------------------------------------------------------------
// validateCatalog
// ---------------------------------------------------------------------------

export function validateCatalog(c: Catalog): Finding[] {
  const findings: Finding[] = [];
  const obj = 'catalog';

  // unique-ids within each section
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

  return findings;
}

// ---------------------------------------------------------------------------
// validateProjectsRegistry
// ---------------------------------------------------------------------------

export function validateProjectsRegistry(r: ProjectsRegistry): Finding[] {
  const findings: Finding[] = [];
  const obj = 'projects';

  // unique-ids
  for (const dup of findDuplicates(r.projects.map((p) => p.id))) {
    findings.push(err(obj, 'unique-ids', `Duplicate project id "${dup}"`));
  }

  // slug per project id
  for (const project of r.projects) {
    if (!SLUG_RE.test(project.id)) {
      findings.push(
        err(obj, 'slug', `Project id "${project.id}" does not match ${SLUG_RE}`),
      );
    }
  }

  return findings;
}
