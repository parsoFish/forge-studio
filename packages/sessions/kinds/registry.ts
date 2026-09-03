/**
 * The session-kind runner registry — one row per PORTED bespoke runner
 * (ADR 043 as amended 2026-09-03, M4 ruling 60; exit row 3 of the M4 sessions
 * lane reads its count from here and from `AGENT_RUNNERS`).
 *
 * BEFORE the ports, `packages/agents/agent-run.ts`'s `AGENT_RUNNERS` held one
 * row per bespoke interactive runner even though every one of those runners
 * lives in `packages/sessions` — the dispatch table sat one package below the
 * code it dispatched. Each port moves its row HERE, beside the kind module it
 * names, and deletes it from `AGENT_RUNNERS`; `cmdAgentRun` resolves an
 * agent-id from `AGENT_RUNNERS` first and this table second, so both halves
 * stay live while the ports land one at a time.
 *
 * The row shape is deliberately structurally identical to
 * `AgentRunnerEntry` — `cmdAgentRun` consumes the two tables through one code
 * path and neither package imports the other's type (agents already imports
 * this package; a type import back the other way would close a cycle).
 * `registry-entry-shape.test.ts` pins that compatibility so a field added on
 * either side cannot drift silently.
 */
import { projectBrainKind, runProjectBrainTurn } from './project-brain.ts';
import type { KindTurnInput } from './kind-turn.ts';

/**
 * What `forge agent run <agent-id> <session-id>` needs to know about one
 * ported session kind. Every field is the one the kind's `AGENT_RUNNERS` row
 * carried before its port — nothing is added, dropped or renamed here, which
 * is what keeps the CLI surface identical across a port.
 */
export interface SessionKindRunner {
  /** The verb string used in error/usage text, e.g. "project-brain run". */
  verb: string;
  /** `--project <name>` is required (errors if absent) vs optional. */
  requiresProject: boolean;
  /** Whether the turn function's input needs `forgeRoot` threaded through. */
  needsForgeRoot?: boolean;
  /** ONE combined "missing arg(s)" check printing just the Usage line, instead
   *  of the sequential "missing <session-id>" / "--project is required" pair. */
  combinedArgCheck?: boolean;
  /** The ONE on-disk containment segment this kind's session dirs live under —
   *  read straight off the kind module's own variant, never re-typed here (the
   *  `_demo` / `demo-builder` trap is a real one: the AGENT_RUNNERS key and the
   *  on-disk dir are intentionally different strings for that kind). */
  kindDir: string;
  /** Resolve the kind's turn function. */
  loadRunTurn: () => Promise<(input: KindTurnInput) => Promise<unknown>>;
  /** Print the kind-specific console summary. */
  printResult: (result: unknown) => void;
}

export const SESSION_KIND_RUNNERS: Record<string, SessionKindRunner> = {
  'project-brain': {
    verb: 'project-brain run',
    requiresProject: true,
    needsForgeRoot: true,
    combinedArgCheck: true,
    kindDir: projectBrainKind.kindDir,
    loadRunTurn: async () => runProjectBrainTurn,
    printResult: (raw) => {
      const result = raw as Awaited<ReturnType<typeof runProjectBrainTurn>>;
      console.log(`project-brain turn complete — phase=${result.phase} (${result.themes?.length ?? 0} theme(s))`);
    },
  },
};
