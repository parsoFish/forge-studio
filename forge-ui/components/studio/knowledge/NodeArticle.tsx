'use client';

import type { KbNodeArticle } from '@/lib/studio-client';

// Badge class per layer
const LAYER_BADGE: Record<string, string> = {
  index:    'badge-kb',
  theme:    'badge-flow',
  raw:      'badge-dim',
  guidance: 'badge-artifact',
};

const LAYER_LABEL: Record<string, string> = {
  index:    'INDEX',
  theme:    'THEME',
  raw:      'RAW',
  guidance: 'GUIDANCE',
};

// ── Wiki-link resolution ──────────────────────────────────────────────────────
// Transforms [[slug]] patterns into clickable spans with data-target

function resolveWikiLinks(body: string, onJump: (id: string) => void): React.ReactNode[] {
  const parts = body.split(/(\[\[.*?\]\])/g);
  return parts.map((part, i) => {
    const match = part.match(/^\[\[(.*?)\]\]$/);
    if (match) {
      const slug = match[1];
      return (
        <span
          key={i}
          className="wiki-link"
          data-target={slug}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-kb)',
            cursor: 'pointer',
          }}
          onClick={() => onJump(slug)}
        >
          {part}
        </span>
      );
    }
    // plain text — split on newlines to render paragraphs
    return <span key={i}>{part}</span>;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  article: KbNodeArticle | null;
  loading: boolean;
  onJump: (nodeId: string) => void;
}

export function NodeArticle({ article, loading, onJump }: Props) {
  if (!article && !loading) {
    return (
      <div className="article-panel" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="panel-head">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="5" fill="none" stroke="var(--c-kb)" strokeWidth="1.5"/>
          </svg>
          NODE ARTICLE
        </div>
        <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--faint)', fontStyle: 'italic', fontSize: 13 }}>
          Select a node to read its article.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="article-panel" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="panel-head">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <circle cx="6" cy="6" r="5" fill="none" stroke="var(--c-kb)" strokeWidth="1.5"/>
          </svg>
          NODE ARTICLE
        </div>
        <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--faint)', fontSize: 13 }}>
          Loading…
        </div>
      </div>
    );
  }

  const a = article!;
  const badgeClass = LAYER_BADGE[a.layer] ?? 'badge-dim';
  const layerLabel = LAYER_LABEL[a.layer] ?? a.layer.toUpperCase();

  return (
    <div className="article-panel" style={{ borderBottom: '1px solid var(--line)' }}>
      <div className="panel-head">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <circle cx="6" cy="6" r="5" fill="none" stroke="var(--c-kb)" strokeWidth="1.5"/>
        </svg>
        NODE ARTICLE
      </div>

      <div style={{ padding: '14px 16px' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, marginBottom: 6, color: 'var(--text)' }}>
          {a.title}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <span className={`badge ${badgeClass}`}>{layerLabel}</span>
          {a.touchedBy && (
            <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
              last touched by {a.touchedBy}
            </span>
          )}
        </div>

        {/* Inbound / Outbound chips */}
        {(a.inbound.length > 0 || a.outbound.length > 0) && (
          <div style={{ marginBottom: 12 }}>
            {a.inbound.length > 0 && (
              <>
                <div style={{ fontSize: 10.5, color: 'var(--faint)', fontFamily: 'var(--font-display)',
                  fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 4 }}>
                  Inbound
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 4 }}>
                  {a.inbound.map((nb) => (
                    <button
                      key={nb.id}
                      data-jump={nb.id}
                      onClick={() => onJump(nb.id)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '2px 9px', background: 'var(--panel-2)', border: '1px solid var(--line-2)',
                        borderRadius: 4, fontSize: 11.5, color: 'var(--steel)', cursor: 'pointer',
                        fontFamily: 'var(--font-mono)', transition: 'border-color .12s, color .12s',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--c-kb)'; (e.currentTarget as HTMLElement).style.color = 'var(--c-kb)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--line-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--steel)'; }}
                    >
                      ← {nb.title}
                    </button>
                  ))}
                </div>
              </>
            )}
            {a.outbound.length > 0 && (
              <>
                <div style={{ fontSize: 10.5, color: 'var(--faint)', fontFamily: 'var(--font-display)',
                  fontWeight: 600, letterSpacing: '.07em', textTransform: 'uppercase', marginBottom: 4, marginTop: a.inbound.length > 0 ? 6 : 0 }}>
                  Outbound
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {a.outbound.map((nb) => (
                    <button
                      key={nb.id}
                      data-jump={nb.id}
                      onClick={() => onJump(nb.id)}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 5,
                        padding: '2px 9px', background: 'var(--panel-2)', border: '1px solid var(--line-2)',
                        borderRadius: 4, fontSize: 11.5, color: 'var(--steel)', cursor: 'pointer',
                        fontFamily: 'var(--font-mono)', transition: 'border-color .12s, color .12s',
                      }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--c-kb)'; (e.currentTarget as HTMLElement).style.color = 'var(--c-kb)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--line-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--steel)'; }}
                    >
                      → {nb.title}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Body */}
        <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--dim)' }}>
          {a.body
            ? resolveWikiLinks(a.body, onJump)
            : <span style={{ fontStyle: 'italic' }}>No article content yet. The next ingest pass will populate this node.</span>
          }
        </div>
      </div>
    </div>
  );
}
