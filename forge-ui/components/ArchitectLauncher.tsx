'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { NewIdeaBox } from './NewIdeaBox';
import type { ArchitectPhase, ArchitectSessionSummary } from '@/lib/bridge-client';

const WORKING_PHASES_LAUNCHER = new Set<ArchitectPhase>(['interviewing', 'drafting', 'finalizing']);
const STALE_THRESHOLD_MS = 120_000;

/**
 * ADR 020 — the compact architect entry on the primary dashboard. Keeps the
 * dashboard uncluttered: just the "new idea" box plus one slim row per active
 * session linking to the dedicated plan screen (`/architect/<sid>`). When a
 * session reaches `awaiting-verdict`, its row shows a prominent "Review plan →"
 * button; the heavy interview + PLAN-gate UI lives only on the dedicated screen.
 */

const PHASE_TEXT: Record<ArchitectPhase, string> = {
  interviewing: 'thinking…',
  'awaiting-answers': 'needs your answers',
  drafting: 'drafting the plan…',
  'awaiting-verdict': 'plan ready',
  finalizing: 'finalizing…',
  committed: 'queued',
  rejected: 'rejected',
};

export function ArchitectLauncher({
  sessions,
  knownProjects,
}: {
  sessions: ArchitectSessionSummary[];
  knownProjects: string[];
}): JSX.Element {
  const router = useRouter();
  const active = sessions.filter((s) => s.phase !== 'committed' && s.phase !== 'rejected');
  const pendingPlans = active.filter((s) => s.phase === 'awaiting-verdict').length;

  return (
    <section
      data-section="architect"
      data-architect-session-count={active.length}
      data-pending-plan-count={pendingPlans}
      style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <NewIdeaBox
        knownProjects={knownProjects}
        onStarted={(sessionId) => router.push(`/architect/${encodeURIComponent(sessionId)}`)}
      />

      {active.map((s) => {
        const planReady = s.phase === 'awaiting-verdict';
        const needsYou = planReady || s.phase === 'awaiting-answers';
        const isStale = WORKING_PHASES_LAUNCHER.has(s.phase) && (s.staleMs ?? 0) > STALE_THRESHOLD_MS;
        return (
          <Link
            key={s.sessionId}
            href={`/architect/${encodeURIComponent(s.sessionId)}`}
            data-architect-session-id={s.sessionId}
            data-architect-phase={s.phase}
            data-architect-project={s.project}
            {...(isStale ? { 'data-architect-stale': 'true', 'data-architect-stale-ms': s.staleMs } : {})}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              textDecoration: 'none',
              border: `1px solid ${planReady ? '#2ea04366' : isStale ? '#9e6a0366' : '#30363d'}`,
              borderRadius: 8,
              padding: '10px 14px',
              background: planReady ? '#07140d' : '#0d1117',
            }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.idea}
              </span>
              <span style={{ fontSize: 11, color: '#8b949e', fontFamily: 'ui-monospace, Menlo, monospace' }}>
                {s.project} · {PHASE_TEXT[s.phase] ?? s.phase}
              </span>
              {isStale && (
                <span style={{ fontSize: 11, color: '#d29922' }}>
                  ⚠ stalled {Math.round((s.staleMs ?? 0) / 60_000)}m ago
                </span>
              )}
            </span>
            <span
              data-action={planReady ? 'open-plan' : 'open-architect'}
              style={{
                flex: '0 0 auto',
                fontSize: 12,
                fontWeight: 600,
                color: needsYou ? '#fff' : '#8b949e',
                background: planReady ? '#238636' : needsYou ? '#9e6a03' : '#21262d',
                border: '1px solid #30363d',
                borderRadius: 6,
                padding: '5px 12px',
              }}
            >
              {planReady ? 'Review plan →' : needsYou ? 'Answer →' : 'Open →'}
            </span>
          </Link>
        );
      })}
    </section>
  );
}
