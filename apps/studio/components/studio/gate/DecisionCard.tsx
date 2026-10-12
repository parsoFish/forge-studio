'use client';

/**
 * The verdict decision (forge-mfv5.1.31) — the gate control, inside viewport 1.
 *
 * The verdict is DERIVED from the operator's comments (DEC-5): no open
 * blocking comment ⇒ approve and merge; any ⇒ send back, each blocker an
 * acceptance criterion the fix loop runs in place. With no blocker the
 * operator may still send back typed work items (forge-mfv5.1.28) — the
 * typed form REPLACES this card's controls so the page keeps exactly one
 * `verdict-form`. forge-nk1y.33: the HEADLINE counts both sources — open
 * blocking comments and the reviewer's blockers — so it never reads "ready"
 * over an open blocker; the derived verdict still counts comments only, and
 * approve stays possible over a reviewer blocker, de-emphasised, behind the
 * operator's rationale (forge-nk1y.34, REQUIRED then, optional otherwise).
 * After an approve the card is the payoff: reflect on the cycle (`open-reflect`).
 *
 * Contract: [data-component="verdict-form"][data-form-state][data-form-kind]
 * [data-initiative-id][data-ac-count][data-blocking-count][data-submit-error];
 * [data-section="verdict-headline"][data-headline=ready|not-ready]; field
 * `approve-rationale`; actions `approve-and-merge` (data-emphasis) | `send-back`,
 * `compose-send-back`, `open-reflect`.
 */
import Link from 'next/link';
import { useState } from 'react';

import type { DerivedVerdict } from '@/lib/review-comments-client';
import { ReviewVerdictForm } from '@/components/ReviewVerdictForm';
import { disabledAttrs } from '@/lib/disabled-reason';
import { eyebrow, miniBtn } from './styles';

/** The approve rationale when the operator writes none and nothing blocks (forge-nk1y.34: never the old canned line). */
export const DEFAULT_APPROVE_RATIONALE = 'Approved on the visual review — no blocking comments and no reviewer blockers open.';

export type ReviewClaims = {
  present: boolean; missed: number; major: number; blocker: number; reviewedSha?: string; headSha?: string; stale: boolean;
  /** forge-nk1y.39: the latest review attempt produced no findings for the change (it failed at this head). */
  noCurrentReview?: { headSha: string | null; unread?: true };
};

const plural = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;

export function DecisionCard({
  derived, blockerCount, resolvedCount, initiativeId, submitting, submitted, error, composing,
  onCompose, onSubmit, onTypedSubmitted, reflectHref, claims, loadError = null, onJumpToBlocker,
}: {
  derived: DerivedVerdict;
  blockerCount: number;
  resolvedCount: number;
  initiativeId: string;
  submitting: boolean;
  submitted: null | 'approve' | 'send-back';
  error: string | null;
  composing: boolean;
  onCompose: () => void;
  /** The operator's approve rationale, trimmed ('' when none); ignored for a send-back. */
  onSubmit: (rationale: string) => void;
  onTypedSubmitted: (kind: 'approve' | 'send-back') => void;
  reflectHref?: string;
  claims: ReviewClaims;
  /** The comments read failed: the derived verdict is UNKNOWN, so neither verdict may be pressed. */
  loadError?: string | null;
  /** Select / scroll to the first open blocker (absent when there is none). */
  onJumpToBlocker?: () => void;
}): JSX.Element {
  const [rationale, setRationale] = useState('');
  const blockedReason = loadError ? `${loadError} — reload the page; the verdict cannot be derived without them` : submitting ? 'the verdict is being submitted' : null;
  const reviewerBlockers = claims.present ? claims.blocker : 0;
  const blocking = blockerCount + reviewerBlockers;
  const noReview = claims.noCurrentReview;
  // Approving over a reviewer blocker, or with no current review at all, is possible — de-emphasised, behind the operator's reason.
  const overBlocker = derived.kind === 'approve' && (reviewerBlockers > 0 || noReview !== undefined);
  const rationaleNeed = reviewerBlockers > 0
    ? `approve over ${plural(reviewerBlockers, 'open reviewer blocker', 'open reviewer blockers')}`
    : 'approve without a current review';
  const approveReason = blockedReason ?? (overBlocker && rationale.trim() === '' ? `a rationale is required to ${rationaleNeed}` : null);
  const notReady = blocking > 0 || noReview !== undefined;
  const headline = blocking > 0
    ? `Not ready: ${plural(blocking, 'blocking finding', 'blocking findings')}`
    : noReview?.unread
      ? 'Not ready: the review could not be read — reload the page'
      : noReview
      ? `Not ready: no current review — it failed at ${noReview.headSha ? noReview.headSha.slice(0, 7) : 'an unknown head'}`
      : 'Ready to approve and merge';
  const primaryBtn: React.CSSProperties = { flex: 1, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-md)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) var(--space-4)', border: '1px solid var(--ember)', background: 'var(--ember)', color: 'var(--accent-fg)' };
  const secondaryBtn: React.CSSProperties = { ...miniBtn, flex: 1, fontSize: 'var(--text-md)', fontWeight: 600, padding: 'var(--space-2) var(--space-4)', color: 'var(--text)' };
  const card: React.CSSProperties = {
    border: `1px solid ${submitted === 'approve' ? 'var(--green)' : 'var(--ember)'}`, borderRadius: 'var(--radius)',
    background: 'linear-gradient(180deg, rgba(255,158,74,.08), rgba(255,158,74,.02))',
    padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0,
  };
  const title: React.CSSProperties = { margin: 0, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-lg)' };

  if (composing && submitted === null) {
    return (
      <aside style={card}>
        <div style={eyebrow}>Your verdict · send back with work items</div>
        <ReviewVerdictForm initiativeId={initiativeId} initialKind="send-back" onSubmitted={onTypedSubmitted} />
      </aside>
    );
  }

  const formState = submitted ? 'submitted' : submitting ? 'submitting' : 'editing';
  return (
    <aside
      data-component="verdict-form"
      data-form-state={formState}
      data-form-kind={submitted ?? derived.kind}
      data-initiative-id={initiativeId}
      data-ac-count={blockerCount}
      data-blocking-count={blocking}
      data-submit-error={error ?? ''}
      style={card}
    >
      <div style={eyebrow}>Your verdict</div>
      {submitted ? (
        <>
          <h2 style={{ ...title, color: submitted === 'approve' ? 'var(--green)' : 'var(--amber)' }}>
            {submitted === 'approve' ? 'Approved — merged' : 'Sent back'}
          </h2>
          <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--dim)' }}>
            {submitted === 'approve'
              ? 'One last step: reflect on the cycle.'
              : 'The fix loop reruns the develop agent on these criteria in this same cycle — no new cycle starts.'}
          </p>
          {submitted === 'approve' && reflectHref && (
            <Link
              href={reflectHref}
              data-action="open-reflect"
              style={{ alignSelf: 'flex-start', fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-md)', color: 'var(--accent-fg)', background: 'var(--ember)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) var(--space-4)', textDecoration: 'none' }}
            >
              Reflect on this cycle →
            </Link>
          )}
        </>
      ) : (
        <>
          <h2 data-section="verdict-headline" data-headline={notReady ? 'not-ready' : 'ready'} style={{ ...title, color: notReady ? 'var(--amber)' : undefined }}>
            {headline}
          </h2>
          <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--dim)' }}>
            Your comments: <strong style={{ color: blockerCount > 0 ? 'var(--amber)' : 'var(--green)' }}>{blockerCount} blocking open</strong> · {resolvedCount} resolved · the review: <strong style={{ color: reviewerBlockers > 0 ? 'var(--amber)' : 'var(--green)' }}>{plural(reviewerBlockers, 'blocker', 'blockers')}</strong>.
            {overBlocker && ' Send back, or approve over it with your reason below.'}
            {derived.kind === 'approve' ? ' Comment on a criterion or checkpoint below to block it.' : ' Each blocker becomes an acceptance criterion the fix loop runs in place.'}
            {onJumpToBlocker && (
              <>{' '}<button data-action="jump-to-blocking" onClick={onJumpToBlocker} style={{ ...miniBtn, color: 'var(--amber)' }}>Show the first blocker ↓</button></>
            )}
          </p>
          {loadError && <p role="alert" data-comments-load="error" style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--red)' }}>{loadError}. Reload the page before you decide.</p>}
          {derived.kind === 'send-back' && derived.rationale && (
            <pre style={{ margin: 0, maxHeight: 'var(--pane-xs)', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', fontSize: 'var(--text-sm)', color: 'var(--dim)' }}>{derived.rationale}</pre>
          )}
          {claims.present && (claims.missed > 0 || claims.major > 0 || claims.stale) && (
            <p data-section="review-claims" style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--amber)', borderLeft: '2px solid var(--amber)', paddingLeft: 'var(--space-2)' }}>
              The reviewer also reports {plural(claims.missed, 'criterion missed', 'criteria missed')} and {plural(claims.major, 'major finding', 'major findings')}
              {claims.stale && claims.reviewedSha && claims.headSha ? `, judged at ${claims.reviewedSha.slice(0, 7)} — not the head ${claims.headSha.slice(0, 7)}` : ''}. Read them below before you decide.
            </p>
          )}
          {derived.kind === 'approve' && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', fontSize: 'var(--text-sm)', color: 'var(--dim)' }}>
              {overBlocker ? `Why ${rationaleNeed} — required, recorded in the verdict and the PR` : 'Why approve — optional, recorded in the verdict and the PR'}
              <textarea data-field="approve-rationale" value={rationale} onChange={(e) => setRationale(e.target.value)} rows={2} disabled={submitting} style={{ font: 'inherit', fontSize: 'var(--text-sm)', resize: 'vertical' }} />
            </label>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {overBlocker && (
              <button data-action="compose-send-back" onClick={onCompose} {...disabledAttrs(blockedReason)} style={primaryBtn}>
                Send back with work items
              </button>
            )}
            <button
              onClick={() => onSubmit(rationale.trim())}
              {...disabledAttrs(derived.kind === 'approve' ? approveReason : blockedReason)}
              data-action={derived.kind === 'approve' ? 'approve-and-merge' : 'send-back'}
              data-emphasis={overBlocker ? 'secondary' : 'primary'}
              style={overBlocker ? secondaryBtn : primaryBtn}
            >
              {submitting ? 'Submitting…' : derived.kind === 'send-back' ? 'Send back (add work items)' : overBlocker ? 'Approve anyway and merge' : 'Approve and merge'}
            </button>
            {derived.kind === 'approve' && !overBlocker && (
              <button data-action="compose-send-back" onClick={onCompose} {...disabledAttrs(blockedReason)} style={secondaryBtn}>
                Send back with work items
              </button>
            )}
          </div>
          {error && <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--red)' }}>{error}</p>}
          <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--faint)' }}>
            Approve merges the PR into main and cannot be undone from here. Send back runs the fix loop in this same cycle.
          </p>
        </>
      )}
    </aside>
  );
}
