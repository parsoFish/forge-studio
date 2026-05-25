'use client';

import { useEffect, useState } from 'react';

import {
  fetchManifest,
  type InitiativeManifestSummary,
} from '@/lib/bridge-client';
import type { PhaseState } from '@/lib/phases';

import { ArtifactBadge } from './CycleArtifacts';

/**
 * Surfaces the initiative the active cycle is working on: the
 * initiative ID (with a human-friendly title derived from the slug),
 * the project, and the list of features the architect declared. Also
 * hosts the plan / demo artifact badges (relocated from the now-
 * removed StateMachine rows per the 2026-05-25 operator note: "the
 * initiative and feature shown in this view as well; remove the state
 * machine and activity").
 *
 * Plan badge surfaces whenever PLAN.md is filed (architect's output;
 * relevant from cycle.start onward). Demo badge surfaces only when
 * review-loop or reflection is non-pending — so it doesn't pull the
 * operator to the demo during dev-loop iteration.
 *
 * Re-fetches every 5s while the manifest summary hasn't loaded yet
 * (bridge transient / cycle just claimed); stops once loaded since
 * features don't change mid-cycle.
 */
export function InitiativeInfo({
  cycleId,
  initiativeId,
  phaseStates,
}: {
  cycleId: string | null;
  initiativeId: string | null;
  phaseStates: PhaseState[];
}): JSX.Element | null {
  const [manifest, setManifest] = useState<InitiativeManifestSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setManifest(null);
    setLoaded(false);
    if (!initiativeId) return;
    let cancelled = false;
    const attempt = (): void => {
      void fetchManifest(initiativeId).then((m) => {
        if (cancelled) return;
        if (m) {
          setManifest(m);
          setLoaded(true);
        }
      });
    };
    attempt();
    const id = setInterval(() => {
      if (cancelled) return;
      if (manifest) return;
      attempt();
    }, 5000);
    return () => { cancelled = true; clearInterval(id); };
    // `manifest` is intentionally excluded — we want the closure to
    // capture the current ref each tick, not retrigger the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initiativeId]);

  if (!cycleId || !initiativeId) return null;

  const title = derivedTitle(initiativeId);
  const reviewStatus = phaseStates.find((p) => p.phase === 'review-loop')?.status ?? 'pending';
  const reflectionStatus = phaseStates.find((p) => p.phase === 'reflection')?.status ?? 'pending';
  const demoVisible = reviewStatus !== 'pending' || reflectionStatus !== 'pending';

  return (
    <section
      style={containerStyle}
      data-section="initiative-info"
      data-initiative-id={initiativeId}
      data-feature-count={manifest?.features.length ?? 0}
    >
      <header style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={titleStyle}>{title}</h2>
          <code style={idStyle}>{initiativeId}</code>
          {manifest?.project && (
            <code style={{ ...idStyle, color: '#a371f7' }} data-project={manifest.project}>
              {manifest.project}
            </code>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <ArtifactBadge
            cycleId={cycleId}
            filename="PLAN.md"
            href={`/plan/${encodeURIComponent(cycleId)}`}
            label="📋 plan"
            title="The architect's PLAN.md for this cycle"
          />
          <ArtifactBadge
            cycleId={cycleId}
            filename="DEMO.md"
            href={`/demo/${encodeURIComponent(cycleId)}`}
            label="🎬 demo"
            title="The unifier's DEMO.md (reviewable once review-loop is active)"
            visible={demoVisible}
          />
        </div>
      </header>
      <div data-section="initiative-features">
        {!loaded && (
          <p style={emptyStyle} data-features-state="loading">
            loading features…
          </p>
        )}
        {loaded && manifest && manifest.features.length === 0 && (
          <p style={emptyStyle} data-features-state="empty">
            no features declared in the manifest.
          </p>
        )}
        {loaded && manifest && manifest.features.length > 0 && (
          <ul style={featureListStyle} data-features-state="ready">
            {manifest.features.map((f) => (
              <li
                key={f.featureId}
                data-feature-id={f.featureId}
                data-feature-deps={f.dependsOn.join(',')}
                style={featureItemStyle}
              >
                <code style={featureIdStyle}>{f.featureId}</code>
                <span style={featureTitleStyle}>{f.title}</span>
                {f.dependsOn.length > 0 && (
                  <span style={featureDepsStyle}>← {f.dependsOn.join(', ')}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * Derive a human-friendly title from an initiative ID. INIT-2026-05-25-
 * claude-trail-verdict-summary → "Claude Trail Verdict Summary". Pure
 * cosmetic; the canonical ID stays visible alongside.
 */
function derivedTitle(initiativeId: string): string {
  // Strip INIT-YYYY-MM-DD- prefix, then title-case the slug.
  const m = initiativeId.match(/^INIT-\d{4}-\d{2}-\d{2}-(.+)$/);
  const slug = m ? m[1] : initiativeId;
  return slug
    .split('-')
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(' ');
}

const containerStyle: React.CSSProperties = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: 16,
  marginTop: 24,
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  marginBottom: 12,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  color: '#e6edf3',
};

const idStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
  color: '#8b949e',
  background: '#0d1117',
  border: '1px solid #21262d',
  borderRadius: 4,
  padding: '2px 6px',
};

const emptyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: '#8b949e',
  fontFamily: 'ui-monospace, Menlo, monospace',
};

const featureListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: 4,
};

const featureItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontSize: 13,
  color: '#e6edf3',
  padding: '4px 0',
};

const featureIdStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, monospace',
  fontSize: 11,
  color: '#79c0ff',
  background: '#0d1117',
  border: '1px solid #21262d',
  borderRadius: 4,
  padding: '2px 6px',
  minWidth: 60,
  textAlign: 'center',
};

const featureTitleStyle: React.CSSProperties = {
  flex: 1,
};

const featureDepsStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#8b949e',
  fontFamily: 'ui-monospace, Menlo, monospace',
};
