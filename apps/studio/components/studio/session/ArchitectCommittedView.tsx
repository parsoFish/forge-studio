'use client';

/**
 * ArchitectCommittedView — the post-approve panel shared by the architect
 * session page (committed phase, SessionArchitectPanel) and the /artifact plan
 * payoff (ArchitectPlanGate) — W7-A3: sessions-kinds-08/12, artifact-plan-22/23,
 * flows-23; M7-E row 205 (ADR 011/031).
 *
 * Replaces the hardcoded "Approved — manifests queued; the autonomous loop is
 * building it now → /flows/forge-develop" (a claim that was false whenever
 * `forge serve` was not running, and a link to the flow DEFINITION rather
 * than the initiative or its run). Everything here is derived: the
 * initiative ids come off the session's manifests dir (bridge), their queue
 * state + run href off the runs list (`deriveInitiativeLinkage`), the
 * headline off both plus the live serve status (`describePostCommit`) —
 * "building it now" is only ever said when a run is active AND serve is
 * actually running. There is no Start control: `forge studio` supervises
 * serve directly, so when it is not currently running the shared read-only
 * `<ServeStatusNotice>` says so instead.
 *
 * DOM contract:
 *   [data-section="architect-committed"][data-commit-tone][data-serve-not-ready]
 *     [data-initiative-link][data-initiative-id][data-queue-state]  one per initiative
 *       a[data-action="open-initiative-run"]                          when a run exists
 *     a[data-action="open-roadmap"]  a[data-action="watch-it-build"]  always
 *     [data-component="serve-status-notice"][data-serve-state]       when serve is not ready
 */

import Link from 'next/link';

import { ServeStatusNotice } from '@/components/studio/ServeStatusNotice';
import { describePostCommit, type InitiativeLinkage } from '@/lib/architect-plan-view';
import type { ArchitectSessionSummary, ServeStatus } from '@/lib/bridge-client';

const TONE_COLOR: Record<string, string> = {
  building: 'var(--green)',
  'queued-running': 'var(--green)',
  done: 'var(--green)',
  gated: 'var(--amber)',
  'queued-halted': 'var(--ember)',
  'queued-not-running': 'var(--ember)',
  'claimed-not-running': 'var(--ember)',
  'queued-unknown': 'var(--dim)',
  'claimed-unknown': 'var(--dim)',
  failed: 'var(--red)',
  unknown: 'var(--dim)',
};

export function ArchitectCommittedView({
  session,
  linkage,
  serve,
  linkageReady,
}: {
  session: Pick<ArchitectSessionSummary, 'sessionId' | 'project'>;
  linkage: InitiativeLinkage[];
  serve: ServeStatus | null;
  linkageReady: boolean;
}): JSX.Element {
  const view = linkageReady
    ? describePostCommit(linkage, serve)
    : { tone: 'unknown' as const, headline: 'Reading the queue…', serveNotReady: false };
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
      data-serve-not-ready={view.serveNotReady ? 'true' : 'false'}
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

      {view.serveNotReady && <ServeStatusNotice status={serve} variant="strip" />}

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
