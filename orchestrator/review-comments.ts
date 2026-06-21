/**
 * S7 / DEC-5 — the interactive review page's comment sidecar + verdict derivation.
 *
 * The visual review page anchors W3C-annotation-style comments to authored
 * `data-demo-region` sections of the demo, and the operator's approve / send-back
 * verdict is DERIVED over them: any blocking, unresolved comment ⇒ send-back,
 * with each concern mapped to a GIVEN/WHEN/THEN acceptance criterion that the
 * existing `/api/verdict` send-back drain consumes in place (ADR-026 — no sibling
 * cycle). No comments / only resolved-or-non-blocking comments ⇒ approve.
 *
 * Persistence is a single JSON sidecar at `_logs/<cycleId>/review-comments.json`
 * (no DB). The read/append/resolve/derive functions here are pure (synchronous
 * fs for read/write); the bridge route wraps the read-modify-write in a
 * proper-lockfile guard, mirroring `applyReviewVerdict`.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

/** A reviewer comment anchored to a demo region (W3C-annotation-ish). */
export type ReviewComment = {
  /** Stable, append-only id (never renumbered — the anchor handle). */
  id: string;
  /** The authored `data-demo-region` this comment is anchored to. */
  region: string;
  /** The reviewer's note. */
  body: string;
  /** A blocking comment must be resolved before the page derives `approve`. */
  blocking: boolean;
  /** Set when the concern has been addressed (or the operator dismissed it). */
  resolved: boolean;
  /** ISO-8601 creation timestamp. */
  at: string;
  /**
   * Optional explicit GIVEN/WHEN/THEN. When a blocking comment carries one it is
   * used verbatim as the send-back acceptance criterion; otherwise a GWT is
   * derived from the region + body so the drain (which rejects blank GWT) is fed.
   */
  ac?: AcceptanceCriterion;
};

export type AcceptanceCriterion = { given: string; when: string; then: string };

export type ReviewCommentsSidecar = {
  cycleId: string;
  comments: ReviewComment[];
};

/** New-comment payload (id/at/resolved are assigned by `appendReviewComment`). */
export type NewReviewComment = {
  region: string;
  body: string;
  blocking: boolean;
  resolved?: boolean;
  ac?: AcceptanceCriterion;
};

export type DerivedVerdict =
  | { kind: 'approve' }
  | { kind: 'send-back'; rationale: string; acceptanceCriteria: AcceptanceCriterion[] };

const SIDECAR_FILE = 'review-comments.json';
/** A cycle id is a single path segment — never a traversal or nested path. */
const SAFE_CYCLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Defence-in-depth cap on a single cycle's review comments (an absurd ceiling). */
export const REVIEW_COMMENTS_MAX = 500;

/** True when a cycleId is a safe single path segment (callers should 400 otherwise). */
export function isSafeCycleId(cycleId: string): boolean {
  return SAFE_CYCLE_ID_RE.test(cycleId);
}

/** Absolute path to the sidecar for a cycle (does not create it). */
export function reviewCommentsPath(logsRoot: string, cycleId: string): string {
  return join(resolve(logsRoot), cycleId, SIDECAR_FILE);
}

/** Read the sidecar; an empty (but well-formed) sidecar when absent/unsafe/unparseable. */
export function readReviewComments(logsRoot: string, cycleId: string): ReviewCommentsSidecar {
  const empty: ReviewCommentsSidecar = { cycleId, comments: [] };
  if (!SAFE_CYCLE_ID_RE.test(cycleId)) return empty;
  const p = reviewCommentsPath(logsRoot, cycleId);
  if (!existsSync(p)) return empty;
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8')) as Partial<ReviewCommentsSidecar>;
    const comments = Array.isArray(parsed.comments) ? parsed.comments.map(normalizeComment) : [];
    return { cycleId, comments };
  } catch {
    return empty;
  }
}

/** Write the sidecar. Throws on a path-traversal cycleId (never escapes logsRoot). */
export function writeReviewComments(logsRoot: string, cycleId: string, sidecar: ReviewCommentsSidecar): void {
  if (!SAFE_CYCLE_ID_RE.test(cycleId)) {
    throw new Error(`unsafe cycleId for review-comments sidecar: ${cycleId}`);
  }
  const logsAbs = resolve(logsRoot);
  const dir = join(logsAbs, cycleId);
  // Defence in depth: the resolved dir must stay under logsRoot.
  if (!(dir + sep).startsWith(logsAbs + sep)) {
    throw new Error(`review-comments cycleId escapes logs root: ${cycleId}`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SIDECAR_FILE), JSON.stringify({ cycleId, comments: sidecar.comments }, null, 2));
}

/** Append a comment (pure) — assigns a stable id + timestamp; never renumbers. */
export function appendReviewComment(sidecar: ReviewCommentsSidecar, c: NewReviewComment): ReviewCommentsSidecar {
  const id = nextCommentId(sidecar.comments);
  const comment: ReviewComment = {
    id,
    region: c.region,
    body: c.body,
    blocking: Boolean(c.blocking),
    resolved: Boolean(c.resolved),
    at: new Date().toISOString(),
    ...(c.ac ? { ac: c.ac } : {}),
  };
  return { cycleId: sidecar.cycleId, comments: [...sidecar.comments, comment] };
}

/** Mark a comment resolved (pure). A no-op if the id is unknown. */
export function resolveComment(sidecar: ReviewCommentsSidecar, commentId: string): ReviewCommentsSidecar {
  return {
    cycleId: sidecar.cycleId,
    comments: sidecar.comments.map((c) => (c.id === commentId ? { ...c, resolved: true } : c)),
  };
}

/**
 * Derive the review verdict from the comment set.
 *
 * - Any blocking AND unresolved comment ⇒ `send-back`. Each such concern becomes
 *   one acceptance criterion (its explicit `ac`, or a GWT derived from region +
 *   body so the drain never sees a blank). The rationale concatenates the
 *   anchored concerns.
 * - Otherwise ⇒ `approve`.
 */
export function deriveVerdictFromComments(comments: ReviewComment[]): DerivedVerdict {
  const blockers = comments.filter((c) => c.blocking && !c.resolved);
  if (blockers.length === 0) return { kind: 'approve' };

  const acceptanceCriteria = blockers.map((c) => acForComment(c));
  const rationale = blockers.map((c) => `[${c.region}] ${c.body.trim()}`).join('\n');
  return { kind: 'send-back', rationale, acceptanceCriteria };
}

// --------------------------------------------------------------------------

function acForComment(c: ReviewComment): AcceptanceCriterion {
  if (c.ac && c.ac.given.trim() && c.ac.when.trim() && c.ac.then.trim()) {
    return { given: c.ac.given.trim(), when: c.ac.when.trim(), then: c.ac.then.trim() };
  }
  // Derive a non-empty GWT from the anchored comment so the drain accepts it.
  return {
    given: `the demo region "${c.region}"`,
    when: 'the operator reviews the change',
    then: c.body.trim() || `region "${c.region}" must be corrected`,
  };
}

/** Stable append-only id: `C-<n>` where n is one past the current max. */
function nextCommentId(comments: ReviewComment[]): string {
  let max = 0;
  for (const c of comments) {
    const m = /^C-(\d+)$/.exec(c.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `C-${max + 1}`;
}

function normalizeComment(raw: unknown): ReviewComment {
  const r = (raw ?? {}) as Record<string, unknown>;
  const ac = r.ac as Record<string, unknown> | undefined;
  return {
    id: typeof r.id === 'string' ? r.id : 'C-0',
    region: typeof r.region === 'string' ? r.region : '',
    body: typeof r.body === 'string' ? r.body : '',
    blocking: Boolean(r.blocking),
    resolved: Boolean(r.resolved),
    at: typeof r.at === 'string' ? r.at : new Date(0).toISOString(),
    ...(ac && typeof ac.given === 'string'
      ? { ac: { given: String(ac.given), when: String(ac.when ?? ''), then: String(ac.then ?? '') } }
      : {}),
  };
}
