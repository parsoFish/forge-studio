'use client';

import type { CSSProperties, ReactNode } from 'react';
import { StudioNav } from './StudioNav';
import { Breadcrumbs, type Crumb } from './Breadcrumbs';
import { useDocumentTitle } from '@/lib/document-title';
import { MAIN_CONTENT_ID } from '@/lib/main-landmark';

/**
 * The ONE Studio page shell (R6-03-F3, batch-F ruling 46).
 *
 * Before this, every surface hand-copied the same frame: a full-height
 * `<main data-page>` with the sticky nav, a centred content wrap, and a
 * display-font title / lede / actions header. Nine pages carried byte-identical
 * copies. This component owns that frame once; the surfaces pass only what
 * differs. The duplication is REMOVED, not shadowed — see
 * scripts/page-shell-consolidation.test.ts.
 *
 * `PageHeader` is exported on its own for the few builder pages that keep a
 * bespoke content wrap but still want the shared eyebrow / title / lede /
 * actions header.
 */

export type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
};

export function PageHeader({ eyebrow, title, lede, actions }: PageHeaderProps) {
  const heading = (
    <div>
      {eyebrow != null ? (
        <div
          style={{
            fontFamily: 'var(--font-display)', fontSize: 10.5, fontWeight: 700,
            letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--faint)',
            marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          {eyebrow}
        </div>
      ) : null}
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text)', margin: '0 0 6px' }}>
        {title}
      </h1>
      {lede != null ? (
        <p style={{ fontSize: 13.5, color: 'var(--dim)', margin: 0, maxWidth: 640, lineHeight: 1.6 }}>
          {lede}
        </p>
      ) : null}
    </div>
  );

  if (actions != null) {
    return (
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 22, flexWrap: 'wrap' }}>
        {heading}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{actions}</div>
      </div>
    );
  }
  return <div style={{ marginBottom: 22 }}>{heading}</div>;
}

export type StudioPageProps = PageHeaderProps & {
  /** `<main data-page>` value — the page's DOM-contract identity. */
  dataPage: string;
  /** `<main data-page-ready>` — omit if the page sets its own readiness attr. */
  ready?: boolean;
  /** Extra `data-*` attributes spread onto `<main>` (counts, filters, …). */
  data?: Record<string, string | number | undefined>;
  /** Optional `data-section` on the content wrap (builder pages use this). */
  section?: string;
  /** Content-wrap max width. Shelves = 1080; builder/form pages = ~620. */
  maxWidth?: number;
  /** Content-wrap padding. Shelves = '32px 28px 64px'; builders = '40px 28px 64px'. */
  padding?: string;
  /** Optional sub-nav rendered between the header and the body. */
  subnav?: ReactNode;
  /** W7-C3 (crosscut-06): the browser-tab title. When omitted and `title` is
   *  a plain string, that string is used — so every shell route gets a
   *  distinct tab for free; pass this only when `title` is a ReactNode. */
  docTitle?: string;
  /** W7-C3 (crosscut-19): detail pages pass their trail; rendered as the
   *  shared semantic `Breadcrumbs` above the header. */
  breadcrumbs?: readonly Crumb[];
  children?: ReactNode;
};

export function StudioPage({
  dataPage, ready, data, section, maxWidth = 1080, padding = '32px 28px 64px',
  eyebrow, title, lede, actions, subnav, docTitle, breadcrumbs, children,
}: StudioPageProps) {
  useDocumentTitle(docTitle ?? (typeof title === 'string' ? title : undefined));
  const mainData: Record<string, string | number> = {};
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined) mainData[k] = v;
    }
  }
  const mainStyle: CSSProperties = { minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column' };
  const wrapStyle: CSSProperties = { maxWidth, margin: '0 auto', padding, width: '100%' };

  return (
    <main
      id={MAIN_CONTENT_ID}
      data-page={dataPage}
      {...(ready !== undefined ? { 'data-page-ready': ready ? 'true' : 'false' } : {})}
      {...mainData}
      style={mainStyle}
    >
      <StudioNav />
      <div {...(section ? { 'data-section': section } : {})} style={wrapStyle}>
        {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={breadcrumbs} /> : null}
        <PageHeader eyebrow={eyebrow} title={title} lede={lede} actions={actions} />
        {subnav ?? null}
        {children}
      </div>
    </main>
  );
}
