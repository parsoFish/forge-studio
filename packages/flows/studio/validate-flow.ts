/**
 * Flow definition validation (ADR 027, §6) — the `flow` half of what was
 * `orchestrator/studio/validate.ts`, moved here by T1 ruling 159. The flow
 * semantics it checks already live in this package: the fan-out predicate
 * (`flow-fanout.ts`), the manifest path guard whose predicate this mirrors
 * (`manifest-path-guard.ts`) and the whole trigger vocabulary
 * (`studio/validate-triggers.ts`, which also owns `TriggerCheckOpts`).
 *
 * Pure semantic checks — no I/O, no mutation of inputs. Consumed by the
 * bridge's flow PUT route, `forge studio lint` and `claim-validator.ts`.
 */

import type { AgentDefinition, FlowDefinition } from '@forge/contracts/studio/types.ts';
import { FLOW_KICKOFF_KINDS } from '@forge/contracts/studio/types.ts';
import { type Finding, err } from '@forge/kernel/findings.ts';
import { SLUG_RE } from '@forge/kernel/ids.ts';
import { agentCapabilityDescriptor } from '@forge/agents/studio/derive.ts';
import { isSafeProjectName } from '../manifest-path-guard.ts';
import { findFanOutViolations } from '../flow-fanout.ts';
import { checkFlowTriggers, type TriggerCheckOpts } from './validate-triggers.ts';

/**
 * Duplicate-id helper. A nine-line pure predicate kept local rather than
 * shared: `packages/library/studio/library-validate.ts` already carries its
 * own copy for the same reason, and the alternative — a home in
 * `@forge/kernel` — is exactly what ruling 159 refused ("kernel owns only
 * ids/findings").
 */
function findDuplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

/**
 * `opts` (R2-04, see {@link TriggerCheckOpts}): `flowIds` is the full
 * registered flow-id set (enables the trigger-target existence check);
 * `flowProjectOf` resolves a flow's project (enables the external-trigger
 * project requirement to be checked on the TARGET flow the mint uses).
 * Omitted callers (a single-flow PUT that hasn't consulted the registry) still
 * get the self-loop / shape checks; studio-lint supplies both.
 */
export function validateFlow(
  flow: FlowDefinition,
  agents: ReadonlyMap<string, AgentDefinition>,
  opts?: TriggerCheckOpts,
): Finding[] {
  const findings: Finding[] = [];
  const obj = `flow:${flow.id}`;

  // slug
  if (!SLUG_RE.test(flow.id)) {
    findings.push(err(obj, 'slug', `Flow id "${flow.id}" does not match ${SLUG_RE}`));
  }

  // project/shape (SEC-03 Defect 3, defence in depth). The REAL enforcement is
  // `writeManifest`'s `assertManifestPathFields` at the manifest-write choke
  // point (orchestrator/mint-triggered-initiative.ts routes through it) — this
  // is layer 2, a charset check catching a poisoned `flow.project` at the
  // PUT/lint boundary, BEFORE it ever reaches a mint. Mirrors the exact
  // predicate the choke point itself uses (`isSafeProjectName`,
  // packages/flows/manifest-path-guard.ts) so the two layers can never drift apart. Error
  // level, not a flag: a warning here would be the "declared data fails open"
  // shape this campaign has repeatedly found and closed. `null`/absent/`''`
  // are all legal (no project binding) — checkFlowTriggers separately requires
  // a non-null project on flows targeted by external triggers.
  if (flow.project !== null && flow.project !== undefined && flow.project !== '' && !isSafeProjectName(flow.project)) {
    findings.push(
      err(
        obj,
        'project/shape',
        `Flow project "${flow.project}" must be a safe single path segment (no separators, no "." or "..")`,
      ),
    );
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
  // and carries no declared `executor` (i.e. not the sole remaining legacy
  // phase executor, 'unifier' — R4-01-F2/ADR-039 retired 'pm'/'dev'/'reflect'
  // onto declared dispatch) can never be executed by the flow engine — interactive
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

  // edge-artifact: every edge MUST carry a non-empty artifact label (bead
  // forge-8vfn.5.12.1, half (b)). The save route runs THIS function and nothing
  // else — `validateArtifactRef` below is `forge studio lint`-only — so before
  // this check a flow built through the builder saved 200 OK, was written as
  // `edges: [{from,to}]`, and then threw on the very next read: `parseFlowEdge`
  // (packages/flows/studio/flow-registry.ts:76) calls `reqString(e,'artifact')`.
  // `loadAllFlows` catches and SKIPS an unreadable flow, so the operator was
  // redirected to `data-page="not-found"` for the flow they had just created.
  //
  // The predicate is `reqString`'s, deliberately and exactly — a non-string or
  // an empty string, with no trimming. A stricter check here would refuse a
  // label the loader accepts and re-open the same disagreement pointing the
  // other way. A write the reader cannot read back is the defect; this refuses
  // it at save time, where the builder already renders flow-save-findings.
  for (const edge of flow.edges) {
    const label: unknown = edge.artifact;
    if (typeof label !== 'string' || label.length === 0) {
      findings.push(
        err(
          obj,
          'edge-artifact',
          `Edge "${edge.from}"→"${edge.to}" carries no artifact label — the flow would be written but could not be read back`,
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

  // fanout-capability (R2-03-F2): a node that declares `fanOut` must target a
  // FANOUT-CAPABLE agent (one whose definition declares a `fanout:` block).
  // Sourced from the SAME capability descriptor the BUILD-tab fanout toggle
  // reads client-side (agentCapabilityDescriptor(def).fanoutCapable), so lint
  // and the UI never disagree. The unknown-agent case is `agent-ref`; the
  // no-inbound-edge topology case is `fan-out` above.
  for (const node of flow.nodes) {
    if (!node.fanOut || !node.agent) continue;
    const def = agents.get(node.agent);
    if (!def) continue;
    if (!agentCapabilityDescriptor(def).fanoutCapable) {
      findings.push(
        err(
          obj,
          'fanout-capability',
          `Node "${node.id}" declares fanOut but agent "${node.agent}" is not fanout-capable (its definition declares no \`fanout:\` block)`,
        ),
      );
    }
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

  // triggers (R2-04, ADR-041) — see checkFlowTriggers above.
  findings.push(...checkFlowTriggers(flow, agents, opts));

  return findings;
}

/**
 * Every FlowEdge.artifact label MUST resolve to a registered artifact template.
 * Promoted from advisory (flag) to error (R3-06/R2-05-F1): ADR-027's own
 * amendment text pre-authorised this once all seed flows ship templates — that
 * condition is now met (all real flow edges resolve to on-disk templates;
 * `forge studio lint` on the pre-promotion base reported 0 `artifact/no-template`
 * findings), so an edge naming an unregistered artifact is now a hard error.
 */
export function validateArtifactRef(flow: FlowDefinition, templateIds: ReadonlySet<string>): Finding[] {
  const findings: Finding[] = [];
  for (const edge of flow.edges) {
    if (!templateIds.has(edge.artifact)) {
      findings.push(
        err(
          `flow:${flow.id}`,
          'artifact/no-template',
          `Edge ${edge.from}→${edge.to} artifact "${edge.artifact}" has no registered template in studio/artifact-templates/`,
        ),
      );
    }
  }
  return findings;
}
