'use client';

/**
 * S7 / DEC-5 — client for the review-comment sidecar + the comment-derived
 * verdict. The interactive review page anchors comments to `data-demo-region`
 * sections; the bridge derives approve / send-back over the set and returns it
 * with every read/mutate (so the UI never re-derives out of sync).
 */
import { bridgeFetch } from './bridge-client';

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
  try {
    const res = await bridgeFetch(`/api/review-comments/${encodeURIComponent(cycleId)}`);
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

/** W7-B7 (artifact-plan-15): rewrite an authored comment (body and/or blocking). */
export async function editReviewComment(
  cycleId: string,
  commentId: string,
  patch: { body?: string; blocking?: boolean },
): Promise<ReviewCommentsResponse | { error: string }> {
  return post(`/api/review-comments/${encodeURIComponent(cycleId)}/edit`, { commentId, ...patch }, cycleId);
}

/** W7-B7 (artifact-plan-15): delete a comment — the only way to clear a non-blocking one. */
export async function deleteReviewComment(
  cycleId: string,
  commentId: string,
): Promise<ReviewCommentsResponse | { error: string }> {
  return post(`/api/review-comments/${encodeURIComponent(cycleId)}/delete`, { commentId }, cycleId);
}

/** Fetch the F4 single DEMO.md (raw markdown) for a cycle, or '' if absent. */
export async function fetchDemoMarkdown(cycleId: string): Promise<string> {
  try {
    const res = await bridgeFetch(`/api/artifact/${encodeURIComponent(cycleId)}/DEMO.md`);
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

async function post(path: string, body: unknown, cycleId: string): Promise<ReviewCommentsResponse | { error: string }> {
  try {
    const res = await bridgeFetch(path, {
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
