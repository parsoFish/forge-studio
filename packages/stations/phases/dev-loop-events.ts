/**
 * dev-loop-events.ts — the developer loop's own diagnostic events, split out of developer-loop.ts (over the file
 * cap; its baseline is a ceiling). Pure emitters: each takes the logger and names what it saw.
 */
import type { EventLogger } from '@forge/kernel';
import type { GateRunInfo } from '@forge/agents';

import type { WiGateTemplateSkipped } from './wi-quality-gate.ts';

/**
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
export function emitUncommittedWorkSwept(
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

/**
 * F-23: emit a `gate` event with the captured stdout/stderr/exit details from
 * a quality-gate run. The dev-loop's prior visibility into the gate was a
 * single boolean per iteration, swallowing the actual reason for failure;
 * this surfaces the truncated output so post-mortems can answer "why did the
 * gate fail" without re-running the worktree.
 */
export function emitGateEvent(
  logger: EventLogger,
  initiativeId: string,
  parentEventId: string,
  workItemId: string,
  info: GateRunInfo,
  // ADR 026: a code-fix UWI runs in the unifier phase wearing the dev role —
  // attribute its gate events to `unifier` so post-mortems don't mis-file them
  // under developer-loop. Defaults to the dev-loop's own phase/skill.
  attr: { phase: 'developer-loop' | 'unifier'; skill: string } = { phase: 'developer-loop', skill: 'developer-ralph' },
): void {
  // 2026-05-25: iter-0 gate fails are EXPECTED (the L2 sharp-gate
  // check proves the gate isn't hollow before the agent has done any
  // work). Emit as `log` with `expected_fail: true` so the UI doesn't
  // flip the dev-loop phase to red on a normal-path event. Real
  // failures (iter >= 1 with the gate still failing) stay as `error`.
  // A gate that ERRORED (could not run — missing binary / signal) is NEVER
  // "expected", even at iter-0: it's a broken gate, not a test outcome. Always
  // surface it as an error with a distinct `gate.errored` message so the
  // classifier says "fix the gate" instead of mis-reading it as a code failure.
  // N10: a gate KILLED by its timeout is an ENVIRONMENT failure — never
  // "expected" and never a work failure. Distinct `gate.timeout` message +
  // `gate_timed_out` / `failure_kind: 'environment'` metadata so the failure
  // classifier routes it as transient instead of "the code was wrong".
  const isExpectedIter0Fail = !info.passed && !info.errored && !info.timedOut && info.iteration === 0;
  logger.emit({
    initiative_id: initiativeId,
    parent_event_id: parentEventId,
    phase: attr.phase,
    skill: attr.skill,
    event_type: info.passed || isExpectedIter0Fail ? 'log' : 'error',
    input_refs: [],
    output_refs: [],
    duration_ms: info.durationMs,
    message: info.timedOut
      ? 'gate.timeout'
      : info.errored
        ? 'gate.errored'
        : info.passed
          ? 'gate.pass'
          : isExpectedIter0Fail
            ? 'gate.expected-fail'
            : 'gate.fail',
    metadata: {
      work_item_id: workItemId,
      gate_passed: info.passed,
      gate_exit_code: info.exitCode,
      gate_command: info.command,
      gate_stdout_tail: info.stdoutTail,
      gate_stderr_tail: info.stderrTail,
      ...(info.errored ? { gate_errored: true } : {}),
      ...(info.timedOut ? { gate_timed_out: true, failure_kind: 'environment' } : {}),
      ...(info.rejectReason ? { reject_reason: info.rejectReason } : {}),
      ...(info.iteration !== undefined ? { iteration: info.iteration } : {}),
      ...(isExpectedIter0Fail ? { expected_fail: true } : {}),
    },
  });
}

/**
 * forge-mfv5.3.6: the project declares a `testProcess.local.perWorkItem`
 * template, this WI omitted its own `quality_gate_cmd`, and its paths share no
 * directory below the repo root — so the project-wide gate runs instead of a
 * template widened to the root. Named, never silent.
 */
export function emitWiGateTemplateSkipped(
  logger: EventLogger,
  ctx: { initiativeId: string; parentEventId: string; workItemId: string; skill: string; skipped: WiGateTemplateSkipped },
): void {
  logger.emit({
    initiative_id: ctx.initiativeId,
    parent_event_id: ctx.parentEventId,
    phase: 'developer-loop',
    skill: ctx.skill,
    event_type: 'log',
    input_refs: [],
    output_refs: [],
    message: 'gate.template-skipped',
    metadata: { work_item_id: ctx.workItemId, reason: ctx.skipped.reason, paths: [...ctx.skipped.paths], gate_source: 'project' },
  });
}
