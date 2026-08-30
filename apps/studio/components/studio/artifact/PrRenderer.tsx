'use client';

/**
 * PR artifact renderer.
 * Shows the PR hero (#N, title, state badge, meta stats, body)
 * sourced from pr-description.md or the run's pr artifact doc. The body is RENDERED
 * markdown (markdown-it + DOMPurify), not raw text — the "## What" / **WI-n** / bullets
 * read as a real PR description, not a wall of literal markdown.
 */

import { useEffect, useState } from 'react';
import { renderMarkdownInline } from '@/lib/render-markdown';

const PR_MD_CSS = `
.pr-md-body { font-size: 13.5px; line-height: 1.65; color: var(--text); }
.pr-md-body > :first-child { margin-top: 0; }
.pr-md-body h1, .pr-md-body h2, .pr-md-body h3 { color: var(--text); line-height: 1.3; margin: 1.3em 0 .5em; }
.pr-md-body h1 { font-size: 1.35em; } .pr-md-body h2 { font-size: 1.18em; } .pr-md-body h3 { font-size: 1.04em; }
.pr-md-body p { margin: .5em 0; } .pr-md-body ul, .pr-md-body ol { margin: .4em 0; padding-left: 1.5em; }
.pr-md-body li { margin: .2em 0; } .pr-md-body strong { color: var(--text); font-weight: 650; }
.pr-md-body a { color: var(--steel); }
.pr-md-body code { background: var(--panel); padding: 1px 5px; border-radius: 4px; font: 12px/1.4 var(--font-mono), ui-monospace, Menlo, monospace; }
.pr-md-body pre { background: #010409; border: 1px solid var(--line); border-radius: 6px; padding: 10px; overflow-x: auto; }
.pr-md-body pre code { background: none; padding: 0; }
.pr-md-body table { border-collapse: collapse; font-size: 12.5px; } .pr-md-body th, .pr-md-body td { border: 1px solid var(--line); padding: 4px 9px; }
.pr-md-body blockquote { border-left: 3px solid var(--line); margin: .5em 0; padding: 2px 12px; color: var(--dim); }
`;

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
  // Render the body markdown client-side (DOMPurify needs a DOM; '' during SSR).
  const [bodyHtml, setBodyHtml] = useState('');
  useEffect(() => { setBodyHtml(renderMarkdownInline(doc.body ?? '')); }, [doc.body]);

  return (
    <div>
      <style dangerouslySetInnerHTML={{ __html: PR_MD_CSS }} />
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

        {/* Body — rendered markdown (not raw text). */}
        {doc.body && (
          <div
            className="pr-md-body"
            data-pr-body
            style={{
              background: 'var(--panel-2)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '14px 18px',
            }}
            dangerouslySetInnerHTML={{ __html: bodyHtml }}
          />
        )}
      </div>
    </div>
  );
}
