'use client';

import type { ReactNode } from 'react';

import { StudioNav } from '@/components/StudioNav';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { useDocumentTitle } from '@/lib/document-title';
import { MAIN_CONTENT_ID } from '@/lib/main-landmark';

/**
 * Native Studio chrome for the architect surfaces (M7-4, ADR-031). Replaces the
 * retired ScreenShell/MomentHex standalone screen: the architect interview now
 * lives inside Studio (StudioNav + the `data-page` DOM-as-metrics root) just
 * like /artifact and the flow monitor. Page-specific page attributes
 * (data-session-id, data-architect-phase) flow through `mainData`.
 *
 * W7-C3: the trail is the shared semantic `Breadcrumbs` (crosscut-19 — the old
 * unlabelled div was one of the three ad-hoc patterns it replaces), the page
 * heading is a real `<h1>` (crosscut-18), and the shell derives the per-route
 * tab title (crosscut-06).
 */
export function StudioArchitectShell({
  dataPage,
  ready,
  title,
  idLabel,
  mainData,
  maxWidth = 1100,
  children,
}: {
  dataPage: string;
  ready: boolean;
  title: string;
  idLabel?: string;
  mainData?: Record<string, string>;
  /** Content column cap (px). Wider surfaces (the demo iframe, the AGENTS.md
   *  draft) pass a larger value so they use the screen rather than a 1100px slot. */
  maxWidth?: number;
  children: ReactNode;
}): JSX.Element {
  useDocumentTitle(idLabel, title);
  return (
    <main
      id={MAIN_CONTENT_ID}
      data-page={dataPage}
      data-page-ready={ready ? 'true' : 'false'}
      {...mainData}
      style={{ minHeight: '100vh', background: 'var(--bg)' }}
    >
      <StudioNav />

      <div style={{ maxWidth, margin: '0 auto', padding: '18px 28px 56px' }}>
        <Breadcrumbs
          items={[
            { label: 'Forge Studio', href: '/' },
            ...(idLabel ? [{ label: title }, { label: idLabel }] : [{ label: title }]),
          ]}
        />

        <div
          style={{
            padding: '10px 0 20px',
            borderBottom: '1px solid var(--line)',
            marginBottom: 28,
          }}
        >
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 26,
              fontWeight: 700,
              lineHeight: 1.2,
              color: 'var(--text)',
              letterSpacing: '-0.01em',
              margin: 0,
            }}
          >
            {title}
          </h1>
        </div>

        {children}
      </div>
    </main>
  );
}
