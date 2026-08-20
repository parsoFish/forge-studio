'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// LibraryItemActions — the shared Edit / Delete action bar every library
// detail page mounts (W7-B4: library-05 skills, library-08 hooks, library-17
// templates; the agent builder reuses the same delete idiom).
//
// Contract (pinned in lib/library-authoring-render.test.ts):
//   [data-component="library-item-actions"][data-kind]
//   [data-action="edit-<kind>"]      aria-pressed mirrors `editing`
//   [data-action="delete-<kind>"]    two-step: arming reveals
//   [data-action="confirm-delete-<kind>"] + [data-action="cancel-delete-<kind>"]
//   [data-component="delete-blocked"] — a server-guarded delete renders the
//     REASON, never a silently dead button.
// ---------------------------------------------------------------------------

export function LibraryItemActions({
  kind,
  id,
  editing,
  onToggleEdit,
  onDelete,
  deleting = false,
  deleteBlockReason = null,
  error = null,
  extra,
}: {
  kind: 'skill' | 'hook' | 'template' | 'agent';
  id: string;
  editing: boolean;
  onToggleEdit: () => void;
  onDelete: () => void;
  deleting?: boolean;
  /** Set when the delete is known-blocked (e.g. still bound/used) — renders
   *  the button disabled WITH the reason. */
  deleteBlockReason?: string | null;
  /** A failed action's error text (the bridge's own message, verbatim). */
  error?: string | null;
  /** Optional extra controls (e.g. Duplicate) rendered between the pair. */
  extra?: ReactNode;
}) {
  const [confirming, setConfirming] = useState(false);
  const blocked = deleteBlockReason !== null && deleteBlockReason !== undefined;

  return (
    <div
      data-component="library-item-actions"
      data-kind={kind}
      data-item-id={id}
      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
    >
      <button
        type="button"
        className="btn btn-sm"
        data-action={`edit-${kind}`}
        aria-pressed={editing ? 'true' : 'false'}
        onClick={onToggleEdit}
      >
        {editing ? 'Close editor' : 'Edit'}
      </button>

      {extra}

      {!confirming && (
        <button
          type="button"
          className="btn btn-sm"
          data-action={`delete-${kind}`}
          disabled={blocked || deleting}
          title={blocked ? deleteBlockReason ?? undefined : undefined}
          onClick={() => setConfirming(true)}
          style={{ color: blocked ? undefined : '#f87171' }}
        >
          Delete
        </button>
      )}
      {confirming && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#f87171' }}>
            Delete {kind} &quot;{id}&quot; permanently?
          </span>
          <button
            type="button"
            className="btn btn-sm"
            data-action={`confirm-delete-${kind}`}
            disabled={deleting}
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
            style={{ background: '#7f1d1d', color: '#fff' }}
          >
            {deleting ? 'Deleting…' : 'Yes, delete'}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            data-action={`cancel-delete-${kind}`}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </span>
      )}

      {blocked && (
        <span
          data-component="delete-blocked"
          style={{ fontSize: 12, color: 'var(--faint)', fontStyle: 'italic' }}
        >
          {deleteBlockReason}
        </span>
      )}
      {error && (
        <span data-component="library-action-error" style={{ fontSize: 12, color: '#f87171' }}>
          {error}
        </span>
      )}
    </div>
  );
}
