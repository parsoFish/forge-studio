'use client';

/**
 * Verdict artifact renderer — VIEW mode only.
 * Shows the approve/send-back stamp + by/at + reasons.
 * Gate mode is handled by ReviewVerdictForm (the harness asserts its data-*).
 */

export type VerdictDoc = {
  decision?: 'approve' | 'send-back';
  by?: string;
  at?: string;
  reasons?: string[];
};

export function VerdictRenderer({ doc }: { doc: VerdictDoc }) {
  const isApprove = doc.decision !== 'send-back';
  const stampColor = isApprove ? 'var(--green)' : 'var(--red)';
  const stampText = isApprove ? 'Approved' : 'Returned';
  const stampBg = isApprove ? 'rgba(74,222,128,.05)' : 'rgba(248,113,113,.05)';
  const stampShadow = isApprove
    ? '0 0 32px rgba(74,222,128,.2), inset 0 0 32px rgba(74,222,128,.05)'
    : '0 0 32px rgba(248,113,113,.2), inset 0 0 32px rgba(248,113,113,.05)';

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '40px 20px',
      gap: 24,
    }}>
      {/* Stamp */}
      <div style={{
        width: 160,
        height: 160,
        borderRadius: '50%',
        border: `5px solid ${stampColor}`,
        background: stampBg,
        boxShadow: stampShadow,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: 'rotate(-3deg)',
        fontFamily: 'var(--font-display)',
        fontSize: 22,
        fontWeight: 900,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: stampColor,
        position: 'relative',
      }}>
        <span style={{
          position: 'absolute',
          inset: 6,
          borderRadius: '50%',
          border: `1.5px solid ${stampColor}`,
          opacity: 0.3,
          pointerEvents: 'none',
        }} />
        {stampText}
      </div>

      {/* Meta */}
      <div style={{ textAlign: 'center' }}>
        {doc.by && (
          <div style={{ fontSize: 13, color: 'var(--dim)' }}>{doc.by}</div>
        )}
        {doc.at && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--faint)' }}>{doc.at}</div>
        )}
      </div>

      {/* Reasons */}
      {doc.reasons && doc.reasons.length > 0 && (
        <div style={{ width: '100%', maxWidth: 500, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {doc.reasons.map((r, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 9,
                padding: '10px 14px',
                background: 'var(--panel)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: isApprove ? 'var(--green)' : 'var(--red)', flexShrink: 0, fontSize: 15 }}>
                {isApprove ? '✓' : '↩'}
              </span>
              {r}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
