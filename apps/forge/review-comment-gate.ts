/**
 * review-comment-gate — forge-mfv5.1.28 (D-20 amended). A blocking verdict-gate
 * comment is the operator's concern in their own words; derive it faithfully.
 *
 *   - A runnable inline command (D-47's rule, `firstRunnableSpan`) becomes the
 *     derived criterion's WHEN and the fix work item's `quality_gate_cmd`.
 *   - A GWT-shaped body (GIVEN / WHEN / THEN clauses or lines, any case) IS the
 *     criterion; it is no longer pasted whole into a generic THEN.
 *   - A command that is not ONE argv-runnable command (a quote, a pipeline or
 *     chain, a redirect) is refused by name: the project gate stays the
 *     fallback and the cycle log says why (`review.comment-gate-extracted`,
 *     `event_type: 'error'`) — never silently.
 *
 * The gate is the FIRST blocker's valid command, in comment order: one send-back
 * compiles one fix work item, which has one gate. It lives in `apps/forge`
 * because the runnable rule is `@forge/stations`', which `@forge/flows` (the
 * comment store) may not import.
 */
import { createLogger } from '@forge/kernel';
import { deriveVerdictFromComments, validateWorkItem, type AcceptanceCriterion, type ReviewComment } from '@forge/flows';
import { firstRunnableSpan } from '@forge/stations';

export type CommentGateExtraction =
  | { ok: true; commentId: string; cmd: string[] }
  | { ok: false; commentId: string; cmd: string; reason: string };

export type DerivedVerdictWithGate =
  | { kind: 'approve' }
  | { kind: 'send-back'; rationale: string; acceptanceCriteria: AcceptanceCriterion[]; qualityGateCmd?: string[] };

export const COMMENT_GATE_EVENT = 'review.comment-gate-extracted';

/** Why `span` cannot run as one argv command, or null. */
function refusal(span: string): string | null {
  if (/["'`]/.test(span)) return 'it contains a quote — a gate runs as argv split on whitespace, never through a shell';
  if (/[|&;<>$]/.test(span)) return 'it is a shell pipeline, chain or redirect (| & ; < > $) — a gate must be ONE runnable command';
  const probe = { work_item_id: 'WI-1', initiative_id: 'INIT-2026-01-01-probe', status: 'pending', depends_on: [], acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }], files_in_scope: ['x'], estimated_iterations: 1, quality_gate_cmd: span.trim().split(/\s+/), body: '' } as Parameters<typeof validateWorkItem>[0];
  const errors = validateWorkItem(probe).filter((e) => e.startsWith('quality_gate_cmd'));
  return errors.length > 0 ? errors.join('; ') : null;
}

/** The comment's runnable inline command, validated; null when it names none. */
export function commentGateExtraction(c: ReviewComment): CommentGateExtraction | null {
  const span = firstRunnableSpan(c.body);
  if (span === null) return null;
  const reason = refusal(span);
  return reason === null
    ? { ok: true, commentId: c.id, cmd: span.trim().split(/\s+/) }
    : { ok: false, commentId: c.id, cmd: span, reason };
}

const CLAUSE = String.raw`[\s,;:.]*`;
const GWT_RE = new RegExp(String.raw`^\s*given\b${CLAUSE}([\s\S]+?)[\n,;.]\s*when\b${CLAUSE}([\s\S]+?)[\n,;.]\s*then\b${CLAUSE}([\s\S]+?)\s*$`, 'i');

/** A body whose clauses or lines start GIVEN / WHEN / THEN, as a criterion; else null. */
export function parseGwtBody(body: string): AcceptanceCriterion | null {
  const m = GWT_RE.exec(body.trim());
  if (!m) return null;
  const [given, when, then] = [m[1]!, m[2]!, m[3]!].map((s) => s.trim());
  return given && when && then ? { given, when, then } : null;
}

/** `deriveVerdictFromComments`, with each blocker's GWT and runnable command honoured. */
export function deriveVerdictWithGates(comments: ReviewComment[]): DerivedVerdictWithGate {
  const base = deriveVerdictFromComments(comments);
  if (base.kind === 'approve') return base;
  const blockers = comments.filter((c) => c.blocking && !c.resolved);
  let qualityGateCmd: string[] | undefined;
  const acceptanceCriteria = blockers.map((c, i) => {
    const x = commentGateExtraction(c);
    if (x?.ok && qualityGateCmd === undefined) qualityGateCmd = x.cmd;
    const derived = base.acceptanceCriteria[i]!;
    if (c.ac && c.ac.given.trim() && c.ac.when.trim() && c.ac.then.trim()) return derived;
    const gwt = parseGwtBody(c.body);
    if (gwt) return gwt;
    return x?.ok ? { ...derived, when: `the operator runs \`${x.cmd.join(' ')}\`` } : derived;
  });
  return { ...base, acceptanceCriteria, ...(qualityGateCmd ? { qualityGateCmd } : {}) };
}

/**
 * Record a blocking comment's extraction on the cycle log: `log` when its
 * command becomes the gate, `error` with the reason when it is refused. A
 * comment naming no runnable command emits nothing. A logging failure is
 * reported on stderr, never thrown — the comment is already stored.
 */
export function emitCommentGateEvent(logsRoot: string, cycleId: string, c: ReviewComment | undefined): void {
  if (!c || !c.blocking) return;
  const x = commentGateExtraction(c);
  if (x === null) return;
  try {
    createLogger(cycleId, logsRoot).emit({
      initiative_id: /INIT-\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.exec(cycleId)?.[0] ?? cycleId,
      phase: 'review-loop',
      skill: 'review-comments',
      event_type: x.ok ? 'log' : 'error',
      input_refs: [],
      output_refs: [],
      message: COMMENT_GATE_EVENT,
      metadata: x.ok
        ? { comment_id: x.commentId, cmd: x.cmd }
        : { comment_id: x.commentId, cmd: x.cmd, reason: x.reason, fallback: 'the project gate backs the fix work item' },
    });
  } catch (err) {
    console.error(`[review-comment-gate] ${COMMENT_GATE_EVENT} for ${c.id} could not be logged: ${err instanceof Error ? err.message : String(err)}`);
  }
}
