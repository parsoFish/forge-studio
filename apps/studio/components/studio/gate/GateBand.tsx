/**
 * The gate shell's first block (forge-mfv5.1.31; D-46 "gate": the decision
 * control inside viewport 1). The story on the left, the decision card on the
 * right — shared by the verdict, plan and reflection gates so the three read
 * the same way: what this is, then what you decide.
 */
import type { ReactNode } from 'react';

export function GateBand({ story, decision }: { story: ReactNode; decision: ReactNode }): JSX.Element {
  return (
    <section
      data-section="gate-decision"
      style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) calc(var(--pane-xl) - var(--pane-xs))', gap: 'var(--space-5)', alignItems: 'start' }}
    >
      {story}
      {decision}
    </section>
  );
}

/** The decision card's frame — ember-edged, one per gate. */
export const decisionCard: React.CSSProperties = {
  border: '1px solid var(--ember)', borderRadius: 'var(--radius)',
  background: 'linear-gradient(180deg, rgba(255,158,74,.08), rgba(255,158,74,.02))',
  padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0,
};

/** A primary gate action (ember) and its secondary siblings. */
export function gateButton(kind: 'primary' | 'secondary' | 'danger', enabled: boolean): React.CSSProperties {
  const tone = kind === 'primary'
    ? { background: 'var(--ember)', color: 'var(--accent-fg)', borderColor: 'var(--ember)' }
    : kind === 'danger'
      ? { background: 'var(--panel-2)', color: 'var(--red)', borderColor: 'var(--line-2)' }
      : { background: 'var(--panel-2)', color: 'var(--text)', borderColor: 'var(--line-2)' };
  return {
    ...tone, flex: 1, border: '1px solid', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) var(--space-4)',
    fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-md)',
    cursor: enabled ? 'pointer' : 'not-allowed', opacity: enabled ? 1 : 0.55,
  };
}
