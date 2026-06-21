'use client';

/**
 * S7 — render F4's single DEMO.md to a self-contained, SANITIZED HTML document
 * for a sandboxed (`sandbox=""`, no-JS) iframe. markdown-it does the render,
 * markdown-it-anchor adds heading anchors, DOMPurify strips anything active. The
 * iframe sandbox is the outer wall; DOMPurify is the inner one (defence in depth).
 *
 * Browser-only (DOMPurify needs a DOM). Returns '' during SSR / before hydration.
 */
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import DOMPurify from 'dompurify';

const md = new MarkdownIt({ html: false, linkify: true, breaks: false }).use(anchor, {
  permalink: false,
});

const DOC_CSS = `
  :root { color-scheme: dark; }
  body { font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    color: #c9d1d9; background: #0b0f14; margin: 0; padding: 16px 18px; }
  h1, h2, h3 { color: #e6edf3; line-height: 1.3; margin: 1.2em 0 0.5em; }
  h1 { font-size: 1.5em; } h2 { font-size: 1.25em; } h3 { font-size: 1.05em; }
  a { color: #58a6ff; } code { background: #161b22; padding: 1px 5px; border-radius: 4px;
    font: 12px/1.4 ui-monospace, Menlo, monospace; }
  pre { background: #010409; border: 1px solid #21262d; border-radius: 6px; padding: 10px;
    overflow: auto; } pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #21262d; padding: 5px 9px; text-align: left; }
  th { color: #8b949e; } blockquote { border-left: 3px solid #2b333c; margin: 0;
    padding: 2px 14px; color: #8b949e; } img { max-width: 100%; }
`;

/** Render markdown to a full sanitized HTML document string for an iframe srcDoc. */
export function renderDemoMarkdownDoc(markdown: string): string {
  if (typeof window === 'undefined') return '';
  const body = DOMPurify.sanitize(md.render(markdown ?? ''), {
    // No scripts, no event handlers, no foreign markup — prose + tables + code only.
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style', 'srcset'],
  });
  return `<!doctype html><html><head><meta charset="utf-8"><style>${DOC_CSS}</style></head><body>${body}</body></html>`;
}
