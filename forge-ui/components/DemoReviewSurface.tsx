'use client';

/**
 * S7 / DEC-5 — the interactive review page. Replaces the textarea verdict form
 * with a comment-on-page visual demo: the F4 DEMO.md rendered in a sandboxed
 * iframe, plus per-`data-demo-region` evidence (before/after slider, JSON diff,
 * per-AC outcome) that the reviewer anchors W3C-annotation-style comments to.
 * The verdict (approve / send-back) is DERIVED over the comments — any blocking,
 * unresolved comment ⇒ send-back, mapping each concern to a GIVEN/WHEN/THEN that
 * the ADR-026 in-place drain runs in the SAME cycle (no requeue, same cycleId).
 *
 * The derived-verdict bar preserves the `data-component="verdict-form"` contract
 * (data-form-state / data-form-kind / data-action / data-initiative-id /
 * data-ac-count) the journey harness depends on.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import type { DemoModel, DemoModelCheckpoint, DemoApiDiffEntry, DemoAcEvaluation } from '@/lib/bridge-client';
import { submitVerdict } from '@/lib/bridge-client';
import {
  fetchReviewComments,
  fetchDemoMarkdown,
  addReviewComment,
  resolveReviewComment,
  isResponse,
  type ReviewComment,
  type DerivedVerdict,
} from '@/lib/review-comments-client';
import { renderDemoMarkdownDoc } from '@/lib/render-markdown';
import { BeforeAfterSlider, JsonDiffView } from './review/evidence';

type Region = {
  id: string;
  title: string;
  render: () => JSX.Element;
};

export function DemoReviewSurface({
  model,
  cycleId,
  initiativeId,
  onSubmitted,
}: {
  model: DemoModel;
  cycleId: string;
  initiativeId: string;
  onSubmitted?: (kind: 'approve' | 'send-back') => void;
}): JSX.Element {
  const [comments, setComments] = useState<ReviewComment[]>([]);
  const [derived, setDerived] = useState<DerivedVerdict>({ kind: 'approve' });
  const [markdownDoc, setMarkdownDoc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<null | 'approve' | 'send-back'>(null);
  const [error, setError] = useState<string | null>(null);

  // Load comments + the DEMO.md narrative.
  useEffect(() => {
    let live = true;
    fetchReviewComments(cycleId).then((r) => { if (live) { setComments(r.comments); setDerived(r.derivedVerdict); } });
    fetchDemoMarkdown(cycleId).then((mdText) => {
      if (live) setMarkdownDoc(renderDemoMarkdownDoc(mdText || fallbackMarkdown(model)));
    });
    return () => { live = false; };
  }, [cycleId, model]);

  const refresh = useCallback((next: { comments: ReviewComment[]; derivedVerdict: DerivedVerdict }) => {
    setComments(next.comments);
    setDerived(next.derivedVerdict);
  }, []);

  const onAddComment = useCallback(
    async (region: string, body: string, blocking: boolean) => {
      const r = await addReviewComment(cycleId, { region, body, blocking });
      if (isResponse(r)) refresh(r);
      else setError(r.error);
    },
    [cycleId, refresh],
  );

  const onResolve = useCallback(
    async (commentId: string) => {
      const r = await resolveReviewComment(cycleId, commentId);
      if (isResponse(r)) refresh(r);
      else setError(r.error);
    },
    [cycleId, refresh],
  );

  const regions = useMemo(() => buildRegions(model, cycleId), [model, cycleId]);
  const blockerCount = comments.filter((c) => c.blocking && !c.resolved).length;

  // The verdict route validates the INIT-YYYY-MM-DD-slug id. When the run object
  // didn't carry one, `initiativeId` can arrive as the full cycleId
  // (`<timestamp>_<initiativeId>`) — recover the real id so the POST never 400s.
  const verdictInitiativeId = effectiveInitiativeId(initiativeId, cycleId);

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
            });
      if (!result.ok) { setError(result.error ?? 'submit failed'); return; }
      setSubmitted(derived.kind);
      onSubmitted?.(derived.kind);
    } finally {
      setSubmitting(false);
    }
  }

  const formState = submitted ? 'submitted' : submitting ? 'submitting' : 'editing';

  return (
    <div data-component="demo-review-surface" data-cycle-id={cycleId} data-comment-count={comments.length} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* The F4 DEMO.md narrative, rendered + sanitized into a no-JS sandbox iframe. */}
      <section data-section="demo-narrative">
        <SectionLabel>Demo</SectionLabel>
        <iframe
          data-demo-markdown
          title="DEMO.md"
          sandbox=""
          srcDoc={markdownDoc}
          style={{ width: '100%', height: 340, border: '1px solid #21262d', borderRadius: 8, background: '#0b0f14' }}
        />
      </section>

      {/* Per-region evidence + anchored comment threads. */}
      <section data-section="demo-regions" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {regions.map((r) => (
          <ReviewRegion
            key={r.id}
            region={r}
            comments={comments.filter((c) => c.region === r.id)}
            disabled={submitted !== null}
            onAdd={onAddComment}
            onResolve={onResolve}
          />
        ))}
      </section>

      {error && <div style={{ fontSize: 12, color: '#f85149' }}>{error}</div>}

      {/* Derived verdict — preserves the verdict-form data-* contract. */}
      <div
        data-component="verdict-form"
        data-form-state={formState}
        data-form-kind={derived.kind}
        data-initiative-id={verdictInitiativeId}
        data-ac-count={blockerCount}
        data-submit-error={error ?? ''}
        style={{ border: `1px solid ${derived.kind === 'send-back' ? '#9e6a03' : '#238636'}`, borderRadius: 10, padding: 16, background: '#0d1117' }}
      >
        {submitted ? (
          <div style={{ fontSize: 13, color: submitted === 'approve' ? '#3fb950' : '#d29922' }}>
            {submitted === 'approve'
              ? 'Approved — merged. The reflector closes out the cycle.'
              : 'Sent back — the unifier drains the work items in the SAME cycle (no new cycle).'}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: '#c9d1d9', marginBottom: 10 }}>
              {derived.kind === 'approve' ? (
                <>No blocking comments — this is <strong style={{ color: '#3fb950' }}>ready to approve & merge</strong>.</>
              ) : (
                <>
                  <strong style={{ color: '#d29922' }}>{blockerCount}</strong> blocking comment{blockerCount === 1 ? '' : 's'} ⇒ <strong>send back</strong>.
                  Each becomes an acceptance criterion the unifier runs in place:
                  <pre style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 12, color: '#8b949e', fontFamily: 'inherit' }}>{derived.rationale}</pre>
                </>
              )}
            </div>
            <button
              onClick={() => void onSubmit()}
              disabled={submitting}
              data-action={derived.kind === 'approve' ? 'approve-and-merge' : 'send-back'}
              style={{
                color: '#fff', border: '1px solid #30363d', borderRadius: 6, padding: '7px 16px',
                fontSize: 13, cursor: 'pointer', background: derived.kind === 'approve' ? '#238636' : '#9e6a03',
              }}
            >
              {submitting ? 'submitting…' : derived.kind === 'approve' ? 'approve and merge' : 'send back (add work items)'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Region builder
// --------------------------------------------------------------------------

function buildRegions(model: DemoModel, _cycleId: string): Region[] {
  const regions: Region[] = [];

  // 1. Per-AC outcome (the prime comment anchors).
  (model.acEvaluations ?? []).forEach((e, i) => {
    regions.push({
      id: `ac-${i + 1}`,
      title: `AC ${i + 1} — ${e.verdict.toUpperCase()}`,
      render: () => <AcEvidence evaluation={e} />,
    });
  });

  // 2. Checkpoints — before/after slider when both images exist, else notes.
  (model.checkpoints ?? []).forEach((c, i) => {
    regions.push({
      id: `checkpoint-${i + 1}`,
      title: c.caption || c.label || `Checkpoint ${i + 1}`,
      render: () => <CheckpointEvidence cp={c} />,
    });
  });

  // 3. API / behaviour diffs — structural JSON diff.
  (model.apiDiff ?? []).forEach((d, i) => {
    regions.push({
      id: `apidiff-${i + 1}`,
      title: `${d.name} (${d.change})`,
      render: () => <JsonDiffView before={d.before} after={d.after} />,
    });
  });

  return regions;
}

function AcEvidence({ evaluation }: { evaluation: DemoAcEvaluation }): JSX.Element {
  const colour = evaluation.verdict === 'met' ? '#2ea043' : evaluation.verdict === 'partial' ? '#d29922' : '#f85149';
  return (
    <div>
      <div style={{ fontSize: 13, color: '#c9d1d9' }} data-ac-verdict={evaluation.verdict}>{evaluation.criterion}</div>
      <div style={{ marginTop: 6, fontSize: 12, color: '#8b949e' }}>
        <span style={{ color: colour, fontWeight: 600, textTransform: 'uppercase' }}>{evaluation.verdict}</span>
        {' — '}{evaluation.evidence}
      </div>
    </div>
  );
}

function CheckpointEvidence({ cp }: { cp: DemoModelCheckpoint }): JSX.Element {
  if (cp.beforeImage && cp.afterImage) {
    return <BeforeAfterSlider before={cp.beforeImage} after={cp.afterImage} />;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 13, color: '#c9d1d9' }}>
      <div><div style={noteLabel}>before</div>{cp.beforeNote ?? '—'}</div>
      <div><div style={noteLabel}>after</div>{cp.afterNote ?? '—'}</div>
    </div>
  );
}

// --------------------------------------------------------------------------
// Region card with anchored comments
// --------------------------------------------------------------------------

function ReviewRegion({
  region,
  comments,
  disabled,
  onAdd,
  onResolve,
}: {
  region: Region;
  comments: ReviewComment[];
  disabled: boolean;
  onAdd: (region: string, body: string, blocking: boolean) => void;
  onResolve: (commentId: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [blocking, setBlocking] = useState(true);

  return (
    <div
      data-demo-region={region.id}
      data-region-comment-count={comments.length}
      style={{ border: '1px solid #21262d', borderRadius: 8, padding: 14, background: '#0b0f14' }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, color: '#8b949e', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{region.title}</div>
      {region.render()}

      {/* Existing comments. */}
      {comments.length > 0 && (
        <ul data-section="region-comments" style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {comments.map((c) => (
            <li
              key={c.id}
              data-comment-id={c.id}
              data-comment-blocking={c.blocking ? 'true' : 'false'}
              data-comment-resolved={c.resolved ? 'true' : 'false'}
              style={{
                fontSize: 12, color: '#c9d1d9', borderLeft: `3px solid ${c.resolved ? '#2ea043' : c.blocking ? '#d29922' : '#30363d'}`,
                padding: '4px 10px', background: '#0d1117', borderRadius: '0 4px 4px 0',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ flex: 1 }}>
                {c.blocking && <span style={{ color: '#d29922', fontWeight: 600 }}>[blocking] </span>}
                {c.body}
              </span>
              {c.blocking && !c.resolved && !disabled && (
                <button data-action="resolve-comment" onClick={() => onResolve(c.id)} style={miniBtn}>resolve</button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Add-comment affordance. */}
      {!disabled && (
        open ? (
          <div data-comment-form data-region={region.id} style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              data-field="comment-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What needs fixing here? (a blocking comment becomes an acceptance criterion the unifier runs)"
              rows={2}
              style={inputStyle}
            />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#8b949e' }}>
              <input data-field="comment-blocking" type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
              blocking (must be addressed before merge)
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                data-action="add-comment"
                disabled={!body.trim()}
                onClick={() => { onAdd(region.id, body.trim(), blocking); setBody(''); setOpen(false); }}
                style={{ ...miniBtn, background: '#1f6feb', borderColor: '#1f6feb', opacity: body.trim() ? 1 : 0.5 }}
              >
                add comment
              </button>
              <button onClick={() => { setOpen(false); setBody(''); }} style={miniBtn}>cancel</button>
            </div>
          </div>
        ) : (
          <button data-action="comment-region" data-region={region.id} onClick={() => setOpen(true)} style={{ ...miniBtn, marginTop: 10 }}>
            + comment
          </button>
        )
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): JSX.Element {
  return <div style={{ fontSize: 12, fontWeight: 600, color: '#8b949e', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>{children}</div>;
}

/**
 * Recover the initiative id for the verdict route. The id is preferred as-is when
 * it already looks like an initiative id; otherwise it's pulled out of the
 * `<timestamp>_<initiativeId>` cycle id (the timestamp segment carries no `_`).
 */
function effectiveInitiativeId(initiativeId: string, cycleId: string): string {
  if (/^INIT-/.test(initiativeId)) return initiativeId;
  const idx = cycleId.indexOf('_');
  const fromCycle = idx >= 0 ? cycleId.slice(idx + 1) : cycleId;
  return /^INIT-/.test(fromCycle) ? fromCycle : initiativeId;
}

/** Minimal fallback markdown when no DEMO.md is served yet (keeps the iframe non-empty). */
function fallbackMarkdown(model: DemoModel): string {
  const lines = [`# ${model.title}`, '', `> ${model.essence}`, ''];
  if (model.acEvaluations?.length) {
    lines.push('## Intent & Outcome', '');
    model.acEvaluations.forEach((e, i) => lines.push(`${i + 1}. **${e.verdict.toUpperCase()}** — ${e.criterion}`));
  }
  return lines.join('\n');
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', background: '#010409', color: '#e6edf3',
  border: '1px solid #30363d', borderRadius: 6, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit',
};
const miniBtn: React.CSSProperties = {
  color: '#fff', background: '#21262d', border: '1px solid #30363d', borderRadius: 6,
  padding: '4px 10px', fontSize: 11, cursor: 'pointer',
};
const noteLabel: React.CSSProperties = { fontSize: 10, color: '#6e7681', marginBottom: 3, textTransform: 'uppercase' };
