/**
 * Shared styles for the verdict gate (forge-mfv5.1.31). Every size is a
 * density token from `app/globals.css` (D-46 §2); colours are the theme's
 * own variables. A hairline border stays `1px` — it is a stroke, not a size.
 */
import type { CSSProperties } from 'react';

export const pane: CSSProperties = {
  background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
  display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden',
};

export const paneHeader: CSSProperties = {
  display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap',
  padding: 'var(--space-2) var(--space-4)', borderBottom: '1px solid var(--line)',
};

export const paneTitle: CSSProperties = { fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-md)', margin: 0 };

export const meta: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--dim)' };

export const eyebrow: CSSProperties = {
  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-xs)', textTransform: 'uppercase',
  letterSpacing: '.1em', color: 'var(--faint)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
};

export const word: CSSProperties = {
  fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '.06em',
};

export const wiTag: CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--faint)', flex: 'none' };

export const miniBtn: CSSProperties = {
  fontFamily: 'var(--font-display)', fontWeight: 500, fontSize: 'var(--text-xs)', color: 'var(--dim)',
  background: 'var(--panel-2)', border: '1px solid var(--line-2)', borderRadius: 'var(--radius-sm)',
  padding: 'var(--space-1) var(--space-2)', cursor: 'pointer',
};

export const input: CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: 'var(--bg-2)', color: 'var(--text)',
  border: '1px solid var(--line-2)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) var(--space-3)',
  fontSize: 'var(--text-base)', fontFamily: 'inherit',
};

export const VERDICT_COLOUR: Record<string, string> = {
  met: 'var(--green)', partial: 'var(--amber)', missed: 'var(--red)', unjudged: 'var(--faint)',
};

export const SEVERITY_COLOUR: Record<string, string> = {
  blocker: 'var(--red)', major: 'var(--amber)', minor: 'var(--dim)', info: 'var(--faint)',
};

export const DELTA_COLOUR: Record<string, string> = {
  changed: 'var(--ember)', unchanged: 'var(--dim)', unknown: 'var(--amber)',
};
