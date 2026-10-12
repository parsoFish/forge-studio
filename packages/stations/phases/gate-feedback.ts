/**
 * gate-feedback.ts — the brief a dev-loop agent reads first each turn
 * (`.forge/last-gate-failure.md`), split out of developer-loop.ts (over the
 * file cap) with forge-nk1y.35's per-WI tracker.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GateRunInfo } from '@forge/agents';
import type { MergeConflictDetail } from '@forge/flows';

/**
 * The one scratch path the gate-feedback and merge-conflict writers share.
 * `.forge/` is gitignored on every onboarded project (contract C2) and
 * stripped pre-PR, so the file never lands on a branch.
 */
export function lastGateFailurePath(worktreePath: string): string {
  return join(worktreePath, '.forge', 'last-gate-failure.md');
}

/** The two headings the shared file can open with; the iteration-0 splice keys on them. */
export const MERGE_CONFLICT_FEEDBACK_HEADING = '# MERGE CONFLICT';
export const GATE_FAILURE_FEEDBACK_HEADING = '# Live quality-gate failure — AUTHORITATIVE';

/**
 * S9 fix (2026-07-01): the orchestrator's gate runs the WI's command live
 * (secrets injected, TF_ACC set) while the agent's self-check runs offline and
 * can false-pass, so the live failure goes where the dev PROMPT says to read
 * first. Precedence vs. `writeMergeConflictFeedback` (same file): the runner's
 * iteration 0 is the sharp-gate pre-check, not the agent's first turn, so
 *  - FAILING at iteration 0 with a merge-conflict note present → keep the note,
 *    gate detail beneath (a requeued fork's iter-0 failure is expected);
 *  - FAILING at iteration ≥ 1 → replace the file (freshest live truth, never
 *    accumulated history — the 2026-07-04 stale-last-gate-failure theme);
 *  - PASSING at any iteration → delete.
 * forge-nk1y.35 adds `context` (HEAD, previous run, refused stale claim) and
 * returns the write's outcome instead of swallowing it.
 */
export function writeGateFeedback(
  worktreePath: string,
  info: GateRunInfo,
  context: GateFeedbackContext = {},
): GateFeedbackWrite {
  const filePath = lastGateFailurePath(worktreePath);
  try {
    if (info.passed) {
      if (existsSync(filePath)) unlinkSync(filePath);
      return { ok: true };
    }
    const gateBody = renderGateFailureBody(info, context);
    // Iteration 0 on a requeued fork: keep the conflict note, splice fresh gate detail beneath (idempotent).
    let body = gateBody;
    if (info.iteration === 0 && existsSync(filePath)) {
      const existing = readFileSync(filePath, 'utf8');
      if (existing.startsWith(MERGE_CONFLICT_FEEDBACK_HEADING)) {
        const spliceAt = existing.indexOf(GATE_FAILURE_FEEDBACK_HEADING);
        const conflictNote = (spliceAt === -1 ? existing : existing.slice(0, spliceAt)).replace(/\s*$/, '');
        body = `${conflictNote}\n\n${gateBody}`;
      }
    }
    mkdirSync(join(worktreePath, '.forge'), { recursive: true });
    writeFileSync(filePath, body);
    return { ok: true };
  } catch (err) {
    // Never throw out of the gate sink — but never swallow either: the caller
    // names the failure (`dev-loop.gate-feedback-write-failed`).
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Bounded tails (4 KB, GateRunInfo), verbatim, inside a fence the tail itself cannot close. */
function tails(prefix: string, stdout: string, stderr: string): string[] {
  const fence = (t: string) => (t.includes('```') ? ['~~~~', t, '~~~~'] : ['```', t, '```']);
  return [`${prefix} stdout (tail)`, ...fence(stdout), '', `${prefix} stderr (tail)`, ...fence(stderr), ''];
}

function renderGateFailureBody(info: GateRunInfo, context: GateFeedbackContext): string {
  const head = context.headSha ?? HEAD_UNKNOWN;
  const exit = String(info.exitCode ?? '?');
  const lines = [
    `${GATE_FAILURE_FEEDBACK_HEADING} (forge, iteration ${info.iteration ?? '?'})`,
    '',
    'This is the result of the SAME gate that decides whether this work item is done. forge runs it after every',
    'one of your turns and rewrites this file, so it is never stale: it judged the HEAD named below.',
    "A local re-run of the tests is never proof — the gate's command, environment (secrets, resource prefixes,",
    'TF_ACC) and working directory can differ from yours, and a local pass next to this failure means exactly that',
    'difference. Fix EXACTLY what is below — the work item is NOT done until this file disappears.',
    '',
    `Command: ${info.command ?? ''}`,
    `Exit code: ${exit}${info.errored ? '  (gate ERRORED — could not run; fix the gate/build itself)' : ''}`,
    `Gate ran at HEAD: ${head}`,
    '',
    ...tails('##', info.stdoutTail ?? '', info.stderrTail ?? ''),
  ];
  if (context.staleClaim !== undefined) {
    lines.push('## Your "stale" claim is REFUSED', '', `Your last turn called this gate failure stale ("${context.staleClaim}").`);
    lines.push(`It is not: forge ran the gate at HEAD ${head} after that turn and it failed (exit code ${exit}).`);
    lines.push('A gate failure may be called stale only when no gate has run at the current HEAD. Fix what the output names.', '');
  }
  const prev = context.previous;
  if (prev) {
    const same = prev.stdoutTail === info.stdoutTail && prev.stderrTail === info.stderrTail ? 'IDENTICAL to' : 'differs from';
    lines.push(`## Repeat failure — the previous gate run (iteration ${prev.iteration ?? '?'})`, '');
    lines.push(`Previous: exit code ${String(prev.exitCode)} at HEAD ${prev.headSha}. Output ${same} this run.`);
    lines.push('Compare the two before you conclude anything: the same failure twice means your change did not reach what the gate runs.', '');
    lines.push(...tails('### previous', prev.stdoutTail, prev.stderrTail));
  }
  return lines.join('\n');
}

/**
 * Conflict-context injection (2026-07-12): a WI whose fan-in merge conflicted
 * gets one bounded requeue on a fresh worktree that knows nothing of WHY —
 * ralph reproduced the same overlapping edit twice (csv-output-flag WI-3). The
 * captured detail goes into the shared file under its own heading: fan-in
 * evidence about sibling work, not a report on the WI's own gate.
 */
export function writeMergeConflictFeedback(
  worktreePath: string,
  attempt: number,
  conflict: MergeConflictDetail,
): void {
  try {
    const list = (items: readonly string[], none: string) => (items.length > 0 ? items.map((x) => `- ${x}`).join('\n') : none);
    const fileList = list(conflict.conflictingFiles, '- (git reported no specific unmerged paths for this failure)');
    const commitList = list(conflict.siblingCommits, '- (none found — the conflict may be against a change forge has not recorded a commit for)');
    const body = [
      `${MERGE_CONFLICT_FEEDBACK_HEADING} (attempt ${attempt}) — forge fan-in, NOT a quality-gate failure`,
      '',
      'Your PREVIOUS attempt on this work item conflicted when forge tried to merge its',
      'branch back into the cycle branch. Sibling work items already merged into the',
      'cycle branch while you were working, and your edit overlapped theirs on the files',
      'listed below. This is a FRESH worktree/branch forked from the CURRENT cycle tip —',
      'do NOT reproduce your previous edit verbatim. Read the current state of these',
      'files first and rebase your approach on top of what is already there.',
      '',
      `Your previous attempt's last commit: "${conflict.wiBranchTipSubject || '(unknown)'}"`,
      '',
      '## Files that conflicted',
      '',
      fileList,
      ...(conflict.filesTruncated ? ['', '_(truncated — more files conflicted than listed above)_'] : []),
      '',
      '## Sibling commits already merged that touched those files',
      '',
      commitList,
      ...(conflict.commitsTruncated ? ['', '_(truncated — more sibling commits touched these files than listed above)_'] : []),
      '',
    ].join('\n');
    mkdirSync(join(worktreePath, '.forge'), { recursive: true });
    writeFileSync(lastGateFailurePath(worktreePath), body);
  } catch {
    /* best-effort — never throw out of the requeue path */
  }
}

/** The HEAD a gate judged, when git cannot say (§6.15: UNKNOWN, never a plausible sha). */
export const HEAD_UNKNOWN = 'UNKNOWN';

export type PreviousGateRun = { iteration?: number; exitCode: number; headSha: string; stdoutTail: string; stderrTail: string };
/** headSha: the HEAD the gate ran at · previous: the prior FAILING agent-iteration run · staleClaim: the agent's own words. */
export type GateFeedbackContext = { headSha?: string; previous?: PreviousGateRun; staleClaim?: string };
export type GateFeedbackWrite = { ok: true } | { ok: false; error: string };
export type GateFeedbackEvent = {
  message: 'dev-loop.gate-output-repeated' | 'dev-loop.stale-claim-refused' | 'dev-loop.gate-feedback-write-failed' | 'dev-loop.gate-head-unknown';
  level: 'log' | 'error';
  metadata: Record<string, unknown>;
};

/**
 * I2 WI-6's agent wrote "Gate failure file is stale from prior iteration" five times while the gate kept failing.
 * A claim is the stale word within one clause of "gate"/"failure" — "removed a stale import" is not one.
 */
const STALE_WORD = String.raw`\b(?:stale|fossil|out[- ]of[- ]date)\b`;
const GATE_WORD = String.raw`\b(?:gate|failure)`;
const STALE_CLAIM = new RegExp(`${GATE_WORD}[^.\n]{0,60}${STALE_WORD}|${STALE_WORD}[^.\n]{0,60}${GATE_WORD}`, 'i');
const HEAD_READ_TIMEOUT_MS = 10_000;
const CLAIM_EXCERPT_MAX = 200;

function staleClaimExcerpt(text: string): string | undefined {
  const m = STALE_CLAIM.exec(text);
  if (!m) return undefined;
  const start = Math.max(0, m.index - CLAIM_EXCERPT_MAX / 2);
  return text.slice(start, start + CLAIM_EXCERPT_MAX).replace(/\s+/g, ' ').trim();
}

function readHeadSha(worktreePath: string): { sha: string; error?: string } {
  try {
    const args = ['-C', worktreePath, 'rev-parse', 'HEAD'];
    const sha = execFileSync('git', args, { stdio: 'pipe', encoding: 'utf8', timeout: HEAD_READ_TIMEOUT_MS }).trim();
    return sha ? { sha } : { sha: HEAD_UNKNOWN, error: 'git rev-parse HEAD printed nothing' };
  } catch (err) {
    return { sha: HEAD_UNKNOWN, error: err instanceof Error ? err.message : String(err) };
  }
}

/** A brief that could not be rewritten must not survive as if current: remove the older one, and say whether that worked. */
function removeOlderBrief(path: string): string {
  try {
    if (!existsSync(path)) return 'absent';
    unlinkSync(path);
    return 'removed';
  } catch (err) {
    return `remove failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * forge-nk1y.35 — one per work-item ralph run. `noteAgentTurn` takes each turn's
 * last text (onIteration fires before the gate that judges the turn); `onRun`
 * is the gate's sink: the brief names the HEAD the gate judged, a repeat shows
 * the previous failing run beside the current (`dev-loop.gate-output-repeated`),
 * a "stale" claim the failing gate just answered at the current HEAD is refused
 * by name (`dev-loop.stale-claim-refused`), and an unwritable brief is named
 * (`dev-loop.gate-feedback-write-failed`, the older brief removed). The
 * iteration-0 pre-check runs before any agent work, and an errored or timed-out
 * run is no test result: neither is a "previous" run or answers a claim.
 */
export function createGateFeedbackTracker(opts: {
  worktreePath: string;
  emit: (event: GateFeedbackEvent) => void;
}): { noteAgentTurn: (lastAssistantText: string | undefined) => void; onRun: (info: GateRunInfo) => void } {
  let previous: PreviousGateRun | undefined;
  let pendingClaim: string | undefined;
  return {
    noteAgentTurn(lastAssistantText) {
      pendingClaim = staleClaimExcerpt(lastAssistantText ?? '');
    },
    onRun(info) {
      const claim = pendingClaim;
      pendingClaim = undefined;
      const head = readHeadSha(opts.worktreePath);
      const headSha = head.sha;
      const judged = !info.passed && (info.iteration ?? 0) > 0 && !info.errored && !info.timedOut;
      const repeat = judged ? previous : undefined;
      const staleClaim = judged ? claim : undefined;
      const base = { iteration: info.iteration, head_sha: headSha, exit_code: info.exitCode };
      if (head.error !== undefined) {
        opts.emit({ message: 'dev-loop.gate-head-unknown', level: 'error', metadata: { ...base, error: head.error } });
      }
      if (repeat) {
        const output_identical = repeat.stdoutTail === info.stdoutTail && repeat.stderrTail === info.stderrTail;
        const prior = { previous_iteration: repeat.iteration, previous_head_sha: repeat.headSha, previous_exit_code: repeat.exitCode };
        opts.emit({ message: 'dev-loop.gate-output-repeated', level: 'log', metadata: { ...base, ...prior, output_identical } });
      }
      if (staleClaim !== undefined) {
        opts.emit({ message: 'dev-loop.stale-claim-refused', level: 'error', metadata: { ...base, claim_excerpt: staleClaim } });
      }
      const written = writeGateFeedback(opts.worktreePath, info, { headSha, previous: repeat, staleClaim });
      if (!written.ok) {
        const path = lastGateFailurePath(opts.worktreePath);
        const older_brief = removeOlderBrief(path);
        opts.emit({ message: 'dev-loop.gate-feedback-write-failed', level: 'error', metadata: { ...base, path, error: written.error, older_brief } });
      }
      const { exitCode, stdoutTail, stderrTail } = info;
      previous = judged ? { iteration: info.iteration, exitCode, headSha, stdoutTail, stderrTail } : undefined;
    },
  };
}
