'use client';

import { useState } from 'react';
import { compareWorkItemIds } from '@forge/contracts';

import { editKickoffWorkItemDeps } from '@/lib/bridge-client';
import { disabledAttrs } from '@/lib/disabled-reason';
import { acButtonStyle } from '@/components/AcceptanceCriteriaRows';

export type KickoffWorkItemRef = { id: string; dependsOn: readonly string[] };

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

type State = { state: 'editing' | 'saving' | 'saved' } | { state: 'error'; detail: string };

/**
 * forge-mfv5.1.36 (D-48 amended) — edit one work item's dependencies at the
 * Kickoff gate: pick it, check what it runs after, Save. The server re-checks
 * the gate under the manifest lock and validates the set (unknown id, self,
 * cycle); a refusal shows its detail.
 */
export function KickoffEditDeps({ initiativeId, workItems, onSaved }: {
  initiativeId: string; workItems: readonly KickoffWorkItemRef[]; onSaved?: () => void | Promise<void>;
}) {
  const ids = workItems.map((w) => w.id).sort(compareWorkItemIds);
  const [wiId, setWiId] = useState('');
  const [deps, setDeps] = useState<string[]>([]);
  const [s, setS] = useState<State>({ state: 'editing' });

  function pick(id: string): void {
    setWiId(id);
    setDeps([...(workItems.find((w) => w.id === id)?.dependsOn ?? [])].sort(compareWorkItemIds));
    setS({ state: 'editing' });
  }

  async function onSave(): Promise<void> {
    setS({ state: 'saving' });
    const r = await editKickoffWorkItemDeps({ initiativeId, workItemId: wiId, dependsOn: deps });
    if (!r.ok) return setS({ state: 'error', detail: r.error });
    setS({ state: 'saved' });
    await onSaved?.();
  }

  const reason = wiId === '' ? 'pick a work item to edit' : s.state === 'saving' ? 'the dependencies are being saved' : null;
  return (
    <div data-component="kickoff-edit-deps" data-form-state={s.state} style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>Edit dependencies</div>
      <select data-field="kickoff-deps-wi" value={wiId} onChange={(e) => pick(e.target.value)} style={{ fontSize: 12, marginTop: 4 }}>
        <option value="">work item…</option>
        {ids.map((id) => <option key={id} value={id}>{id}</option>)}
      </select>
      {wiId !== '' && <DepsChecklist ids={ids.filter((id) => id !== wiId)} checked={deps} onToggle={(id) => setDeps(toggleId(deps, id))} fieldPrefix="kickoff-dep-" />}
      {s.state === 'error' && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: '#f85149' }}>{s.detail}</div>}
      {s.state === 'saved' && <div style={{ marginTop: 8, fontSize: 12 }}>{wiId} runs after {deps.length > 0 ? deps.join(', ') : 'nothing — it is a root'}.</div>}
      <button data-action="save-kickoff-deps" onClick={() => void onSave()} {...disabledAttrs(reason)}
        style={{ ...acButtonStyle, marginTop: 8, opacity: reason ? 0.5 : 1 }}>
        {s.state === 'saving' ? 'saving…' : 'save dependencies'}
      </button>
    </div>
  );
}
