/**
 * The preflight read's response shapes (`GET /api/studio/projects/:id/preflight`).
 * Moved out of studio-client.ts (row 174, forge-8vfn.8.5.9) so that file stays
 * under its file-size baseline; studio-client re-exports them unchanged.
 */

export type ClauseResolution = 'auto' | 'agent' | 'user';
export type ClauseRoute = 'instructions' | 'demo-builder' | 'brain-fix' | 'preflight-fix';

export type PreflightClause = {
  id: string;
  title: string;
  hard: boolean;
  pass: boolean;
  detail: string;
  /** Stage D — resolution tier + (agent-tier) route + hint, from the server classifier. */
  resolution?: ClauseResolution;
  route?: ClauseRoute;
  fixHint?: string;
};

export type PreflightResult = {
  clauses: PreflightClause[];
  /** Every hard clause passes, DEPS included — the claim gate's clause set (SPEC §6). */
  ready: boolean;
  /** The DEPS clause projected for the "not claimable" notice — false means the scheduler would refuse the claim. */
  runnableGate: { pass: boolean; detail: string };
};
