'use client';

import Link from 'next/link';
import type { Agent, Flow, Kb, Project, Run } from '@/lib/studio-client';

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
    <div
      className="lib-card"
      data-card-type="project"
      data-card-id={project.id}
      style={{ animationDelay: `${index * 0.045}s`, cursor: 'default' }}
      title="Project builder lands in M2"
    >
      <div className="card-top">
        <span className="card-name">{project.name}</span>
        <span className="badge badge-project">project</span>
      </div>
      <p className="card-body">{truncate(project.northStar, 120)}</p>
      <div className="card-meta">
        <span className="card-stat">{plural(skillCount, 'skill')}</span>
        {kbLabel && <span className="badge badge-kb">{kbLabel}</span>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent card
// ---------------------------------------------------------------------------

export function AgentCard({ agent, index }: { agent: Agent; index: number }) {
  const skillCount = (agent.skills ?? []).length;
  const toolCount = (agent.tools ?? []).length;
  const hookCount = (agent.hooks ?? []).length;
  const parts: string[] = [];
  if (skillCount) parts.push(plural(skillCount, 'skill'));
  if (toolCount) parts.push(plural(toolCount, 'tool'));
  if (hookCount) parts.push(plural(hookCount, 'hook'));
  const compositionSummary = parts.join(' · ') || 'no composition';

  const interactivityHint = (agent.interactivity ?? '').split('.')[0];
  const runtimeLabel = agent.runtime?.label ?? null;

  return (
    <div
      className="lib-card"
      data-card-type="agent"
      data-card-id={agent.id}
      style={{ animationDelay: `${index * 0.045}s`, cursor: 'default' }}
      title="Agent builder lands in M2"
    >
      <div className="card-top">
        <span className="card-name">{agent.name}</span>
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
    </div>
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
  const hasTrigger = (flow.triggers ?? []).length > 0;

  // Runs for this flow
  const flowRuns = runs.filter((r) => r.flowId === flow.id);
  const activeRun = flowRuns.find((r) => r.status === 'active');
  const gatedRuns = flowRuns.filter((r) => r.status === 'gated');
  const failedRuns = flowRuns.filter((r) => r.status === 'failed');

  return (
    <Link
      href={`/flows/${encodeURIComponent(flow.id)}`}
      className="lib-card"
      data-card-type="flow"
      data-card-id={flow.id}
      style={{ animationDelay: `${index * 0.045}s`, display: 'block' }}
    >
      <div className="card-top">
        <span className="card-name">{flow.name}</span>
        <span className="badge badge-flow">flow</span>
      </div>
      <p className="card-body">{truncate(flow.goal, 110)}</p>
      <div className="card-meta">
        <span className="card-stat">{nodeCount} nodes · {edgeCount} edges</span>
        {proj && <span className="badge badge-project">{proj.name}</span>}
        {hasTrigger && (
          <span className="badge badge-dim">
            triggers {flow.triggers.length} {flow.triggers.length !== 1 ? 'flows' : 'flow'}
          </span>
        )}
        {gatedRuns.length > 0 && (
          <Link
            href={`/flows/${encodeURIComponent(flow.id)}`}
            className="chip chip-gated pulse-ember"
            onClick={(e) => e.stopPropagation()}
          >
            {gatedRuns.length} need{gatedRuns.length === 1 ? 's' : ''} you
          </Link>
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
    kb.scope === 'project' ? 'badge-project' :
    kb.scope === 'flow' ? 'badge-flow' :
    'badge-agent';

  const scopeLabel = kb.scope === 'agent-integration' ? 'agent-integration' : kb.scope;

  return (
    <div
      className="lib-card"
      data-card-type="kb"
      data-card-id={kb.id}
      style={{ animationDelay: `${index * 0.045}s`, cursor: 'default' }}
      title="Knowledge builder lands in M5"
    >
      <div className="card-top">
        <span className="card-name">{kb.name}</span>
        <span className="badge badge-kb">kb</span>
      </div>
      <p className="card-body">{truncate(kb.desc, 110)}</p>
      <div className="card-meta">
        <span className="card-stat">{layerStat}</span>
        <span className={`badge ${scopeBadgeClass}`}>{scopeLabel}</span>
      </div>
    </div>
  );
}
