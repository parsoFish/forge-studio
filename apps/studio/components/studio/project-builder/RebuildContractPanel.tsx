'use client';

import { useCallback, useState } from 'react';

import {
  previewProjectContractReset,
  applyProjectContractReset,
  type ContractDrift,
} from '@/lib/studio-client-reset';
import { disabledAttrs } from '@/lib/disabled-reason';

/**
 * S3 (1.0.md §3) — Studio's "Rebuild contract" control + the drift-report
 * surface the operator reads BEFORE applying it (`_1.0/stories/S3.md`: "the
 * drift report has no surface at all" today — this component is that
 * surface, built alongside the control rather than after it).
 *
 * FLOW, progressive disclosure (mirrors `ContractResolutionPanel`'s own
 * stage shape, one level simpler):
 *   1. `[data-action="rebuild-contract"]` computes the drift report
 *      (`POST .../contract-reset`, writes nothing) and shows it.
 *   2. A project with NO persisted `appType` (an onboarded project —
 *      `terraform-provider-betterado`, S3's own ground) cannot be diffed
 *      against a starter; the server throws `AppTypeUnresolvedError` and
 *      answers 400 with `availableAppTypes` (never a bare 500 — see
 *      `bridge-studio-project-reset.ts`'s header). This renders the
 *      `[data-field="rebuild-app-type"]` select, populated from exactly
 *      that list, plus a re-preview action — the CONTROL supplies the
 *      choice a project with a persisted appType never needs to make.
 *   3. Once a report comes back, `[data-section="contract-drift"]` lists
 *      every row's section + action so the operator reads what will change
 *      before confirming.
 *   4. `[data-action="apply-contract-reset"]` applies it
 *      (`POST .../contract-reset/apply`, recomputed server-side fresh —
 *      never the previewed report round-tripped back) and reports the
 *      result; `onApplied` lets the project page reload its own project +
 *      preflight state off a real success, not off this panel's local copy.
  *
 * WHY `onApplied` IS THE PAGE'S `reload`, not a local state update. The drift
 * this panel exists to surface is a project's bound skills / testProcess /
 * demoProcess / releaseProcess drifting away from the CURRENT template
 * WITHOUT failing a single preflight clause — so after an apply, the skill
 * chips and the resolution panel must re-read from the server off the same
 * `loadKey` bump a page Retry uses. Patching a local copy of the result would
 * make S3's beats 5 and 6 go green because this component said so, rather
 * than because the contract on disk actually changed.
*/

type Phase = 'idle' | 'computing' | 'needs-app-type' | 'preview' | 'applying' | 'applied';

export function RebuildContractPanel({
  projectId,
  onApplied,
}: {
  projectId: string;
  /** Called once an apply succeeds — the project page reloads project +
   *  preflight state so the skill chips (`SkillsBind`) and the resolution
   *  panel (`ContractResolutionPanel`) reflect the rebuild immediately. */
  onApplied?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [drift, setDrift] = useState<ContractDrift | null>(null);
  const [availableAppTypes, setAvailableAppTypes] = useState<string[]>([]);
  const [appType, setAppType] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{ appliedCount: number; skillMovesAppliedCount: number; preflightOk: boolean } | null>(null);

  const preview = useCallback(async () => {
    setPhase('computing');
    setError(null);
    const r = await previewProjectContractReset(projectId, appType || undefined);
    if (r.ok && r.drift) {
      setDrift(r.drift);
      setApplyResult(null);
      setPhase('preview');
      return;
    }
    if (r.availableAppTypes && r.availableAppTypes.length > 0) {
      setAvailableAppTypes(r.availableAppTypes);
      setPhase('needs-app-type');
      return;
    }
    setError(r.error ?? 'could not compute the drift report');
    setPhase('idle');
  }, [projectId, appType]);

  const apply = useCallback(async () => {
    setPhase('applying');
    setError(null);
    const r = await applyProjectContractReset(projectId, appType || undefined);
    if (r.ok) {
      setApplyResult({
        appliedCount: r.appliedCount ?? 0,
        skillMovesAppliedCount: r.skillMovesAppliedCount ?? 0,
        preflightOk: r.preflightOk === true,
      });
      setDrift(null);
      setPhase('applied');
      onApplied?.();
      return;
    }
    if (r.availableAppTypes && r.availableAppTypes.length > 0) {
      setAvailableAppTypes(r.availableAppTypes);
      setPhase('needs-app-type');
      return;
    }
    setError(r.error ?? 'apply failed');
    setPhase('preview');
  }, [projectId, appType, onApplied]);

  const busy = phase === 'computing' || phase === 'applying';

  return (
    <section
      data-section="rebuild-contract"
      style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}
    >
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>
        Rebuild contract
      </div>
      <div style={{ fontSize: 11, color: 'var(--faint)', marginBottom: 8, lineHeight: 1.5 }}>
        Regenerates the mechanisms forge owns — testProcess, demoProcess, releaseProcess, skill wiring —
        from the current project template. The north star, instructions and secrets are never touched.
      </div>

      <button
        data-action="rebuild-contract"
        style={{ fontSize: 11.5, padding: '5px 11px', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer' }}
        {...disabledAttrs(busy ? 'a drift computation or apply is already in flight' : null)}
        onClick={() => void preview()}
      >
        {phase === 'computing' ? 'Computing drift…' : 'Rebuild contract'}
      </button>

      {phase === 'needs-app-type' && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 6 }}>
            This project has no persisted app type — pick the template to diff against:
          </div>
          <select
            data-field="rebuild-app-type"
            value={appType}
            onChange={(e) => setAppType(e.target.value)}
            style={{ fontSize: 12, padding: '4px 8px', marginRight: 8, background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5 }}
          >
            <option value="">Choose an app type…</option>
            {availableAppTypes.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button
            data-action="preview-contract-reset"
            style={{ fontSize: 11.5, padding: '5px 11px', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer' }}
            {...disabledAttrs(busy ? 'computing' : appType === '' ? 'choose an app type first' : null)}
            onClick={() => void preview()}
          >
            Preview drift
          </button>
        </div>
      )}

      {error && (
        <div data-section="rebuild-contract-error" style={{ fontSize: 11, color: 'var(--red)', marginTop: 8 }}>
          {error}
        </div>
      )}

      {drift && (
        <div
          data-section="contract-drift"
          data-drift-row-count={drift.rows.length}
          data-drift-skill-move-count={drift.skillMoves.length}
          style={{ marginTop: 10 }}
        >
          <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 6 }}>
            Drift report — read this before applying:
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 8 }}>
            {drift.rows.map((row) => (
              <div
                key={row.section}
                data-drift-row={row.section}
                data-drift-action={row.action}
                style={{ display: 'flex', gap: 8, fontSize: 11, fontFamily: 'var(--font-mono)', color: row.action === 'regenerate' || row.action === 'add' ? 'var(--amber)' : 'var(--faint)' }}
              >
                <span style={{ flex: 1 }}>{row.section}</span>
                <span>{row.action}</span>
              </div>
            ))}
          </div>
          {drift.skillMoves.length > 0 && (
            <div style={{ fontSize: 10.5, color: 'var(--faint)', marginBottom: 8 }}>
              {drift.skillMoves.length} skill{drift.skillMoves.length === 1 ? '' : 's'} would relocate to .forge/skills/
            </div>
          )}
          <button
            data-action="apply-contract-reset"
            style={{ fontSize: 11.5, padding: '5px 11px', background: 'var(--ember)', color: 'var(--bg)', border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 600 }}
            {...disabledAttrs(busy ? 'a drift computation or apply is already in flight' : null)}
            onClick={() => void apply()}
          >
            {phase === 'applying' ? 'Applying…' : 'Apply rebuild'}
          </button>
        </div>
      )}

      {applyResult && (
        <div
          data-section="contract-drift-applied"
          data-applied-count={applyResult.appliedCount}
          data-skill-moves-applied-count={applyResult.skillMovesAppliedCount}
          data-preflight-ok={applyResult.preflightOk ? 'true' : 'false'}
          style={{ fontSize: 11, color: 'var(--dim)', marginTop: 10 }}
        >
          Rebuild applied — {applyResult.appliedCount} section{applyResult.appliedCount === 1 ? '' : 's'} regenerated,{' '}
          {applyResult.skillMovesAppliedCount} skill{applyResult.skillMovesAppliedCount === 1 ? '' : 's'} relocated.
        </div>
      )}
    </section>
  );
}
