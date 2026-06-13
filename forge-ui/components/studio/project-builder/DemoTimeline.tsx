'use client';

import { useEffect, useRef, useState } from 'react';
import type { DemoStep } from '@/lib/studio-client';

const KIND_META: Record<string, { icon: string; label: string }> = {
  capture: { icon: '📸', label: 'Capture' },
  verify:  { icon: '✓',  label: 'Verify'  },
  present: { icon: '📎', label: 'Present' },
};

const PRESETS: Array<{ kind: DemoStep['kind']; text: string; icon: string }> = [
  { kind: 'capture', text: 'Screenshot of live resource', icon: '📸' },
  { kind: 'capture', text: 'API GET of created entity', icon: '🔌' },
  { kind: 'capture', text: 'Terminal cast recording', icon: '⌨' },
  { kind: 'capture', text: 'Playwright video of interaction', icon: '🎬' },
  { kind: 'present', text: 'Portal walkthrough attached to PR', icon: '🖥' },
  { kind: 'present', text: 'Demo evidence attached to PR', icon: '📎' },
  { kind: 'verify',  text: 'Assert response matches expected schema', icon: '✓' },
  { kind: 'verify',  text: 'Project tests green in CI after merge', icon: '🟢' },
];

let _uid = 0;
function nextUid(): string { return `step-${++_uid}`; }

type StepWithUid = DemoStep & { uid: string };

function attachUids(steps: DemoStep[]): StepWithUid[] {
  return steps.map((s) => ({ ...s, uid: nextUid() }));
}

export function DemoTimeline({ steps, onChange }: { steps: DemoStep[]; onChange: (s: DemoStep[]) => void }) {
  const [internal, setInternal] = useState<StepWithUid[]>(() => attachUids(steps));
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const prevStepsRef = useRef(steps);

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

  function removeStep(i: number) {
    emit(internal.filter((_, idx) => idx !== i));
  }

  function updateStep(i: number, patch: Partial<DemoStep>) {
    emit(internal.map((s, idx) => idx === i ? { ...s, ...patch } : s));
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
      <div className="panel">
        <div className="panel-head"><span>Acceptable proof-of-work for this project</span></div>
        <div className="panel-body">
          <div style={{ fontSize: 12, color: 'var(--amber)', fontStyle: 'italic', padding: '7px 12px', background: 'rgba(251,191,36,.06)', border: '1px solid rgba(251,191,36,.2)', borderRadius: 'var(--radius-sm)', marginBottom: 14 }}>
            ⚠ Demos show the ACTUAL resource — a passing-test table is not a demo.
          </div>

          {/* Timeline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
            {internal.map((step, i) => (
              <div
                key={step.uid}
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
                    <select
                      value={step.kind}
                      onChange={(e) => updateStep(i, { kind: e.target.value as DemoStep['kind'] })}
                      style={{
                        background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)',
                        color: 'var(--dim)', fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 600,
                        letterSpacing: '.06em', textTransform: 'uppercase', padding: '3px 8px', cursor: 'pointer', outline: 'none',
                      }}
                    >
                      {(['capture', 'verify', 'present'] as const).map((k) => (
                        <option key={k} value={k}>{KIND_META[k].label}</option>
                      ))}
                    </select>
                    <span>{KIND_META[step.kind]?.icon}</span>
                    <button
                      onClick={() => removeStep(i)}
                      style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--faint)', cursor: 'pointer', fontSize: 15 }}
                      title="Remove step"
                    >×</button>
                  </div>
                  <textarea
                    className="input"
                    rows={2}
                    value={step.text}
                    onChange={(e) => updateStep(i, { text: e.target.value })}
                    placeholder="Describe what this step does…"
                    style={{ fontSize: 13, resize: 'none', minHeight: 36, width: '100%', boxSizing: 'border-box' }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Add step */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, paddingLeft: 46 }}>
            <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={() => addStep('capture', '')}>+ Add step</button>
          </div>

          {/* Preset strip */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14, padding: '10px 12px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
            <div style={{ width: '100%', fontSize: 10.5, fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 2 }}>
              Preset steps — click to add
            </div>
            {PRESETS.map((p, i) => (
              <span
                key={i}
                onClick={() => addStep(p.kind, p.text)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  padding: '4px 10px', borderRadius: 999,
                  fontSize: 11.5, cursor: 'pointer', userSelect: 'none',
                  border: '1px solid var(--line-2)', background: 'var(--panel-2)', color: 'var(--dim)',
                }}
                data-kind={p.kind}
                data-text={p.text}
              >
                <span style={{ fontSize: 12 }}>{p.icon}</span> {p.text}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
