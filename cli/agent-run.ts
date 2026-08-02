/**
 * `forge agent run <agent-id> <session-id> [--project <name>]` — the generic
 * path over the 4 interactive agent runners (architect / instructions /
 * demo-builder / project-brain).
 *
 * Extracted from `orchestrator/cli.ts` (R2-01 final-review cleanup — cli.ts
 * had grown past the 800-line cap after R2-01-F3a added this machinery).
 * `cli/` is where subcommand handlers live (architect-plan.ts, brain-lint.ts,
 * bridge-recovery.ts, …); this file is the same kind of extraction.
 *
 * `AGENT_RUNNERS` captures exactly what varies per agent-id
 * (project-required-or-not, forgeRoot-needed-or-not, how its run-turn
 * function is loaded, its phase-specific console summary); `cmdAgentRun` is
 * the ONE parse/resolve/guard/call/print skeleton every legacy `cmd<X>Run` in
 * `orchestrator/cli.ts` delegates into, so the legacy `<verb> run <sid>
 * [--project]` commands keep behaving byte-identically (same error text,
 * same exit codes, same printed summaries) while the boilerplate lives in
 * exactly one place.
 *
 * `forgeRoot` is threaded in from the caller (orchestrator/cli.ts's
 * already-resolved `FORGE_ROOT`) rather than recomputed here — one SSOT,
 * mirroring how `cmdStudioLauncher` threads `forgeRoot` into `runWatch`.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runArchitectTurn } from '../orchestrator/architect-runner.ts';
import { runInstructionsTurn } from '../orchestrator/instructions-runner.ts';
import { runDemoBuilderTurn } from '../orchestrator/demo-builder-runner.ts';
import type { runProjectBrainTurn } from '../orchestrator/project-brain-builder-runner.ts';
import { dispatchAgentRun } from '../orchestrator/agent-dispatch.ts';
import { isStandaloneBandAgent, runBandAgentStandalone } from '../orchestrator/band-agent-run.ts';
import { skillsDir } from '../orchestrator/skill-path.ts';
import { createLogger } from '../orchestrator/logging.ts';

type AgentTurnInput = { sessionId: string; projectRoot: string; forgeRoot?: string };
type AgentTurnFn = (input: AgentTurnInput) => Promise<unknown>;

export interface AgentRunnerEntry {
  /** The verb string used in error/usage text, e.g. "architect run". */
  verb: string;
  /** `--project <name>` is required (errors if absent) vs optional — only
   *  architect falls back to `findSessionProject` auto-discovery when absent. */
  requiresProject: boolean;
  /** Whether the turn function's input needs `forgeRoot` threaded through. */
  needsForgeRoot?: boolean;
  /** project-brain's pre-existing quirk: ONE combined "missing arg(s)" check
   *  that prints just the Usage line, instead of the other 3's two-line
   *  "missing <session-id>" / "--project is required" sequential checks. */
  combinedArgCheck?: boolean;
  /** Resolve the runner's `run<X>Turn` function. project-brain performs a
   *  dynamic import here (preserving the pre-existing lazy-load); the other
   *  three just hand back their static top-of-file import. The cast through
   *  `unknown` is deliberate: each runner has its own, more specific
   *  input/result type (see the map doc) and the registry needs one common
   *  shape to store them uniformly — `cmdAgentRun` is the single place that
   *  builds the correctly-shaped call args per entry, so the underlying call
   *  stays exactly as typed/behaved as before this refactor. */
  loadRunTurn: () => Promise<AgentTurnFn>;
  /** Print the phase-specific console summary (moved out of each legacy
   *  `cmd<X>Run` body verbatim). */
  printResult: (result: unknown) => void;
}

export const AGENT_RUNNERS: Record<string, AgentRunnerEntry> = {
  architect: {
    verb: 'architect run',
    requiresProject: false,
    loadRunTurn: async () => runArchitectTurn as unknown as AgentTurnFn,
    printResult: (raw) => {
      const result = raw as Awaited<ReturnType<typeof runArchitectTurn>>;
      console.log(`architect turn complete — phase=${result.phase}`);
      if (result.questions?.length) {
        console.log(`  ${result.questions.length} question(s) awaiting the operator`);
      }
      if (result.planPath) console.log(`  PLAN: ${result.planPath}`);
      if (result.promotedManifestPaths?.length) {
        console.log(`  promoted ${result.promotedManifestPaths.length} manifest(s) to _queue/pending/:`);
        for (const p of result.promotedManifestPaths) console.log(`    ${p}`);
      }
    },
  },
  instructions: {
    verb: 'instructions run',
    requiresProject: true,
    // R3-05-F3 — the runner reads the studio/instruction-seeds/ library under
    // forgeRoot to compose AGENTS.md from vetted blocks.
    needsForgeRoot: true,
    loadRunTurn: async () => runInstructionsTurn as unknown as AgentTurnFn,
    printResult: (raw) => {
      const result = raw as Awaited<ReturnType<typeof runInstructionsTurn>>;
      console.log(`instructions turn complete — phase=${result.phase}`);
      if (result.questions?.length) {
        console.log(`  ${result.questions.length} question(s) awaiting the operator`);
      }
      if (result.draftPath) console.log(`  DRAFT: ${result.draftPath}`);
      if (result.agentsPath) console.log(`  AGENTS.md: ${result.agentsPath}`);
    },
  },
  'demo-builder': {
    verb: 'demo-builder run',
    requiresProject: true,
    needsForgeRoot: true,
    loadRunTurn: async () => runDemoBuilderTurn as unknown as AgentTurnFn,
    printResult: (raw) => {
      const result = raw as Awaited<ReturnType<typeof runDemoBuilderTurn>>;
      console.log(`demo-builder turn complete — phase=${result.phase}`);
      if (result.demoPath) console.log(`  DEMO: ${result.demoPath}`);
      if (result.lockPath) console.log(`  LOCK: ${result.lockPath}`);
    },
  },
  'project-brain': {
    verb: 'project-brain run',
    requiresProject: true,
    needsForgeRoot: true,
    combinedArgCheck: true,
    loadRunTurn: async () => {
      const { runProjectBrainTurn: run } = await import('../orchestrator/project-brain-builder-runner.ts');
      return run as unknown as AgentTurnFn;
    },
    printResult: (raw) => {
      const result = raw as Awaited<ReturnType<typeof runProjectBrainTurn>>;
      console.log(`project-brain turn complete — phase=${result.phase} (${result.themes?.length ?? 0} theme(s))`);
    },
  },
};

// R2-01-F3a: `AGENT_RUNNERS` (declared above) is the registry `cmdAgentRun`
// looks up.
export async function cmdAgent(rest: string[], forgeRoot: string): Promise<void> {
  const sub = rest[0];
  if (sub === 'run') return await cmdAgentRun(rest.slice(1), forgeRoot);
  if (sub === 'dispatch') return await cmdAgentDispatch(rest.slice(1), forgeRoot);
  console.error('forge agent: subcommands: run <agent-id> <session-id> | dispatch <slug>');
  console.error('  forge agent run <agent-id> <session-id> [--project <name>]');
  console.error('  forge agent dispatch <slug> --run-id <id> [--project <name>] [--input k=v ...]');
  console.error(`  run <agent-id> is one of: ${Object.keys(AGENT_RUNNERS).join(', ')}`);
  process.exit(2);
}

/**
 * `forge agent dispatch <slug> --run-id <id> [--project <name>] [--input k=v]`
 * — the generic standalone-run path for a NON-interactive roster agent
 * (R2-01-F3 dispatch half). Unlike `forge agent run` (the four bespoke
 * interactive turn-runners in `AGENT_RUNNERS`), this resolves ANY studio agent
 * def by slug and runs it once through the F1 `runAgent` primitive via
 * `dispatchAgentRun`. This is the CLI the bridge's `POST /api/agents/:slug/run`
 * spawns detached (mirroring `spawnAgentTurn`), so the run's events/cost land
 * under `_logs/<run-id>/` for the monitor.
 */
export async function cmdAgentDispatch(rest: string[], forgeRoot: string): Promise<void> {
  const slug = rest[0];
  if (!slug || slug.startsWith('--')) {
    console.error('forge agent dispatch: missing <slug>');
    console.error('Usage: forge agent dispatch <slug> --run-id <id> [--project <name>] [--input k=v ...]');
    process.exit(2);
    return;
  }
  const flags = rest.slice(1);
  const flagValue = (name: string): string | undefined => {
    const i = flags.indexOf(name);
    return i >= 0 ? flags[i + 1] : undefined;
  };
  const runId = flagValue('--run-id');
  if (!runId) {
    console.error('forge agent dispatch: --run-id <id> is required');
    process.exit(2);
    return;
  }
  const projectArg = flagValue('--project');
  const project = projectArg
    ? { name: projectArg, repoPath: resolve('projects', projectArg) }
    : undefined;

  // `--input k=v` may repeat; each is surfaced as prompt DATA (never instructions).
  const inputs: Record<string, string> = {};
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--input') {
      const kv = flags[i + 1] ?? '';
      const eq = kv.indexOf('=');
      if (eq <= 0) {
        console.error(`forge agent dispatch: --input expects k=v, got ${JSON.stringify(kv)}`);
        process.exit(2);
        return;
      }
      inputs[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
  }

  if (project && !existsSync(project.repoPath)) {
    console.error(`forge agent dispatch: project root not found: ${project.repoPath}`);
    process.exit(2);
    return;
  }

  try {
    // R4-10-F3 isolation surface: the two band-hook node agents (demo-agent /
    // adversarial-review) run standalone through their FLOW pipeline (parity),
    // against an existing initiative's worktree — NOT the bare `runAgent` spawn
    // the generic dispatch uses (which would skip the pipeline bands entirely).
    if (isStandaloneBandAgent(slug)) {
      const initiativeId = inputs.initiative;
      if (!initiativeId) {
        console.error(`forge agent dispatch: standalone "${slug}" needs --input initiative=<id> (the post-develop initiative to run against)`);
        process.exit(2);
        return;
      }
      const out = await runBandAgentStandalone({ slug, initiativeId, forgeRoot, queryFn: undefined });
      console.log(`agent dispatch complete — ${out.slug} (standalone ${out.kind} pipeline) on ${out.initiativeId} → ${out.result.status}`);
      return;
    }

    const out = await dispatchAgentRun({
      slug,
      skillsDir: skillsDir(forgeRoot),
      runId,
      project,
      inputs: Object.keys(inputs).length > 0 ? inputs : undefined,
    });
    const { result } = out;
    if (result.suppressed) {
      console.log(`agent dispatch: ${out.slug} run ${out.runId} — spawn suppressed (dry-bridge / no-spawn seam)`);
    } else {
      console.log(`agent dispatch complete — ${out.slug} run ${out.runId} — cost $${result.costUsd.toFixed(4)}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`forge agent dispatch: ${msg}`);
    // Emit a terminal failure marker to the run log so the bridge's status
    // endpoint reports `failed` instead of a perpetual `running` (the RunPanel
    // polls it). Best-effort — never masks the original error / exit code.
    try {
      createLogger(runId, '_logs').emit({
        initiative_id: runId,
        phase: 'orchestrator',
        skill: slug,
        event_type: 'log',
        input_refs: [],
        output_refs: [],
        message: 'agent-dispatch.failed',
        metadata: { error: msg, agent_slug: slug },
      });
    } catch { /* best-effort */ }
    process.exit(1);
  }
}

/**
 * The shared parse/resolve/guard/call/print skeleton for ALL agent-id run
 * verbs — both the new `forge agent run <agent-id> <sid>` path and the 4
 * legacy `<verb> run <sid>` commands in `orchestrator/cli.ts`, which delegate
 * here as `cmdAgentRun(['<agent-id>', ...rest], forgeRoot)`.
 */
export async function cmdAgentRun(rest: string[], forgeRoot: string): Promise<void> {
  const agentId = rest[0];
  const entry = agentId ? AGENT_RUNNERS[agentId] : undefined;
  if (!entry) {
    console.error(`forge agent run: unknown agent-id: ${agentId ?? '(missing)'}`);
    console.error('Usage: forge agent run <agent-id> <session-id> [--project <name>]');
    console.error(`  <agent-id> is one of: ${Object.keys(AGENT_RUNNERS).join(', ')}`);
    process.exit(2);
    return;
  }

  const sessionId = rest[1];
  const flagRest = rest.slice(2);
  const projectIdx = flagRest.indexOf('--project');
  const projectArg = projectIdx >= 0 ? flagRest[projectIdx + 1] : undefined;

  if (entry.combinedArgCheck) {
    if (!sessionId || (entry.requiresProject && !projectArg)) {
      console.error(
        `Usage: forge ${entry.verb} <session-id>${entry.requiresProject ? ' --project <name>' : ''}`,
      );
      process.exit(2);
      return;
    }
  } else {
    if (!sessionId) {
      console.error(`forge ${entry.verb}: missing <session-id>`);
      console.error(
        `Usage: forge ${entry.verb} <session-id>${entry.requiresProject ? ' --project <name>' : ' [--project <name>]'}`,
      );
      process.exit(2);
      return;
    }
    if (entry.requiresProject && !projectArg) {
      console.error(`forge ${entry.verb}: --project <name> is required`);
      console.error(`Usage: forge ${entry.verb} <session-id> --project <name>`);
      process.exit(2);
      return;
    }
  }

  let projectRoot: string;
  if (projectArg) {
    projectRoot = resolve('projects', projectArg);
  } else {
    // Only reachable when !requiresProject (architect today) — required-project
    // entries already returned above when --project was absent.
    const found = findSessionProject(sessionId);
    if (!found) {
      console.error(
        `forge ${entry.verb}: no project found containing _architect/${sessionId}/. ` +
          `Pass --project <name> to disambiguate.`,
      );
      process.exit(2);
      return;
    }
    projectRoot = found;
  }

  if (!existsSync(projectRoot)) {
    console.error(`forge ${entry.verb}: project root not found: ${projectRoot}`);
    process.exit(2);
    return;
  }

  const runTurn = await entry.loadRunTurn();
  const result = await runTurn({
    sessionId,
    projectRoot,
    ...(entry.needsForgeRoot ? { forgeRoot } : {}),
  });
  entry.printResult(result);
}

/**
 * Scan `projects/*` for `_architect/<sessionId>/PLAN.md` and return the
 * first match's project root. Used when the operator omits `--project`.
 */
function findSessionProject(sessionId: string): string | null {
  const projectsDir = resolve('projects');
  if (!existsSync(projectsDir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const candidate = join(projectsDir, name);
    try {
      const stat = statSync(candidate);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    // Match on the session dir (status.json appears from the first turn;
    // PLAN.md only appears once drafting completes).
    const sessionDir = join(candidate, '_architect', sessionId);
    if (existsSync(join(sessionDir, 'status.json')) || existsSync(join(sessionDir, 'PLAN.md'))) {
      return candidate;
    }
  }
  return null;
}
