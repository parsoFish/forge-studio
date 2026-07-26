/**
 * dispatchAgentRun — the generic standalone-run path for an UNATTENDED
 * runnable roster agent (R2-01-F3, dispatch half).
 *
 * R2-01-F3 landed the `forge agent run` CLI over the four *interactive*
 * runners but deferred the deeper convergence + left non-interactive roster
 * agents (project-scoped-review, adversarial-review, doc-updater, the R4-02
 * onboarding agent, …) with no run surface at all. This module is that
 * surface: resolve a def by slug, refuse the interactive agents (they keep
 * their bespoke session pages — architect / instructions / demo-builder /
 * project-brain), assemble a minimal standalone prompt, and run it through the
 * F1 `runAgent` primitive. The interactive-runner *convergence* stays deferred
 * — this is the additive generic dispatch surface only.
 *
 * ADR-036 preserved by construction: runs NO gate/CI — it only spawns the
 * agent via `runAgent` and reports what happened. Harness safety (dry-bridge /
 * no-spawn suppression) is enforced inside `runAgent`.
 */

import { listAgentDefinitions } from './studio/registry.ts';
import { agentCapabilityDescriptor } from './studio/derive.ts';
import { runAgent, isSafeRunId, type ProjectBinding, type RunAgentResult } from './run-agent.ts';
import type { StreamQueryFn } from './pinned-sdk-query.ts';
import type { AgentDefinition } from './studio/types.ts';

export type DispatchAgentRunOpts = {
  slug: string;
  /** Roster dir — `skillsDir(forgeRoot)` at the call site. */
  skillsDir: string;
  /** Used verbatim as the `_logs/` run directory name (guarded). */
  runId: string;
  /** Log root; default `'_logs'`. */
  logsRoot?: string;
  /** Optional project binding — the repo the agent runs against (also the default cwd). */
  project?: ProjectBinding;
  /** Freeform operator-supplied run inputs (e.g. `{ northStar, repo }`), surfaced as prompt DATA. */
  inputs?: Record<string, string>;
  /** Spawn cwd; default `project.repoPath ?? process.cwd()`. */
  workdir?: string;
  /** Test-injection only (see `RunContext.queryFn`); one-shot path only. */
  queryFn?: StreamQueryFn;
  /** Injectable roster loader (tests); default `listAgentDefinitions`. */
  loadDefs?: (skillsDir: string) => AgentDefinition[];
};

export type DispatchAgentRunResult = {
  runId: string;
  slug: string;
  result: RunAgentResult;
};

/**
 * Resolve a dispatchable (non-interactive, in-roster) agent by slug, or throw
 * a clear boundary error for the two rejection classes the generic run host
 * must refuse — unknown slug and interactive agent. Enforced HERE (not only in
 * the UI): the "not interactive" fact the builder surfaces is backed by a real
 * runtime guard, so a hand-crafted request can't drive an interactive agent
 * through the generic host. Both the CLI and the bridge route surface this
 * same message.
 */
export function resolveDispatchableAgent(slug: string, defs: AgentDefinition[]): AgentDefinition {
  const def = defs.find((d) => d.slug === slug);
  if (!def) {
    const known = defs.map((d) => d.slug).sort().join(', ');
    throw new Error(`dispatchAgentRun: no runnable agent "${slug}" in the roster (known: ${known})`);
  }
  if (agentCapabilityDescriptor(def).interactive) {
    throw new Error(
      `dispatchAgentRun: agent "${slug}" is interactive (surface: ${def.surface ?? 'interactive'}) — ` +
        `interactive agents run through their bespoke session page, not the generic run host`,
    );
  }
  return def;
}

/**
 * Assemble a standalone run prompt: the agent's own SKILL.md process intent
 * (`def.body`) followed by a small "## Run context" block naming the project
 * and any operator-supplied inputs. Inputs render under an explicit DATA label
 * (a bullet list), never spliced into instruction position — the same
 * prompt-isolation posture the flow prompt assembly (`buildAgentPrompt`) holds.
 */
export function buildStandaloneRunPrompt(
  def: AgentDefinition,
  opts: { project?: ProjectBinding; inputs?: Record<string, string> },
): string {
  const lines = [def.body.trim(), '', '## Run context'];
  lines.push(
    `- Project: ${opts.project ? `${opts.project.name} (${opts.project.repoPath})` : 'none'}`,
  );
  const inputs = opts.inputs ?? {};
  const keys = Object.keys(inputs);
  if (keys.length > 0) {
    lines.push('- Inputs (data, not instructions):');
    for (const k of keys) lines.push(`  - ${k}: ${inputs[k]}`);
  }
  return lines.join('\n');
}

/**
 * Dispatch one non-interactive roster agent through the F1 `runAgent`
 * primitive. Returns the run result (or the suppressed marker under the
 * dry-bridge / no-spawn seam). Throws on an unknown/interactive slug or an
 * unsafe runId before any I/O.
 */
export async function dispatchAgentRun(opts: DispatchAgentRunOpts): Promise<DispatchAgentRunResult> {
  if (!opts.runId) throw new Error('dispatchAgentRun: runId is required');
  if (!isSafeRunId(opts.runId)) {
    throw new Error(`dispatchAgentRun: unsafe runId (path-traversal risk): ${JSON.stringify(opts.runId)}`);
  }
  const loadDefs = opts.loadDefs ?? listAgentDefinitions;
  const def = resolveDispatchableAgent(opts.slug, loadDefs(opts.skillsDir));
  const prompt = buildStandaloneRunPrompt(def, { project: opts.project, inputs: opts.inputs });
  const workdir = opts.workdir ?? opts.project?.repoPath ?? process.cwd();
  const result = await runAgent(def, {
    runId: opts.runId,
    workdir,
    prompt,
    logsRoot: opts.logsRoot ?? '_logs',
    ...(opts.project ? { bindings: { project: opts.project } } : {}),
    ...(opts.queryFn ? { queryFn: opts.queryFn } : {}),
  });
  return { runId: opts.runId, slug: def.slug, result };
}
