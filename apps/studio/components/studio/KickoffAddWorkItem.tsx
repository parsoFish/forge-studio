'use client';

import { useState } from 'react';

import { addKickoffWorkItem } from '@/lib/bridge-client';
import { disabledAttrs } from '@/lib/disabled-reason';
import { emptyWorkItemDraft, workItemDraftMissing, workItemDraftToSource, type WorkItemDraft } from '@/lib/work-item-authoring';
import { WorkItemAuthoringFields } from '@/components/WorkItemAuthoringFields';
import { acButtonStyle } from '@/components/AcceptanceCriteriaRows';

type Outcome = { state: 'editing' | 'submitting' } | { state: 'added'; workItemId: string; uncovered: string[] } | { state: 'error'; detail: string };

/**
 * forge-nk1y.12 (D-48) — add a plan work item at the Kickoff gate, before the
 * first build. Collapsed in a `<details>` BELOW Start development, so the
 * gate's primary act stays first (D-46). The D-47 coverage the server re-reports
 * is shown, never a refusal; a refusal shows the server's detail.
 */
export function KickoffAddWorkItem({ initiativeId, onAdded }: { initiativeId: string; onAdded?: () => void | Promise<void> }) {
  const [draft, setDraft] = useState<WorkItemDraft>(emptyWorkItemDraft);
  const [outcome, setOutcome] = useState<Outcome>({ state: 'editing' });

  async function onSubmit(): Promise<void> {
    const parsed = workItemDraftToSource(draft);
    if ('error' in parsed) return setOutcome({ state: 'error', detail: parsed.error });
    setOutcome({ state: 'submitting' });
    const r = await addKickoffWorkItem({ initiativeId, ...parsed.source });
    if (!r.ok) return setOutcome({ state: 'error', detail: r.error });
    setOutcome({ state: 'added', workItemId: r.workItemId, uncovered: r.uncoveredAcceptanceCriteria });
    setDraft(emptyWorkItemDraft());
    await onAdded?.();
  }

  const missing = workItemDraftMissing(draft);
  return (
    <details style={{ marginTop: 4 }}>
      <summary style={{ fontSize: 12, cursor: 'pointer' }}>Add work item</summary>
      <div data-component="kickoff-add-work-item" data-initiative-id={initiativeId} data-form-state={outcome.state} style={{ marginTop: 8 }}>
        <WorkItemAuthoringFields value={draft} onChange={setDraft} fieldPrefix="kickoff" />
        {outcome.state === 'error' && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: '#f85149' }}>{outcome.detail}</div>}
        {outcome.state === 'added' && (
          <div data-kickoff-wi-added={outcome.workItemId} data-uncovered-acs={outcome.uncovered.length} style={{ marginTop: 10, fontSize: 12 }}>
            {outcome.workItemId} added — it builds with the rest when development starts.
            {outcome.uncovered.length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#d29922' }}>
                {outcome.uncovered.map((u) => <li key={u}>{u}</li>)}
              </ul>
            )}
          </div>
        )}
        <button
          data-action="add-kickoff-work-item"
          onClick={() => void onSubmit()}
          {...disabledAttrs(outcome.state === 'submitting' ? 'the work item is being added' : missing)}
          style={{ ...acButtonStyle, marginTop: 12, background: '#238636', opacity: missing ? 0.5 : 1 }}
        >
          {outcome.state === 'submitting' ? 'adding…' : 'add work item'}
        </button>
      </div>
    </details>
  );
}
