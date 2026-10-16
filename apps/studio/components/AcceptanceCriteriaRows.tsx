'use client';

import { disabledAttrs } from '@/lib/disabled-reason';
import { emptyCriterionDraft, type AcceptanceCriterionDraft } from '@/lib/work-item-authoring';

/**
 * The GIVEN/WHEN/THEN rows editor (forge-nk1y.12), extracted from
 * `ReviewVerdictForm` so every work-item authoring surface shares ONE editor.
 * Field handles are the prefix + `-ac-given-N` / `-ac-when-N` / `-ac-then-N`;
 * action handles are the action prefix + `add-criterion` / `remove-criterion-N`.
 * The verdict form passes `verdict` and no action prefix, so its DOM is
 * byte-identical to before the extraction.
 *
 * forge-mfv5.1.43 (D-20 amended): each row also carries its falsifying check —
 * `-ac-check-N` (one command, argv), `-ac-expect-N` (pass | fail),
 * `-ac-unset-env-N` and `-ac-requires-env-N` (env var names).
 */
export function AcceptanceCriteriaRows({
  acs,
  onChange,
  fieldPrefix,
  actionPrefix = '',
  lastRowReason,
}: {
  acs: AcceptanceCriterionDraft[];
  onChange: (next: AcceptanceCriterionDraft[]) => void;
  fieldPrefix: string;
  actionPrefix?: string;
  /** Why the last remaining row cannot be removed. */
  lastRowReason: string;
}) {
  const set = (i: number, k: keyof AcceptanceCriterionDraft, v: string) => onChange(acs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div style={{ marginTop: 12 }} data-section="acceptance-criteria" data-ac-row-count={acs.length}>
      <div style={acLabelStyle}>acceptance criteria</div>
      {acs.map((a, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
          <input data-field={`${fieldPrefix}-ac-given-${i + 1}`} placeholder="GIVEN ..." value={a.given} onChange={(e) => set(i, 'given', e.target.value)} style={acInputStyle} />
          <input data-field={`${fieldPrefix}-ac-when-${i + 1}`} placeholder="WHEN ..." value={a.when} onChange={(e) => set(i, 'when', e.target.value)} style={acInputStyle} />
          <input data-field={`${fieldPrefix}-ac-then-${i + 1}`} placeholder="THEN ..." value={a.then} onChange={(e) => set(i, 'then', e.target.value)} style={acInputStyle} />
          <button
            data-action={`${actionPrefix}remove-criterion-${i + 1}`}
            onClick={() => onChange(acs.filter((_, j) => j !== i))}
            {...disabledAttrs(acs.length === 1 ? lastRowReason : null)}
            style={{ ...acButtonStyle, background: '#21262d', borderColor: '#30363d' }}
          >
            −
          </button>
          <input data-field={`${fieldPrefix}-ac-check-${i + 1}`} placeholder="CHECK — one command that proves it (argv, no quotes)" value={a.check} onChange={(e) => set(i, 'check', e.target.value)} style={{ ...acInputStyle, gridColumn: '1 / 3' }} />
          <select data-field={`${fieldPrefix}-ac-expect-${i + 1}`} value={a.expect} onChange={(e) => set(i, 'expect', e.target.value)} style={acInputStyle}>
            <option value="pass">must pass</option>
            <option value="fail">must fail</option>
          </select>
          <span />
          <input data-field={`${fieldPrefix}-ac-unset-env-${i + 1}`} placeholder="unset env (names)" value={a.unsetEnv} onChange={(e) => set(i, 'unsetEnv', e.target.value)} style={acInputStyle} />
          <input data-field={`${fieldPrefix}-ac-requires-env-${i + 1}`} placeholder="requires env (names)" value={a.requiresEnv} onChange={(e) => set(i, 'requiresEnv', e.target.value)} style={acInputStyle} />
        </div>
      ))}
      <button data-action={`${actionPrefix}add-criterion`} onClick={() => onChange([...acs, emptyCriterionDraft()])} style={{ ...acButtonStyle, background: '#21262d', borderColor: '#30363d', fontSize: 11 }}>
        + add criterion
      </button>
    </div>
  );
}

export const acLabelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: '#8b949e', marginBottom: 6 };
export const acInputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#010409',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '8px 10px',
  fontSize: 13,
  fontFamily: 'inherit',
};
export const acButtonStyle: React.CSSProperties = {
  color: '#fff',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
  cursor: 'pointer',
};
