'use client';

import { useState } from 'react';
import { compareWorkItemIds } from '@forge/contracts';

import { deleteKickoffWorkItem, editKickoffWorkItem, type RoadmapWorkItem } from '@/lib/bridge-client';
import { disabledAttrs } from '@/lib/disabled-reason';
import { workItemDraftFrom, workItemDraftMissing, workItemDraftToSource, type WorkItemDraft } from '@/lib/work-item-authoring';
import { WorkItemAuthoringFields } from '@/components/WorkItemAuthoringFields';
import { acButtonStyle } from '@/components/AcceptanceCriteriaRows';

/** `kickoff`: present for a work item ADDED at the gate (the roadmap serves its editable fields). */
export type KickoffWorkItemRef = { id: string; dependsOn: readonly string[]; kickoff?: RoadmapWorkItem['kickoff'] };

/** One checkbox per id (in the order given), `data-field="<fieldPrefix><id>"`. */
export function DepsChecklist({ ids, checked, onToggle, fieldPrefix }: {
  ids: readonly string[]; checked: readonly string[]; onToggle: (id: string) => void; fieldPrefix: string;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 4 }}>
      {ids.map((id) => (
        <label key={id} style={{ fontSize: 12, display: 'inline-flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" data-field={`${fieldPrefix}${id}`} checked={checked.includes(id)} onChange={() => onToggle(id)} />
          {id}
        </label>
      ))}
    </div>
  );
}

/** Toggle `id` in `ids`, keeping the one natural work-item order. */
export const toggleId = (ids: readonly string[], id: string): string[] =>
  (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]).sort(compareWorkItemIds);

type State =
  | { state: 'editing' | 'saving' | 'saved' | 'confirm-delete' | 'deleting' | 'deleted' }
  | { state: 'error'; detail: string };

/**
 * forge-mfv5.1.36 / forge-nk1y.32 (D-48 amended) — edit one work item at the
 * Kickoff gate: pick it; one ADDED at the gate prefills the shared authoring
 * fields and can be deleted (after a confirm); a plan work item edits its
 * dependencies only. The server re-checks
 * the gate under the manifest lock and validates the set; a refusal shows its
 * detail.
 */
export function KickoffEditWorkItem({ initiativeId, workItems, onSaved }: {
  initiativeId: string; workItems: readonly KickoffWorkItemRef[]; onSaved?: () => void | Promise<void>;
}) {
  const ids = workItems.map((w) => w.id).sort(compareWorkItemIds);
  const [wiId, setWiId] = useState('');
  const [deps, setDeps] = useState<string[]>([]);
  const [draft, setDraft] = useState<WorkItemDraft | null>(null); // null = a plan work item (dependencies only)
  const [s, setS] = useState<State>({ state: 'editing' });
  const addedAtGate = (id: string): boolean => workItems.some((w) => w.id === id && w.kickoff !== undefined);

  function pick(id: string): void {
    const wi = workItems.find((w) => w.id === id);
    setWiId(id);
    setDeps([...(wi?.dependsOn ?? [])].sort(compareWorkItemIds));
    setDraft(wi?.kickoff ? workItemDraftFrom(wi.kickoff) : null);
    setS({ state: 'editing' });
  }

  async function onDelete(): Promise<void> {
    setS({ state: 'deleting' });
    const r = await deleteKickoffWorkItem({ initiativeId, workItemId: wiId });
    if (!r.ok) return setS({ state: 'error', detail: r.error });
    setS({ state: 'deleted' });
    setWiId('');
    await onSaved?.();
  }

  async function onSave(): Promise<void> {
    const parsed = draft ? workItemDraftToSource(draft) : null;
    if (parsed && 'error' in parsed) return setS({ state: 'error', detail: parsed.error });
    setS({ state: 'saving' });
    const fields = parsed ? parsed.source : {};
    const r = await editKickoffWorkItem({ initiativeId, workItemId: wiId, ...fields, dependsOn: deps });
    if (!r.ok) return setS({ state: 'error', detail: r.error });
    setS({ state: 'saved' });
    await onSaved?.();
  }

  const busy = s.state === 'saving' || s.state === 'deleting';
  const saveReason = wiId === '' ? 'pick a work item to edit'
    : busy ? 'a change is being saved'
      : draft ? workItemDraftMissing(draft) : null;
  const deleteReason = wiId === '' ? 'pick a work item to delete'
    : !draft ? `${wiId} is a plan work item — only a work item added at the Kickoff gate can be deleted`
      : busy ? 'a change is being saved' : null;
  return (
    <div data-component="kickoff-edit-wi" data-form-state={s.state} style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>Edit work item</div>
      <select data-field="kickoff-edit-wi-id" value={wiId} onChange={(e) => pick(e.target.value)} style={{ fontSize: 12, marginTop: 4 }}>
        <option value="">work item…</option>
        {ids.map((id) => (
          <option key={id} value={id}>
            {id}
            {addedAtGate(id) ? ' (added at the gate)' : ''}
          </option>
        ))}
      </select>
      {wiId !== '' && draft && (
        <div style={{ marginTop: 8 }}>
          <WorkItemAuthoringFields value={draft} onChange={setDraft} fieldPrefix="kickoff-edit" />
        </div>
      )}
      {wiId !== '' && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          {draft ? 'Runs after' : `${wiId} is a plan work item: only what it runs after can change`}
          <DepsChecklist
            ids={ids.filter((id) => id !== wiId)}
            checked={deps}
            onToggle={(id) => setDeps(toggleId(deps, id))}
            fieldPrefix="kickoff-edit-dep-"
          />
        </div>
      )}
      {s.state === 'error' && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: '#f85149' }}>{s.detail}</div>}
      {s.state === 'saved' && <div style={{ marginTop: 8, fontSize: 12 }}>{wiId} saved.</div>}
      {s.state === 'deleted' && <div style={{ marginTop: 8, fontSize: 12 }}>Work item deleted.</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          data-action="save-kickoff-wi"
          onClick={() => void onSave()}
          {...disabledAttrs(saveReason)}
          style={{ ...acButtonStyle, opacity: saveReason ? 0.5 : 1 }}
        >
          {s.state === 'saving' ? 'saving…' : 'save'}
        </button>
        {s.state !== 'confirm-delete' ? (
          <button
            data-action="delete-kickoff-wi"
            onClick={() => setS({ state: 'confirm-delete' })}
            {...disabledAttrs(deleteReason)}
            style={{ ...acButtonStyle, opacity: deleteReason ? 0.5 : 1 }}
          >
            {s.state === 'deleting' ? 'deleting…' : 'delete'}
          </button>
        ) : (
          <>
            <span style={{ fontSize: 12 }}>Delete {wiId}?</span>
            <button
              data-action="confirm-delete-kickoff-wi"
              onClick={() => void onDelete()}
              style={{ ...acButtonStyle, background: '#da3633' }}
            >
              confirm delete
            </button>
            <button data-action="cancel-delete-kickoff-wi" onClick={() => setS({ state: 'editing' })} style={acButtonStyle}>
              cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}
