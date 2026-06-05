/**
 * Single source for the agent-flow status palette.
 *
 * Forge's pipeline / WI units share one 5-state vocabulary
 * (`wi-status.ts` + `phases.ts`); other status domains (cycle lifecycle,
 * architect phase) map onto the same semantic tones. Before this module the
 * hex values were re-spelled across AgentGraphCanvas, the three per-phase
 * hexes, and page.tsx — and had already drifted (pending grey was `#475059`
 * in the canvas but `#6e7681` everywhere else). Keeping the palette here means
 * a colour change happens in exactly one place.
 */

import type { WiStatus } from './wi-status';

/** The semantic tones. Domains that aren't the 5-state vocab reference these. */
export const STATUS_COLOR = {
  idle: '#6e7681', // pending / queued / not-yet-started (muted grey)
  active: '#1f6feb', // running / working (blue)
  complete: '#2ea043', // done / merged (green)
  attention: '#d29922', // retrying / needs-you / your-call (amber)
  failed: '#f85149', // terminal failure (red)
} as const;

/** Glow colour for the pipeline / WI 5-state vocabulary. */
export const WI_STATUS_GLOW: Record<WiStatus, string> = {
  pending: STATUS_COLOR.idle,
  active: STATUS_COLOR.active,
  complete: STATUS_COLOR.complete,
  retrying: STATUS_COLOR.attention,
  failed: STATUS_COLOR.failed,
};

/** Map any status string to its glow, defaulting to the idle tone. */
export function statusGlow(status: string): string {
  return (WI_STATUS_GLOW as Record<string, string>)[status] ?? STATUS_COLOR.idle;
}
