'use client';

/**
 * HexDetailDrawer (Feature #9) — the click-driven detail panel for a selected
 * pipeline hex. A right-side DRAWER (it does NOT cover the hex canvas — the
 * canvas stays visible to its left). Shows TWO things for the clicked hex:
 *
 *   1. DEFINITION
 *        - wi      → acceptance criteria (Given/When/Then), files_in_scope,
 *                    quality_gate_cmd (fetched from the bridge's
 *                    /api/work-item/<cycleId>/<wiId> snapshot endpoint).
 *        - feature → title + depends_on.
 *        - phase   → phase name, status, cost.
 *   2. ACTIVITY — the existing ActivityPanel, scoped to this hex via `scopeHex`
 *        (events pre-filtered by eventMatchesHex; chip bar hidden).
 *
 * DOM-as-metrics: [data-section="hex-detail"][data-hex-kind][data-hex-id].
 */

import { useEffect, useState } from 'react';

import { fetchWorkItem, type WorkItemDetail, type CostSummary, type EventLogEntry } from '@/lib/bridge-client';
import type { SelectedHex } from '@/lib/hex-detail';
import type { PhaseState } from '@/lib/phases';
import type { GraphWorkItem } from '@/lib/use-graph-model';
import { statusGlow } from '@/lib/status-colors';
import { ActivityPanel } from '@/components/ActivityPanel';

const MONO = 'ui-monospace, Menlo, Consolas, monospace';

export type HexDetailDrawerProps = {
  hex: SelectedHex;
  cycleId: string | null;
  events: EventLogEntry[];
  phaseStates: PhaseState[];
  cost: CostSummary | null;
  workItems: GraphWorkItem[];
  onClose: () => void;
};

export function HexDetailDrawer(props: HexDetailDrawerProps): JSX.Element {
  const { hex, cycleId, events, phaseStates, cost, workItems, onClose } = props;

  return (
    <div
      data-section="hex-detail"
      data-hex-kind={hex.kind}
      data-hex-id={hex.id}
      style={drawerStyle}
    >
      <div style={headerStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={kindBadge(hex.kind)}>{hex.kind}</span>
          <span style={{ fontFamily: MONO, fontSize: 13, color: '#e6edf3', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hex.id}</span>
        </div>
        <button onClick={onClose} aria-label="close detail" data-action="close-hex-detail" style={closeBtn}>×</button>
      </div>

      <div style={bodyStyle}>
        <div style={sectionLabel}>definition</div>
        <Definition hex={hex} cycleId={cycleId} phaseStates={phaseStates} cost={cost} workItems={workItems} />

        <div style={{ ...sectionLabel, marginTop: 14 }}>activity</div>
        <div style={activityWrapStyle}>
          <ActivityPanel events={events} scopeHex={hex} />
        </div>
      </div>
    </div>
  );
}

// ---- definition (per kind) -------------------------------------------------

function Definition({
  hex,
  cycleId,
  phaseStates,
  cost,
  workItems: _workItems,
}: {
  hex: SelectedHex;
  cycleId: string | null;
  phaseStates: PhaseState[];
  cost: CostSummary | null;
  workItems: GraphWorkItem[];
}): JSX.Element {
  if (hex.kind === 'phase') {
    const st = phaseStates.find((p) => p.phase === hex.id)?.status ?? 'pending';
    const costUsd = cost?.perPhase?.[hex.id]?.cost_usd ?? 0;
    return (
      <div data-detail-kind="phase">
        <Field label="phase" value={hex.id} />
        <Field label="status" value={st} accent={statusGlow(st)} />
        <Field label="cost" value={`$${costUsd.toFixed(3)}`} accent="#7ee787" />
      </div>
    );
  }
  return <WiDefinition cycleId={cycleId} wiId={hex.id} />;
}

function WiDefinition({ cycleId, wiId }: { cycleId: string | null; wiId: string }): JSX.Element {
  const [wi, setWi] = useState<WorkItemDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'absent'>('loading');

  useEffect(() => {
    if (!cycleId) { setState('absent'); return; }
    let cancelled = false;
    setState('loading');
    setWi(null);
    fetchWorkItem(cycleId, wiId)
      .then((w) => {
        if (cancelled) return;
        if (w) { setWi(w); setState('ready'); } else { setState('absent'); }
      })
      .catch(() => { if (!cancelled) setState('absent'); });
    return () => { cancelled = true; };
  }, [cycleId, wiId]);

  if (state === 'loading') {
    return <div data-detail-kind="wi" data-wi-detail-state="loading" style={mutedStyle}>loading work item…</div>;
  }
  if (state === 'absent' || !wi) {
    return (
      <div data-detail-kind="wi" data-wi-detail-state="absent" style={mutedStyle}>
        No spec on disk yet (the PM emits it mid-cycle; the snapshot lands at cycle end).
      </div>
    );
  }
  return (
    <div data-detail-kind="wi" data-wi-detail-state="ready">
      <Field label="work item" value={wi.work_item_id} />
      <div style={subLabel}>acceptance criteria</div>
      <ol style={acListStyle} data-section="acceptance-criteria">
        {wi.acceptance_criteria.length === 0 ? (
          <li style={mutedStyle}>(none)</li>
        ) : (
          wi.acceptance_criteria.map((ac, i) => (
            <li key={i} style={acItemStyle} data-ac-index={i}>
              <span style={gwtKey}>GIVEN</span> {ac.given}{' '}
              <span style={gwtKey}>WHEN</span> {ac.when}{' '}
              <span style={gwtKey}>THEN</span> {ac.then}
            </li>
          ))
        )}
      </ol>
      <div style={subLabel}>files in scope</div>
      <ul style={fileListStyle} data-section="files-in-scope">
        {wi.files_in_scope.map((f, i) => (
          <li key={i} style={fileItemStyle}>{f}</li>
        ))}
      </ul>
      <div style={subLabel}>quality gate</div>
      <pre style={gateStyle} data-section="quality-gate">{wi.quality_gate_cmd.join(' ') || '(none)'}</pre>
    </div>
  );
}

// ---- small bits ------------------------------------------------------------

function Field({ label, value, accent }: { label: string; value: string; accent?: string }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0', fontSize: 12, fontFamily: MONO }}>
      <span style={{ color: '#6e7681', minWidth: 92 }}>{label}</span>
      <span style={{ color: accent ?? '#e6edf3', wordBreak: 'break-word' }}>{value}</span>
    </div>
  );
}

// ---- styles ----------------------------------------------------------------

function kindBadge(kind: SelectedHex['kind']): React.CSSProperties {
  const color = kind === 'phase' ? '#58a6ff' : '#7ee787';
  return { fontSize: 10, fontFamily: MONO, textTransform: 'uppercase', letterSpacing: 0.6, color, border: `1px solid ${color}55`, borderRadius: 10, padding: '1px 8px' };
}

const drawerStyle: React.CSSProperties = {
  // Widened 380→460 (operator 2026-06-02: the inspection detail was too narrow).
  // The canvas stays visible to the left; this is a flex sibling, not an overlay.
  position: 'absolute', top: 0, right: 0, bottom: 0, width: 460, zIndex: 20,
  background: '#0b0f14f7', borderLeft: '1px solid #21262d', boxShadow: '-8px 0 24px #0008',
  display: 'flex', flexDirection: 'column', color: '#e6edf3',
};
const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
  padding: '10px 12px', borderBottom: '1px solid #1c232c',
};
const closeBtn: React.CSSProperties = { background: 'transparent', border: 'none', color: '#8b949e', fontSize: 20, lineHeight: 1, cursor: 'pointer' };
const bodyStyle: React.CSSProperties = { padding: '10px 12px', overflowY: 'auto', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 };
const sectionLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', color: '#6e7681', marginBottom: 6 };
const subLabel: React.CSSProperties = { fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: '#6e7681', margin: '10px 0 4px' };
const mutedStyle: React.CSSProperties = { color: '#8b949e', fontSize: 12, fontFamily: MONO };
const acListStyle: React.CSSProperties = { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 };
const acItemStyle: React.CSSProperties = { fontSize: 12, color: '#c9d1d9', lineHeight: 1.5 };
const gwtKey: React.CSSProperties = { color: '#58a6ff', fontFamily: MONO, fontSize: 10, fontWeight: 600 };
const fileListStyle: React.CSSProperties = { margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 };
const fileItemStyle: React.CSSProperties = { fontSize: 11, fontFamily: MONO, color: '#adbac7', wordBreak: 'break-all' };
const gateStyle: React.CSSProperties = { margin: 0, padding: 8, background: '#161b22', border: '1px solid #21262d', borderRadius: 4, color: '#a5d6ff', fontSize: 11, fontFamily: MONO, whiteSpace: 'pre-wrap', wordBreak: 'break-word' };
// The scoped ActivityPanel fills height:100%; give it a generous tall region so
// its now-VERTICAL list + full-width detail blade are both readable. The drawer
// body scrolls if the definition + this exceed the viewport.
const activityWrapStyle: React.CSSProperties = { height: 460, minHeight: 320, display: 'flex' };
