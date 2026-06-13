'use client';

import type { KbHealth as KbHealthData } from '@/lib/studio-client';

interface Props {
  health: KbHealthData;
}

function Bar({ layer, count, total, color }: { layer: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 3 }}>
      <span style={{ fontSize: 11.5, color: 'var(--dim)', width: 70, flexShrink: 0 }}>{layer}</span>
      <div style={{ flex: 1, height: 5, background: 'var(--panel-2)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', borderRadius: 3, width: `${pct}%`, background: color, transition: 'width .5s ease' }} />
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--dim)', width: 20, textAlign: 'right' }}>
        {count}
      </span>
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
      background: ok ? 'var(--c-kb)' : 'var(--amber)',
    }} />
  );
}

export function KbHealth({ health }: Props) {
  const { layerBalance, orphans, linkDensity, staleness, lintFlags, lintErrors } = health;
  const total = (layerBalance.index ?? 0) + (layerBalance.theme ?? 0) + (layerBalance.raw ?? 0);
  const staleRaw   = staleness?.staleRawCount   ?? 0;
  const staleTheme = staleness?.staleThemeCount  ?? 0;

  return (
    <div>
      <div className="panel-head">
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M1,6 L3,3 L5,8 L7,2 L9,6 L11,4" fill="none" stroke="var(--c-kb)" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        KB HEALTH
      </div>

      <div style={{ padding: 14 }}>
        {/* Layer balance */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-display)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5 }}>
            Layer balance
          </div>
          <Bar layer="index" count={layerBalance.index ?? 0} total={total} color="var(--c-kb)" />
          <Bar layer="theme" count={layerBalance.theme ?? 0} total={total} color="var(--steel)" />
          <Bar layer="raw"   count={layerBalance.raw   ?? 0} total={total} color="var(--faint)" />
        </div>

        {/* Connectivity */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-display)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5 }}>
            Connectivity
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12.5, color: 'var(--dim)' }}>
            <Dot ok={orphans === 0} />
            {orphans === 0
              ? 'No orphan nodes'
              : `${orphans} orphan node${orphans !== 1 ? 's' : ''} (degree 0)`}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12.5, color: 'var(--dim)' }}>
            <Dot ok={true} />
            Link density {linkDensity.toFixed(2)} edges/node
          </div>
        </div>

        {/* Lint */}
        {(lintFlags > 0 || lintErrors > 0) && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-display)', fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5 }}>
              Lint
            </div>
            {lintErrors > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12.5, color: 'var(--dim)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block', background: 'var(--red)' }} />
                {lintErrors} lint error{lintErrors !== 1 ? 's' : ''}
              </div>
            )}
            {lintFlags > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12.5, color: 'var(--dim)' }}>
                <Dot ok={false} />
                {lintFlags} lint flag{lintFlags !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        )}

        {/* Staleness */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-display)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '.07em', marginBottom: 5 }}>
            Staleness
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12.5, color: 'var(--dim)' }}>
            <Dot ok={staleRaw === 0} />
            {staleRaw > 0
              ? `${staleRaw} raw note${staleRaw !== 1 ? 's' : ''} older than 30d — ingest candidate`
              : 'All raw notes current'}
          </div>
          {staleTheme > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 12.5, color: 'var(--dim)' }}>
              <Dot ok={false} />
              {staleTheme} theme{staleTheme !== 1 ? 's' : ''} not updated recently
            </div>
          )}
        </div>

        {/* Suggested action */}
        {staleRaw > 0 && layerBalance.raw > 0 && (
          <div style={{
            marginTop: 6, padding: '8px 10px',
            background: 'rgba(251,191,36,.07)', border: '1px solid rgba(251,191,36,.25)',
            borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--amber)', lineHeight: 1.5,
          }}>
            <strong style={{ color: 'var(--amber)' }}>Suggested action:</strong>{' '}
            {staleRaw} raw incident{staleRaw !== 1 ? 's' : ''} ready to distil into the theme layer.
            Queue a manual ingest pass or leave a guidance note.
          </div>
        )}
      </div>
    </div>
  );
}
