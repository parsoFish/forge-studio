'use client';

import { DemoStageHandoff } from '@/components/studio/session/DemoStageHandoff';
import type { ContractBuildoutView } from '@/lib/session-artifact-view';
import type { ContractStageRow } from '@/lib/session-client';

// ---------------------------------------------------------------------------
// ContractBuildout — the onboarding/creation session's stage-aware artifact
// renderer (R4-17). Presentational only: `contractBuildoutView`
// (lib/session-artifact-view.ts) owns every bit of derived state (which mode,
// which rows) — this component just renders its output, mirroring the
// FilePackage/GenerationGallery convention of a pure lib module plus a thin
// component.
//
// Mirrors the retired studio-endstate-v2 views-session.jsx's stage-aware
// sub-views exactly (provenance: docs/reference/studio-copy.md): the `contract` stage's CHECKLIST (`:139-157`, the
// "which components are present" readiness overview — reuses the SAME
// `.readiness-list`/`.readiness-item`/`.ri-dot` classes ReadinessPanel.tsx
// already ships, not a bespoke checklist styling); every other stage's own
// row DETAIL (`:80-138`).
//
// D11 (binding): a row states artifact PRESENCE, never a clause verdict —
// this component renders exactly what the row says ("present"/"absent",
// source, detail lines, byte count) and never re-derives or upgrades that
// into pass/fail language.
//
// D3 (binding, security): the secrets stage's `detail` array is NAMES ONLY —
// the wire payload never carries a value. This component renders each name
// plainly and never invents a placeholder VALUE (no "••••••", no fabricated
// "redacted" string) that could read as though a real value were being
// partially shown.
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<string, string> = {
  contract: 'Contract',
  instructions: 'Instructions',
  secrets: 'Secrets',
  demo: 'Demo capability',
  roadmap: 'Roadmap',
};

function stageLabel(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function ContractBuildout({
  view,
  activeStage,
  project,
}: {
  view: ContractBuildoutView;
  activeStage?: string;
  /** The session's project. Absent for a session the shell could not attribute
   *  to one — the demo handoff then renders NOTHING rather than a control that
   *  would dispatch an agent at an unknown project. */
  project?: string;
}): JSX.Element {
  const rowCount = view.mode === 'checklist' ? view.checklist.length : view.row ? 1 : 0;
  const resolvedActiveStage = activeStage ?? (view.mode === 'checklist' ? 'contract' : (view.row?.stage ?? ''));

  return (
    <div data-component="contract-buildout" data-buildout-mode={view.mode} data-buildout-active-stage={resolvedActiveStage} data-buildout-row-count={rowCount}>
      {view.mode === 'checklist' ? <ContractChecklist rows={view.checklist} /> : <ContractStageDetail row={view.row} project={project} />}
    </div>
  );
}

function ContractChecklist({ rows }: { rows: ContractStageRow[] }): JSX.Element {
  return (
    <ul className="readiness-list" data-section="contract-checklist" data-checklist-row-count={rows.length}>
      {rows.map((row) => (
        <li
          key={row.stage}
          className={`readiness-item${row.status === 'present' ? ' ok' : ''}`}
          data-checklist-row={row.stage}
          data-checklist-status={row.status}
          title={row.source}
        >
          <span className="ri-dot" />
          {stageLabel(row.stage)} — {row.status}
        </li>
      ))}
    </ul>
  );
}

function ContractStageDetail({ row, project }: { row: ContractStageRow | null; project?: string }): JSX.Element {
  if (row === null) {
    return (
      <div data-stage-detail-state="no-row" style={{ fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic', padding: '6px 0' }}>
        No data for this stage.
      </div>
    );
  }
  return (
    <div
      data-stage-detail-state="row"
      data-stage-detail-stage={row.stage}
      data-stage-detail-status={row.status}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          aria-hidden="true"
          style={{ width: 10, height: 10, borderRadius: '50%', background: row.status === 'present' ? 'var(--green)' : 'var(--amber)', flexShrink: 0 }}
        />
        <strong style={{ fontSize: 13 }}>{stageLabel(row.stage)}</strong>
        <span style={{ color: 'var(--faint)', fontSize: 12 }}>{row.status}</span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--faint)' }}>
        source: <span style={{ fontFamily: 'var(--font-mono)' }}>{row.source}</span>
      </div>
      {row.bytes !== null && <div style={{ fontSize: 12, color: 'var(--faint)' }}>{row.bytes} bytes</div>}
      {/* forge-8vfn.5.6: the demo stage is the one stage whose detail names an
          act rather than a fact — the operator reads what the scaffold produced
          and hands the gap to the agent that fills it. Every other stage's
          detail stays a pure read, so the control is never decoration. */}
      {row.stage === 'demo' && project ? <DemoStageHandoff project={project} /> : null}
      {row.detail.length > 0 && (
        <ul data-section="stage-detail-list" style={{ margin: 0, padding: '0 0 0 18px', fontSize: 12.5, color: 'var(--text)' }}>
          {row.detail.map((line) => (
            <li key={line} data-detail-line={line}>
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
