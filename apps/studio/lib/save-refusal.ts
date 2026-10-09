/**
 * forge-mfv5.1.12 — a Save that did not land. The project PUT commits the config
 * to forge-studio, then the Save either refuses (contract files uncommitted:
 * `refused`) or fails on git (`merged: false` with a reason). Either way the
 * client reports NOT saved (row 6, ruling T1 1977a); only "nothing pending" and
 * "not a git repo" are a successful no-op, and a PR opened against a protected
 * default branch is saved (forge-mfv5.1.22).
 */
const NO_OP_DETAILS = ['no pending forge-studio changes', 'not a git repo'];
/** Only a github.com pull-request URL is ever rendered as a link (forge-mfv5.1.22 review). */
const PR_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/;
const SHA_RE = /^[0-9a-f]{40}$/;

/** forge-mfv5.1.22 — a Save that found the default branch stranded ahead of origin
 *  proposes this; nothing moves until the operator confirms it with these shas. */
export type SaveRecoveryProposal = { commits: number; subjects: string[]; localHead: string; resetTo: string; base: string; detail: string };

/** A PR link the bridge served (repo-status or a Save), or undefined. */
export function readPrUrl(v: unknown): string | undefined {
  return typeof v === 'string' && PR_URL_RE.test(v) ? v : undefined;
}

function readRecovery(v: unknown, detail: string): SaveRecoveryProposal | undefined {
  if (v === null || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  if (typeof r.commits !== 'number' || !SHA_RE.test(String(r.localHead)) || !SHA_RE.test(String(r.resetTo)) || typeof r.base !== 'string') return undefined;
  const subjects = Array.isArray(r.subjects) ? r.subjects.filter((s): s is string => typeof s === 'string') : [];
  return { commits: r.commits, subjects, localHead: String(r.localHead), resetTo: String(r.resetTo), base: r.base, detail };
}

export function readSaveRefusal(save: unknown): { error: string; refused: string[]; recovery?: SaveRecoveryProposal } | null {
  if (save === null || typeof save !== 'object') return null;
  const { refused, detail, merged, pushed, prUrl, recovery } = save as Record<string, unknown>;
  const files = Array.isArray(refused) ? refused.filter((f): f is string => typeof f === 'string') : [];
  const reason = typeof detail === 'string' ? detail : '';
  if (files.length > 0) return { error: reason || `not saved: ${files.join(', ')}`, refused: files };
  const proposal = readRecovery(recovery, reason);
  if (proposal) return { error: reason, refused: [], recovery: proposal };
  // A protected default branch took a PR: saved to forge-studio + origin, shown as a link, not a failure.
  if (pushed === true && readPrUrl(prUrl)) return null;
  if (merged === false && !NO_OP_DETAILS.includes(reason)) return { error: reason || 'not saved', refused: [] };
  return null;
}
