/**
 * Stage D — preflight clause resolution classifier.
 *
 * Mirrors the brain-lint guided-resolution pattern (`packages/knowledge/brain-lint.ts`
 * `classifyFinding`): each preflight clause is routed to a resolution tier —
 *   `auto` (a deterministic, surgical fix exists, `preflight-fix-auto.ts`), `agent`
 *   (an agent resolves it; `route` says which runner — Stage-A instructions for
 *   C8, Stage-B demo builder for DEMO, brain-fix for BRAIN, else the generic
 *   preflight-fix agent), or `user` (needs an operator decision — a command, a
 *   remote, a constraint; `target` says exactly where the fix lands).
 *
 * Pure — no I/O, no mutation. Unknown clauses fall back to `user` (the safe
 * default: surface it for a human rather than auto-touching the project).
 */
import type { ClauseId, ClauseResult } from './preflight.ts';

export type ClauseResolution = 'auto' | 'agent' | 'user';

/** Which agentic runner resolves an `agent`-tier clause. */
export type ClauseRoute = 'instructions' | 'demo-builder' | 'brain-fix' | 'preflight-fix';

/** Where a USER-tier clause's fix lands (forge-8vfn.6.11.31) — the ONE map the preflight-fix runner reads instead of the agent guessing: a `.forge/project.json` key path, a named file (first existing candidate wins), or `operator` (not a file edit — the agent makes no change). */
export type ClauseTarget = { kind: 'config'; keyPath: string } | { kind: 'file'; candidates: readonly string[] } | { kind: 'operator'; reason: string };

export type ClauseClassification = {
  resolution: ClauseResolution;
  route?: ClauseRoute; // present on `agent`-tier — the runner that resolves the clause
  fixHint?: string; // operator-facing (and agent-prompt) hint about how the clause is resolved
  target?: ClauseTarget; // USER-tier only — see ClauseTarget
};

const TABLE: Record<ClauseId, ClauseClassification> = {
  // AUTO — deterministic, surgical project edits.
  C2: { resolution: 'auto', fixHint: 'Append the forge scratch paths to .gitignore so they are never committed.' },
  ARTIFACTS: { resolution: 'auto', fixHint: 'Append the language build-output globs to .gitignore.' },
  C4: { resolution: 'auto', fixHint: 'Scaffold the missing roadmap.md / brain/projects/<name>/profile.md stubs.' },

  // AGENT — route to the matching agentic runner.
  C8: { resolution: 'agent', route: 'instructions', fixHint: 'Author or edit AGENTS.md with the instructions agent (operator-confirmed) — absent ⇒ create it, present-but-missing-the-gate ⇒ edit it.' },
  DEMO: { resolution: 'agent', route: 'demo-builder', fixHint: 'Build the demo with the demo agent (declares demoProcess + machinery).' },
  // DEMO-SKILL is the per-project demo machinery — authored by the demo agent
  // (there is no deterministic generator), so it routes to demo-builder too.
  'DEMO-SKILL': { resolution: 'agent', route: 'demo-builder', fixHint: 'Generate the demo-design skill with the demo agent.' },
  BRAIN: { resolution: 'agent', route: 'brain-fix', fixHint: 'Repair the stale brain citation with the brain-fix agent.' },
  // R1-03-F3: alignment divergence is a demo-content judgment — the demo agent owns it.
  'DEMO-ALIGN': { resolution: 'agent', route: 'demo-builder', fixHint: 'Align capture steps with the declared test process (or keep the divergence deliberately — advisory).' },

  // USER — needs an operator decision; no safe auto/agent fix. `target` (forge-8vfn.6.11.31) says exactly where the fix lands — read by the preflight-fix runner so the agent is TOLD the file, never left to guess.
  C1: { resolution: 'user', fixHint: 'Declare a single fast, deterministic test command (testProcess.local.cmd, the .forge/quality_gate_cmd sidecar, or package.json "test").', target: { kind: 'config', keyPath: 'testProcess.local.cmd' } },
  // R1-03-F1: the CI net + acceptance tier are operator-declared gate policy.
  C1b: { resolution: 'user', fixHint: 'Declare testProcess.ci ({cmd, fixCmd?, unsetEnv?}) — the full CI mirror that keeps a red whole-module baseline from ever shipping.', target: { kind: 'config', keyPath: 'testProcess.ci' } },
  C7: { resolution: 'user', fixHint: 'External-resource projects declare testProcess.acceptance ({match, required, requiresEnv}) so merges are backed by a live acceptance test.', target: { kind: 'config', keyPath: 'testProcess.acceptance' } },
  C5: { resolution: 'user', fixHint: 'Declare locked-core constraints (CLAUDE.md / AGENTS.md / CONSTRAINTS.md).', target: { kind: 'file', candidates: ['CLAUDE.md', 'CONSTRAINTS.md'] } },
  C6: { resolution: 'user', fixHint: 'Add a GitHub remote so forge can open + merge PRs.', target: { kind: 'operator', reason: 'Add a GitHub `origin` remote (git remote add) — the skill must never add a remote itself; this is the operator\'s to do.' } },
  // R1-04-F2: release substrate is operator-owned (creating a changelog/version file blind is presumptuous).
  C10: { resolution: 'user', fixHint: 'Add the missing release substrate (changelogPath / versionFile / docsDir) or correct the releaseProcess declaration.', target: { kind: 'config', keyPath: 'releaseProcess' } },
  // R1-04-F3: the build process is operator-declared project policy.
  BUILD: { resolution: 'user', fixHint: 'Declare buildProcess.local (the compile/package command) and buildProcess.remote (the CI workflow) so a broken build is its own obligation.', target: { kind: 'config', keyPath: 'buildProcess' } },
  // forge-8vfn.5.13: an unresolved binding needs a JUDGMENT call (rebind to
  // the right id, author the missing skill, or drop the stale declaration) —
  // none of which is a safe deterministic edit or a single agentic runner.
  SKILLS: { resolution: 'user', fixHint: 'Rebind each unresolved skill id to a real project-local (.forge/skills/<id>) or forge-wide (skills/<id>) skill, or remove the stale declaration.', target: { kind: 'config', keyPath: 'skills' } },
  // forge-8vfn.5.21: running an installer (network access, lockfile resolution, arbitrary postinstall scripts) is not a safe surgical file edit the way C2/ARTIFACTS/C4's fixers are — the operator runs it.
  DEPS: { resolution: 'user', fixHint: 'Run npm ci (or npm install) in the project\'s own ground checkout so node_modules is provisioned before the next claim.', target: { kind: 'operator', reason: 'Run npm ci (or npm install) in the project\'s own ground checkout — the agent has no Bash tool and cannot run installers.' } },
};

/** Classify a preflight clause into its resolution tier. Accepts the full `ClauseResult` (so the UI can pass it straight through); routing is keyed on the clause id. Unknown ids → `user` (safe default). */
export function classifyClause(clause: ClauseResult): ClauseClassification {
  return TABLE[clause.clause] ?? { resolution: 'user' };
}

/** The clause's fix target (config key / file / operator-owned), or undefined for AUTO/AGENT tiers and unknown ids — the ONE lookup preflight-fix's runner uses to build the agent's prompt. */
export function clauseTarget(id: ClauseId): ClauseTarget | undefined {
  return TABLE[id]?.target;
}
