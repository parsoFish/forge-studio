'use client';

/**
 * Work-items artifact renderer.
 * Renders a grid of WI cards from the work-items snapshot data.
 * Each card: hex-num icon, title, branch badge, deps tags, AC list, status badge.
 */

export type WorkItemEntry = {
  id: string;
  title: string;
  status?: string;
  branch?: string;
  deps?: string[];
  ac?: string[];
};

const STATUS_COLOR: Record<string, string> = {
  complete:  'var(--green)',
  active:    'var(--ember)',
  retrying:  'var(--amber)',
  failed:    'var(--red)',
  pending:   'var(--faint)',
};

export function WorkItemsRenderer({ items }: { items: WorkItemEntry[] }) {
  if (items.length === 0) {
    return (
      <div style={{ fontSize: 13, color: 'var(--faint)', padding: '24px 0' }}>
        No work items found.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {items.map((wi) => {
        const shortId = wi.id.replace(/^WI-/i, '');
        const statusColor = STATUS_COLOR[wi.status ?? 'pending'] ?? 'var(--faint)';

        return (
          <div
            key={wi.id}
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              padding: '16px 18px',
              display: 'grid',
              gridTemplateColumns: '44px 1fr auto',
              gap: '0 16px',
              alignItems: 'start',
            }}
          >
            {/* Hex ID */}
            <div style={{
              width: 36,
              height: 40,
              clipPath: 'var(--hex-clip)',
              background: 'var(--panel-3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--ember)',
              marginTop: 2,
              flexShrink: 0,
            }}>
              {shortId}
            </div>

            {/* Info */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-display)' }}>
                {wi.title}
              </div>
              {wi.branch && (
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11.5,
                  color: 'var(--steel)',
                  background: 'rgba(92,200,255,.08)',
                  border: '1px solid rgba(92,200,255,.2)',
                  borderRadius: 4,
                  padding: '2px 7px',
                  display: 'inline-block',
                  width: 'fit-content',
                }}>
                  {wi.branch}
                </span>
              )}
              {wi.deps && wi.deps.length > 0 && (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {wi.deps.map((d) => (
                    <span
                      key={d}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        color: 'var(--violet)',
                        background: 'rgba(183,140,255,.1)',
                        border: '1px solid rgba(183,140,255,.3)',
                        borderRadius: 3,
                        padding: '1px 5px',
                      }}
                    >
                      ← {d}
                    </span>
                  ))}
                </div>
              )}
              {wi.ac && wi.ac.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {wi.ac.map((a, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12.5, color: 'var(--dim)' }}>
                      <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span>
                      {a}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Status */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                fontWeight: 600,
                color: statusColor,
                background: 'var(--panel-3)',
                border: `1px solid ${statusColor}40`,
                borderRadius: 4,
                padding: '2px 7px',
              }}>
                {wi.status ?? 'pending'}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
