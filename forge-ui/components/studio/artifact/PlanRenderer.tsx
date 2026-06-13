'use client';

import { useState } from 'react';

/**
 * Plan artifact renderer.
 *
 * Two rendering paths:
 *   1. Structured plan (JSON doc from artifactDocs) — renders goal callout,
 *      scope/non-goals, ACs, decomposition diagram, design decisions
 *      (interactive in gate-mode; choose-before-approve).
 *   2. PLAN.html fallback — when no structured plan JSON is available, embeds
 *      the PlanGate component's iframe (which shows the PLAN.html artifact
 *      directly). This preserves the data-section="plan-gate" data-* the
 *      harness depends on.
 *
 * The plan section renders gate-mode decisions-resolved gating:
 *   - Gate bar disabled until all unresolved decisions are chosen.
 *   - The parent page receives onDecisionsResolved to propagate to GateBar.
 */

export type PlanDecision = {
  id: string;
  q: string;
  options: string[];
  chosen?: string | null;
  note?: string;
};

export type PlanDecompItem = {
  wi: string;
  title: string;
  deps?: string[];
};

export type PlanDoc = {
  title?: string;
  goal?: string;
  scope?: string[];
  nonGoals?: string[];
  acceptanceCriteria?: string[];
  decomposition?: PlanDecompItem[];
  decisions?: PlanDecision[];
  status?: string;
};

function SectionHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontFamily: 'var(--font-display)',
      fontSize: 10.5,
      fontWeight: 700,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: 'var(--faint)',
      marginBottom: 10,
      paddingBottom: 6,
      borderBottom: '1px solid var(--line)',
    }}>
      {children}
    </div>
  );
}

function DecompDiagram({ items }: { items: PlanDecompItem[] }) {
  // Group: col 0 = no deps, col 1 = has deps
  const col0 = items.filter((i) => !i.deps || i.deps.length === 0);
  const col1 = items.filter((i) => i.deps && i.deps.length > 0);
  const cols = col0.length > 0 ? [col0, ...(col1.length > 0 ? [col1] : [])] : [col1];

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 0, overflowX: 'auto', paddingBottom: 8 }}>
      {cols.map((col, ci) => (
        <div key={ci} style={{ display: 'flex', alignItems: 'flex-start', gap: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 200 }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--faint)',
              paddingBottom: 6,
              borderBottom: '1px solid var(--line)',
              marginBottom: 4,
            }}>
              {ci === 0 ? 'Parallel' : 'Dependent'}
            </div>
            {col.map((wi) => (
              <div
                key={wi.wi}
                style={{
                  background: 'var(--panel)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '10px 12px',
                  position: 'relative',
                }}
              >
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, fontWeight: 700, color: 'var(--ember)', marginBottom: 3 }}>
                  {wi.wi}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.4 }}>{wi.title}</div>
                {wi.deps && wi.deps.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {wi.deps.map((d) => (
                      <span
                        key={d}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 10,
                          color: 'var(--violet)',
                          background: 'rgba(183,140,255,.1)',
                          border: '1px solid rgba(183,140,255,.3)',
                          borderRadius: 3,
                          padding: '1px 5px',
                        }}
                      >
                        ← {d}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          {ci < cols.length - 1 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0 12px',
              flexShrink: 0,
              alignSelf: 'center',
              color: 'var(--faint)',
              fontSize: 16,
              marginTop: 24,
            }}>
              →
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function PlanRenderer({
  doc,
  gateMode,
  onDecisionsResolved,
}: {
  doc: PlanDoc;
  gateMode: boolean;
  onDecisionsResolved?: (resolved: boolean) => void;
}) {
  // Track which unresolved decisions the user has chosen in gate-mode
  const [selected, setSelected] = useState<Record<string, string>>({});

  const decisions = doc.decisions ?? [];
  const unresolvedCount = decisions.filter(
    (d) => !d.chosen && !selected[d.id]
  ).length;
  const allResolved = unresolvedCount === 0;

  function selectOption(decId: string, option: string) {
    const next = { ...selected, [decId]: option };
    setSelected(next);
    const stillUnresolved = decisions.filter((d) => !d.chosen && !next[d.id]).length;
    onDecisionsResolved?.(stillUnresolved === 0);
  }

  return (
    <div>
      {/* Goal callout */}
      {doc.goal && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(255,158,74,.07) 0%, rgba(255,107,53,.04) 100%)',
          border: '1px solid rgba(255,158,74,.25)',
          borderLeft: '3px solid var(--ember)',
          borderRadius: 'var(--radius)',
          padding: '16px 20px',
          marginBottom: 24,
          fontSize: 14.5,
          lineHeight: 1.6,
          color: 'var(--text)',
        }}>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--ember)',
            marginBottom: 6,
          }}>
            Goal
          </div>
          {doc.goal}
        </div>
      )}

      {/* Scope + non-goals */}
      {((doc.scope?.length ?? 0) > 0 || (doc.nonGoals?.length ?? 0) > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
          {(doc.scope?.length ?? 0) > 0 && (
            <div>
              <SectionHead>In scope</SectionHead>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {doc.scope!.map((s, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
                    <span style={{ flexShrink: 0, width: 5, height: 5, borderRadius: '50%', background: 'var(--green)', marginTop: 6, display: 'inline-block' }} />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(doc.nonGoals?.length ?? 0) > 0 && (
            <div>
              <SectionHead>Non-goals</SectionHead>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {doc.nonGoals!.map((ng, i) => (
                  <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, lineHeight: 1.5 }}>
                    <span style={{ flexShrink: 0, width: 5, height: 5, borderRadius: '50%', background: 'var(--faint)', marginTop: 6, display: 'inline-block' }} />
                    {ng}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Acceptance criteria */}
      {(doc.acceptanceCriteria?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionHead>Acceptance criteria</SectionHead>
          <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8, counterReset: 'ac' }}>
            {doc.acceptanceCriteria!.map((ac, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, lineHeight: 1.5, padding: '10px 14px', background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)' }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--ember)',
                  background: 'rgba(255,158,74,.12)',
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {i + 1}
                </span>
                {ac}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Decomposition */}
      {(doc.decomposition?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionHead>Decomposition</SectionHead>
          <DecompDiagram items={doc.decomposition!} />
        </div>
      )}

      {/* Design decisions */}
      {decisions.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <SectionHead>Design decisions</SectionHead>
          {gateMode && unresolvedCount > 0 && !allResolved && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              background: 'rgba(251,191,36,.08)',
              border: '1px solid rgba(251,191,36,.3)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-display)',
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--amber)',
              marginBottom: 16,
            }}>
              ⬡ {unresolvedCount} decision{unresolvedCount !== 1 ? 's' : ''} need your input before you can approve
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {decisions.map((dec) => {
              const chosenNow = dec.chosen ?? selected[dec.id] ?? null;
              const isUnresolved = !chosenNow;
              return (
                <div
                  key={dec.id}
                  data-decision-id={dec.id}
                  style={{
                    background: isUnresolved && gateMode ? 'rgba(251,191,36,.04)' : 'var(--panel)',
                    border: `1px solid ${isUnresolved && gateMode ? 'rgba(251,191,36,.3)' : 'var(--line)'}`,
                    borderRadius: 'var(--radius)',
                    padding: '16px 18px',
                  }}
                >
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--faint)', marginBottom: 6 }}>
                    {dec.id}
                  </div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 12, lineHeight: 1.4 }}>
                    {dec.q}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {dec.options.map((opt) => {
                      const isChosen = chosenNow === opt;
                      const isInteractive = gateMode && isUnresolved;
                      return (
                        <button
                          key={opt}
                          onClick={isInteractive ? () => selectOption(dec.id, opt) : undefined}
                          disabled={!isInteractive}
                          style={{
                            padding: '6px 14px',
                            borderRadius: 999,
                            fontSize: 12.5,
                            border: `1.5px solid ${isChosen ? 'var(--green)' : 'var(--line-2)'}`,
                            background: isChosen ? 'rgba(74,222,128,.1)' : 'var(--panel-2)',
                            color: isChosen ? 'var(--green)' : 'var(--dim)',
                            cursor: isInteractive ? 'pointer' : 'default',
                            boxShadow: isChosen ? '0 0 0 1px rgba(74,222,128,.2)' : 'none',
                            transition: 'border-color 0.15s, background 0.15s, color 0.15s',
                            fontFamily: 'inherit',
                          }}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>
                  {dec.note && (
                    <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 10, fontStyle: 'italic' }}>
                      {dec.note}
                    </div>
                  )}
                  {gateMode && isUnresolved && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--amber)', marginTop: 6, fontFamily: 'var(--font-display)', fontWeight: 600 }}>
                      ⬡ Awaiting your choice
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
