/**
 * authoring-session.ts — the session facts the authoring finalize route needs,
 * as library's OWN port (handoffs L1–L4).
 *
 * Library is rank 2 and `@forge/sessions` is rank 4, so this route may not
 * import the session spine; the facts arrive injected from `apps/forge`, the
 * shape `AgentFacts` and `FlowSource` use one door over. `design.md`
 * §"The authoring turn arrives by injection" carries the why.
 */

/** What a finished authoring turn reports. */
export type AuthoringTurnResult = { readonly phase: string };

/** A session `status.json` as THIS route reads it: an open record it spreads,
 *  plus the one field it compares. Sessions owns the full shape. */
export type AuthoringStatus = Record<string, unknown> & { readonly phase?: string };

export type AuthoringSessionPort = {
  readonly readStatus: <S>(projectsRoot: string, dirSegments: readonly string[]) => S | null;
  readonly writeStatus: <S extends Record<string, unknown>>(
    projectsRoot: string,
    dirSegments: readonly string[],
    status: S,
  ) => string | null;
  /** Load the `authoring` kind and run one turn. `null` = no descriptor on disk. */
  readonly runAuthoringTurn: (input: {
    readonly sessionId: string;
    readonly projectRoot: string;
    readonly forgeRoot: string;
  }) => Promise<AuthoringTurnResult | null>;
  /** Did this error come from the staging copy layer? Only the CLASS is sessions'. */
  readonly isFinalizerError: (err: unknown) => boolean;
};
