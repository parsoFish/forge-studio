'use client';

// ---------------------------------------------------------------------------
// ApprovalRecordPanel — W7-B4 (library-09). A RESOLVED hook (approved or
// overridden) used to render NOTHING once the approve button vanished —
// approved and unapproved looked identical. This panel renders the recorded
// resolution (badge + approvedAt + override reason) plus the inverse act
// (Revoke, library-08) so approval is a visible, reversible state.
//
// Pure + props-driven (renderToStaticMarkup-testable); the page owns fetch.
// ---------------------------------------------------------------------------

export function ApprovalRecordPanel({
  trust,
  approvedAt,
  reason,
  onRevoke,
  revoking,
  error,
}: {
  trust: 'approved' | 'overridden';
  approvedAt: string;
  reason?: string;
  onRevoke: () => void;
  revoking: boolean;
  error: string | null;
}) {
  return (
    <section
      data-section="approval-record"
      data-hook-trust={trust}
      style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius, 8px)', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
        Approval record
      </h2>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="badge" style={trust === 'overridden' ? { color: '#f87171', borderColor: 'rgba(248,113,113,.4)' } : undefined}>
          {trust}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--dim)' }}>
          {trust === 'overridden' ? 'block overridden' : 'approved'} at{' '}
          <span style={{ fontFamily: 'var(--font-mono, monospace)' }}>{approvedAt}</span>
        </span>
      </div>
      {trust === 'overridden' && reason && (
        <p data-field="override-reason-recorded" style={{ fontSize: 12.5, color: 'var(--dim)', margin: 0 }}>
          Reason: {reason}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="btn btn-sm"
          data-action="revoke-hook-approval"
          onClick={onRevoke}
          disabled={revoking}
        >
          {revoking ? 'Revoking…' : 'Revoke approval'}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--faint)', fontStyle: 'italic' }}>
          Revoking drops the hook back to needs-review; the revocation is recorded, never erased.
        </span>
      </div>
      {error && <span style={{ fontSize: 12, color: '#f87171' }}>{error}</span>}
    </section>
  );
}
