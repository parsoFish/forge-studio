'use client';

/**
 * S7 / DEC-5 — client for the review-comment sidecar + the comment-derived
 * verdict. The interactive review page anchors comments to `data-demo-region`
 * sections; the bridge derives approve / send-back over the set and returns it
 * with every read/mutate (so the UI never re-derives out of sync).
 */
import { resolveBridgeUrl } from './bridge-client';

export type ReviewCommentAc = { given: string; when: string; then: string };

export type ReviewComment = {
  id: string;
  region: string;
  body: string;
  blocking: boolean;
  resolved: boolean;
  at: string;
  ac?: ReviewCommentAc;
};

export type DerivedVerdict =
  | { kind: 'approve' }
  | { kind: 'send-back'; rationale: string; acceptanceCriteria: ReviewCommentAc[] };

export type ReviewCommentsResponse = {
  cycleId: string;
  comments: ReviewComment[];
  derivedVerdict: DerivedVerdict;
};

const EMPTY = (cycleId: string): ReviewCommentsResponse => ({
  cycleId,
  comments: [],
  derivedVerdict: { kind: 'approve' },
});

export async function fetchReviewComments(cycleId: string): Promise<ReviewCommentsResponse> {
  const base = await resolveBridgeUrl();
  if (!base) return EMPTY(cycleId);
  try {
    const res = await fetch(`${base}/api/review-comments/${encodeURIComponent(cycleId)}`);
    if (!res.ok) return EMPTY(cycleId);
    return normalize(cycleId, await res.json());
  } catch {
    return EMPTY(cycleId);
  }
}

export async function addReviewComment(
  cycleId: string,
  input: { region: string; body: string; blocking: boolean; ac?: ReviewCommentAc },
): Promise<ReviewCommentsResponse | { error: string }> {
  return post(`/api/review-comments/${encodeURIComponent(cycleId)}`, input, cycleId);
}

export async function resolveReviewComment(
  cycleId: string,
  commentId: string,
): Promise<ReviewCommentsResponse | { error: string }> {
  return post(`/api/review-comments/${encodeURIComponent(cycleId)}/resolve`, { commentId }, cycleId);
}

/** Fetch the F4 single DEMO.md (raw markdown) for a cycle, or '' if absent. */
export async function fetchDemoMarkdown(cycleId: string): Promise<string> {
  const base = await resolveBridgeUrl();
  if (!base) return '';
  try {
    const res = await fetch(`${base}/api/artifact/${encodeURIComponent(cycleId)}/DEMO.md`);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

async function post(path: string, body: unknown, cycleId: string): Promise<ReviewCommentsResponse | { error: string }> {
  const base = await resolveBridgeUrl();
  if (!base) return { error: 'no bridge configured' };
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) return { error: (data.error as string) ?? `HTTP ${res.status}` };
    return normalize(cycleId, data);
  } catch (err) {
    return { error: String(err) };
  }
}

function normalize(cycleId: string, raw: unknown): ReviewCommentsResponse {
  const r = (raw ?? {}) as Partial<ReviewCommentsResponse>;
  return {
    cycleId,
    comments: Array.isArray(r.comments) ? (r.comments as ReviewComment[]) : [],
    derivedVerdict: r.derivedVerdict ?? { kind: 'approve' },
  };
}

export function isResponse(r: ReviewCommentsResponse | { error: string }): r is ReviewCommentsResponse {
  return (r as ReviewCommentsResponse).comments !== undefined;
}
