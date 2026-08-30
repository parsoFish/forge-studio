'use client';

import { useEffect, useState } from 'react';

import type { KbNodeArticle } from '@/lib/studio-client';
import { renderMarkdownInline } from '@/lib/render-markdown';

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
// Rewrite [[slug]] → a real markdown link `[slug](#kbnode-slug)` BEFORE markdown
// render, so markdown-it keeps it and a delegated click handler turns it back into
// an onJump(slug). Colon-free href so DOMPurify keeps it as a same-page fragment.

const WIKINODE_HREF_PREFIX = '#kbnode-';

function preprocessWikiLinks(body: string): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (_m, slug: string) => {
    const s = slug.trim();
    return `[${s}](${WIKINODE_HREF_PREFIX}${s})`;
  });
}

// Scoped styling for the rendered article body (renderMarkdownInline returns an
// unstyled fragment — style the host's descendants ourselves; see render-markdown.ts).
const KB_ARTICLE_CSS = `
  .kb-article-body { font-size: 13px; line-height: 1.65; color: var(--dim); }
  .kb-article-body > :first-child { margin-top: 0; }
  .kb-article-body h1, .kb-article-body h2, .kb-article-body h3 {
    color: var(--text); line-height: 1.3; margin: 1.1em 0 .45em; font-family: var(--font-display); }
  .kb-article-body h1 { font-size: 1.25em; } .kb-article-body h2 { font-size: 1.12em; }
  .kb-article-body h3 { font-size: 1em; }
  .kb-article-body p { margin: .5em 0; } .kb-article-body ul, .kb-article-body ol { margin: .5em 0; padding-left: 1.3em; }
  .kb-article-body li { margin: .2em 0; }
  .kb-article-body code { background: var(--panel-2); padding: 1px 5px; border-radius: 4px;
    font-family: var(--font-mono); font-size: 12px; }
  .kb-article-body pre { background: var(--panel-2); border: 1px solid var(--line-2); border-radius: 6px;
    padding: 10px; overflow: auto; } .kb-article-body pre code { background: none; padding: 0; }
  .kb-article-body table { border-collapse: collapse; width: 100%; font-size: 12px; }
  .kb-article-body th, .kb-article-body td { border: 1px solid var(--line-2); padding: 4px 8px; text-align: left; }
  .kb-article-body blockquote { border-left: 3px solid var(--line-2); margin: .5em 0; padding: 2px 12px; color: var(--faint); }
  .kb-article-body a[href^="${WIKINODE_HREF_PREFIX}"] { color: var(--c-kb); font-family: var(--font-mono); cursor: pointer; }
  .kb-article-body a { color: var(--c-kb); }
`;

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  article: KbNodeArticle | null;
  loading: boolean;
  onJump: (nodeId: string) => void;
}

export function NodeArticle({ article, loading, onJump }: Props) {
  // renderMarkdownInline is browser-only (DOMPurify needs a DOM) — render after
  // hydration via state, like PrRenderer. Hooks must run before the early returns.
  const body = article?.body ?? '';
  const [bodyHtml, setBodyHtml] = useState('');
  useEffect(() => {
    setBodyHtml(body ? renderMarkdownInline(preprocessWikiLinks(body)) : '');
  }, [body]);

  // Delegate clicks on rewritten [[wikilink]] anchors back to onJump.
  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const anchor = (e.target as HTMLElement).closest(`a[href^="${WIKINODE_HREF_PREFIX}"]`);
    if (!anchor) return;
    e.preventDefault();
    const href = anchor.getAttribute('href') ?? '';
    const slug = href.slice(WIKINODE_HREF_PREFIX.length);
    if (slug) onJump(slug);
  };

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

        {/* Body — rendered markdown (markdown-it + DOMPurify), wiki-links preserved */}
        <style>{KB_ARTICLE_CSS}</style>
        {a.body ? (
          <div
            className="kb-article-body"
            data-node-article-body
            onClick={handleBodyClick}
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        ) : (
          <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--dim)' }}>
            <span style={{ fontStyle: 'italic' }}>No article content yet. The next ingest pass will populate this node.</span>
          </div>
        )}
      </div>
    </div>
  );
}
