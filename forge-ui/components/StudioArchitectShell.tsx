'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

import { StudioNav } from '@/components/StudioNav';

/**
 * Native Studio chrome for the architect surfaces (M7-4, ADR-031). Replaces the
 * retired ScreenShell/MomentHex standalone screen: the architect interview now
 * lives inside Studio (StudioNav + the `data-page` DOM-as-metrics root) just
 * like /artifact and the flow monitor. Page-specific page attributes
 * (data-session-id, data-architect-phase) flow through `mainData`.
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
  return (
    <main
      data-page={dataPage}
      data-page-ready={ready ? 'true' : 'false'}
      {...mainData}
      style={{ minHeight: '100vh', background: 'var(--bg)' }}
    >
      <StudioNav />

      <div style={{ maxWidth, margin: '0 auto', padding: '0 28px 56px' }}>
        {/* Breadcrumb — keeps the operator inside Studio chrome (no /dashboard link). */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12.5,
            color: 'var(--faint)',
            padding: '18px 0 0',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <Link href="/" style={{ color: 'var(--dim)', textDecoration: 'none' }}>
            Forge Studio
          </Link>
          <span style={{ color: 'var(--line-2)' }}>/</span>
          <span style={{ color: 'var(--c-artifact, var(--ember))' }}>{title}</span>
          {idLabel ? (
            <>
              <span style={{ color: 'var(--line-2)' }}>/</span>
              <span style={{ color: 'var(--dim)' }}>{idLabel}</span>
            </>
          ) : null}
        </div>

        <div
          style={{
            padding: '24px 0 20px',
            borderBottom: '1px solid var(--line)',
            marginBottom: 28,
          }}
        >
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 26,
              fontWeight: 700,
              lineHeight: 1.2,
              color: 'var(--text)',
              letterSpacing: '-0.01em',
            }}
          >
            {title}
          </div>
        </div>

        {children}
      </div>
    </main>
  );
}
