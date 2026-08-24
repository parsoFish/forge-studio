'use client';

import Link from 'next/link';
import type { Agent, Flow, Kb, Project, Run } from '@/lib/studio-client';
import { ProvenanceBadge } from '@/components/ProvenanceBadge';
import { deriveFlowStatus, runsForFlow } from '@/lib/home-view';
import { deriveProjectHealth, type ProjectHealthLevel } from '@/lib/projects-index-health';
import { deriveProjectActivity } from '@/lib/projects-index-activity';
import { formatWhen } from '@/lib/history-ledger';
import type { Cycle, ProjectAttentionItem } from '@/lib/bridge-client';

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

/** W8-C3: the health chip's colour token per level. `healthy` is deliberately
 *  the QUIET one — a roster of ready projects should not glow; the eye belongs
 *  on the two that need the operator. */
const HEALTH_COLOR: Record<ProjectHealthLevel, string> = {
  healthy: 'var(--faint)',
  attention: 'var(--amber, var(--ember))',
  broken: 'var(--ember)',
  unknown: 'var(--faint)',
};

export function ProjectCard({
  project,
  kbs,
  index,
  attention,
  cycles,
  nowMs,
}: {
  project: Project;
  kbs: Kb[];
  index: number;
  /**
   * W8-C3 (projects-08): the RAW sources an activity signal is derived from,
   * never a pre-computed activity value. Passing the derivation instead of its
   * inputs is exactly how a prop becomes a place for a stale copy to live —
   * the same reason `health` above is not a prop either.
   *
   * BOTH absent = this shelf does not show activity (the Library's projects
   * section). That is a different fact from "present but empty", which means
   * the sources were read and had nothing for this project.
   */
  attention?: readonly ProjectAttentionItem[];
  cycles?: readonly Cycle[];
  /** Injected so the relative time is deterministic under test (D7: never read
   *  `Date.now()` inside a formatter). */
  nowMs?: number;
}) {
  const skillCount = (project.skills ?? []).length;
  const kbLabel = project.kb ? (kbs.find((k) => k.id === project.kb)?.name ?? project.kb) : null;
  // W8-C3 (projects-08 / forge-j1e): DERIVED here, from the project itself, on
  // every render. Deliberately NOT a prop — a `health` prop is a place for a
  // stale copy to live, and the derivation belongs with the thing that renders
  // it. (Correction, verified rather than assumed: this card has exactly ONE
  // consumer today — `ProjectsIndex.tsx`. The Library's projects shelf that
  // used to be the second one was retired by W6-IA-4 in favour of that index,
  // so "one card, two shelves" is no longer true and is not the argument here.
  // The argument is that the NEXT consumer cannot introduce a disagreement,
  // because there is no value for it to pass. `lib/projects-index-health.test.ts`
  // pins the consumer count so this claim cannot rot silently.)
  const health = deriveProjectHealth(project);
  const showsActivity = attention !== undefined || cycles !== undefined;
  const activity = showsActivity ? deriveProjectActivity(project.id, attention ?? [], cycles ?? []) : null;

  return (
    <Link
      href={`/projects/${encodeURIComponent(project.id)}`}
      className="lib-card"
      data-card-type="project"
      data-card-id={project.id}
      data-provenance={project.provenance}
      data-health={health.level}
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
        <span
          className="card-stat"
          data-field="project-health"
          data-health={health.level}
          style={{ color: HEALTH_COLOR[health.level], fontWeight: health.level === 'broken' ? 700 : 400 }}
        >
          {health.label}
        </span>
      </div>
      {activity && (
        <div
          className="card-meta"
          data-field="project-activity"
          /* Machine-readable and EXACT: the server's own ISO verbatim, and the
             explicit tokens `none` / `unknown` rather than an empty string, so
             "we looked and there is nothing" and "we could not look" stay
             distinguishable in the DOM contract. */
          data-last-activity={activity.lastActivityIso ?? 'none'}
          data-open-count={activity.openCount === null ? 'unknown' : String(activity.openCount)}
          data-progress-done={activity.progress === null ? 'unknown' : String(activity.progress.done)}
          data-progress-total={activity.progress === null ? 'unknown' : String(activity.progress.total)}
          data-flagged={activity.queue === null ? 'unknown' : String(activity.queue.flagged)}
          style={{ marginTop: 6 }}
        >
          <span className="card-stat">
            {activity.lastActivityIso === null ? 'no activity yet' : formatWhen(activity.lastActivityIso, nowMs ?? Date.now())}
          </span>
          <span className="card-stat">
            {activity.openCount === null
              ? 'work unknown'
              : activity.openCount === 0
                ? 'nothing queued'
                : plural(activity.openCount, 'open initiative')}
          </span>
          {activity.progress !== null && (
            <span className="card-stat">{activity.progress.done}/{activity.progress.total} merged</span>
          )}
          {activity.queue !== null && activity.queue.flagged > 0 && (
            <span className="card-stat" style={{ color: 'var(--ember)' }}>
              {plural(activity.queue.flagged, 'flagged plan')}
            </span>
          )}
        </div>
      )}
      {/* The reason, in the words of whatever judged it — the operator cannot
          fix "unhealthy", only "the flat gate keys moved to the typed
          testProcess object". Rendered only when there IS one, so a healthy
          card gains no empty row. */}
      {health.reasons.length > 0 && (
        <div
          data-field="project-health-reason"
          style={{ fontSize: 11, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}
        >
          {health.reasons.join(' · ')}
        </div>
      )}
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
  // W7-C1 (flows-19): a QUEUED initiative used to produce NOTHING on this
  // card — the one state that means "work is waiting" was invisible on the
  // flows pillar. Same lineage-aware set as the gated/failed chips.
  const queuedRuns = flowRuns.filter((r) => r.status === 'planned');

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
      data-flow-queued-count={queuedRuns.length}
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
        {/* R2-04-F4: one badge per declared trigger. W7-C1 (flows-18): the
            text is "on <kind>" — the bare uppercased kind ("MERGED") sat in
            the same meta row as the "N failed" run chips and read as a run
            STATUS, not a trigger. Full "<kind> → <target>" stays on hover. */}
        {triggers.map((tr, i) => (
          <span
            key={`${tr.on}-${tr.target?.ref ?? ''}-${i}`}
            className="badge badge-dim"
            data-trigger-badge={tr.on}
            title={`trigger: ${tr.on} → ${tr.target?.ref ?? ''}`}
            style={{ textTransform: 'none' }}
          >
            on {tr.on}
          </span>
        ))}
        {queuedRuns.length > 0 && (
          <span className="chip">
            {queuedRuns.length} queued
          </span>
        )}
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
