'use client';

/**
 * ArchitectCommittedView — the post-approve panel shared by the architect
 * session page (committed phase, SessionArchitectPanel) and the /artifact plan
 * payoff (ArchitectPlanGate) — W7-A3: sessions-kinds-08/12, artifact-plan-22/23,
 * flows-23.
 *
 * Replaces the hardcoded "Approved — manifests queued; the autonomous loop is
 * building it now → /flows/forge-develop" (a claim that was false whenever the
 * scheduler was stopped, and a link to the flow DEFINITION rather than the
 * initiative or its run). Everything here is derived: the initiative ids come
 * off the session's manifests dir (bridge), their queue state + run href off
 * the runs list (`deriveInitiativeLinkage`), the headline off both plus the
 * scheduler status (`describePostCommit`) — "building it now" is only ever
 * said when a run is active AND the daemon runs. When the daemon is stopped
 * the Start control is right here (SchedulerCardView strip).
 *
 * DOM contract:
 *   [data-section="architect-committed"][data-commit-tone][data-needs-scheduler-start]
 *     [data-initiative-link][data-initiative-id][data-queue-state]  one per initiative
 *       a[data-action="open-initiative-run"]                          when a run exists
 *     a[data-action="open-roadmap"]  a[data-action="watch-it-build"]  always
 *     [data-component="scheduler-card"] (strip)                       when a start is needed
 */

import Link from 'next/link';

import { SchedulerCardView } from '@/components/SchedulerCard';
import { describePostCommit, type InitiativeLinkage } from '@/lib/architect-plan-view';
import type { SchedulerAction } from '@/lib/scheduler-view';
import type { ArchitectSessionSummary, SchedulerStatus } from '@/lib/bridge-client';

const TONE_COLOR: Record<string, string> = {
  building: 'var(--green)',
  'queued-running': 'var(--green)',
  done: 'var(--green)',
  gated: 'var(--amber)',
  'queued-stopped': 'var(--ember)',
  'claimed-stopped': 'var(--ember)',
  'queued-unknown': 'var(--dim)',
  'claimed-unknown': 'var(--dim)',
  // W7-FIX-A3 (round-2 finding 4): the drain window reads like the stopped
  // pair — nothing is being claimed — not like the running green.
  'queued-stopping': 'var(--ember)',
  'claimed-stopping': 'var(--ember)',
  failed: 'var(--red)',
  unknown: 'var(--dim)',
};

export function ArchitectCommittedView({
  session,
  linkage,
  scheduler,
  schedulerReady,
  linkageReady,
  busy = false,
  error = null,
  onSchedulerAction,
}: {
  session: Pick<ArchitectSessionSummary, 'sessionId' | 'project'>;
  linkage: InitiativeLinkage[];
  scheduler: SchedulerStatus | null;
  schedulerReady: boolean;
  linkageReady: boolean;
  busy?: boolean;
  error?: string | null;
  onSchedulerAction?: (action: SchedulerAction) => void;
}): JSX.Element {
  const view = linkageReady
    ? describePostCommit(linkage, scheduler)
    : { tone: 'unknown' as const, headline: 'Reading the queue…', needsSchedulerStart: false };
  // W8-B3 (sessions-kinds-08) — the loop-closure CTA, in preference order:
  // a live flow monitor, else the initiative's OWN run page (which resolves
  // without a flow definition — W7-FIX-A3 — and is what the operator actually
  // wants to watch anyway), else the flows index. Before this, `monitorHref`
  // was minted from the run's `flowId` unconditionally, so on every legacy
  // session carrying the `"unknown"` sentinel the biggest, greenest control on
  // the panel landed on a retired-flow not-found page.
  const watchHref =
    linkage.find((l) => l.monitorHref)?.monitorHref
    ?? linkage.find((l) => l.runHref)?.runHref
    ?? '/flows';

  return (
    <div
      data-section="architect-committed"
      data-commit-tone={view.tone}
      data-needs-scheduler-start={view.needsSchedulerStart ? 'true' : 'false'}
      style={{
        border: `1px solid ${view.tone === 'building' || view.tone === 'done' ? 'rgba(74,222,128,.4)' : 'var(--line)'}`,
        borderRadius: 10,
        padding: '14px 18px',
        background: view.tone === 'building' || view.tone === 'done' ? 'rgba(74,222,128,.07)' : 'var(--panel)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, color: TONE_COLOR[view.tone] ?? 'var(--dim)' }}>{view.headline}</div>

      {linkage.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {linkage.map((l) => (
            <li
              key={l.initiativeId}
              data-initiative-link
              data-initiative-id={l.initiativeId}
              data-queue-state={l.queueState}
              style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}
            >
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)' }}>{l.initiativeId}</code>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--faint)' }}>{l.queueState}</span>
              {l.runHref && (
                <Link href={l.runHref} data-action="open-initiative-run" style={{ fontSize: 12, color: 'var(--accent)' }}>
                  run →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}

      {view.needsSchedulerStart && (
        <SchedulerCardView
          status={scheduler}
          ready={schedulerReady}
          queuedCount={linkage.filter((l) => l.queueState === 'queued').length}
          busy={busy}
          error={error}
          variant="strip"
          onAction={onSchedulerAction}
        />
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Link href={`/projects/${encodeURIComponent(session.project)}#roadmap`} data-action="open-roadmap" style={{ fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none' }}>
          Open the roadmap →
        </Link>
        <Link
          href={watchHref}
          data-action="watch-it-build"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#fff',
            background: '#238636',
            border: '1px solid var(--line)',
            borderRadius: 6,
            padding: '6px 14px',
            textDecoration: 'none',
            marginLeft: 'auto',
          }}
        >
          Watch it build →
        </Link>
      </div>
    </div>
  );
}
