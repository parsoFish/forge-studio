/**
 * `forge agent run <agent-id> <session-id> [--project <name>]` — the generic
 * path over the 4 interactive agent runners (architect / instructions /
 * demo-builder / project-brain).
 *
 * Extracted from `apps/forge/cli.ts` (R2-01 final-review cleanup — cli.ts
 * had grown past the 800-line cap after R2-01-F3a added this machinery).
 * `cli/` is where subcommand handlers live (architect-plan.ts, brain-lint.ts,
 * bridge-recovery.ts, …); this file is the same kind of extraction.
 *
 * `AGENT_RUNNERS` captures exactly what varies per agent-id
 * (project-required-or-not, forgeRoot-needed-or-not, how its run-turn
 * function is loaded, its phase-specific console summary); `cmdAgentRun` is
 * the ONE parse/resolve/guard/call/print skeleton every legacy `cmd<X>Run` in
 * `apps/forge/cli.ts` delegates into, so the legacy `<verb> run <sid>
 * [--project]` commands keep behaving byte-identically (same error text,
 * same exit codes, same printed summaries) while the boilerplate lives in
 * exactly one place.
 *
 * `forgeRoot` is threaded in from the caller (apps/forge/cli.ts's
 * already-resolved `FORGE_ROOT`) rather than recomputed here — one SSOT,
 * mirroring how `cmdStudioLauncher` threads `forgeRoot` into `runWatch`.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { resolveGuardedPath } from '@forge/kernel';
// `forge agent dispatch`'s command lives beside its parsing and guards; this
// file keeps `forge agent run`. `writeSessionTerminalPhase` is shared by both
// verbs and is exported from there — the dispatch module imports nothing from
// this one, so the pair has no cycle.
import {
  cmdAgentDispatch, writeSessionTerminalPhase, type AgentDispatchDeps,
} from './agent-dispatch-cmd.ts';
import { findSessionProject } from './find-session-project.ts';
import { defaultConfigPath, loadConfig, resolveProjectsDir } from '@forge/kernel';
import { runInteractiveTurn } from '@forge/sessions/interactive-runner.ts';
import { loadSessionKinds, type SessionKindDescriptor } from '@forge/sessions/studio/session-kinds.ts';
import { SESSION_KIND_RUNNERS } from '@forge/sessions/kinds/registry.ts';

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
  /** bead forge-poc — the ONE on-disk containment segment this runner's own
   *  session dir lives under (`<projectRoot>/<kindDir>/<sessionId>/status.json`),
   *  mirroring `TurnSpec.kindDir` for the new-road turnSpec kinds
   *  (`runTurnSpecAgent` below). Read STRAIGHT off each runner's own
   *  `*_KIND_DIR` constant — `packages/sessions/architect-runner.ts` ('_architect'),
   *  `packages/sessions/instructions-runner.ts` ('_instructions'),
   *  `packages/sessions/kinds/project-brain.ts` ('_project-brain', now a
   *  `SESSION_KIND_RUNNERS` row) — with
   *  ONE deliberate trap: demo-builder's is `_demo`, NOT `_demo-builder` (see
   *  `packages/sessions/demo-builder-runner.ts`'s `DEMO_KIND_DIR` and
   *  `studio/session-kinds.yaml`'s own "id is demo — NOT demo-builder" comment
   *  on the "demo" descriptor — the AGENT_RUNNERS *key* `demo-builder` and the
   *  on-disk dir are intentionally different strings). Used ONLY by
   *  `cmdAgentRun`'s new failed-turn catch (below) to locate the session's
   *  `status.json` for `writeSessionTerminalPhase` — never by the runner
   *  itself, which resolves its own kind dir independently. */
  kindDir: string;
}

export const AGENT_RUNNERS: Record<string, AgentRunnerEntry> = {
};

/** Every agent-id `forge agent run` accepts — DERIVED from both dispatch
 *  tables, never typed out: a usage line listing only half of them is how a
 *  ported kind goes invisible to the operator while still working. */
const knownAgentIds = (): string[] => [...Object.keys(AGENT_RUNNERS), ...Object.keys(SESSION_KIND_RUNNERS)];

// R2-01-F3a: `AGENT_RUNNERS` (above) plus `SESSION_KIND_RUNNERS` (a PORTED
// kind's row lives beside its kind module, M4 ruling 60) are the two
// registries `cmdAgentRun` looks up.
export async function cmdAgent(rest: string[], forgeRoot: string, deps?: AgentDispatchDeps): Promise<void> {
  const sub = rest[0];
  if (sub === 'run') return await cmdAgentRun(rest.slice(1), forgeRoot, deps);
  if (sub === 'dispatch') return await cmdAgentDispatch(rest.slice(1), forgeRoot, deps);
  console.error('forge agent: subcommands: run <agent-id> <session-id> | dispatch <slug>');
  console.error('  forge agent run <agent-id> <session-id> [--project <name>]');
  console.error('  forge agent dispatch <slug> --run-id <id> [--project <name>] [--input k=v ...]');
  console.error(`  run <agent-id> is one of: ${knownAgentIds().join(', ')}`);
  process.exit(2);
}


/**
 * ADR-043 §3 (R4-22 WI-5) — dispatch-fork lookup for `cmdAgentRun`. Resolves
 * `agentId`'s session-kind descriptor from `studio/session-kinds.yaml`, if
 * any. `loadSessionKinds` throws on a missing file / unparseable YAML; none
 * of the 4 legacy `AGENT_RUNNERS` ids need this file at all, so a broken or
 * absent `studio/session-kinds.yaml` must never break them — the throw is
 * caught here and downgraded to "no descriptor found", falling through to
 * the existing `AGENT_RUNNERS` lookup below, untouched. This is deliberately
 * NOT a silent swallow (the codebase's "fail loud; no silent fallbacks"
 * rule): the failure is still printed to stderr, so an operator pointing at
 * a genuinely broken `studio/session-kinds.yaml` sees why a turnSpec id
 * disappeared instead of a bare "unknown agent-id" with no clue — while a
 * legacy id (found in `AGENT_RUNNERS` regardless of this file's health)
 * still runs to completion.
 */
function findSessionKindDescriptor(agentId: string, forgeRoot: string): SessionKindDescriptor | undefined {
  let descriptors: SessionKindDescriptor[];
  try {
    descriptors = loadSessionKinds(forgeRoot);
  } catch (err) {
    console.error(`forge agent run: studio/session-kinds.yaml failed to load — ${(err as Error).message}`);
    return undefined;
  }
  return descriptors.find((d) => d.id === agentId);
}

/**
 * ADR-043 §3 (R4-22 WI-5) — the "new road": a `turnSpec`-bearing session-kind
 * descriptor (by construction, one with NO `AGENT_RUNNERS` entry) drives the
 * generic `runInteractiveTurn` spine (`packages/sessions/interactive-runner.ts`,
 * R4-22 WI-3) instead of one of the 4 bespoke runners below. `args` is
 * `cmdAgentRun`'s `rest.slice(1)` — `args[0]` is the session-id, the
 * remainder is flags — mirroring the legacy skeleton's own `rest[1]` /
 * `rest.slice(2)` split one level up, reusing the same `--project` parsing
 * shape rather than a second parser that could drift from it.
 *
 * `--project <name>` is REQUIRED on this road (AT-6, this WI's own pinned
 * contract) — there is no `entry.verb`-driven `findSessionProject`
 * auto-discovery fallback (architect's legacy quirk); omitting it is a loud
 * usage error, mirroring the legacy `requiresProject` entries' two-line
 * shape as closely as possible without an `entry.verb` to draw the exact
 * prefix from.
 */
async function runTurnSpecAgent(
  agentId: string,
  descriptor: SessionKindDescriptor,
  args: string[],
  forgeRoot: string,
): Promise<void> {
  const sessionId = args[0];
  const flagRest = args.slice(1);
  const projectIdx = flagRest.indexOf('--project');
  const projectArg = projectIdx >= 0 ? flagRest[projectIdx + 1] : undefined;

  if (!sessionId) {
    console.error(`forge agent run ${agentId}: missing <session-id>`);
    console.error(`Usage: forge agent run ${agentId} <session-id> --project <name>`);
    process.exit(2);
    return;
  }

  if (!projectArg) {
    console.error(`forge agent run ${agentId}: --project <name> is required`);
    console.error(`Usage: forge agent run ${agentId} <session-id> --project <name>`);
    process.exit(2);
    return;
  }

  // CONTAINMENT (R4-22 WI-5 review finding 1). The legacy skeleton below does a
  // bare `resolve('projects', projectArg)`, which folds an unvalidated CLI value
  // into the ROOT: `--project /etc` discards `projects/` entirely and `--project ..`
  // walks out of it, and `resolveGuardedPath` performs NO identity check on its
  // `root` argument (see packages/kernel/path-guard.ts's CONTRACT section, which names
  // this "root-folding" shape a total containment bypass — the spine's SEC-04
  // preamble then guards [kindDir, sessionId] RELATIVE to an already-escaped root,
  // making the comparison tautological). That gap is INHERITED and left untouched on
  // the legacy road (ruling 44: the 4 legacy runners stay byte-for-byte identical),
  // but this is NEW code with no back-compat obligation, and ADR-043 makes this the
  // durable home every future interactive kind funnels through — so the untrusted
  // project name rides as its OWN guarded SEGMENT under the trusted projects root,
  // never folded into it. This closes `..`, `/abs`, `.`, separators and control
  // chars at the door rather than inheriting the legacy hole N times over.
  //
  // R4-21 phase 2, correction B: the ROOT itself is now resolveProjectsDir's
  // single source of truth (honouring FORGE_PROJECTS_DIR / forge.config.json's
  // projectsDir), not a hardcoded `resolve('projects')` — every bridge route
  // already resolves the projects root this way (e.g. cli/ui-bridge.ts's
  // POST /api/studio/authoring/start), and this CLI entry point is what
  // POST /api/studio/authoring/start's spawned turn actually runs, so the two
  // must agree or a session created under a non-default projectsDir is
  // unreachable by its own turn. The guarded-SEGMENT shape for `projectArg`
  // itself is UNCHANGED (AT-B3 regression pin).
  const projectsRoot = resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot)));
  const projectGuard = resolveGuardedPath(projectsRoot, [projectArg]);
  if (!projectGuard.ok) {
    console.error(`forge agent run ${agentId}: --project "${projectArg}" is not a valid project name — ${projectGuard.reason}`);
    process.exit(2);
    return;
  }
  const projectRoot = projectGuard.realPath;
  if (!existsSync(projectRoot)) {
    console.error(`forge agent run ${agentId}: project root not found: ${projectRoot}`);
    process.exit(2);
    return;
  }

  // bead forge-poc — `descriptor.turnSpec` is guaranteed present here: the
  // ONLY caller (`cmdAgentRun`'s ADR-043 §3 fork below) invokes this function
  // exclusively when `descriptor?.turnSpec` is truthy. Asserted rather than
  // silently trusted, per this codebase's declared-data-fails-open rule —
  // if this invariant is ever violated it fails loud, naming the id, instead
  // of a confusing crash three lines later inside `join(undefined, ...)`.
  const turnSpec = descriptor.turnSpec;
  if (!turnSpec) {
    throw new Error(`runTurnSpecAgent: session kind "${agentId}" has no turnSpec (internal invariant violated — the caller must only reach here for a turnSpec-bearing descriptor)`);
  }
  // bead forge-poc (defect 1, "a runner throw wedges a session at its
  // pre-turn phase forever") — `runInteractiveTurn` (like each of the 4
  // legacy runners below) can throw synchronously (a declared-data-fails-open
  // guard, a cost-ceiling refusal, a containment refusal, …) with NOTHING
  // above this call catching it; the session's status.json then sits at
  // whatever phase it was in when the turn started, forever — the operator
  // UI polls status and shows silence, the only trace is stderr.log (R4-23
  // widened exactly this trigger set; ADR-043 2026-08-14 amendment §4).
  // The session dir mirrors `runInteractiveTurn`'s OWN SEC-04 containment
  // preamble (`[turnSpec.kindDir, sessionId]` under `projectRoot`) — same
  // two segments, same root, so the terminal write lands exactly where the
  // turn itself would have written its next status.
  const sessionDir = join(projectRoot, turnSpec.kindDir, sessionId);
  let result: Awaited<ReturnType<typeof runInteractiveTurn>>;
  try {
    result = await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // writeSessionTerminalPhase is best-effort (its own try/catch swallows
    // any failure) and honours the sticky-cancel rule via
    // guardedWriteSessionStatus — a session the operator cancelled while
    // this turn ran stays 'cancelled', never resurrected to 'failed'.
    writeSessionTerminalPhase(forgeRoot, sessionDir, 'failed', undefined, msg);
    throw err; // RETHROW — the exit code must still reflect the failure.
  }
  console.log(`${agentId} turn complete — phase=${result.phase}`);
  if (result.wrote.length) {
    console.log(`  wrote ${result.wrote.length} file(s):`);
    for (const p of result.wrote) console.log(`    ${p}`);
  }
}

/**
 * The shared parse/resolve/guard/call/print skeleton for ALL agent-id run
 * verbs — both the new `forge agent run <agent-id> <sid>` path and the 4
 * legacy `<verb> run <sid>` commands in `apps/forge/cli.ts`, which delegate
 * here as `cmdAgentRun(['<agent-id>', ...rest], forgeRoot)`.
 */
export async function cmdAgentRun(rest: string[], forgeRoot: string, deps?: AgentDispatchDeps): Promise<void> {
  const agentId = rest[0];

  // ADR-043 §3 dispatch fork (R4-22 WI-5) — evaluated BEFORE the
  // unknown-agent-id bail-out below. A turnSpec-bearing session kind has NO
  // AGENT_RUNNERS entry, so checking `entry` first would reject every
  // new-style kind as "unknown agent-id" before this lookup is ever
  // consulted (see findSessionKindDescriptor's own doc for the
  // broken-yaml-must-not-break-legacy-runners decision). Routing key is
  // `descriptor?.turnSpec` presence ALONE — not whether an AGENT_RUNNERS
  // entry also exists for the same id (a descriptor sharing an id with a
  // real AGENT_RUNNERS entry, but carrying no turnSpec, still falls through
  // to the untouched legacy path below).
  if (agentId) {
    const descriptor = findSessionKindDescriptor(agentId, forgeRoot);
    if (descriptor?.turnSpec) {
      return await runTurnSpecAgent(agentId, descriptor, rest.slice(1), forgeRoot);
    }
  }

  // `AGENT_RUNNERS` first, so an un-ported runner keeps its exact behaviour;
  // the two tables hold structurally identical rows (SessionKindRunner's doc
  // says why neither package imports the other's type).
  const entry: AgentRunnerEntry | undefined = agentId ? (AGENT_RUNNERS[agentId] ?? SESSION_KIND_RUNNERS[agentId]) : undefined;
  if (!entry) {
    console.error(`forge agent run: unknown agent-id: ${agentId ?? '(missing)'}`);
    console.error('Usage: forge agent run <agent-id> <session-id> [--project <name>]');
    console.error(`  <agent-id> is one of: ${knownAgentIds().join(', ')}`);
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
    // Parity with the interactive road (runTurnSpecAgent): guard the untrusted
    // --project value as a SEGMENT under the config-derived projects root,
    // never folded into the root. See packages/kernel/path-guard.ts's CONTRACT.
    const projectsRoot = resolveProjectsDir(resolve(forgeRoot), loadConfig(defaultConfigPath(forgeRoot)));
    const projectGuard = resolveGuardedPath(projectsRoot, [projectArg]);
    if (!projectGuard.ok) {
      console.error(`forge ${entry.verb}: --project "${projectArg}" is not a valid project name — ${projectGuard.reason}`);
      process.exit(2);
      return;
    }
    projectRoot = projectGuard.realPath;
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
  // bead forge-poc (defect 1) — same rationale as runTurnSpecAgent's own
  // catch above: a legacy runner throw (architect's cost-ceiling refusal,
  // any runner's "no status.json"/containment refusal, …) previously had
  // NOTHING between it and the top-level `apps/forge/cli.ts` catch-all,
  // which only logs to stderr — invisible to the detached, unref'd spawn
  // `cli/ui-bridge.ts`'s `spawnAgentTurn` uses. `entry.kindDir` is each
  // runner's own on-disk session-dir segment (see AgentRunnerEntry.kindDir's
  // doc for the demo-builder/`_demo` trap).
  const sessionDir = join(projectRoot, entry.kindDir, sessionId);
  let result: unknown;
  try {
    result = await runTurn({
      sessionId,
      projectRoot,
      ...(entry.needsForgeRoot ? { forgeRoot } : {}),
      ...(deps?.sessionKind ?? {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    writeSessionTerminalPhase(forgeRoot, sessionDir, 'failed', undefined, msg);
    throw err; // RETHROW — the exit code must still reflect the failure.
  }
  entry.printResult(result);
}

