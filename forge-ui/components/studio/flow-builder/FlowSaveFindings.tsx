'use client';

// ---------------------------------------------------------------------------
// FlowSaveFindings — W7-B4 (flows-10). The bridge's flow-save 400 carries
// per-node validation findings; the client used to throw them away, leaving
// the operator staring at the words "validation failed". This renders each
// finding attributed (check + message) so the offending node is nameable.
//
// Pure + props-driven; renders NOTHING for an empty list.
// ---------------------------------------------------------------------------

export type FlowSaveFinding = {
  level?: string;
  object?: string;
  check?: string;
  message: string;
};

export function FlowSaveFindings({ findings }: { findings: FlowSaveFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <div
      data-component="flow-save-findings"
      data-finding-count={findings.length}
      style={{
        border: '1px solid rgba(248,113,113,.35)',
        background: 'rgba(248,113,113,.06)',
        borderRadius: 'var(--radius-sm, 6px)',
        padding: '10px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: '#f87171' }}>
        Save refused — {findings.length} validation finding{findings.length === 1 ? '' : 's'}:
      </span>
      {findings.map((f, i) => (
        <div key={i} data-finding-node data-finding-check={f.check ?? ''} style={{ fontSize: 12.5, color: 'var(--text)', display: 'flex', gap: 8 }}>
          {f.check && (
            <span className="badge" style={{ flexShrink: 0, fontFamily: 'var(--font-mono, monospace)' }}>
              {f.check}
            </span>
          )}
          <span>{f.message}</span>
        </div>
      ))}
    </div>
  );
}
