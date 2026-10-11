'use client';

/**
 * The verdict gate (forge-mfv5.1.31; D-46 gate
 * budget). Four blocks, decision first:
 *   1. gate-decision — the labelled narrative + measured facts + the decision card
 *   2. review        — criteria (the first comment regions, S10 beats 13/16) | findings
 *   3. demo          — one checkpoint at a time, before/after large, <dialog> to enlarge
 *   4. details       — work items, gate runs, changed files (collapsed: secondary)
 *
 * The verdict is DERIVED over the operator's anchored comments (DEC-5): any
 * blocking, unresolved comment ⇒ send back, each mapped to a GIVEN/WHEN/THEN
 * the D-20 in-place drain runs in the SAME cycle. This component owns the
 * comment state and the submit; the blocks only render it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DemoModel } from '@/lib/bridge-client';
import { submitVerdict } from '@/lib/bridge-client';
import {
  fetchReviewComments,
  addReviewComment,
  resolveReviewComment,
  editReviewComment,
  deleteReviewComment,
  isResponse,
  type ReviewComment,
  type DerivedVerdict,
  type ReviewCommentsResponse,
} from '@/lib/review-comments-client';
import { effectiveInitiativeId } from '@/lib/initiative-id';
import { summarizeReview } from '@/lib/demo-review-view';
import { countBy, joinCriteria, parseDiffStat, reviewHeadIsStale } from '@/lib/gate-view';
import { GateBand } from './studio/gate/GateBand';
import { StoryBand } from './studio/gate/StoryBand';
import { DecisionCard } from './studio/gate/DecisionCard';
import { CriteriaPane } from './studio/gate/CriteriaPane';
import { FindingsPane, type ReviewFindingsState } from './studio/gate/FindingsPane';
import { DemoGallery } from './studio/gate/DemoGallery';
import { GateDetails } from './studio/gate/GateDetails';
import type { CommentHandlers } from './studio/gate/RegionComments';

const NO_REVIEW: ReviewFindingsState = { doc: null, absent: true, error: false };

export function DemoReviewSurface({
  model,
  cycleId,
  initiativeId,
  onSubmitted,
  reviewFindings = NO_REVIEW,
  costUsd = null,
  reflectHref,
  bridgeBase = null,
}: {
  model: DemoModel;
  cycleId: string;
  initiativeId: string;
  onSubmitted?: (kind: 'approve' | 'send-back') => void;
  reviewFindings?: ReviewFindingsState;
  costUsd?: number | null;
  reflectHref?: string;
  bridgeBase?: string | null;
}): JSX.Element {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [derived, setDerived] = useState<DerivedVerdict>({ kind: 'approve' });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<null | 'approve' | 'send-back'>(null);
  const [error, setError] = useState<string | null>(null);
  // forge-mfv5.1.28 (D-20 amended): with no blocking comment, the operator may
  // still send back — typed work items through ReviewVerdictForm's send-back.
  const [composing, setComposing] = useState(false);
  // A failed comments read must not derive "approve" (lib/review-comments-client.ts).
  const [loadError, setLoadError] = useState<string | null>(null);
  // The region the operator asked to jump to (the first open blocker) — the gallery selects a checkpoint for it.
  const [focusRegion, setFocusRegion] = useState<{ id: string; seq: number } | null>(null);

  useEffect(() => {
    let live = true;
    fetchReviewComments(cycleId).then((r) => {
      if (!live) return;
      if (isResponse(r)) { setComments(r.comments); setDerived(r.derivedVerdict); setLoadError(null); }
      else setLoadError(r.error);
    });
    return () => { live = false; };
  }, [cycleId]);

  /** Apply a comment write; resolves false (and records why) when the bridge refused it. */
  const apply = useCallback(async (call: Promise<ReviewCommentsResponse | { error: string }>): Promise<boolean> => {
    const r = await call;
    if (isResponse(r)) { setComments(r.comments); setDerived(r.derivedVerdict); return true; }
    setError(r.error);
    return false;
  }, []);

  const handlers: CommentHandlers = useMemo(() => ({
    onAdd: (region, body, blocking) => apply(addReviewComment(cycleId, { region, body, blocking })),
    onResolve: (id) => apply(resolveReviewComment(cycleId, id)),
    // W7-B7 (artifact-plan-15): edit fixes a typo'd concern without losing its anchor.
    onEdit: (id, patch) => apply(editReviewComment(cycleId, id, patch)),
    onDelete: (id) => apply(deleteReviewComment(cycleId, id)),
  }), [apply, cycleId]);

  const blockerCount = comments.filter((c) => c.blocking && !c.resolved).length;
  const resolvedCount = comments.filter((c) => c.resolved).length;
  // The verdict route validates the INIT-YYYY-MM-DD-slug id; recover it from a
  // cycle id when the run carried none (lib/initiative-id.ts — W7-B7, artifact-plan-25).
  const verdictInitiativeId = effectiveInitiativeId(initiativeId, cycleId);
  // The first open blocker in reading order — criteria, then checkpoints, then API changes.
  const firstBlocker = summarizeReview(
    [...(model.acceptanceCriteria ?? []).map((_, i) => `ac-${i + 1}`), ...model.checkpoints.map((_, i) => `checkpoint-${i + 1}`), ...(model.apiDiff ?? []).map((_, i) => `apidiff-${i + 1}`)],
    comments,
  ).firstBlockingRegion;

  async function onSubmit(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const result =
        derived.kind === 'approve'
          ? await submitVerdict({ kind: 'approve', initiativeId: verdictInitiativeId, rationale: 'Approved on the visual review — no blocking comments.' })
          : await submitVerdict({
              kind: 'send-back',
              initiativeId: verdictInitiativeId,
              rationale: derived.rationale,
              acceptanceCriteria: derived.acceptanceCriteria,
              // A blocker's runnable inline command gates the fix WI (forge-mfv5.1.28).
              ...(derived.qualityGateCmd ? { qualityGateCmd: derived.qualityGateCmd } : {}),
            });
      if (!result.ok) { setError(result.error ?? 'submit failed'); return; }
      setSubmitted(derived.kind);
      onSubmitted?.(derived.kind);
    } finally {
      setSubmitting(false);
    }
  }

  const doc = reviewFindings.doc;
  const criteria = joinCriteria(model.acceptanceCriteria ?? [], doc?.acEvaluations ?? []);
  const checkpoints = model.checkpoints;
  const severities = countBy(doc?.findings ?? [], (f) => f.severity ?? 'info');
  const verdicts = countBy(criteria.filter((c) => c.verdict !== null), (c) => c.verdict!);
  const testEvidence = model.testEvidence ?? [];
  const workItemTitle = (id: string): string => {
    const bullet = model.summary?.bullets.find((b) => b.startsWith(`${id} `));
    return bullet ? bullet.replace(/^WI-\d+ \[[a-z-]+\] #\s*WI-\d+:?\s*(—\s*)?/, '') : '';
  };
  const locked = submitted !== null;

  return (
    <div data-component="demo-review-surface" data-cycle-id={cycleId} data-comment-count={comments.length} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <GateBand
        story={<StoryBand
          narrative={model.narrative}
          essence={model.essence}
          facts={{
            gates: { pass: testEvidence.filter((t) => t.result === 'pass').length, total: testEvidence.length, names: testEvidence.map((t) => t.name.split(':')[0]).join(' · ') },
            deltas: countBy(checkpoints, (c) => c.delta ?? 'unknown'),
            verdicts,
            severities,
            diff: parseDiffStat(model.diffStat),
            diffStat: model.diffStat,
            costUsd,
            headSha: model.changedRef,
          }}
        />}
        decision={<DecisionCard
          derived={derived}
          blockerCount={blockerCount}
          resolvedCount={resolvedCount}
          initiativeId={verdictInitiativeId}
          submitting={submitting}
          submitted={submitted}
          error={error}
          composing={composing}
          onCompose={() => setComposing(true)}
          onSubmit={() => void onSubmit()}
          onTypedSubmitted={(kind) => { setSubmitted(kind); onSubmitted?.(kind); }}
          reflectHref={reflectHref}
          loadError={loadError}
          onJumpToBlocker={firstBlocker ? () => setFocusRegion((f) => ({ id: firstBlocker, seq: (f?.seq ?? 0) + 1 })) : undefined}
          claims={{
            present: doc !== null,
            missed: verdicts.missed ?? 0,
            major: severities.major ?? 0,
            blocker: severities.blocker ?? 0,
            reviewedSha: doc?.headSha,
            headSha: model.changedRef,
            stale: reviewHeadIsStale(doc?.headSha, model.changedRef),
          }}
        />}
      />

      <section data-section="review" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--space-5)' }}>
        <CriteriaPane criteria={criteria} comments={comments} disabled={locked} handlers={handlers} focusRegion={focusRegion} />
        <FindingsPane state={reviewFindings} headSha={model.changedRef} workItemTitle={workItemTitle} />
      </section>

      <DemoGallery checkpoints={checkpoints} apiDiff={model.apiDiff ?? []} cycleId={cycleId} bridgeBase={bridgeBase} comments={comments} disabled={locked} handlers={handlers} focusRegion={focusRegion} />

      <GateDetails model={model} />
    </div>
  );
}
