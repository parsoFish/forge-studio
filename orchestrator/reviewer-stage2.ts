/**
 * Review-loop stage 2 building blocks. Stage 2 is the verdict layer that runs
 * BETWEEN iterations of the review-Ralph loop:
 *
 *   1. Each iteration of the review-Ralph: agent prepares (or refines) the
 *      demo + PR draft on the initiative branch.
 *   2. Between iterations, the orchestrator's quality-gate function:
 *      a. Re-runs the project quality gate command (orchestrator-verified;
 *         never trusts the agent's claim).
 *      b. Calls `getVerdict(ctx)` — production: stdin prompt; bench: simulator.
 *      c. On `approve`: gate returns true → Ralph stops with `status: complete`.
 *         The orchestrator then merges, moves the manifest to `_queue/done/`,
 *         and fires the notification.
 *      d. On `send-back`: gate appends the feedback ACs to fix_plan.md (so the
 *         next iteration sees them) and returns false → Ralph continues.
 *
 * This module exports:
 *   - The verdict types (`Verdict`, `VerdictContext`, `GetVerdict`).
 *   - `appendSendBackFeedback()` — pure write to fix_plan.md.
 *   - `makeReviewerQualityGate()` — closure factory consumed by the runner.
 *   - `buildVerdictContext()` — assembles the context the verdict-provider sees.
 *
 * No imports from `cycle.ts` (avoids circular deps). `cycle.ts` orchestrates
 * `runReviewer` by calling into this module + `loops/ralph/runner.ts`.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AcceptanceCriterion, WorkItem } from './work-item.ts';

export type Verdict =
  | { kind: 'approve'; rationale: string }
  | { kind: 'send-back'; feedback: AcceptanceCriterion[]; rationale: string };

export type VerdictContext = {
  initiativeId: string;
  worktreePath: string;
  manifestPath: string;
  /** Absolute path to `<worktree>/.forge/pr-description.md`. */
  prDescriptionPath: string;
  /** Absolute path to `<worktree>/.forge/demos/<initiative-id>/`. */
  demoBundleDir: string;
  workItems: WorkItem[];
  /** `git diff main...HEAD --stat` output, capped at ~4 KB. */
  diffSummary: string;
  /** 1 = first review (after iteration 1); 2 = after iteration 2; ... */
  roundNumber: number;
};

export type GetVerdict = (ctx: VerdictContext) => Promise<Verdict>;

/**
 * Append a "Round N send-back" block to fix_plan.md with the verdict's
 * feedback ACs as unchecked checklist items. The next Ralph iteration reads
 * fix_plan.md and acts on the new items. Idempotent within a round (subsequent
 * calls within the same round append; we don't deduplicate — the round
 * counter in the header makes the chronology readable).
 */
export function appendSendBackFeedback(
  fixPlanPath: string,
  roundNumber: number,
  feedback: AcceptanceCriterion[],
  rationale: string,
): void {
  if (feedback.length === 0) return;
  const ts = new Date().toISOString();
  const lines = [
    '',
    `## Round ${roundNumber} send-back (${ts})`,
    '',
    '> Reviewer feedback — address before next review.',
    '',
    `**Rationale:** ${rationale.trim()}`,
    '',
    ...feedback.map(
      (ac) =>
        `- [ ] AC: GIVEN ${ac.given.trim()} WHEN ${ac.when.trim()} THEN ${ac.then.trim()}`,
    ),
    '',
  ];
  appendFileSync(fixPlanPath, lines.join('\n'));
}

/**
 * Build the `VerdictContext` the verdict-provider sees. Pure — reads the
 * worktree state at the moment of the gate check.
 */
export function buildVerdictContext(input: {
  initiativeId: string;
  worktreePath: string;
  manifestPath: string;
  workItems: WorkItem[];
  roundNumber: number;
}): VerdictContext {
  const prDescriptionPath = resolve(input.worktreePath, '.forge', 'pr-description.md');
  const demoBundleDir = resolve(input.worktreePath, '.forge', 'demos', input.initiativeId);
  const diffSummary = computeDiffSummary(input.worktreePath);
  return {
    initiativeId: input.initiativeId,
    worktreePath: input.worktreePath,
    manifestPath: input.manifestPath,
    prDescriptionPath,
    demoBundleDir,
    workItems: input.workItems,
    diffSummary,
    roundNumber: input.roundNumber,
  };
}

/**
 * Best-effort diff summary against `main`. Falls back to an explanatory
 * message when the worktree isn't a git repo or `main` doesn't exist (e.g.,
 * in early test setups). Capped at 4 KB to keep prompt size predictable.
 */
function computeDiffSummary(worktreePath: string): string {
  const tryCommands: Array<{ cmd: string; args: string[] }> = [
    { cmd: 'git', args: ['diff', '--stat', 'main...HEAD'] },
    { cmd: 'git', args: ['diff', '--stat', 'HEAD~1...HEAD'] },
    { cmd: 'git', args: ['diff', '--stat', 'HEAD'] },
  ];
  for (const { cmd, args } of tryCommands) {
    try {
      const out = execFileSync(cmd, args, {
        cwd: worktreePath,
        stdio: 'pipe',
        encoding: 'utf8',
      });
      if (out.trim().length > 0) {
        return out.length > 4096 ? `${out.slice(0, 4096)}\n... (truncated)` : out;
      }
    } catch {
      /* try next */
    }
  }
  return '_(no git diff available — bench may not be running in a git worktree)_';
}

export type ReviewerGateContext = {
  initiativeId: string;
  worktreePath: string;
  manifestPath: string;
  workItems: WorkItem[];
  /** Absolute path to fix_plan.md. The gate appends send-back feedback here. */
  fixPlanPath: string;
  /** Absolute path to AGENT.md. The gate writes verdict summaries here. */
  agentMdPath: string;
  /** Argv for the project quality-gate command (npm test, pytest, bats, etc.). */
  qualityGateCmd: string[];
};

export type ReviewerGateState = {
  /** Number of times the gate has been invoked. roundNumber = invocations. */
  invocations: number;
  /** Verdicts collected so far, in order. */
  verdicts: Verdict[];
  /** Quality-gate command results per invocation. */
  qualityGateResults: boolean[];
};

/**
 * Build the orchestrator-side quality-gate function the Ralph runner calls
 * between iterations. Owns both:
 *   1. Re-running the project quality-gate command (truth, not agent claim).
 *   2. Asking `getVerdict()` and acting on the result.
 *
 * Returns a closure suitable for `LoopInput.qualityGate`. Mutates the
 * supplied `state` object so the caller can read post-loop telemetry
 * (round count, verdict trail).
 */
export function makeReviewerQualityGate(
  ctx: ReviewerGateContext,
  getVerdict: GetVerdict,
  state: ReviewerGateState,
): () => Promise<boolean> {
  return async () => {
    state.invocations += 1;
    const roundNumber = state.invocations;

    // 1. Project quality-gate command. If red, the agent must fix before we
    //    can ask for a verdict.
    const gatesGreen = runProjectGate(ctx.worktreePath, ctx.qualityGateCmd);
    state.qualityGateResults.push(gatesGreen);
    if (!gatesGreen) {
      // Append a "synthetic send-back" so the next iteration knows to fix
      // the gate. We don't call getVerdict here — there's nothing to review.
      appendGateFailureNote(ctx.fixPlanPath, roundNumber, ctx.qualityGateCmd);
      return false;
    }

    // 2. Verify the agent has produced a PR draft + demo bundle. If not, the
    //    review isn't ready — don't waste a verdict-call on it.
    if (!existsSync(ctx.fixPlanPath)) return false; // shouldn't happen — Ralph stamps this
    const prPath = resolve(ctx.worktreePath, '.forge', 'pr-description.md');
    const demoDir = resolve(ctx.worktreePath, '.forge', 'demos', ctx.initiativeId);
    const prReady = existsSync(prPath) && statSync(prPath).size > 0;
    const demoReady = existsSync(demoDir);
    if (!prReady || !demoReady) {
      appendArtifactMissingNote(ctx.fixPlanPath, roundNumber, prReady, demoReady);
      return false;
    }

    // 3. Build the verdict context and ask the verdict-provider.
    const verdictCtx = buildVerdictContext({
      initiativeId: ctx.initiativeId,
      worktreePath: ctx.worktreePath,
      manifestPath: ctx.manifestPath,
      workItems: ctx.workItems,
      roundNumber,
    });
    const verdict = await getVerdict(verdictCtx);
    state.verdicts.push(verdict);

    // 4. Record the verdict in AGENT.md for cross-iteration visibility.
    appendVerdictToAgentMd(ctx.agentMdPath, roundNumber, verdict);

    if (verdict.kind === 'approve') {
      return true; // Ralph stops with status 'complete'
    }
    // send-back: append feedback to fix_plan.md so iteration N+1 sees it.
    appendSendBackFeedback(ctx.fixPlanPath, roundNumber, verdict.feedback, verdict.rationale);
    return false;
  };
}

function runProjectGate(worktreePath: string, cmd: string[]): boolean {
  if (cmd.length === 0) return false;
  const [head, ...rest] = cmd;
  if (!head) return false;
  try {
    execFileSync(head, rest, { cwd: worktreePath, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function appendGateFailureNote(
  fixPlanPath: string,
  roundNumber: number,
  cmd: string[],
): void {
  const ts = new Date().toISOString();
  const lines = [
    '',
    `## Round ${roundNumber} — quality gate FAILED (${ts})`,
    '',
    `> Project quality gate \`${cmd.join(' ')}\` exited non-zero. Fix before next review.`,
    '',
    '- [ ] Make the project quality gate pass before drafting the PR.',
    '',
  ];
  appendFileSync(fixPlanPath, lines.join('\n'));
}

function appendArtifactMissingNote(
  fixPlanPath: string,
  roundNumber: number,
  prReady: boolean,
  demoReady: boolean,
): void {
  const missing: string[] = [];
  if (!prReady) missing.push('`.forge/pr-description.md` (must have all four sections, body ≥ 300 chars)');
  if (!demoReady) missing.push('`.forge/demos/<initiative-id>/` bundle (source + recording + README.md)');
  const ts = new Date().toISOString();
  const lines = [
    '',
    `## Round ${roundNumber} — artifacts missing (${ts})`,
    '',
    '> Cannot ask for a verdict yet. Produce the missing artifacts.',
    '',
    ...missing.map((m) => `- [ ] ${m}`),
    '',
  ];
  appendFileSync(fixPlanPath, lines.join('\n'));
}

function appendVerdictToAgentMd(
  agentMdPath: string,
  roundNumber: number,
  verdict: Verdict,
): void {
  const ts = new Date().toISOString();
  const header = `## Round ${roundNumber} verdict (${ts})`;
  const body =
    verdict.kind === 'approve'
      ? `**APPROVED.** ${verdict.rationale.trim()}`
      : `**SEND-BACK.** ${verdict.rationale.trim()}\n\nNew acceptance criteria:\n${verdict.feedback
          .map(
            (ac, i) =>
              `${i + 1}. GIVEN ${ac.given.trim()} WHEN ${ac.when.trim()} THEN ${ac.then.trim()}`,
          )
          .join('\n')}`;
  const block = `\n${header}\n\n${body}\n`;
  if (existsSync(agentMdPath)) {
    appendFileSync(agentMdPath, block);
  }
}

/**
 * Read a fix_plan.md and return the count of unchecked send-back items
 * generated for round >= the supplied threshold. Bench/observability helper.
 */
export function countOpenSendBackItems(fixPlanPath: string, sinceRound = 1): number {
  if (!existsSync(fixPlanPath)) return 0;
  const text = readFileSync(fixPlanPath, 'utf8');
  // Walk header by header; only count unchecked items under "Round N send-back" headers
  // for N >= sinceRound.
  const headerRegex = /^## Round (\d+) send-back/m;
  let count = 0;
  const sections = text.split(/^## /m).slice(1);
  for (const sec of sections) {
    const match = sec.match(/^Round (\d+) send-back/);
    if (!match) continue;
    const round = Number(match[1]);
    if (round < sinceRound) continue;
    for (const line of sec.split('\n')) {
      if (/^- \[ \]/.test(line)) count += 1;
    }
  }
  // Suppress unused-warning for `headerRegex` while keeping intent clear.
  void headerRegex;
  return count;
}
