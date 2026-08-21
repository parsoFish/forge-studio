/**
 * Breadcrumbs — the ONE semantic trail for detail pages (W7-C3, crosscut-19).
 *
 * Before this, three ad-hoc patterns coexisted (an unlabelled "Forge Studio /
 * …" div on the session/artifact shells, a "← Skills" back link on the
 * library detail pages, nothing at all on the five deepest routes). This is
 * the single component: a labelled `<nav>` wrapping an ordered list, parents
 * linked, the current page marked `aria-current="page"` and never a link.
 *
 * DOM contract (docs/forge-ui-dom-and-harness.md → "Shared — breadcrumbs"):
 *   <nav aria-label="Breadcrumb" data-component="breadcrumbs">
 *     <ol><li><a href>…</a></li>…<li aria-current="page">leaf</li></ol>
 *   </nav>
 */
import type { CSSProperties } from 'react';
import Link from 'next/link';

export type Crumb = {
  label: string;
  /** Omit on the last (current-page) item — and any item with no destination. */
  href?: string;
};

const NAV_STYLE: CSSProperties = { marginBottom: 14 };
const OL_STYLE: CSSProperties = {
  listStyle: 'none',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  margin: 0,
  padding: 0,
  fontSize: 12,
  fontFamily: 'var(--font-display)',
  color: 'var(--faint)',
};
const LINK_STYLE: CSSProperties = { color: 'var(--dim)', textDecoration: 'none' };

export function Breadcrumbs({ items }: { items: readonly Crumb[] }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" data-component="breadcrumbs" style={NAV_STYLE}>
      <ol style={OL_STYLE}>
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              {i > 0 && <span aria-hidden style={{ color: 'var(--faint)' }}>/</span>}
              {last || !item.href ? (
                <span
                  {...(last ? { 'aria-current': 'page' as const } : {})}
                  style={{ color: last ? 'var(--dim)' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}
                >
                  {item.label}
                </span>
              ) : (
                <Link href={item.href} style={LINK_STYLE}>
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
