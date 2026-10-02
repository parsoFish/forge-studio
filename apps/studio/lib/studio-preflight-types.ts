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
  /** The BIRTH verdict: hard clauses with DEPS off. */
  ready: boolean;
  /** Row 174: the claim's DEPS verdict — false means the scheduler would refuse the claim. */
  runnableGate: { pass: boolean; detail: string };
};
