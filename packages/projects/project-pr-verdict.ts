/** forge-mfv5.1.23 — the forge-studio PR's merge verdict, pure over one `gh api graphql` read. Never merge on absence
 *  of red: no required check is never green, red wins over pending, unreadable (or truncated) is named, nothing reported
 *  yet is pending (an unreported required check is absent from the rollup), and green also needs GitHub's own CLEAN. */
export type PrState = 'merged' | 'blocked-no-required-check' | 'failing' | 'pending' | 'green' | 'unreadable' | 'stale-head' | 'blocked-by-ruleset' | 'merge-failed';
/** `required` counts the required checks that reported; `--auto` is never requested with none. */
export type PrVerdict = { state: PrState; detail: string; required?: number };
type Check = { name: string; required: boolean; status: 'green' | 'red' | 'pending' };
export type PrRead = { ok: true; merged: boolean; headOid: string; mergeState: string; checks: Check[] } | { ok: false; reason: string };

export const NO_REQUIRED_CHECK = 'no required check reports on this branch — merge on GitHub yourself or add a required check';
const GREEN_CONCLUSIONS = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];

/** A CheckRun is green on success/neutral/skipped, red on any other completed conclusion; a StatusContext
 *  is red on FAILURE/ERROR, green on SUCCESS, else pending. */
function check(n: Record<string, unknown>): Check {
  const required = n.isRequired === true;
  if (n.__typename === 'StatusContext') {
    return { name: String(n.context), required, status: n.state === 'SUCCESS' ? 'green' : n.state === 'FAILURE' || n.state === 'ERROR' ? 'red' : 'pending' };
  }
  if (n.status !== 'COMPLETED') return { name: String(n.name), required, status: 'pending' };
  return { name: String(n.name), required, status: GREEN_CONCLUSIONS.includes(String(n.conclusion)) ? 'green' : 'red' };
}

export function parsePrRead(stdout: string): PrRead {
  try {
    const pr = JSON.parse(stdout)?.data?.repository?.pullRequest;
    if (!pr || typeof pr.headRefOid !== 'string') return { ok: false, reason: 'gh api graphql returned no pull request' };
    const commit = pr.commits?.nodes?.[0]?.commit;
    if (commit?.oid !== undefined && commit.oid !== pr.headRefOid) return { ok: false, reason: `checks read for ${String(commit.oid).slice(0, 7)}, not the PR head` };
    const contexts = commit?.statusCheckRollup?.contexts;
    if (contexts?.pageInfo?.hasNextPage === true) return { ok: false, reason: 'more checks than one read returns (over 100) — not judged' };
    const nodes = contexts?.nodes ?? [];
    return { ok: true, merged: pr.merged === true || pr.state === 'MERGED', headOid: pr.headRefOid, mergeState: String(pr.mergeStateStatus), checks: (nodes as Array<Record<string, unknown>>).map(check) };
  } catch {
    return { ok: false, reason: 'gh api graphql returned unparseable output' };
  }
}

/** `pushed` is the commit Save pushed to forge-studio; a PR on any other head is never merged. */
export function prVerdict(read: PrRead, pushed: string): PrVerdict {
  if (!read.ok) return { state: 'unreadable', detail: `PR state unreadable: ${read.reason}` };
  if (read.headOid !== pushed) return { state: 'stale-head', detail: `PR head ${read.headOid.slice(0, 7)} is not the pushed ${pushed.slice(0, 7)}` };
  if (read.merged) return { state: 'merged', detail: 'PR merged' };
  const required = read.checks.filter((c) => c.required);
  const names = (cs: Check[]): string => cs.map((c) => c.name).join(', ');
  const red = required.filter((c) => c.status === 'red');
  const pending = required.filter((c) => c.status === 'pending');
  if (read.checks.length === 0) return { state: 'pending', detail: 'no check has reported on this head yet' };
  if (required.length === 0) return { state: 'blocked-no-required-check', detail: NO_REQUIRED_CHECK };
  if (red.length > 0) return { state: 'failing', detail: `checks failing: ${names(red)}` };
  if (pending.length > 0) return { state: 'pending', detail: `checks pending: ${names(pending)}`, required: required.length };
  if (read.mergeState !== 'CLEAN' && read.mergeState !== 'HAS_HOOKS') return { state: 'pending', detail: `reported required checks green, but GitHub says ${read.mergeState}`, required: required.length };
  return { state: 'green', detail: `required checks green: ${names(required)}` };
}
