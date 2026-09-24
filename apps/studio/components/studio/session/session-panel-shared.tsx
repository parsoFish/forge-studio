'use client';

// ---------------------------------------------------------------------------
// session-panel-shared — the tiny render bits `SessionInteractivePanel.tsx`
// and its two per-affordance-kind renderers (`SessionQuestionFormAffordance.tsx`,
// `SessionVerdictAffordance.tsx`) all three need: the section/label/input
// style objects every affordance card is built from, and the ONE error-line
// renderer for `data-affordance-error` (bead forge-8vfn.8.3.4's file-size
// split — pure transfer, no behaviour change; these three declarations moved
// out of `SessionInteractivePanel.tsx` verbatim).
// ---------------------------------------------------------------------------

export function ErrorLine({ message }: { message: string }): JSX.Element {
  return (
    <div data-affordance-error style={{ fontSize: 12.5, color: 'var(--red, #f87171)', margin: '6px 0' }}>
      {message}
    </div>
  );
}

export const sectionStyle: React.CSSProperties = {
  border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px',
  background: 'var(--panel)', marginBottom: 10,
};

export const labelStyle: React.CSSProperties = {
  fontSize: 11.5, fontWeight: 600, color: 'var(--dim)', marginBottom: 6,
};

export const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
};
