'use client';

// ---------------------------------------------------------------------------
// FlowSaveFindings — W7-B4 (flows-10). The bridge's flow-save 400 carries
// per-node validation findings; the client used to throw them away, leaving
// the operator staring at the words "validation failed". This renders each
// finding attributed (check + message) so the offending node is nameable.
//
// forge-8vfn.5.12: a CLEAN save used to render NOTHING here — the identical
// DOM shape as "nobody has saved this mount at all", so no automation (and
// no operator glancing at the header) could tell the two apart. This
// component now ALWAYS renders, carrying the caller-resolved verdict on
// `data-lint-state`:
//   "unsaved"  — no save attempted yet this page load
//   "clean"    — the last save that reported a lint verdict succeeded
//   "findings" — the last save that reported a lint verdict was REJECTED
// `data-finding-count` is always present too (never absent), and the
// component defends it to 0 for any state other than "findings" — the
// resolution of WHICH state applies is FlowHeader's job (same shape as its
// existing `savedKickoffKind`), this component only renders the resolved
// answer and cannot itself publish a nonzero count beside a "clean"/
// "unsaved" verdict even if a caller forgets to clear stale findings.
//
// The value vocabulary reuses 'clean'/'findings' from the existing hook /
// community scan report's `HookScanVerdict` ('blocked' | 'findings' |
// 'clean', lib/hook-client.ts) rather than inventing a second word for the
// same fact; 'unsaved' is this component's own third state — a security
// scan has no "not yet scanned" idle render to distinguish.
// ---------------------------------------------------------------------------

export type FlowSaveFinding = {
  level?: string;
  object?: string;
  check?: string;
  message: string;
};

export type FlowSaveLintState = 'unsaved' | 'clean' | 'findings';

type Props = {
  findings: FlowSaveFinding[];
  lintState: FlowSaveLintState;
};

const VERDICT_COPY: Record<'unsaved' | 'clean', string> = {
  unsaved: 'Not saved yet.',
  clean: 'Save clean — no validation findings.',
};

export function FlowSaveFindings({ findings, lintState }: Props) {
  // Defensive: only "findings" may report a nonzero count, regardless of
  // what the caller passed — a stale/forgotten findings array must not leak
  // a count beside a "clean"/"unsaved" verdict.
  const shownFindings = lintState === 'findings' ? findings : [];

  return (
    <div
      data-component="flow-save-findings"
      data-lint-state={lintState}
      data-finding-count={shownFindings.length}
      style={
        lintState === 'findings'
          ? {
              border: '1px solid rgba(248,113,113,.35)',
              background: 'rgba(248,113,113,.06)',
              borderRadius: 'var(--radius-sm, 6px)',
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }
          : {
              fontSize: 12,
              color: lintState === 'clean' ? 'var(--faint)' : 'var(--dim)',
              padding: '2px 2px',
            }
      }
    >
      {lintState === 'findings' ? (
        <>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#f87171' }}>
            Save refused — {shownFindings.length} validation finding{shownFindings.length === 1 ? '' : 's'}:
          </span>
          {shownFindings.map((f, i) => (
            <div key={i} data-finding-node data-finding-check={f.check ?? ''} style={{ fontSize: 12.5, color: 'var(--text)', display: 'flex', gap: 8 }}>
              {f.check && (
                <span className="badge" style={{ flexShrink: 0, fontFamily: 'var(--font-mono, monospace)' }}>
                  {f.check}
                </span>
              )}
              <span>{f.message}</span>
            </div>
          ))}
        </>
      ) : (
        <span>{VERDICT_COPY[lintState]}</span>
      )}
    </div>
  );
}
