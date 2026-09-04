/**
 * The post-merge CI watcher — the last thing the cycle does to a PR, and the
 * only part of `pr.ts` that polls rather than acts.
 *
 * Carved out of `pr.ts` under the 800-line cap (M4-flows exit row 4). It is the
 * cleanest of that file's four seams: measured against the other blocks, this
 * one references NOTHING outside itself — no branch helper, no PR-lifecycle
 * function, no demo path — so the extraction is a verbatim move with an import
 * list and nothing else.
 *
 * `pr.ts` is about the GitHub PR API and `pr-branch-sync.ts` about local git
 * invariants; this module is about a run that has already merged and the
 * question of whether main went red because of it.
 */
import { execFileSync } from 'node:child_process';

// N6 (plan 2.8) — post-merge CI watch. After a confirmed merge, forge no
// longer walks away: closure polls the merged commit's GitHub Actions runs
// (bounded) and surfaces the result as `cycle.post-merge-ci` events. All gh
// shelling for it lives here (this module is the gh boundary).

/** One GitHub Actions run as reported by `gh run list`. */
export type CiRun = {
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  databaseId?: number;
  workflowName?: string;
};

export type PostMergeCiOutcome =
  | { status: 'green'; sha: string; runs: Array<{ name: string; url: string }> }
  | { status: 'red'; sha: string; failing: Array<{ name: string; url: string; failing_jobs: string[] }> }
  | { status: 'no-ci'; sha: string; detail: string }
  | { status: 'timeout'; sha: string; pending: string[] }
  | { status: 'unavailable'; detail: string };

/** Conclusions that count as green. Everything else on a completed run is red. */
const CI_GOOD_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

/**
 * Pure verdict over a run list (unit-testable without gh):
 *   - any COMPLETED run with a non-green conclusion → red (fail fast — a red
 *     is a red regardless of siblings still running)
 *   - anything not yet completed → pending
 *   - empty list → pending (no signal yet; the caller decides no-ci at the
 *     deadline)
 *   - else → green
 */
export function evaluateCiRuns(
  runs: CiRun[],
):
  | { verdict: 'green' }
  | { verdict: 'red'; failing: CiRun[] }
  | { verdict: 'pending'; pending: CiRun[] } {
  const failing = runs.filter(
    (r) => r.status === 'completed' && !CI_GOOD_CONCLUSIONS.has(r.conclusion ?? ''),
  );
  if (failing.length > 0) return { verdict: 'red', failing };
  const pending = runs.filter((r) => r.status !== 'completed');
  if (runs.length === 0 || pending.length > 0) return { verdict: 'pending', pending };
  return { verdict: 'green' };
}

/** The merged PR's merge-commit sha via `gh pr view`. Null when unresolvable. */
function mergedCommitSha(worktreePath: string): string | null {
  try {
    const out = execFileSync('gh', ['pr', 'view', '--json', 'mergeCommit'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out) as { mergeCommit?: { oid?: unknown } };
    const oid = parsed.mergeCommit?.oid;
    return typeof oid === 'string' && oid.length > 0 ? oid : null;
  } catch {
    return null;
  }
}

/** Workflow count for the repo. Null when `gh workflow list` fails. */
function repoWorkflowCount(worktreePath: string): number | null {
  try {
    const out = execFileSync('gh', ['workflow', 'list', '--json', 'id'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out) as unknown;
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

/** Actions runs for the given commit. Null when `gh run list` fails. */
function listCommitCiRuns(worktreePath: string, sha: string): CiRun[] | null {
  try {
    const out = execFileSync(
      'gh',
      ['run', 'list', '--commit', sha, '--json', 'name,status,conclusion,url,databaseId,workflowName'],
      { cwd: worktreePath, stdio: 'pipe', encoding: 'utf8' },
    );
    const parsed = JSON.parse(out) as unknown;
    if (!Array.isArray(parsed)) return null;
    return (parsed as Array<Record<string, unknown>>).map((r) => ({
      name: typeof r.workflowName === 'string' && r.workflowName ? r.workflowName : String(r.name ?? '(unnamed run)'),
      status: String(r.status ?? ''),
      conclusion: typeof r.conclusion === 'string' && r.conclusion ? r.conclusion : null,
      url: String(r.url ?? ''),
      databaseId: typeof r.databaseId === 'number' ? r.databaseId : undefined,
    }));
  } catch {
    return null;
  }
}

/** Failing job names within a run. Best-effort — errors yield []. */
function failingJobNames(worktreePath: string, runId: number | undefined): string[] {
  if (typeof runId !== 'number') return [];
  try {
    const out = execFileSync('gh', ['run', 'view', String(runId), '--json', 'jobs'], {
      cwd: worktreePath,
      stdio: 'pipe',
      encoding: 'utf8',
    });
    const parsed = JSON.parse(out) as { jobs?: Array<{ name?: unknown; conclusion?: unknown }> };
    return (parsed.jobs ?? [])
      .filter((j) => typeof j.conclusion === 'string' && !CI_GOOD_CONCLUSIONS.has(j.conclusion))
      .map((j) => String(j.name ?? '(unnamed job)'));
  } catch {
    return [];
  }
}

/**
 * Bounded post-merge CI watch (N6). Resolves the merged commit's sha, then
 * polls its Actions runs until green / red / the deadline. NEVER throws —
 * every degraded state maps to a structured outcome ('no-ci' when the
 * project has no workflows or none triggered for the commit; 'unavailable'
 * when gh itself cannot answer; 'timeout' when runs are still in flight at
 * the deadline). Red does NOT auto-fix anything — the caller emits the
 * event + needs-operator marker and moves on.
 */
export async function watchPostMergeCi(
  worktreePath: string,
  opts: { timeoutMs: number; pollIntervalMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<PostMergeCiOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  const sha = mergedCommitSha(worktreePath);
  if (!sha) {
    return { status: 'unavailable', detail: 'could not resolve the merged commit sha via `gh pr view --json mergeCommit`' };
  }

  // No workflows configured → nothing will ever run for this commit. Skip
  // without polling (the caller emits a debug-level event).
  const workflowCount = repoWorkflowCount(worktreePath);
  if (workflowCount === 0) {
    return { status: 'no-ci', sha, detail: 'no GitHub Actions workflows configured for this repo' };
  }

  const deadline = Date.now() + opts.timeoutMs;
  let sawRuns = false;
  let lastPending: CiRun[] = [];
  let ghEverAnswered = workflowCount !== null;

  for (;;) {
    const runs = listCommitCiRuns(worktreePath, sha);
    if (runs !== null) {
      ghEverAnswered = true;
      if (runs.length > 0) sawRuns = true;
      const verdict = evaluateCiRuns(runs);
      if (verdict.verdict === 'green') {
        return { status: 'green', sha, runs: runs.map((r) => ({ name: r.name, url: r.url })) };
      }
      if (verdict.verdict === 'red') {
        return {
          status: 'red',
          sha,
          failing: verdict.failing.map((r) => ({
            name: r.name,
            url: r.url,
            failing_jobs: failingJobNames(worktreePath, r.databaseId),
          })),
        };
      }
      lastPending = verdict.pending;
    }
    if (Date.now() + opts.pollIntervalMs > deadline) break;
    await sleep(opts.pollIntervalMs);
  }

  if (!ghEverAnswered) {
    return { status: 'unavailable', detail: 'gh could not list workflow runs for the merged commit (every poll errored)' };
  }
  if (!sawRuns) {
    return { status: 'no-ci', sha, detail: 'workflows exist but no run appeared for the merged commit within the watch window' };
  }
  return { status: 'timeout', sha, pending: lastPending.map((r) => r.name) };
}

