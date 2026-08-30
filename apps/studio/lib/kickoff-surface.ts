/**
 * kickoff-surface — the ONE table the flow monitor's launch UI dispatches on,
 * and therefore the one place `data-can-start` can be derived from.
 *
 * W8-A3 / `flows-25`. `canStartFlow` used to live in `kickoff-candidates.ts`
 * as a hand-maintained SECOND enumeration of which kickoff kinds launch
 * something (`kind !== 'trigger-only'`), sitting in a different file from the
 * `FlowKickoff` dispatch that decides what actually renders. It never learned
 * about `initiative-select` — whose whole body is an informational note and a
 * `/projects` link — so `/flows/forge-develop` advertised
 * `data-can-start="true"` on a page carrying no start control at all. That is
 * `declared-data-fails-open`: a field parsed and surfaced, agreeing with
 * nothing.
 *
 * The cure here is constructive rather than another detector. `launches` sits
 * in the SAME ROW as the surface the component renders, the record is exhaustive
 * over `KickoffSurfaceId` (a new kind cannot compile without a row), and
 * `lib/flow-kickoff-render.test.ts` RENDERS every row and asserts the launch
 * control is present exactly when `launches` says it is — so the row cannot
 * claim a launcher it does not draw.
 */
import type { Flow } from './studio-client';

/** The four launch surfaces `FlowKickoff` can render. */
export type KickoffSurfaceId = 'idea' | 'initiative-select' | 'trigger-only' | 'generic';

export type KickoffSurface = {
  /** True when this surface renders a control that actually starts something. */
  launches: boolean;
  /**
   * The `data-action` of the control it renders — `null` for a surface that
   * launches nothing. Named rather than implied so the render test can look
   * for the real thing instead of guessing.
   */
  launchAction: string | null;
};

export const KICKOFF_SURFACES: Record<KickoffSurfaceId, KickoffSurface> = {
  /** The architect NewIdeaBox: free-text idea → a real architect session. */
  idea: { launches: true, launchAction: 'start-architect' },
  /**
   * Develop-type flows are launched from a project's roadmap ("Start
   * development" on a planned initiative), keeping one entry point per flow
   * type. The monitor renders the way there — a note and a `/projects` link —
   * and NO launcher. This is the row `flows-25` was missing.
   */
  'initiative-select': { launches: false, launchAction: null },
  /** Runs only when its declared FlowTrigger fires: no manual launch exists. */
  'trigger-only': { launches: false, launchAction: null },
  /** Authored flows with no `kickoff:` block: the generic Start-Run picker. */
  generic: { launches: true, launchAction: 'start-run' },
};

/**
 * The surface a flow's monitor renders. An absent or unrecognised `kickoff.kind`
 * falls back to `generic` — matching `FlowKickoff`'s own dispatch, which is the
 * point of this function existing.
 */
export function kickoffSurfaceId(flow: Flow): KickoffSurfaceId {
  const kind = flow.kickoff?.kind;
  return kind === 'idea' || kind === 'initiative-select' || kind === 'trigger-only' ? kind : 'generic';
}

/** `data-can-start` on `/flows/[id]`: true exactly when the monitor renders a launcher. */
export function canStartFlow(flow: Flow | null): boolean {
  if (flow === null) return false;
  return KICKOFF_SURFACES[kickoffSurfaceId(flow)].launches;
}
