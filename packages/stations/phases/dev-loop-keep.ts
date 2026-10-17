/**
 * forge-mfv5.1.56 (D-06) — gitweave I4 round 2: WI-17 failed at its iteration
 * budget, its branch and 15 commits were deleted, and the round reviewed
 * unchanged code. An unmerged WI's branch is now kept and resumed
 * (`createWiWorktree`), and a fix round with a failed fix WI halts before integrate.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { EventLogger } from '@forge/kernel';
import { parseManifest, parseWorkItem, removeWiWorktree, serializeWorkItem, unmergedCommitCount, type WorkItem } from '@forge/flows';
import { gitNetDelta, wiDeliveryEvent, type WiOutcome } from './developer-loop.ts';

export type WiCloseContext = { logger: EventLogger; initiativeId: string; parentEventId: string; skill: string };

const gitOut = (cwd: string, args: string[]): string => execFileSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' }).trim();

/**
 * The per-WI delivery record, read BEFORE the worktree is removed: a complete
 * WI is `dev-loop.delivered`; an unmerged one with commits is `dev-loop.kept`
 * (its spec gains `kept_branch`), and only its uncommitted residue — dropped
 * with the scratch worktree — is `dev-loop.discarded`. Returns the WI's delta.
 */
export function recordWiOutcome(o: WiCloseContext & { workItemId: string; specPath: string; wiWorktree: { path: string; branch: string }; wiBaseSha: string; finalStatus: WorkItem['status'] }): ReturnType<typeof gitNetDelta> {
  const delta = gitNetDelta(o.wiWorktree.path, o.wiBaseSha);
  const emit = (message: string, metadata: Record<string, unknown>, eventType: 'log' | 'error' = 'log'): void => void o.logger.emit({ initiative_id: o.initiativeId, parent_event_id: o.parentEventId, phase: 'developer-loop', skill: o.skill, event_type: eventType, input_refs: [o.wiWorktree.path], output_refs: [], message, metadata });
  if (o.finalStatus === 'complete') {
    const ev = wiDeliveryEvent(o.finalStatus, o.workItemId, delta);
    emit(ev.message, ev.metadata);
    return delta;
  }
  const residue = uncommittedFiles(o.wiWorktree.path);
  if (residue === 'UNKNOWN') {
    emit('dev-loop.residue-unknown', { work_item_id: o.workItemId, outcome: o.finalStatus }, 'error');
  } else if (residue.length > 0) {
    emit('dev-loop.discarded', { work_item_id: o.workItemId, uncommitted_files: residue, files_changed: residue.length, insertions: 0, deletions: 0, commits: 0, outcome: o.finalStatus });
  }
  const commits = unmergedCommitCount(o.wiWorktree.path, 'HEAD', [o.wiBaseSha]); // gitNetDelta reads 0 on a git error
  if (commits !== 0) {
    const spec = parseWorkItem(readFileSync(o.specPath, 'utf8'));
    writeFileSync(o.specPath, serializeWorkItem({ ...spec, kept_branch: o.wiWorktree.branch }));
    emit('dev-loop.kept', { work_item_id: o.workItemId, branch: o.wiWorktree.branch, tip: gitOut(o.wiWorktree.path, ['rev-parse', 'HEAD']),
      files_changed: delta.files, insertions: delta.insertions, deletions: delta.deletions, commits, outcome: o.finalStatus, resumable: true });
  }
  return delta;
}

/** Paths `git status` lists in the WI worktree (gitignored scratch excluded), or UNKNOWN. */
function uncommittedFiles(wt: string): string[] | 'UNKNOWN' {
  try { return gitOut(wt, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).map((l) => l.slice(3)); } catch { return 'UNKNOWN'; }
}

/**
 * Remove the per-WI worktree directory (scratch). Its branch goes only when
 * it carries no commit outside the cycle branch, or this attempt — cut fresh,
 * never a resumed kept tip — is requeued (the retry re-cuts); UNKNOWN keeps it.
 */
export function closeWiWorktree(o: { projectRepoPath: string; wiWorktree: { path: string; branch: string; resumedFrom: string | null }; cycleWorktreePath: string; requeue: boolean }): void {
  let cycleHead = '';
  try { cycleHead = gitOut(o.cycleWorktreePath, ['rev-parse', 'HEAD']); } catch { /* '' keeps the branch */ }
  const deleteBranch = (o.requeue && o.wiWorktree.resumedFrom === null) || (cycleHead !== '' && unmergedCommitCount(o.projectRepoPath, o.wiWorktree.branch, [cycleHead]) === 0);
  removeWiWorktree({ projectRepoPath: o.projectRepoPath, path: o.wiWorktree.path, branch: o.wiWorktree.branch, deleteBranch });
}

/** The round's fix WIs: compiled by a fix loop and still owed at develop entry. */
export function roundFixWorkItemIds(items: readonly WorkItem[]): string[] {
  return items.filter((w) => w.origin !== undefined && (w.status === 'pending' || w.status === 'in-progress')).map((w) => w.work_item_id);
}

/**
 * A fix round whose fix WIs did not all complete halts: the reason names each
 * failed fix WI with the checks its last iteration reached. Null = proceed.
 * An environment failure is not a halt (see `stopIncompleteFixRound`).
 */
export function fixRoundHaltReason(o: { items: readonly WorkItem[]; roundFixIds: readonly string[]; outcomes: ReadonlyMap<string, WiOutcome>; logFilePath: string }): { reason: string; failedIds: string[] } | null {
  // A terminal merge conflict settles `environment` too (it cascades like one) but is a work failure: Ralph completed.
  const failed = o.roundFixIds.map((id) => o.outcomes.get(id)).filter((x): x is WiOutcome => x !== undefined && x.status === 'failed' && (x.environment !== true || x.result?.status === 'complete'));
  if (failed.length === 0) return null;
  const events = readGateChecks(o.logFilePath);
  const checks = (id: string): string => {
    const total = o.items.find((w) => w.work_item_id === id)?.acceptance_criteria.filter((c) => c.check).length ?? 0;
    if (events === 'UNKNOWN') return `UNKNOWN/${total} checks passing`;
    const mine = events.filter((e) => e.id === id);
    const last = Math.max(-1, ...mine.map((e) => e.iteration));
    return `${new Set(mine.filter((e) => e.iteration === last && e.passed).map((e) => e.label)).size}/${total} checks passing`;
  };
  const stop = (x: WiOutcome): string => x.result === null ? 'not run' : x.result.status === 'complete' ? 'merge conflict' : x.result.stop_reason;
  const reason = failed.every((x) => stop(x) === 'iteration-budget')
    ? `fix work item(s) failed at the iteration budget: ${failed.map((x) => `${x.id} (${checks(x.id)})`).join(', ')}`
    : `fix work item(s) failed: ${failed.map((x) => `${x.id} (${stop(x)}; ${checks(x.id)})`).join(', ')}`;
  return { reason, failedIds: failed.map((x) => x.id) };
}

function readGateChecks(logFilePath: string): Array<{ id: string; iteration: number; label: string; passed: boolean }> | 'UNKNOWN' {
  if (!existsSync(logFilePath)) return 'UNKNOWN';
  try {
    return readFileSync(logFilePath, 'utf8').split('\n').filter(Boolean).flatMap((line) => {
      let md: Record<string, unknown> | undefined;
      try { md = (JSON.parse(line) as { metadata?: Record<string, unknown> }).metadata; } catch { return []; } // a torn line
      if (typeof md?.work_item_id !== 'string' || typeof md.acceptance_criterion !== 'string' || typeof md.iteration !== 'number') return [];
      return [{ id: md.work_item_id, iteration: md.iteration, label: md.acceptance_criterion, passed: md.gate_passed === true }];
    });
  } catch { return 'UNKNOWN'; }
}

/** Record the halt where #1218's round-halt surfaces read it, then fail the develop node by name. */
export function haltFixRound(o: WiCloseContext & { manifestPath: string; worktreePath: string; failedIds: readonly string[]; reason: string }): never {
  let round: number | 'UNKNOWN' = 'UNKNOWN';
  try { round = parseManifest(readFileSync(o.manifestPath, 'utf8')).review_rounds ?? 0; } catch { /* named UNKNOWN */ }
  let head: string | null = null;
  try { head = gitOut(o.worktreePath, ['rev-parse', 'HEAD']); } catch { /* recorded as null */ }
  o.logger.emit({ initiative_id: o.initiativeId, parent_event_id: o.parentEventId, phase: 'developer-loop', skill: o.skill, event_type: 'error', input_refs: [o.manifestPath], output_refs: [], message: 'sendback.loop-halted',
    metadata: { round, classification: 'fix-work-items-failed', reason: o.reason, pending_work_items: [...o.failedIds].sort(), head_sha: head } });
  throw new Error(`developer-loop: ${o.reason} — the round halts before integrate; Requeue resumes each from its kept branch`);
}

/**
 * The develop node's last act in a fix round: a failed fix WI halts the round
 * by name; one stopped for an environment reason (rate limit) fails the node
 * plainly, so the classifier retries it — neither reaches integrate.
 */
export function stopIncompleteFixRound(o: WiCloseContext & { items: readonly WorkItem[]; roundFixIds: readonly string[]; outcomes: ReadonlyMap<string, WiOutcome>; manifestPath: string; worktreePath: string }): void {
  const halt = fixRoundHaltReason({ ...o, logFilePath: o.logger.logFilePath });
  if (halt !== null) haltFixRound({ ...o, ...halt });
  const env = o.roundFixIds.filter((id) => o.outcomes.get(id)?.status === 'failed');
  if (env.length > 0) throw new Error(`developer-loop: fix work item(s) stopped for an environment reason: ${env.join(', ')} — the round does not proceed to integrate`);
}
