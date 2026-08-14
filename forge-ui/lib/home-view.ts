/**
 * Home dashboard — PURE derivation module (R6-07).
 *
 * THE DEFECT CLASS THIS MODULE KILLS: declared-data-fails-open. The mockup
 * (mockups/studio-endstate-v2/views-home.jsx + data.jsx) invents
 * `flow.status` / `agent.status` / `kb.status` fields that do not exist on
 * the real wire types (`Flow`, `Agent`, `Project`, `Kb` in ./studio-client —
 * none carry a `status` field). Live status on Home is DERIVED from the
 * run-model (`Run[]` from fetchRuns()) and the attention aggregate
 * (`ProjectAttentionItem[]` from fetchProjectAttention()), never read off a
 * fabricated field.
 *
 * PURITY CONTRACT (scripts/home-no-new-polling.test.ts enforces this at the
 * source level): no fetch, no API-path string, no async/promise-waiting
 * keyword, no subscribe. Every function here takes already-fetched data as
 * input and returns a value — all I/O and live-refresh wiring belongs to
 * the page (app/page.tsx).
 */

import type { Run, Flow, Agent, Project, Kb, KbLintSummary } from './studio-client';
import type { ProjectAttentionItem } from './bridge-client';

export type HomeStatus = 'active' | 'gated' | 'idle';
export type HomeHexKind = 'flow' | 'agent' | 'project' | 'kb';

export type HomeHex = {
  id: string;
  kind: HomeHexKind;
  glyph: string;
  label: string;
  status: HomeStatus;
  href: string;
};

/**
 * forge-2am: widened to a discriminated union so the attention strip can
 * carry KB-lint rows alongside the pre-existing project-gate rows without
 * either kind borrowing fields it doesn't have (a 'kb' row has no
 * `projectId`; a 'gate' row has no `kbId`/`lint`). `id`/`text`/`sub`/`href`/
 * `status` stay common to both so the page can render most of the row
 * uniformly, branching only on `kind` for the kind-specific `data-*`
 * attributes and fields.
 */
export type HomeAttentionItem =
  | {
      id: string;
      kind: 'gate';
      text: string;
      sub: string;
      status: string;
      href: string;
      projectId: string;
    }
  | {
      id: string;
      kind: 'kb';
      text: string;
      sub: string;
      status: 'fail' | 'warn' | 'unknown';
      href: string;
      kbId: string;
      lint: KbLintSummary;
    };

/**
 * forge-n5r: the ONE flow<->run matcher. A run "belongs" to a flow either
 * directly (`run.flowId`) or by having traversed it as part of a threaded
 * spine (`run.flowLineage`, e.g. architect -> develop -> reflect) —
 * ignoring lineage would leave a spine run's traversed flows permanently
 * 'idle'/quiet. Every consumer that needs "the runs for this flow"
 * (`deriveFlowStatus` below, `FlowCard` in `components/studio/LibraryCard.tsx`,
 * the flow monitor in `app/flows/[id]/page.tsx`) calls THIS function rather
 * than re-writing the predicate inline — two independently-written copies is
 * exactly how `FlowCard`'s `runs.filter(r => r.flowId === flow.id)` drifted
 * from the correct behaviour in the first place.
 */
export function runsForFlow(flowId: string, runs: Run[]): Run[] {
  return runs.filter((r) => r.flowId === flowId || r.flowLineage.includes(flowId));
}

/**
 * A flow's live status, built ON `runsForFlow` (never a second, independent
 * predicate). 'active' beats 'gated' when both are present (an active run
 * elsewhere on the flow is the more urgent fact); no matching run at all is
 * 'idle' — never a fabricated default.
 */
export function deriveFlowStatus(flowId: string, runs: Run[]): HomeStatus {
  const matching = runsForFlow(flowId, runs);
  if (matching.some((r) => r.status === 'active')) return 'active';
  if (matching.some((r) => r.status === 'gated')) return 'gated';
  return 'idle';
}

/**
 * An agent's live status: 'active' iff some `active` run has an `active`
 * phase on a flow node this agent owns (matched by `node.agent === agent.id`,
 * keyed by that node's own `id` against `run.phases`). An agent that maps to
 * no node in any flow fails CLOSED to 'idle' — it must never default to
 * 'active' just because it exists.
 */
export function deriveAgentStatus(agent: Agent, flows: Flow[], runs: Run[]): HomeStatus {
  const ownedNodeIds = new Set<string>();
  for (const flow of flows) {
    for (const node of flow.nodes) {
      if (node.agent === agent.id) ownedNodeIds.add(node.id);
    }
  }
  if (ownedNodeIds.size === 0) return 'idle';

  for (const run of runs) {
    if (run.status !== 'active') continue;
    for (const nodeId of ownedNodeIds) {
      if (run.phases[nodeId] === 'active') return 'active';
    }
  }
  return 'idle';
}

/**
 * A project's live status, read from its row in the attention aggregate
 * (never a fabricated `project.status` — `Project` carries none). A project
 * absent from the attention list — e.g. one with no queue activity yet —
 * fails closed to 'idle', not to a guessed state.
 */
export function deriveProjectStatus(projectId: string, attention: ProjectAttentionItem[]): HomeStatus {
  const row = attention.find((a) => a.projectId === projectId);
  if (!row) return 'idle';
  if (row.gated > 0) return 'gated';
  if (row.inFlight > 0) return 'active';
  return 'idle';
}

/**
 * Assemble the full hex-constellation: one hex per flow, agent, project, and
 * KB, in that order. Status is ALWAYS derived (never read off a `.status`
 * field the real types don't carry) — KBs have no live-status source at all,
 * so their hex is always 'idle' rather than inventing one.
 */
export function buildConstellation(input: {
  flows: Flow[];
  agents: Agent[];
  projects: Project[];
  kbs: Kb[];
  runs: Run[];
  attention: ProjectAttentionItem[];
}): HomeHex[] {
  const { flows, agents, projects, kbs, runs, attention } = input;
  const hexes: HomeHex[] = [];

  for (const flow of flows) {
    hexes.push({
      id: flow.id,
      kind: 'flow',
      glyph: '⬡',
      label: flow.name,
      status: deriveFlowStatus(flow.id, runs),
      href: `/flows/${flow.id}`,
    });
  }

  for (const agent of agents) {
    hexes.push({
      id: agent.id,
      kind: 'agent',
      glyph: '⬢',
      label: agent.name,
      status: deriveAgentStatus(agent, flows, runs),
      href: `/agents/${agent.id}`,
    });
  }

  for (const project of projects) {
    hexes.push({
      id: project.id,
      kind: 'project',
      glyph: '◆',
      label: project.name,
      status: deriveProjectStatus(project.id, attention),
      href: `/projects/${project.id}`,
    });
  }

  for (const kb of kbs) {
    hexes.push({
      id: kb.id,
      kind: 'kb',
      glyph: '◈',
      // No live-status source exists for KBs — always 'idle', never fabricated.
      label: kb.name,
      status: 'idle',
      href: `/knowledge?id=${kb.id}`,
    });
  }

  return hexes;
}

/**
 * Cross-project "what needs me" rows, mirroring the R4-11-F4 attention
 * strip's own real-condition rule: a row fires only when it has an actual
 * gated or flagged count, never on the mere existence of a project. Rows
 * with neither are omitted entirely — an empty result honestly means
 * nothing needs attention right now.
 */
export function buildHomeAttention(attention: ProjectAttentionItem[]): HomeAttentionItem[] {
  const items: HomeAttentionItem[] = [];

  for (const row of attention) {
    if (row.gated <= 0 && row.flagged <= 0) continue;

    const parts: string[] = [];
    if (row.gated > 0) parts.push(`${row.gated} awaiting review`);
    if (row.flagged > 0) parts.push(`${row.flagged} flagged`);

    items.push({
      id: `gate-${row.projectId}`,
      kind: 'gate',
      text: `${row.name} · ${parts.join(' · ')}`,
      sub: `${row.planned} planned · ${row.inFlight} in-flight · ${row.merged} merged`,
      status: row.gated > 0 ? 'gated' : 'flagged',
      href: row.link,
      projectId: row.projectId,
    });
  }

  return items;
}

/**
 * forge-2am: KB-lint rows for the attention strip, mirroring
 * `buildHomeAttention`'s own real-condition rule above — a row fires ONLY
 * on an honest signal from the KB's OWN `lint` summary, never from mere
 * existence, and `lint === null` (no data) is never folded into a
 * fabricated clean verdict. Precedence: `lint.error` (the lint run itself
 * threw) beats a real errors/flags count — an "unknown" verdict is more
 * honest than reporting stale/partial numbers next to a run that failed to
 * complete. Otherwise `errors > 0` -> 'fail' beats `flags > 0` -> 'warn'.
 * A KB with `checksRun < checksTotal` (not every check inspected this KB —
 * see `Kb.lint`'s header) still fires normally; the n/a-invariant is
 * surfaced on the row's `lint` object verbatim, not smoothed over.
 */
export function buildKbAttention(kbs: Kb[]): HomeAttentionItem[] {
  const items: HomeAttentionItem[] = [];

  for (const kb of kbs) {
    const lint = kb.lint;
    if (lint === null) continue;

    let status: 'fail' | 'warn' | 'unknown' | null = null;
    if (lint.error) status = 'unknown';
    else if (lint.errors > 0) status = 'fail';
    else if (lint.flags > 0) status = 'warn';
    if (status === null) continue; // an all-clean lint fires no row

    const parts: string[] = [];
    if (lint.error) {
      parts.push('lint run failed');
    } else {
      if (lint.errors > 0) parts.push(`${lint.errors} lint error${lint.errors === 1 ? '' : 's'}`);
      if (lint.flags > 0) parts.push(`${lint.flags} flagged`);
    }

    items.push({
      id: `kb-${kb.id}`,
      kind: 'kb',
      text: `${kb.name} · ${parts.join(' · ')}`,
      sub: `${lint.checksRun}/${lint.checksTotal} checks run`,
      status,
      href: `/knowledge?id=${kb.id}`,
      kbId: kb.id,
      lint,
    });
  }

  return items;
}
