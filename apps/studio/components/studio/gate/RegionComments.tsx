'use client';

/**
 * The comment thread anchored to one review region (a criterion or a
 * checkpoint) — moved out of DemoReviewSurface for the verdict gate
 * (forge-mfv5.1.31). A blocking, unresolved comment derives the send-back;
 * every authored comment is editable and deletable (W7-B7, artifact-plan-15:
 * delete is the only way to clear a non-blocking comment), resolve stays for
 * blockers. The data-* keys are the S10 contract: `comment-region`,
 * `comment-body`, `comment-blocking`, `add-comment`, `resolve-comment`,
 * `data-comment-resolved`.
 */
import { useState } from 'react';

import type { ReviewComment } from '@/lib/review-comments-client';
import { input, miniBtn, word } from './styles';

/** Each write resolves true when the bridge accepted it; on false the caller recorded why. */
export type CommentHandlers = {
  onAdd: (region: string, body: string, blocking: boolean) => Promise<boolean>;
  onResolve: (commentId: string) => Promise<boolean>;
  onEdit: (commentId: string, patch: { body?: string; blocking?: boolean }) => Promise<boolean>;
  onDelete: (commentId: string) => Promise<boolean>;
};

export function RegionComments({
  regionId, comments, disabled, handlers, addLabel, onDeleting,
}: {
  regionId: string;
  comments: ReviewComment[];
  disabled: boolean;
  handlers: CommentHandlers;
  addLabel: string;
  /** Called before a delete, so a collapsible parent can pin itself open (the operator is inside it). */
  onDeleting?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [blocking, setBlocking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // The draft is cleared only once the bridge has the comment — a refused write keeps the operator's text.
  async function add(): Promise<void> {
    setSaving(true);
    const ok = await handlers.onAdd(regionId, body.trim(), blocking);
    setSaving(false);
    setFailed(!ok);
    if (ok) { setBody(''); setOpen(false); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
      {comments.length > 0 && (
        <ul data-section="region-comments" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              disabled={disabled}
              handlers={handlers}
              onDelete={(id) => { onDeleting?.(); void handlers.onDelete(id); }}
            />
          ))}
        </ul>
      )}
      {!disabled && (open ? (
        <div data-comment-form data-region={regionId} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <textarea
            data-field="comment-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What needs fixing here? A blocking comment becomes an acceptance criterion the fix loop runs."
            rows={2}
            style={input}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-sm)', color: 'var(--dim)' }}>
            <input data-field="comment-blocking" type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} />
            Blocking — must be fixed before merge
          </label>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button
              data-action="add-comment"
              disabled={!body.trim() || saving}
              onClick={() => void add()}
              style={{ ...miniBtn, color: 'var(--accent-fg)', background: 'var(--ember)', borderColor: 'var(--ember)', opacity: body.trim() && !saving ? 1 : 0.5 }}
            >
              {saving ? 'Adding…' : 'Add comment'}
            </button>
            <button onClick={() => { setOpen(false); setBody(''); setFailed(false); }} style={miniBtn}>Cancel</button>
          </div>
          {failed && <p role="alert" style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--red)' }}>The comment was not saved — the reason is under your verdict. Your text is kept; try again.</p>}
        </div>
      ) : (
        <button data-action="comment-region" data-region={regionId} onClick={() => setOpen(true)} style={{ ...miniBtn, alignSelf: 'flex-start' }}>
          {addLabel}
        </button>
      ))}
    </div>
  );
}

function CommentRow({
  comment: c, disabled, handlers, onDelete,
}: {
  comment: ReviewComment;
  disabled: boolean;
  handlers: CommentHandlers;
  onDelete: (commentId: string) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);
  const [draftBlocking, setDraftBlocking] = useState(c.blocking);
  const row = {
    'data-comment-id': c.id,
    'data-comment-blocking': c.blocking ? 'true' : 'false',
    'data-comment-resolved': c.resolved ? 'true' : 'false',
  };
  const box: React.CSSProperties = {
    fontSize: 'var(--text-sm)', color: 'var(--text)', background: 'var(--bg-2)', border: '1px solid var(--line)',
    borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)',
  };

  if (editing && !disabled) {
    return (
      <li {...row} data-comment-editing="true" style={box}>
        <textarea data-field="comment-edit-body" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} style={input} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--dim)' }}>
          <input type="checkbox" checked={draftBlocking} onChange={(e) => setDraftBlocking(e.target.checked)} />
          Blocking — must be fixed before merge
        </label>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button
            data-action="save-comment-edit"
            disabled={!draft.trim()}
            onClick={() => { void handlers.onEdit(c.id, { body: draft.trim(), blocking: draftBlocking }).then((ok) => { if (ok) setEditing(false); }); }}
            style={{ ...miniBtn, color: 'var(--accent-fg)', background: 'var(--ember)', borderColor: 'var(--ember)', opacity: draft.trim() ? 1 : 0.5 }}
          >
            Save
          </button>
          <button onClick={() => { setEditing(false); setDraft(c.body); setDraftBlocking(c.blocking); }} style={miniBtn}>Cancel</button>
        </div>
      </li>
    );
  }

  return (
    <li {...row} style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <span style={{ ...word, color: c.resolved ? 'var(--green)' : 'var(--amber)' }}>{c.resolved ? 'resolved' : 'open'}</span>
        {c.blocking && <span style={{ ...word, color: 'var(--red)' }}>blocking</span>}
        <span style={{ flex: 1 }} />
        {!disabled && (
          <>
            {c.blocking && !c.resolved && <button data-action="resolve-comment" onClick={() => void handlers.onResolve(c.id)} style={miniBtn}>Resolve</button>}
            <button data-action="edit-comment" onClick={() => { setDraft(c.body); setDraftBlocking(c.blocking); setEditing(true); }} style={miniBtn}>Edit</button>
            <button data-action="delete-comment" onClick={() => onDelete(c.id)} style={miniBtn} title="Remove this comment">Delete</button>
          </>
        )}
      </div>
      <span style={{ overflowWrap: 'anywhere' }}>{c.body}</span>
    </li>
  );
}
