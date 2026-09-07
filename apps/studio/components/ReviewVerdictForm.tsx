'use client';

import { useState } from 'react';

import { submitVerdict, type AcceptanceCriterion } from '@/lib/bridge-client';
import { disabledAttrs } from '@/lib/disabled-reason';

/**
 * The review human moment (ADR 020) — approve or add work items to a cycle's PR
 * after review. Lives on its own screen (`/review/[cycleId]`), mirroring the
 * architect plan screen; the inline dashboard box was retired. Approve =
 * rationale only; "add work items" = rationale + 1+ `GIVEN/WHEN/THEN` acceptance
 * criteria. POSTs the kept `/api/verdict` bridge route (wire kind stays
 * `send-back` for back-compat). ADR 026: the work items are appended to the
 * unifier's queue and run in the SAME cycle — no send-back to a dev phase, no
 * new cycle.
 */
export function ReviewVerdictForm({
  initiativeId,
  onSubmitted,
  initialKind = 'approve',
}: {
  initiativeId: string;
  onSubmitted?: (kind: 'approve' | 'send-back') => void;
  /**
   * Which verdict the form opens on. Defaults to `approve`, so every existing
   * caller is unchanged.
   *
   * It exists because the acceptance-criteria block renders ONLY on the
   * send-back kind, which made that half of the gate unreachable to anything
   * that cannot click — a server render, and therefore a DOM-contract test
   * (bead `forge-8vfn.7.5.4`). It is also the honest shape for a caller that
   * already knows the operator is sending back, which is where an anchored
   * blocking comment arrives from.
   */
  initialKind?: 'approve' | 'send-back';
}) {
  const [kind, setKind] = useState<'approve' | 'send-back'>(initialKind);
  const [rationale, setRationale] = useState('');
  const [acs, setAcs] = useState<AcceptanceCriterion[]>([{ given: '', when: '', then: '' }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(): Promise<void> {
    setError(null);
    setSubmitting(true);
    try {
      const result =
        kind === 'approve'
          ? await submitVerdict({ kind, initiativeId, rationale: rationale.trim() })
          : await submitVerdict({
              kind,
              initiativeId,
              rationale: rationale.trim(),
              acceptanceCriteria: acs
                .filter((a) => a.given.trim() && a.when.trim() && a.then.trim())
                .map((a) => ({ given: a.given.trim(), when: a.when.trim(), then: a.then.trim() })),
            });
      if (!result.ok) {
        setError(result.error ?? 'submit failed');
        return;
      }
      setSubmitted(true);
      onSubmitted?.(kind);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div
        style={{ ...panelStyle, borderColor: '#3fb950' }}
        data-component="verdict-form"
        data-form-state="submitted"
        data-form-kind={kind}
        data-initiative-id={initiativeId}
      >
        <div style={{ fontSize: 13, color: '#3fb950' }}>
          {kind === 'approve'
            ? 'Approved — the reviewer will close out the cycle.'
            : 'Work items added — the unifier runs them in the same cycle (no new cycle).'}
        </div>
      </div>
    );
  }

  return (
    <div
      style={panelStyle}
      data-component="verdict-form"
      data-form-state={submitting ? 'submitting' : 'editing'}
      data-form-kind={kind}
      data-initiative-id={initiativeId}
      data-ac-count={kind === 'send-back' ? acs.length : 0}
    >
      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px', display: 'flex', gap: 12 }}>
        {/* Bead `forge-8vfn.7.5.4`. The kind pair carried no handle at all, so a
            story could not switch the form and the SEND-BACK HALF OF THE VERDICT
            GATE was unreachable — not untested, unreachable. `data-field` sits on
            the LABEL and `data-verdict-kind` names which one, the shape S9's
            `kickoff-model-tier-option` already established (the DSL resolves the
            label and acts on the input inside it). */}
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          data-field="verdict-kind-option"
          data-verdict-kind="approve"
        >
          <input type="radio" name="kind" checked={kind === 'approve'} onChange={() => setKind('approve')} />
          approve
        </label>
        <label
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}
          data-field="verdict-kind-option"
          data-verdict-kind="send-back"
        >
          <input type="radio" name="kind" checked={kind === 'send-back'} onChange={() => setKind('send-back')} />
          add work items
        </label>
      </fieldset>

      <label style={labelStyle}>
        rationale
        <textarea
          data-field="verdict-rationale"
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder={kind === 'approve' ? 'Why is this mergeable?' : 'What still needs fixing? (runs in the same cycle)'}
          style={inputStyle}
          rows={3}
        />
      </label>

      {kind === 'send-back' && (
        <div style={{ marginTop: 12 }} data-section="acceptance-criteria" data-ac-row-count={acs.length}>
          <div style={labelStyle}>acceptance criteria</div>
          {acs.map((a, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
              <input data-field={`verdict-ac-given-${i + 1}`} placeholder="GIVEN ..." value={a.given} onChange={(e) => setAcs(acs.map((x, j) => (j === i ? { ...x, given: e.target.value } : x)))} style={inputStyle} />
              <input data-field={`verdict-ac-when-${i + 1}`} placeholder="WHEN ..." value={a.when} onChange={(e) => setAcs(acs.map((x, j) => (j === i ? { ...x, when: e.target.value } : x)))} style={inputStyle} />
              <input data-field={`verdict-ac-then-${i + 1}`} placeholder="THEN ..." value={a.then} onChange={(e) => setAcs(acs.map((x, j) => (j === i ? { ...x, then: e.target.value } : x)))} style={inputStyle} />
              <button
                data-action={`remove-criterion-${i + 1}`}
                onClick={() => setAcs(acs.filter((_, j) => j !== i))}
                {...disabledAttrs(acs.length === 1 ? 'a send-back needs at least one acceptance criterion' : null)}
                style={{ ...buttonStyle, background: '#21262d', borderColor: '#30363d' }}
              >
                −
              </button>
            </div>
          ))}
          <button data-action="add-criterion" onClick={() => setAcs([...acs, { given: '', when: '', then: '' }])} style={{ ...buttonStyle, background: '#21262d', borderColor: '#30363d', fontSize: 11 }}>
            + add criterion
          </button>
        </div>
      )}

      {error && <div style={{ marginTop: 10, fontSize: 12, color: '#f85149' }}>{error}</div>}

      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          onClick={() => void onSubmit()}
          // A disabled gate CTA that gives no reason can only be reported by a
          // story as "the press did nothing" — `disabledAttrs` drives disabled,
          // title and `data-disabled-reason` from ONE nullable reason so they
          // cannot drift (`lib/disabled-reason.ts`).
          {...disabledAttrs(
            submitting
              ? 'the verdict is being submitted'
              : !rationale.trim()
                ? 'a rationale is required before a verdict can be submitted'
                : null,
          )}
          data-action={kind === 'approve' ? 'approve-and-merge' : 'send-back'}
          style={{ ...buttonStyle, background: kind === 'approve' ? '#238636' : '#9e6a03', opacity: !rationale.trim() ? 0.5 : 1 }}
        >
          {submitting ? 'submitting…' : kind === 'approve' ? 'approve and merge' : 'add work items'}
        </button>
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 10,
  padding: 16,
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, color: '#8b949e', marginBottom: 6 };
const inputStyle: React.CSSProperties = {
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
const buttonStyle: React.CSSProperties = {
  color: '#fff',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 13,
  cursor: 'pointer',
};
