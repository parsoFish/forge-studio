'use client';

/**
 * The verdict decision (forge-mfv5.1.31) — the gate control, inside viewport 1.
 *
 * The verdict is DERIVED from the operator's comments (DEC-5): no open
 * blocking comment ⇒ approve and merge; any ⇒ send back, each blocker an
 * acceptance criterion the fix loop runs in place. With no blocker the
 * operator may still send back typed work items (forge-mfv5.1.28) — the
 * typed form REPLACES this card's controls so the page keeps exactly one
 * `verdict-form`. The reviewer's open claims are named beside the derived
 * verdict but never counted into it (R4-08-F3: claims, not a gate). After an
 * approve the card is the payoff: reflect on the cycle (`open-reflect`).
 *
 * Contract: [data-component="verdict-form"][data-form-state][data-form-kind]
 * [data-initiative-id][data-ac-count][data-submit-error]; actions
 * `approve-and-merge` | `send-back`, `compose-send-back`, `open-reflect`.
 */
import Link from 'next/link';

import type { DerivedVerdict } from '@/lib/review-comments-client';
import { ReviewVerdictForm } from '@/components/ReviewVerdictForm';
import { disabledAttrs } from '@/lib/disabled-reason';
import { eyebrow, miniBtn } from './styles';

export type ReviewClaims = { present: boolean; missed: number; major: number; blocker: number; reviewedSha?: string; headSha?: string; stale: boolean };

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
  onSubmit: () => void;
  onTypedSubmitted: (kind: 'approve' | 'send-back') => void;
  reflectHref?: string;
  claims: ReviewClaims;
  /** The comments read failed: the derived verdict is UNKNOWN, so neither verdict may be pressed. */
  loadError?: string | null;
  /** Select / scroll to the first open blocker (absent when there is none). */
  onJumpToBlocker?: () => void;
}): JSX.Element {
  const blockedReason = loadError ? `${loadError} — reload the page; the verdict cannot be derived without them` : submitting ? 'the verdict is being submitted' : null;
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
          <h2 style={title}>
            {derived.kind === 'approve' ? 'Ready to approve and merge' : `${plural(blockerCount, 'blocking comment', 'blocking comments')} — send back`}
          </h2>
          <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--dim)' }}>
            Derived from your comments: <strong style={{ color: blockerCount > 0 ? 'var(--amber)' : 'var(--green)' }}>{blockerCount} blocking open</strong> · {resolvedCount} resolved.
            {derived.kind === 'approve' ? ' Comment on a criterion or checkpoint below to block it.' : ' Each blocker becomes an acceptance criterion the fix loop runs in place.'}
            {onJumpToBlocker && (
              <>{' '}<button data-action="jump-to-blocking" onClick={onJumpToBlocker} style={{ ...miniBtn, color: 'var(--amber)' }}>Show the first blocker ↓</button></>
            )}
          </p>
          {loadError && <p role="alert" data-comments-load="error" style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--red)' }}>{loadError}. Reload the page before you decide.</p>}
          {derived.kind === 'send-back' && derived.rationale && (
            <pre style={{ margin: 0, maxHeight: 'var(--pane-xs)', overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit', fontSize: 'var(--text-sm)', color: 'var(--dim)' }}>{derived.rationale}</pre>
          )}
          {claims.present && (claims.missed > 0 || claims.major > 0 || claims.blocker > 0 || claims.stale) && (
            <p data-section="review-claims" style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--amber)', borderLeft: '2px solid var(--amber)', paddingLeft: 'var(--space-2)' }}>
              The reviewer&apos;s claims are not counted here: {plural(claims.missed, 'criterion missed', 'criteria missed')}, {plural(claims.blocker, 'blocker', 'blockers')}, {plural(claims.major, 'major finding', 'major findings')}
              {claims.stale && claims.reviewedSha && claims.headSha ? `, judged at ${claims.reviewedSha.slice(0, 7)} — not the head ${claims.headSha.slice(0, 7)}` : ''}. Read them below before you decide.
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              onClick={onSubmit}
              {...disabledAttrs(blockedReason)}
              data-action={derived.kind === 'approve' ? 'approve-and-merge' : 'send-back'}
              style={{ flex: 1, fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 'var(--text-md)', cursor: 'pointer', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) var(--space-4)', border: '1px solid var(--ember)', background: 'var(--ember)', color: 'var(--accent-fg)' }}
            >
              {submitting ? 'Submitting…' : derived.kind === 'approve' ? 'Approve and merge' : 'Send back (add work items)'}
            </button>
            {derived.kind === 'approve' && (
              <button data-action="compose-send-back" onClick={onCompose} {...disabledAttrs(blockedReason)} style={{ ...miniBtn, flex: 1, fontSize: 'var(--text-md)', fontWeight: 600, padding: 'var(--space-2) var(--space-4)', color: 'var(--text)' }}>
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
