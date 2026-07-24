/**
 * Stage D — preflight clause resolution classifier.
 *
 * Mirrors the brain-lint guided-resolution pattern (`cli/brain-lint.ts`
 * `classifyFinding`): each preflight clause is routed to a resolution tier —
 *
 *   - `auto`  — a deterministic, surgical fix exists (`cli/preflight-fix-auto.ts`).
 *   - `agent` — an agent resolves it; `route` says which runner (the Stage-A
 *               instructions creator for C8, the Stage-B demo builder for DEMO,
 *               brain-fix for BRAIN, else the generic preflight-fix agent).
 *   - `user`  — needs an operator decision (a command, a remote, a constraint).
 *
 * Pure — no I/O, no mutation. Unknown clauses fall back to `user` (the safe
 * default: surface it for a human rather than auto-touching the project).
 */
import type { ClauseId, ClauseResult } from './preflight.ts';

export type ClauseResolution = 'auto' | 'agent' | 'user';

/** Which agentic runner resolves an `agent`-tier clause. */
export type ClauseRoute = 'instructions' | 'demo-builder' | 'brain-fix' | 'preflight-fix';

export type ClauseClassification = {
  resolution: ClauseResolution;
  /** Present on `agent`-tier — the runner that resolves the clause. */
  route?: ClauseRoute;
  /** Operator-facing (and agent-prompt) hint about how the clause is resolved. */
  fixHint?: string;
};

const TABLE: Record<ClauseId, ClauseClassification> = {
  // AUTO — deterministic, surgical project edits.
  C2: { resolution: 'auto', fixHint: 'Append the forge scratch paths to .gitignore so they are never committed.' },
  ARTIFACTS: { resolution: 'auto', fixHint: 'Append the language build-output globs to .gitignore.' },
  C4: { resolution: 'auto', fixHint: 'Scaffold the missing roadmap.md / brain/projects/<name>/profile.md stubs.' },

  // AGENT — route to the matching agentic runner.
  C8: { resolution: 'agent', route: 'instructions', fixHint: 'Author AGENTS.md with the instructions agent (operator-confirmed).' },
  DEMO: { resolution: 'agent', route: 'demo-builder', fixHint: 'Build the demo with the demo agent (declares demoProcess + machinery).' },
  // DEMO-SKILL is the per-project demo machinery — authored by the demo agent
  // (there is no deterministic generator), so it routes to demo-builder too.
  'DEMO-SKILL': { resolution: 'agent', route: 'demo-builder', fixHint: 'Generate the demo-design skill with the demo agent.' },
  BRAIN: { resolution: 'agent', route: 'brain-fix', fixHint: 'Repair the stale brain citation with the brain-fix agent.' },
  // R1-03-F3: alignment divergence is a demo-content judgment — the demo agent owns it.
  'DEMO-ALIGN': { resolution: 'agent', route: 'demo-builder', fixHint: 'Align capture steps with the declared test process (or keep the divergence deliberately — advisory).' },

  // USER — needs an operator decision; no safe auto/agent fix.
  C1: { resolution: 'user', fixHint: 'Declare a single fast, deterministic test command (testProcess.local.cmd, the .forge/quality_gate_cmd sidecar, or package.json "test").' },
  // R1-03-F1: the CI net + acceptance tier are operator-declared gate policy.
  C1b: { resolution: 'user', fixHint: 'Declare testProcess.ci ({cmd, fixCmd?, unsetEnv?}) — the full CI mirror that keeps a red whole-module baseline from ever shipping.' },
  C7: { resolution: 'user', fixHint: 'External-resource projects declare testProcess.acceptance ({match, required, requiresEnv}) so merges are backed by a live acceptance test.' },
  C5: { resolution: 'user', fixHint: 'Declare locked-core constraints (CLAUDE.md / AGENTS.md / CONSTRAINTS.md).' },
  C6: { resolution: 'user', fixHint: 'Add a GitHub remote so forge can open + merge PRs.' },
};

/**
 * Classify a preflight clause into its resolution tier. Accepts the full
 * `ClauseResult` (so the UI can pass it straight through); routing is keyed on
 * the clause id. Unknown ids → `user` (safe default).
 */
export function classifyClause(clause: ClauseResult): ClauseClassification {
  return TABLE[clause.clause] ?? { resolution: 'user' };
}
