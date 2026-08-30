'use client';

import Link from 'next/link';
import type { KickoffKindSpec } from '@/lib/session-kind-meta';

// ---------------------------------------------------------------------------
// KickoffContextCard — the context card at the top of the generic session
// kickoff page (W7-B1, sessions-kinds-05).
//
// The card was authored as provenance for the harness rather than operator
// orientation: it LED with `AGENT demo-builder · skills/demo-builder/
// SKILL.md / SESSION DIRECTORY projects/<p>/_demo/<sid>` and offered no way
// back out. It now leads with the kind's own plain-English blurb (what the
// session does and what it produces — `KICKOFF_SPECS[kind].blurb`,
// lib/session-kind-meta.ts) and keeps the slug/SKILL-path/session-dir as a
// SECONDARY provenance line — demoted, not deleted (the harness and any
// curious operator still get the exact on-disk facts). A "back to sessions"
// link (`data-action="kickoff-back"`) gives the page its missing exit.
//
// Pure + props-driven (no fetch, no state) so the layout contract is pinned
// by `lib/kickoff-context-render.test.ts` via renderToStaticMarkup.
// ---------------------------------------------------------------------------

export function KickoffContextCard({
  kind,
  spec,
  sessionDirHint,
  initiative = null,
}: {
  kind: string;
  spec: KickoffKindSpec;
  /** The on-disk session home, already resolved by the page (it knows the
   *  selector state) — rendered verbatim in the provenance line. */
  sessionDirHint: string;
  /** W6-B10 deep-link context — shown only when a sender handed one over. */
  initiative?: string | null;
}): JSX.Element {
  return (
    <div data-section="kickoff-context" style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <p data-kickoff-blurb style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6, margin: '0 0 10px', maxWidth: 480 }}>
          {spec.blurb}
        </p>
        <Link
          href="/sessions"
          data-action="kickoff-back"
          style={{ fontSize: 12, color: 'var(--faint)', textDecoration: 'none', whiteSpace: 'nowrap' }}
        >
          ← back to sessions
        </Link>
      </div>
      <div style={rowLabel}>Produces</div>
      <div style={rowValue}>{spec.artifactLabel}</div>
      {/* Provenance — the exact on-disk facts, demoted to one small line. */}
      <div
        data-kickoff-provenance
        style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'ui-monospace, Menlo, monospace', lineHeight: 1.7, wordBreak: 'break-all' }}
      >
        agent {spec.agentSlug} · skills/{spec.agentSlug}/SKILL.md · {sessionDirHint}
      </div>
      {initiative && (
        <div data-section="kickoff-initiative-context" style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 10 }}>
          Opened from initiative <span style={mono}>{initiative}</span> — sessions here are
          project-scoped, not tied to it; this is context only.
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  border: '1px solid var(--line)', borderRadius: 10, padding: 16, background: 'var(--bg-2)', maxWidth: 560,
};
const rowLabel: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 };
const rowValue: React.CSSProperties = { fontSize: 13, color: 'var(--text)', marginBottom: 12 };
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--dim)' };
