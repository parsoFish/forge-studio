'use client';

/**
 * PR artifact renderer.
 * Shows the PR hero (#N, title, state badge, meta stats, body)
 * sourced from pr-description.md or the run's pr artifact doc.
 */

export type PrDoc = {
  number?: number;
  title?: string;
  state?: string;
  commits?: number;
  additions?: number;
  deletions?: number;
  checks?: string;
  body?: string;
  url?: string;
};

const STATE_STYLE: Record<string, React.CSSProperties> = {
  open: {
    color: 'var(--green)',
    borderColor: 'rgba(74,222,128,.5)',
    background: 'rgba(74,222,128,.08)',
  },
  merged: {
    color: 'var(--violet)',
    borderColor: 'rgba(183,140,255,.5)',
    background: 'rgba(183,140,255,.08)',
  },
  closed: {
    color: 'var(--red)',
    borderColor: 'rgba(248,113,113,.5)',
    background: 'rgba(248,113,113,.08)',
  },
};

export function PrRenderer({ doc }: { doc: PrDoc }) {
  const stateStyle = STATE_STYLE[doc.state ?? 'open'] ?? STATE_STYLE.open;

  return (
    <div>
      {/* Hero card */}
      <div style={{
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius)',
        padding: '20px 22px',
        marginBottom: 20,
      }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
          {doc.number !== undefined && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, color: 'var(--faint)' }}>
              #{doc.number}
            </span>
          )}
          {doc.title && (
            <span style={{ fontSize: 17, fontWeight: 700, fontFamily: 'var(--font-display)', flex: 1 }}>
              {doc.title}
            </span>
          )}
          {doc.state && (
            <span style={{
              ...stateStyle,
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 600,
              padding: '3px 9px',
              borderRadius: 999,
              border: '1.5px solid',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              whiteSpace: 'nowrap',
            }}>
              {doc.state}
            </span>
          )}
        </div>

        {/* Meta row */}
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--dim)', marginBottom: 16 }}>
          {doc.commits !== undefined && (
            <span>{doc.commits} commit{doc.commits !== 1 ? 's' : ''}</span>
          )}
          {doc.additions !== undefined && (
            <span style={{ color: 'var(--green)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              +{doc.additions}
            </span>
          )}
          {doc.deletions !== undefined && (
            <span style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
              −{doc.deletions}
            </span>
          )}
          {doc.checks && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--green)',
              background: 'rgba(74,222,128,.08)',
              border: '1px solid rgba(74,222,128,.25)',
              borderRadius: 'var(--radius-sm)',
              padding: '4px 10px',
            }}>
              ✓ {doc.checks}
            </span>
          )}
          {doc.url && (
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--steel)', fontSize: 12 }}
            >
              View on GitHub →
            </a>
          )}
        </div>

        {/* Body */}
        {doc.body && (
          <div style={{
            background: 'var(--panel-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            padding: '14px 16px',
            fontSize: 13,
            lineHeight: 1.65,
            color: 'var(--text)',
            whiteSpace: 'pre-wrap',
          }}>
            {doc.body}
          </div>
        )}
      </div>
    </div>
  );
}
