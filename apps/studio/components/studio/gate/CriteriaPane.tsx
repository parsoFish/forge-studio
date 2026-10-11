'use client';

/**
 * Acceptance criteria with the reviewer's verdict on each — the first comment
 * regions on the verdict gate (forge-mfv5.1.31). S10 beats 13/16 press
 * `toggle-region` / `comment-region` / `resolve-comment` inside the FIRST
 * `[data-demo-region]` in document order when none names their text, so this
 * pane renders before the demo. A row's criterion is always fully in the DOM
 * (forge-8vfn.8.1.16: a text scope must find it collapsed) and wraps inside
 * the row — a long inline-code span can never widen the page again.
 */
import { useEffect, useRef, useState } from 'react';

import type { ReviewComment } from '@/lib/review-comments-client';
import type { GateCriterion } from '@/lib/gate-view';
import { regionDefaultOpen } from '@/lib/demo-review-view';
import { RegionComments, type CommentHandlers } from './RegionComments';
import { InlineCode } from './InlineCode';
import { pane, paneHeader, paneTitle, meta, word, wiTag, VERDICT_COLOUR } from './styles';

export function CriteriaPane({
  criteria, comments, disabled, handlers, focusRegion = null,
}: {
  criteria: GateCriterion[];
  comments: ReviewComment[];
  disabled: boolean;
  handlers: CommentHandlers;
  /** A jump request (`jump-to-blocking`): the named row opens and scrolls into view; `seq` re-fires a repeat. */
  focusRegion?: { id: string; seq: number } | null;
}): JSX.Element {
  return (
    <div data-section="ac-verdicts" data-ac-eval-count={criteria.filter((c) => c.verdict !== null).length} style={pane}>
      <header style={paneHeader}>
        <h2 style={paneTitle}>Acceptance criteria</h2>
        <span style={meta}>{criteria.length} · the reviewer&apos;s verdicts · open a row to read it or comment</span>
      </header>
      <div data-pane-body style={{ height: 'var(--pane-md)', overflowY: 'auto', overflowX: 'hidden' }}>
        {criteria.length === 0 && (
          <p style={{ margin: 0, padding: 'var(--space-3) var(--space-4)', fontSize: 'var(--text-sm)', color: 'var(--dim)' }}>
            This initiative declared no acceptance criteria.
          </p>
        )}
        {criteria.map((c) => (
          <CriterionRow
            key={c.regionId}
            criterion={c}
            comments={comments.filter((x) => x.region === c.regionId)}
            defaultOpen={regionDefaultOpen(criteria.length, comments.filter((x) => x.region === c.regionId).length)}
            disabled={disabled}
            handlers={handlers}
            focusSeq={focusRegion?.id === c.regionId ? focusRegion.seq : 0}
          />
        ))}
      </div>
    </div>
  );
}

function CriterionRow({
  criterion: c, comments, defaultOpen, disabled, handlers, focusSeq,
}: {
  criterion: GateCriterion;
  comments: ReviewComment[];
  defaultOpen: boolean;
  disabled: boolean;
  handlers: CommentHandlers;
  focusSeq: number;
}): JSX.Element {
  // null = follow the default (a region gaining its first comment auto-opens); the operator's toggle wins.
  const [override, setOverride] = useState<boolean | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusSeq === 0) return;
    setOverride(true);
    root.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [focusSeq]);
  const expanded = override ?? defaultOpen;
  const verdict = c.verdict ?? 'unjudged';
  const blockingOpen = comments.some((x) => x.blocking && !x.resolved);

  return (
    <div
      ref={root}
      id={`region-${c.regionId}`}
      data-demo-region={c.regionId}
      data-region-comment-count={comments.length}
      data-region-collapsed={expanded ? 'false' : 'true'}
      data-ac-verdict={verdict}
      style={{ borderBottom: '1px solid var(--line)' }}
    >
      <button
        data-action="toggle-region"
        data-region={c.regionId}
        aria-expanded={expanded}
        onClick={() => setOverride(!expanded)}
        style={{
          width: '100%', minWidth: 0, display: 'grid', alignItems: 'baseline', gap: 'var(--space-2)', textAlign: 'left',
          gridTemplateColumns: 'calc(var(--space-6) * 2) calc(var(--space-6) + var(--space-3)) minmax(0, 1fr) auto',
          background: 'none', border: 0, padding: 'var(--space-2) var(--space-4)', cursor: 'pointer', color: 'inherit',
        }}
      >
        <span style={{ ...word, color: VERDICT_COLOUR[verdict] }}>{verdict}</span>
        <span style={wiTag}>{c.wi}</span>
        <span
          data-criterion-text
          title={c.text}
          style={{
            fontSize: 'var(--text-base)', color: 'var(--text)', overflowWrap: 'anywhere', overflow: 'hidden',
            ...(expanded ? {} : { display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' as const }),
          }}
        >
          <InlineCode text={c.text} />
        </span>
        <span style={{ ...meta, whiteSpace: 'nowrap', color: blockingOpen ? 'var(--amber)' : 'var(--dim)' }}>
          {comments.length > 0 ? `${comments.length} comment${comments.length === 1 ? '' : 's'}` : ''}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 var(--space-4) var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--dim)' }}>
          {c.evidence && (
            <p style={{ margin: 0, borderLeft: '2px solid var(--line-2)', paddingLeft: 'var(--space-3)', overflowWrap: 'anywhere' }}>
              <span style={{ ...word, display: 'block', color: 'var(--faint)' }}>Reviewer&apos;s evidence</span>
              <InlineCode text={c.evidence} />
            </p>
          )}
          <RegionComments
            regionId={c.regionId}
            comments={comments}
            disabled={disabled}
            handlers={handlers}
            addLabel="Comment on this criterion"
            onDeleting={() => setOverride(true)}
          />
        </div>
      )}
    </div>
  );
}
