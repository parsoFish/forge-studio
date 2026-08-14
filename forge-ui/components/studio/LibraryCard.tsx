'use client';

import Link from 'next/link';
import type { Agent, Flow, Kb, Project, Run } from '@/lib/studio-client';
import { ProvenanceBadge } from '@/components/ProvenanceBadge';
import { deriveFlowStatus, runsForFlow } from '@/lib/home-view';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncate(s: string | undefined, max: number): string {
  if (!s) return '';
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n !== 1 ? 's' : ''}`;
}

// ---------------------------------------------------------------------------
// Project card
// ---------------------------------------------------------------------------

export function ProjectCard({ project, kbs, index }: { project: Project; kbs: Kb[]; index: number }) {
  const skillCount = (project.skills ?? []).length;
  const kbLabel = project.kb ? (kbs.find((k) => k.id === project.kb)?.name ?? project.kb) : null;

  return (
    <Link
      href={`/projects/${encodeURIComponent(project.id)}`}
      className="lib-card"
      data-card-type="project"
      data-card-id={project.id}
      data-provenance={project.provenance}
      style={{ animationDelay: `${index * 0.045}s`, display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{project.name}</span>
        <ProvenanceBadge provenance={project.provenance} />
        <span className="badge badge-project">project</span>
      </div>
      <p className="card-body">{truncate(project.northStar, 120)}</p>
      <div className="card-meta">
        <span className="card-stat">{plural(skillCount, 'skill')}</span>
        {kbLabel && <span className="badge badge-kb">{kbLabel}</span>}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Agent card
// ---------------------------------------------------------------------------

export function AgentCard({ agent, index }: { agent: Agent; index: number }) {
  const skillCount = (agent.skills ?? []).length;
  const toolCount = (agent.tools ?? []).length;
  const guardCount = (agent.guards ?? []).length;
  const parts: string[] = [];
  if (skillCount) parts.push(plural(skillCount, 'skill'));
  if (toolCount) parts.push(plural(toolCount, 'tool'));
  if (guardCount) parts.push(plural(guardCount, 'guard'));
  const compositionSummary = parts.join(' · ') || 'no composition';

  const interactivityHint = (agent.interactivity ?? '').split('.')[0];
  const runtimeLabel = agent.runtime?.label ?? null;

  return (
    <Link
      href={`/agents/${encodeURIComponent(agent.id)}`}
      className="lib-card"
      data-card-type="agent"
      data-card-id={agent.id}
      data-provenance={agent.provenance}
      style={{ animationDelay: `${index * 0.045}s`, display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{agent.name}</span>
        <ProvenanceBadge provenance={agent.provenance} />
        <span className="badge badge-agent">agent</span>
      </div>
      <p className="card-body">{truncate(agent.purpose, 110)}</p>
      <div className="card-meta">
        <span className="card-stat">{compositionSummary}</span>
        {interactivityHint && (
          <span className="card-stat" style={{ color: 'var(--faint)' }}>{interactivityHint}</span>
        )}
      </div>
      {runtimeLabel && (
        <div className="agent-runtime-line">{runtimeLabel}</div>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Flow card
// ---------------------------------------------------------------------------

export function FlowCard({
  flow,
  runs,
  projects,
  index,
}: {
  flow: Flow;
  runs: Run[];
  projects: Project[];
  index: number;
}) {
  const nodeCount = (flow.nodes ?? []).length;
  const edgeCount = (flow.edges ?? []).length;

  const proj = flow.project ? projects.find((p) => p.id === flow.project) : null;
  const triggers = flow.triggers ?? [];
  // forge-3oq: provenance is a SERVER FACT (Flow.provenance) — read
  // verbatim, never re-derived from flow.origin client-side.
  const provenance = flow.provenance;
  // forge-n5r: deriveFlowStatus/runsForFlow (lib/home-view.ts) — the ONE
  // shared flow<->run matcher, byte-identical to the flow monitor's and
  // Home's own derivation. runsForFlow honours run.flowLineage; the prior
  // `runs.filter(r => r.flowId === flow.id)` here dropped it entirely,
  // leaving a threaded-spine run's traversed flows wrongly quiet.
  const flowStatus = deriveFlowStatus(flow.id, runs);
  const flowRuns = runsForFlow(flow.id, runs);
  const activeRun = flowRuns.find((r) => r.status === 'active');
  const gatedRuns = flowRuns.filter((r) => r.status === 'gated');
  const failedRuns = flowRuns.filter((r) => r.status === 'failed');

  // review round (GAP 3): deriveFlowStatus stays a 3-state derivation
  // (active|gated|idle) shared byte-for-byte with the flow monitor — a
  // 4th 'failed' state is deliberately NOT added here. Instead
  // data-flow-failed-count/data-flow-gated-count below mirror the SAME
  // lineage-aware runsForFlow set that already feeds the gated/failed
  // chips, so DOM-driven automation can tell a failed-only flow apart
  // from a never-run one without scraping chip text. Always present
  // ("0" when none) — never omitted just because the count is zero.
  return (
    <Link
      href={`/flows/${encodeURIComponent(flow.id)}`}
      className="lib-card"
      data-card-type="flow"
      data-card-id={flow.id}
      data-provenance={provenance}
      data-flow-status={flowStatus}
      data-flow-failed-count={failedRuns.length}
      data-flow-gated-count={gatedRuns.length}
      style={{ animationDelay: `${index * 0.045}s`, display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{flow.name}</span>
        <ProvenanceBadge provenance={provenance} />
        <span className="badge badge-flow">flow</span>
      </div>
      <p className="card-body">{truncate(flow.goal, 110)}</p>
      <div className="card-meta">
        <span className="card-stat">{nodeCount} nodes · {edgeCount} edges</span>
        {proj && <span className="badge badge-project">{proj.name}</span>}
        {/* R2-04-F4: one badge per declared trigger — the kind is the badge
            text, the full "<kind> → <target>" reads on hover. */}
        {triggers.map((tr, i) => (
          <span
            key={`${tr.on}-${tr.target?.ref ?? ''}-${i}`}
            className="badge badge-dim"
            data-trigger-badge={tr.on}
            title={`${tr.on} → ${tr.target?.ref ?? ''}`}
          >
            {tr.on}
          </span>
        ))}
        {gatedRuns.length > 0 && (
          <span className="chip chip-gated pulse-ember">
            {gatedRuns.length} need{gatedRuns.length === 1 ? 's' : ''} you
          </span>
        )}
        {failedRuns.length > 0 && (
          <span className="chip chip-failed">
            {failedRuns.length} failed
          </span>
        )}
      </div>
      {activeRun && (
        <div className="flow-live-strip">
          <span className="status-dot" data-status="active" />
          <span className="flow-live-initiative">{truncate(activeRun.initiative, 52)}</span>
          <span className="flow-live-cost">${(activeRun.costUsd ?? 0).toFixed(2)}</span>
        </div>
      )}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// KB card
// ---------------------------------------------------------------------------

export function KbCard({ kb, index }: { kb: Kb; index: number }) {
  const { index: indexCount, themes: themeCount, raw: rawCount } = kb.counts ?? { index: 0, themes: 0, raw: 0 };
  const layerParts: string[] = [];
  if (indexCount) layerParts.push(`${indexCount} index`);
  if (themeCount) layerParts.push(plural(themeCount, 'theme'));
  if (rawCount) layerParts.push(`${rawCount} raw`);
  const layerStat = layerParts.join(' · ') || '0 nodes';

  const scopeBadgeClass =
    kb.binding.kind === 'project' ? 'badge-project' :
    kb.binding.kind === 'flow' ? 'badge-flow' :
    'badge-agent';

  const scopeLabel = kb.binding.kind;

  return (
    <Link
      href={`/knowledge?id=${encodeURIComponent(kb.id)}`}
      className="lib-card"
      data-card-type="kb"
      data-card-id={kb.id}
      data-provenance={kb.provenance}
      style={{ animationDelay: `${index * 0.045}s`, display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{kb.name}</span>
        <ProvenanceBadge provenance={kb.provenance} />
        <span className="badge badge-kb">kb</span>
      </div>
      <p className="card-body">{truncate(kb.desc, 110)}</p>
      <div className="card-meta">
        <span className="card-stat">{layerStat}</span>
        <span className={`badge ${scopeBadgeClass}`}>{scopeLabel}</span>
      </div>
    </Link>
  );
}
