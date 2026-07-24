'use client';

import { useEffect, useRef, useState } from 'react';
import type { DemoStep } from '@/lib/studio-client';
import { startDemoBuilder, listDemoElements, type DemoElementSummary } from '@/lib/bridge-client';

const KIND_META: Record<string, { icon: string; label: string }> = {
  capture: { icon: '📸', label: 'Capture' },
  verify:  { icon: '✓',  label: 'Verify'  },
  present: { icon: '📎', label: 'Present' },
};

/** Display order for the phase-grouped element picker. */
const PHASE_ORDER: Array<DemoElementSummary['phase']> = ['capture', 'verify', 'present'];

let _uid = 0;
function nextUid(): string { return `step-${++_uid}`; }

type StepWithUid = DemoStep & { uid: string };

function attachUids(steps: DemoStep[]): StepWithUid[] {
  return steps.map((s) => ({ ...s, uid: nextUid() }));
}

export function DemoTimeline({
  project,
  steps,
  hasLockedDemo,
  onChange,
  onSessionStarted,
}: {
  project: string;
  steps: DemoStep[];
  hasLockedDemo: boolean;
  onChange: (s: DemoStep[]) => void;
  /** R1-03-F2: a demo session started (whole-demo launch or a per-element
   *  iterate) — the page owns which session is active + shows it inline via
   *  DemoBuilderPanel, rather than this component navigating to /demo/<sid>. */
  onSessionStarted: (sessionId: string) => void;
}) {
  const [internal, setInternal] = useState<StepWithUid[]>(() => attachUids(steps));
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  // The forge demo-element library (the per-step element options), loaded on mount.
  const [palette, setPalette] = useState<DemoElementSummary[]>([]);
  // Which element step's iterate action is in-flight (data-element-id), or null.
  const [iterating, setIterating] = useState<string | null>(null);
  const prevStepsRef = useRef(steps);

  // Load the forge demo-element library on mount (the composer palette).
  useEffect(() => {
    let cancelled = false;
    listDemoElements()
      .then((els) => { if (!cancelled) setPalette(els); })
      .catch(() => { /* leave palette empty — composer hides itself */ });
    return () => { cancelled = true; };
  }, []);

  function elementById(id: string | undefined): DemoElementSummary | null {
    if (!id) return null;
    return palette.find((e) => e.id === id) ?? null;
  }

  async function onLaunchDemoBuilder(): Promise<void> {
    if (launching) return;
    setLaunchError(null);
    setLaunching(true);
    try {
      const res = await startDemoBuilder({ project, mode: hasLockedDemo ? 'update' : 'create' });
      if (!res.ok || !res.sessionId) {
        setLaunchError(res.error ?? 'failed to start the demo agent');
        return;
      }
      onSessionStarted(res.sessionId);
    } finally {
      setLaunching(false);
    }
  }

  // Iterate ONE library element — start a per-element demo session and jump to it.
  async function onIterateElement(elementId: string): Promise<void> {
    if (iterating) return;
    setLaunchError(null);
    setIterating(elementId);
    try {
      const res = await startDemoBuilder({
        project,
        mode: hasLockedDemo ? 'update' : 'create',
        targetElement: elementId,
      });
      if (!res.ok || !res.sessionId) {
        setLaunchError(res.error ?? 'failed to start the demo agent');
        return;
      }
      onSessionStarted(res.sessionId);
    } finally {
      setIterating(null);
    }
  }

  // Sync incoming steps → internal when the parent replaces the array
  // (e.g. on initial data load). Don't re-sync on every render — only when
  // the reference changes (i.e. a load replaced the array wholesale).
  useEffect(() => {
    if (steps !== prevStepsRef.current) {
      prevStepsRef.current = steps;
      setInternal(attachUids(steps));
    }
  }, [steps]);

  function emit(next: StepWithUid[]) {
    setInternal(next);
    onChange(next.map(({ uid: _uid, ...s }) => s));
  }

  function addStep(kind: DemoStep['kind'], text: string) {
    emit([...internal, { kind, text, uid: nextUid() }]);
  }

  // Bind a step to a library element (phase becomes the step kind), or clear it
  // back to a free-text step (keeping the current kind).
  function setStepElement(i: number, elementId: string) {
    if (!elementId) { updateStep(i, { element: undefined }); return; }
    const el = elementById(elementId);
    updateStep(i, { element: elementId, ...(el ? { kind: el.phase } : {}) });
  }

  function removeStep(i: number) {
    emit(internal.filter((_, idx) => idx !== i));
  }

  function updateStep(i: number, patch: Partial<DemoStep>) {
    emit(internal.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  }

  // Move a step within the array (the demo composition order).
  function moveStep(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= internal.length) return;
    const next = [...internal];
    const [moved] = next.splice(i, 1);
    next.splice(j, 0, moved);
    emit(next);
  }

  function handleDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const next = [...internal];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    emit(next);
    setDragIdx(null);
  }

  return (
    <section data-step-count={internal.length}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        Demo Process <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>

      <div
        data-section="demo-source"
        style={{ fontSize: 11.5, color: 'var(--dim)', lineHeight: 1.5, marginBottom: 10 }}
      >
        The demo is now <strong style={{ color: 'var(--text)' }}>composed</strong> of ordered demo elements drawn from the forge library — the demo agent runs each element&apos;s skill in order, then you review and lock it in.
      </div>

      <div className="panel">
        <div className="panel-head"><span>Acceptable proof-of-work for this project</span></div>
        <div className="panel-body">
          {/* Locked-state indicator — is a reproducible demo set up yet? */}
          {hasLockedDemo ? (
            <div
              data-section="demo-locked"
              data-demo-locked="true"
              style={{ fontSize: 12, color: 'var(--green)', padding: '8px 12px', background: 'rgba(74,222,128,.07)', border: '1px solid rgba(74,222,128,.3)', borderRadius: 'var(--radius-sm)', marginBottom: 14, lineHeight: 1.5 }}
            >
              ✓ A reproducible demo is locked in (.forge/demo/). The agent renders a before/after of
              each completed initiative&apos;s changes following the process below.
            </div>
          ) : (
            <div
              data-section="demo-locked"
              data-demo-locked="false"
              style={{ fontSize: 12, color: 'var(--dim)', padding: '8px 12px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', marginBottom: 14, lineHeight: 1.5 }}
            >
              No demo is set up yet — build one with the agent so each completed initiative renders a
              before/after of its changes.
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary"
            data-action="launch-demo-builder"
            data-demo-mode={hasLockedDemo ? 'update' : 'create'}
            onClick={() => void onLaunchDemoBuilder()}
            disabled={launching}
            style={{ alignSelf: 'flex-start', marginBottom: 14, opacity: launching ? 0.6 : 1 }}
          >
            {launching ? 'Starting…' : hasLockedDemo ? '✦ Update the demo with the agent' : '✦ Build the demo with the agent'}
          </button>
          {launchError && <div style={{ fontSize: 11.5, color: 'var(--red, #f85149)', marginBottom: 14 }}>{launchError}</div>}

          <div style={{ fontSize: 12, color: 'var(--amber)', fontStyle: 'italic', padding: '7px 12px', background: 'rgba(251,191,36,.06)', border: '1px solid rgba(251,191,36,.2)', borderRadius: 'var(--radius-sm)', marginBottom: 14 }}>
            ⚠ Demos show the ACTUAL resource — a passing-test table is not a demo.
          </div>

          {/* Demo process — the ordered steps the demo agent follows. Each step
              picks WHICH forge element renders it (or stays free text). */}
          <div style={{ fontSize: 10.5, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 4 }}>
            The demo process this follows
          </div>
          <div style={{ fontSize: 11, color: 'var(--dim)', fontStyle: 'italic', marginBottom: 10 }}>
            Each step picks which forge element renders it (or stays free text). They run top-to-bottom — this is the demo composition order.
          </div>

          {/* Timeline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {internal.map((step, i) => {
              const el = elementById(step.element);
              const composed = !!step.element;
              return (
              <div
                key={step.uid}
                data-step-element={step.element ?? ''}
                style={{ display: 'flex', gap: 0, position: 'relative', opacity: dragIdx === i ? 0.4 : 1 }}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); handleDrop(i); }}
              >
                {/* Connector */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 36, flexShrink: 0 }}>
                  <div style={{
                    width: 26, height: 28, clipPath: 'var(--hex-clip)',
                    background: step.kind === 'capture' ? 'linear-gradient(135deg, rgba(92,200,255,.5), rgba(92,200,255,.25))'
                               : step.kind === 'verify' ? 'linear-gradient(135deg, rgba(74,222,128,.5), rgba(74,222,128,.25))'
                               : 'linear-gradient(135deg, rgba(251,191,36,.5), rgba(251,191,36,.25))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                    color: step.kind === 'capture' ? 'var(--steel)' : step.kind === 'verify' ? 'var(--green)' : 'var(--amber)',
                    zIndex: 1,
                  }}>
                    {i + 1}
                  </div>
                  {i < internal.length - 1 && <div style={{ flex: 1, width: 2, background: 'var(--line)', margin: '0 auto', minHeight: 12 }} />}
                </div>

                {/* Card */}
                <div
                  {...(composed ? { 'data-demo-element': step.element } : {})}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragEnd={() => setDragIdx(null)}
                  style={{
                    flex: 1, margin: '0 0 12px 10px', padding: '11px 13px',
                    background: 'var(--panel-2)', border: '1px solid var(--line-2)',
                    borderRadius: 'var(--radius)', cursor: 'default',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ color: 'var(--faint)', cursor: 'grab', fontSize: 13, userSelect: 'none' }}>⠿</span>

                    {/* Element selector — which forge element renders this step (or free text). */}
                    <select
                      data-step-element-select={step.element ?? ''}
                      value={step.element ?? ''}
                      onChange={(e) => setStepElement(i, e.target.value)}
                      title="Which forge demo element renders this step"
                      style={{
                        background: 'var(--bg-2)', border: `1px solid ${composed ? 'var(--line-2)' : 'var(--line)'}`,
                        borderRadius: 'var(--radius-sm)', color: composed ? 'var(--text)' : 'var(--dim)',
                        fontFamily: 'var(--font-display)', fontSize: 11.5, fontWeight: 600,
                        padding: '3px 8px', cursor: 'pointer', outline: 'none', maxWidth: 240,
                      }}
                    >
                      <option value="">— free text —</option>
                      {PHASE_ORDER.map((phase) => {
                        const inPhase = palette.filter((e) => e.phase === phase);
                        if (inPhase.length === 0) return null;
                        return (
                          <optgroup key={phase} label={`${KIND_META[phase]?.icon ?? ''} ${KIND_META[phase]?.label ?? phase}`}>
                            {inPhase.map((el2) => <option key={el2.id} value={el2.id}>{el2.name}</option>)}
                          </optgroup>
                        );
                      })}
                    </select>

                    {/* Reorder + remove controls */}
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <button
                        type="button"
                        data-action="move-step-up"
                        onClick={() => moveStep(i, -1)}
                        disabled={i === 0}
                        title="Move up"
                        style={{ background: 'transparent', border: 'none', color: i === 0 ? 'var(--line-2)' : 'var(--faint)', cursor: i === 0 ? 'default' : 'pointer', fontSize: 13, padding: '0 3px' }}
                      >↑</button>
                      <button
                        type="button"
                        data-action="move-step-down"
                        onClick={() => moveStep(i, 1)}
                        disabled={i === internal.length - 1}
                        title="Move down"
                        style={{ background: 'transparent', border: 'none', color: i === internal.length - 1 ? 'var(--line-2)' : 'var(--faint)', cursor: i === internal.length - 1 ? 'default' : 'pointer', fontSize: 13, padding: '0 3px' }}
                      >↓</button>
                      <button
                        type="button"
                        onClick={() => removeStep(i)}
                        style={{ background: 'transparent', border: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 15, padding: '0 3px' }}
                        title="Remove step"
                      >×</button>
                    </span>
                  </div>

                  {/* Config (composed: element configHint as placeholder) / freetext (legacy) */}
                  <textarea
                    className="input"
                    rows={2}
                    value={step.text}
                    onChange={(e) => updateStep(i, { text: e.target.value })}
                    placeholder={composed ? (el?.configHint ?? 'Element config…') : 'Describe what this step does…'}
                    style={{ fontSize: 13, resize: 'none', minHeight: 36, width: '100%', boxSizing: 'border-box' }}
                  />

                  {composed && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      data-action="iterate-element"
                      data-element-id={step.element}
                      onClick={() => step.element && void onIterateElement(step.element)}
                      disabled={!!iterating}
                      style={{ fontSize: 12, marginTop: 8, opacity: iterating ? 0.6 : 1 }}
                    >
                      {iterating === step.element ? 'Starting…' : '⟳ Iterate this element'}
                    </button>
                  )}
                </div>
              </div>
              );
            })}
          </div>

          {/* Add step — a new step the operator binds to a forge element (or leaves free text). */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, paddingLeft: 46 }}>
            <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => addStep('capture', '')}>+ Add step</button>
          </div>
        </div>
      </div>
    </section>
  );
}
