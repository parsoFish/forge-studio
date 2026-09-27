/**
 * dev-loop-events.ts — the developer loop's own diagnostic events, split out of developer-loop.ts (over the file
 * cap; its baseline is a ceiling). Pure emitters: each takes the logger and names what it saw.
 */
import type { EventLogger } from '@forge/kernel';

export /**
 * G1 rescope (plan item 2.6): one autocommit-sweep observation. The safety
 * net (`autoCommitWorktreeIfDirty`) STAYS — it closes the
 * uncommitted-work-dead-ends-the-gate failure mode — but when it fires, the
 * AGENT failed its commit discipline, and that must be a distinct greppable
 * event for reflectors instead of being silently absorbed.
 *
 * forge-1rk5.3 row 145 (orchestrator ruling 1742): the net's own scope is
 * now bounded (agent file_change paths ∪ the WI's files_in_scope/creates),
 * so a sweep can also RESTORE a tracked file changed outside that boundary,
 * or LEAVE an untracked one in place. `sweep` carries all three lists so a
 * reflector can see exactly what happened, not just that something did.
 */
function emitUncommittedWorkSwept(
  logger: EventLogger,
  ctx: {
    initiativeId: string;
    parentEventId: string;
    workItemId: string;
    worktreePath: string;
    phase: 'developer-loop' | 'unifier';
    skill: string; // seam F4: the executing def's own slug, not a fixed literal.
  },
  iteration: number,
  sweep: { committed: readonly string[]; restored: readonly string[]; left: readonly string[] },
): void {
  logger.emit({
    initiative_id: ctx.initiativeId,
    parent_event_id: ctx.parentEventId,
    phase: ctx.phase,
    skill: ctx.skill,
    event_type: 'log',
    input_refs: [ctx.worktreePath],
    output_refs: [],
    message: 'ralph.uncommitted-work-swept',
    metadata: {
      work_item_id: ctx.workItemId,
      iteration,
      committed: sweep.committed,
      restored: sweep.restored,
      left: sweep.left,
      detail:
        'agent exited the iteration with uncommitted work; the forge-autocommit safety net swept it (commit-discipline gap — the agent must commit its own work, git add -f for gitignored declared deliverables). Anything outside the WI scope was restored (tracked) or left in place (untracked), never committed.',
    },
  });
}

/**
 * forge-1rk5.3 row 137: linking a per-WI worktree's deps (linkProjectDeps) could not do everything it tried —
 * e.g. the git exclude that keeps the node_modules symlink off the branch. Named as an error, never swallowed.
 */
export function emitDepsLinkProblems(
  logger: EventLogger,
  ctx: { initiativeId: string; parentEventId: string; skill: string; workItemId: string },
  wiWorktree: { path: string; depsProblems: readonly string[] },
): void {
  if (wiWorktree.depsProblems.length === 0) return;
  logger.emit({
    initiative_id: ctx.initiativeId,
    parent_event_id: ctx.parentEventId,
    phase: 'developer-loop',
    skill: ctx.skill,
    event_type: 'error',
    input_refs: [wiWorktree.path],
    output_refs: [],
    message: 'deps.link-problem',
    metadata: { work_item_id: ctx.workItemId, problems: wiWorktree.depsProblems },
  });
}
