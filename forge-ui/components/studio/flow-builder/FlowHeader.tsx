'use client';

/**
 * FlowHeader — the header strip above the canvas in the BUILD tab.
 * Contains:
 *   - Flow selector (dropdown of all flows)
 *   - Editable flow name input
 *   - Goal textarea + data-goal-set warning when empty
 *   - Project + KB selects
 *   - Trigger chips (on complete → flow picker)
 *   - Save button → calls saveFlow PUT; handles 423 edit-lock
 *
 * Props receive the current header state; parent owns the state (FlowBuilder).
 */

import { useCallback, useEffect, useState } from 'react';
import {
  fetchStudioFlows,
  fetchStudioProjects,
  fetchStudioKbs,
  saveFlow,
} from '@/lib/studio-client';
import type { Flow, Project, Kb, FlowTrigger } from '@/lib/studio-client';

export type FlowHeaderState = {
  name: string;
  goal: string;
  project: string;
  kb: string;
  triggers: FlowTrigger[];
};

type Props = {
  /** The flow id being edited */
  flowId: string;
  /** Current header state (controlled) */
  state: FlowHeaderState;
  /** Called when any header field changes */
  onChange: (next: FlowHeaderState) => void;
  /** Current saved version */
  version?: number;
  /** Triggered by Save; parent provides nodes/edges to include in the PUT body */
  onSave: () => Promise<{ ok: boolean; version?: number; error?: string }>;
  /** All flows (for the flow selector) */
  flows: Flow[];
  /** Called when the user selects a different flow from the dropdown */
  onFlowSelect: (id: string) => void;
};

export function FlowHeader({
  flowId,
  state,
  onChange,
  version,
  onSave,
  flows,
  onFlowSelect,
}: Props): JSX.Element {
  const [projects, setProjects] = useState<Project[]>([]);
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [lockBanner, setLockBanner] = useState<string | null>(null);
  const [showTriggerPicker, setShowTriggerPicker] = useState(false);

  // Load projects + KBs
  useEffect(() => {
    const signal = { cancelled: false };
    void (async () => {
      const [projs, ks] = await Promise.all([fetchStudioProjects(), fetchStudioKbs()]);
      if (!signal.cancelled) { setProjects(projs); setKbs(ks); }
    })();
    return () => { signal.cancelled = true; };
  }, []);

  const goalSet = state.goal.trim().length > 0;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveMsg(null);
    setLockBanner(null);
    try {
      const result = await onSave();
      if (!result.ok) {
        // 423 edit-lock: the error string includes "locked" or "423"
        if (result.error?.toLowerCase().includes('locked') || result.error?.includes('423') || result.error?.toLowerCase().includes('in flight')) {
          setLockBanner('Flow locked — a run is in flight; cannot save while running.');
        } else {
          setSaveMsg({ ok: false, text: result.error ?? 'Save failed.' });
        }
      } else {
        setSaveMsg({ ok: true, text: `Saved${result.version ? ` (v${result.version})` : ''}.` });
        setTimeout(() => setSaveMsg(null), 3000);
      }
    } finally {
      setSaving(false);
    }
  }, [onSave]);

  const addTrigger = useCallback(() => {
    const otherFlows = flows.filter((f) => f.id !== flowId);
    if (otherFlows.length === 0) return;
    // Pick first flow not already in triggers
    const existing = new Set(state.triggers.map((t) => t.flow));
    const target = otherFlows.find((f) => !existing.has(f.id));
    if (!target) return;
    onChange({
      ...state,
      triggers: [...state.triggers, { on: 'complete', flow: target.id }],
    });
    setShowTriggerPicker(false);
  }, [flows, flowId, state, onChange]);

  const removeTrigger = useCallback((i: number) => {
    onChange({
      ...state,
      triggers: state.triggers.filter((_, idx) => idx !== i),
    });
  }, [state, onChange]);

  const flowName = (id: string) => flows.find((f) => f.id === id)?.name ?? id;

  return (
    <div
      data-component="flow-header"
      data-goal-set={goalSet ? 'true' : 'false'}
      style={{
        background: 'var(--panel)',
        borderBottom: '1px solid var(--line)',
        padding: '14px 24px 10px',
        flexShrink: 0,
      }}
    >
      {/* Edit-lock banner */}
      {lockBanner && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 12px',
          marginBottom: 10,
          background: 'rgba(248,113,113,0.08)',
          border: '1px solid rgba(248,113,113,0.3)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 12,
          color: 'var(--red)',
        }}
        data-banner="edit-lock">
          <span>⚠ {lockBanner}</span>
          <button
            onClick={() => setLockBanner(null)}
            style={{ background: 'none', border: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 13 }}
          >✕</button>
        </div>
      )}

      {/* Top row: flow selector + name + goal warning + save */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12, flexWrap: 'wrap' }}>
        {/* Flow selector */}
        <select
          value={flowId}
          onChange={(e) => onFlowSelect(e.target.value)}
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text)',
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            padding: '6px 11px',
            outline: 'none',
            cursor: 'pointer',
            minWidth: 180,
          }}
          data-field="flow-selector"
        >
          {flows.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>

        {/* Editable flow name */}
        <input
          type="text"
          value={state.name}
          placeholder="Flow name…"
          onChange={(e) => onChange({ ...state, name: e.target.value })}
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 18,
            fontWeight: 700,
            color: 'var(--text)',
            background: 'transparent',
            border: 'none',
            borderBottom: '2px solid transparent',
            padding: '2px 6px',
            outline: 'none',
            flex: 1,
            minWidth: 200,
            transition: 'border-color 0.15s',
          }}
          onFocus={(e) => { (e.target as HTMLInputElement).style.borderBottomColor = 'var(--ember)'; }}
          onBlur={(e) => { (e.target as HTMLInputElement).style.borderBottomColor = 'transparent'; }}
          data-field="flow-name"
        />

        {/* Goal warning badge */}
        {!goalSet && (
          <span
            data-banner="goal-warning"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11.5,
              color: 'var(--amber)',
              fontFamily: 'var(--font-mono)',
              padding: '2px 8px',
              border: '1px solid rgba(251,191,36,0.3)',
              borderRadius: 4,
              background: 'rgba(251,191,36,0.07)',
            }}
          >
            ⚠ no goal set
          </span>
        )}

        {/* Save status */}
        {saveMsg && (
          <span style={{
            fontSize: 11.5,
            color: saveMsg.ok ? 'var(--green)' : 'var(--red)',
            fontFamily: 'var(--font-mono)',
          }}>
            {saveMsg.text}
          </span>
        )}

        {version !== undefined && (
          <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
            v{version}
          </span>
        )}

        <div style={{ flex: 1 }} />

        {/* Save button */}
        <button
          onClick={() => void handleSave()}
          disabled={saving}
          data-action="save-flow"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 16px',
            fontFamily: 'var(--font-display)',
            fontSize: 13,
            fontWeight: 600,
            color: saving ? 'var(--dim)' : '#fff',
            background: saving
              ? 'var(--panel-3)'
              : 'linear-gradient(135deg, #c2410c 0%, #9a3412 100%)',
            border: `1px solid ${saving ? 'var(--line-2)' : 'var(--ember-hot)'}`,
            borderRadius: 'var(--radius-sm)',
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save Flow'}
        </button>
      </div>

      {/* Goal row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
          color: 'var(--dim)',
          paddingTop: 10,
          whiteSpace: 'nowrap',
        }}>
          Goal
        </span>
        <textarea
          value={state.goal}
          placeholder="What does this flow accomplish?"
          rows={1}
          onChange={(e) => onChange({ ...state, goal: e.target.value })}
          style={{
            flex: 1,
            background: 'var(--bg-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--text)',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            padding: '8px 11px',
            outline: 'none',
            resize: 'none',
            minHeight: 36,
            maxHeight: 80,
            transition: 'border-color 0.12s',
          }}
          onFocus={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--ember)'; }}
          onBlur={(e) => { (e.target as HTMLTextAreaElement).style.borderColor = 'var(--line)'; }}
          data-field="flow-goal"
        />
      </div>

      {/* Meta row: project, kb, triggers */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', paddingBottom: 4 }}>
        {/* Project */}
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--faint)' }}>Project</span>
        <select
          value={state.project}
          onChange={(e) => onChange({ ...state, project: e.target.value })}
          style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 12.5, padding: '4px 8px', outline: 'none', cursor: 'pointer' }}
          data-field="project-select"
        >
          <option value="">— none —</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>

        {/* KB */}
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--faint)', marginLeft: 8 }}>Knowledge Base</span>
        <select
          value={state.kb}
          onChange={(e) => onChange({ ...state, kb: e.target.value })}
          style={{ background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', fontFamily: 'var(--font-body)', fontSize: 12.5, padding: '4px 8px', outline: 'none', cursor: 'pointer' }}
          data-field="kb-select"
        >
          <option value="">— none —</option>
          {kbs.map((k) => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
        </select>

        {/* Triggers */}
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: 'var(--faint)', marginLeft: 8 }}>On complete →</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {state.triggers.map((tr, i) => (
            <span
              key={`${tr.flow}-${i}`}
              data-trigger-chip={tr.flow}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '3px 10px',
                background: 'rgba(183,140,255,0.1)',
                border: '1px solid rgba(183,140,255,0.35)',
                borderRadius: 999,
                fontSize: 12,
                color: 'var(--violet)',
              }}
            >
              <span style={{ color: 'var(--faint)', fontSize: 11 }}>on complete →</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 12 }}>{flowName(tr.flow)}</span>
              <span
                role="button"
                onClick={() => removeTrigger(i)}
                style={{ color: 'rgba(183,140,255,0.6)', cursor: 'pointer', fontSize: 13 }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = 'var(--red)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = 'rgba(183,140,255,0.6)'; }}
              >
                ✕
              </span>
            </span>
          ))}

          <button
            onClick={addTrigger}
            style={{
              background: 'transparent',
              border: '1px solid transparent',
              color: 'var(--dim)',
              fontFamily: 'var(--font-display)',
              fontSize: 12,
              fontWeight: 600,
              padding: '3px 10px',
              borderRadius: 'var(--radius-sm)',
              cursor: 'pointer',
              transition: 'color 0.12s, background 0.12s',
            }}
            onMouseEnter={(e) => { const el = e.currentTarget as HTMLButtonElement; el.style.color = 'var(--text)'; el.style.background = 'var(--panel-2)'; }}
            onMouseLeave={(e) => { const el = e.currentTarget as HTMLButtonElement; el.style.color = 'var(--dim)'; el.style.background = 'transparent'; }}
            data-action="add-trigger"
          >
            + trigger
          </button>
        </div>
      </div>
    </div>
  );
}
