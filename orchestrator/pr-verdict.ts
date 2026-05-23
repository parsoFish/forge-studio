/**
 * PR-comment verdict provider (P3).
 *
 * The PR is the sole review window. Instead of the operator hand-editing a
 * local `.verdict-response.md`, the review/send-back loop happens on the
 * GitHub PR: the provider posts a prompt comment, then polls the PR's issue
 * comments for the operator's reply. This is the loop the brain theme
 * `pr-as-sole-review-window` records as beating the file-verdict loop
 * (trafficGame PR #54: 4 rounds, converged + merged).
 *
 * The reviewer selects this provider ONLY when an open PR exists; otherwise
 * it falls back to the file-verdict provider so a no-remote / gh-unavailable
 * cycle never strands (P3 fallback decision).
 *
 * `gh` is injectable (`gh`) so the polling/parsing is unit-testable without
 * a network or a real repo.
 */

import { execFileSync } from 'node:child_process';

import { notify, type NotifyConfig } from './notify.ts';
import { parseAcceptanceCriteria } from './file-verdict.ts';
import { prRef, type PrRef } from './pr.ts';
import type { GetVerdict, Verdict, VerdictContext } from './file-verdict.ts';

/** Runs `gh` with args in `cwd`, returns stdout. Throws on non-zero. */
export type GhRunner = (args: string[], cwd: string) => string;

export type PrCommentVerdictOptions = {
  worktreePath: string;
  initiativeId: string;
  /** Default 15 s. */
  pollIntervalMs?: number;
  /** Default Infinity — operators may take hours. Set in tests. */
  timeoutMs?: number;
  notifier?: NotifyConfig;
  // ---- injectable seams (tests) ----
  gh?: GhRunner;
  resolvePr?: (worktreePath: string) => PrRef | null;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

const PROMPT_SENTINEL = '<!-- forge:verdict-prompt -->';
const ACK_SENTINEL = '<!-- forge:verdict-ack -->';

type IssueComment = { id: number; login: string; body: string };

const defaultGh: GhRunner = (args, cwd) =>
  execFileSync('gh', args, { cwd, stdio: 'pipe', encoding: 'utf8' });

/**
 * Build a `GetVerdict` backed by GitHub PR comments. One round = one prompt
 * comment + a poll for the operator's reply comment.
 */
export function makePrCommentVerdict(opts: PrCommentVerdictOptions): GetVerdict {
  const gh = opts.gh ?? defaultGh;
  const resolvePr = opts.resolvePr ?? prRef;
  const pollIntervalMs = opts.pollIntervalMs ?? 15_000;
  const timeoutMs = opts.timeoutMs ?? Number.POSITIVE_INFINITY;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;

  return async (ctx: VerdictContext): Promise<Verdict> => {
    const pr = resolvePr(opts.worktreePath);
    if (!pr) {
      throw new Error(
        `pr-comment-verdict: no open PR for ${opts.initiativeId} — cannot run the PR review loop`,
      );
    }

    // Baseline: highest existing comment id BEFORE we post the prompt, so
    // neither the prompt nor any pre-existing comment is mistaken for the
    // operator's reply.
    const baseline = listComments(gh, opts.worktreePath, pr).reduce(
      (max, c) => (c.id > max ? c.id : max),
      0,
    );

    postComment(
      gh,
      opts.worktreePath,
      pr,
      `${PROMPT_SENTINEL}\n## Review round ${ctx.roundNumber} — verdict needed\n\n` +
        `Inspect this PR (diff + the committed demo) and reply with a comment:\n\n` +
        '- Approve: a line `forge: approve` (optionally followed by a rationale).\n' +
        '- Send back: a line `forge: send-back`, then one or more acceptance\n' +
        '  criteria, each `- GIVEN <…> WHEN <…> THEN <…>`.\n\n' +
        `Send-back cap applies (the loop is bounded by the reviewer iteration cap).`,
    );

    if (opts.notifier) {
      await notify(
        {
          type: 'review-ready',
          title: `Review needed: ${opts.initiativeId}`,
          body: `Round ${ctx.roundNumber} — comment a verdict on the PR: ${pr.url}`,
          url: pr.url,
        },
        opts.notifier,
      ).catch(() => {
        /* best-effort */
      });
    }

    const start = now();
    for (;;) {
      const fresh = listComments(gh, opts.worktreePath, pr).filter(
        (c) =>
          c.id > baseline &&
          !c.body.includes(PROMPT_SENTINEL) &&
          !c.body.includes(ACK_SENTINEL),
      );
      for (const c of fresh) {
        const verdict = parseVerdictComment(c.body);
        if (verdict) {
          postComment(
            gh,
            opts.worktreePath,
            pr,
            `${ACK_SENTINEL}\nforge: recorded **${verdict.kind}** for review round ${ctx.roundNumber}.`,
          );
          return verdict;
        }
      }
      if (now() - start > timeoutMs) {
        throw new Error(
          `pr-comment-verdict: timed out after ${timeoutMs}ms waiting for a verdict comment on ${pr.url}`,
        );
      }
      await sleep(pollIntervalMs);
    }
  };
}

/**
 * Parse a single PR comment into a Verdict, or null if it isn't one.
 * Exported for unit testing the (forgiving) operator-comment grammar.
 */
export function parseVerdictComment(body: string): Verdict | null {
  const text = body.replace(/\r\n/g, '\n');
  if (/^\s*\/?forge:\s*approve\b/im.test(text) || /^\s*\/approve\b/im.test(text)) {
    return { kind: 'approve', rationale: text.trim() };
  }
  if (/^\s*\/?forge:\s*send-?back\b/im.test(text) || /^\s*\/send-?back\b/im.test(text)) {
    const feedback = parseAcceptanceCriteria(text);
    // A send-back with no acceptance criteria isn't actionable — ignore it
    // and keep polling (the operator can add a follow-up comment with the
    // GWT lines). Mirrors file-verdict's "send-back must include ≥1 AC".
    if (feedback.length === 0) return null;
    return { kind: 'send-back', feedback, rationale: text.trim() };
  }
  return null;
}

function listComments(gh: GhRunner, cwd: string, pr: PrRef): IssueComment[] {
  try {
    const out = gh(
      [
        'api',
        '--paginate',
        `repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`,
        '-q',
        '.[] | {id: .id, login: .user.login, body: .body}',
      ],
      cwd,
    );
    const comments: IssueComment[] = [];
    for (const line of out.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        const o = JSON.parse(s) as { id: number; login: string; body: string };
        if (typeof o.id === 'number') {
          comments.push({ id: o.id, login: o.login ?? '', body: o.body ?? '' });
        }
      } catch {
        /* skip a malformed line — never break the poll loop */
      }
    }
    return comments;
  } catch {
    // Transient gh/network failure — treat as "no new comments yet" and let
    // the caller poll again rather than crash the review.
    return [];
  }
}

function postComment(gh: GhRunner, cwd: string, pr: PrRef, body: string): void {
  try {
    gh(['pr', 'comment', String(pr.number), '--body', body], cwd);
  } catch {
    /* best-effort: a failed prompt/ack comment must not crash the loop */
  }
}
