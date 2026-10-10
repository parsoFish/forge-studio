'use client';

import type { WorkItemDraft } from '@/lib/work-item-authoring';
import { AcceptanceCriteriaRows, acInputStyle, acLabelStyle } from './AcceptanceCriteriaRows';

/**
 * The work-item authoring fields (forge-nk1y.12), controlled: summary, GIVEN/
 * WHEN/THEN rows, gate command (argv, whitespace-split) and files in scope (one
 * per line). Every surface that authors a work item renders THIS — the Kickoff
 * gate's add and the verdict gate's send-back (forge-mfv5.1.28) — and parses
 * the draft with `lib/work-item-authoring.ts`. Handles: `<fieldPrefix>-wi-summary`,
 * `<fieldPrefix>-wi-gate-cmd`, `<fieldPrefix>-wi-files`, plus the rows' own.
 */
export function WorkItemAuthoringFields({
  value,
  onChange,
  fieldPrefix,
  actionPrefix = `${fieldPrefix}-`,
  withSummary = true,
  lastRowReason = 'a work item needs at least one acceptance criterion',
}: {
  value: WorkItemDraft;
  onChange: (next: WorkItemDraft) => void;
  fieldPrefix: string;
  actionPrefix?: string;
  /** False on the verdict gate, whose rationale IS the fix WI's summary (forge-mfv5.1.28). */
  withSummary?: boolean;
  /** Why the last criterion row cannot be removed. */
  lastRowReason?: string;
}) {
  return (
    <div data-section="work-item-authoring">
      {withSummary && (
        <label style={acLabelStyle}>
          summary
          <textarea data-field={`${fieldPrefix}-wi-summary`} value={value.summary} rows={3} style={acInputStyle}
            placeholder="What this work item delivers" onChange={(e) => onChange({ ...value, summary: e.target.value })} />
        </label>
      )}
      <AcceptanceCriteriaRows acs={value.acceptanceCriteria} onChange={(acceptanceCriteria) => onChange({ ...value, acceptanceCriteria })}
        fieldPrefix={fieldPrefix} actionPrefix={actionPrefix} lastRowReason={lastRowReason} />
      <label style={{ ...acLabelStyle, marginTop: 12 }}>
        gate command (one command, no quotes — it runs as argv, never through a shell)
        <input data-field={`${fieldPrefix}-wi-gate-cmd`} value={value.gateCmd} style={acInputStyle}
          placeholder="node --test tests/x.test.ts" onChange={(e) => onChange({ ...value, gateCmd: e.target.value })} />
      </label>
      <label style={{ ...acLabelStyle, marginTop: 12 }}>
        files in scope (one path per line)
        <textarea data-field={`${fieldPrefix}-wi-files`} value={value.files} rows={3} style={acInputStyle}
          placeholder="src/x.ts" onChange={(e) => onChange({ ...value, files: e.target.value })} />
      </label>
    </div>
  );
}
