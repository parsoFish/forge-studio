'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Shared chrome for the focused screens (architect / review / reflect): the
 * `<main>` wrapper carrying the DOM-as-metrics page attributes, the `← forge`
 * back-header with title + mono id, and the centered column. Page-specific
 * loading / not-found / content lives in `children`; page-specific page
 * attributes (e.g. data-cycle-status, data-architect-phase) go via `mainData`.
 */
export function ScreenShell({
  dataPage,
  ready,
  title,
  idLabel,
  maxWidth = 1000,
  mainData,
  children,
}: {
  dataPage: string;
  ready: boolean;
  title: string;
  idLabel: string;
  maxWidth?: number;
  mainData?: Record<string, string>;
  children: ReactNode;
}): JSX.Element {
  return (
    <main
      data-page={dataPage}
      data-page-ready={ready ? 'true' : 'false'}
      {...mainData}
      style={{ padding: '16px 24px', minHeight: '100vh', maxWidth, margin: '0 auto' }}
    >
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginBottom: 18 }}>
        <Link href="/dashboard" data-action="back-to-dashboard" style={{ color: '#58a6ff', fontSize: 13, textDecoration: 'none' }}>
          ← forge
        </Link>
        <h1 style={{ margin: 0, fontSize: 18, letterSpacing: 0.4 }}>{title}</h1>
        <span style={{ fontSize: 12, color: '#8b949e', fontFamily: 'ui-monospace, Menlo, monospace' }}>{idLabel}</span>
      </header>
      {children}
    </main>
  );
}
