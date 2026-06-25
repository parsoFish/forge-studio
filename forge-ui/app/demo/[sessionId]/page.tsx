'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import {
  listDemoSessions,
  demoBuilderBrief,
  listDemoHistory,
  listDemoElements,
  architectFileUrl,
  type DemoSessionSummary,
  type DemoBuilderPhase,
  type DemoHistoryEntry,
  type DemoElementSummary,
} from '@/lib/bridge-client';
import { fetchStudioProjects, type DemoStep } from '@/lib/studio-client';
import { StudioArchitectShell } from '@/components/StudioArchitectShell';
import { StageHex } from '@/components/StageHex';
import { SessionBriefing } from '@/components/SessionBriefing';
import { DemoReview } from '@/components/DemoReview';
import { ArchitectActivityLog } from '@/components/ArchitectActivityLog';
import { useNowTicker } from '@/lib/use-now-ticker';
import { useCycleEvents } from '@/lib/use-cycle-events';
import { STATUS_COLOR } from '@/lib/status-colors';

const STEP_KIND_LABEL: Record<DemoStep['kind'], string> = {
  capture: 'capture',
  verify: 'verify',
  present: 'present',
};

/**
 * Demo-builder review surface (Stage B). Mirrors the instructions-creator
 * interview surface (`/instructions/<sid>`): the demo agent builds a
 * reproducible DEMO.html for the managed project, gates it for review, then
 * locks it. Reuses the same Studio chrome (StudioArchitectShell), the shared
 * StageHex primitive, and the live event tail (useCycleEvents).
 *
 * The `DemoBuilderPhase` union differs from the architect/instructions phases,
 * so a small local {@link demoHexMeta} maps it onto the shared StageHex
 * `{label, glow, frac, active}` shape rather than forcing the architect-hex
 * helpers.
 *
 * Phase handling:
 *   - generating | locking → Status + ArchitectActivityLog
 *   - awaiting-review → DemoReview (the DEMO.html gate + feedback/lock/abandon)
 *   - locked → success box, link back to the project
 *   - abandoned → status
 */

type DemoHexMeta = { label: string; glow: string; frac: number; active: boolean };

/** Demo phase → hex visual meta. generating/locking read active (working);
 *  awaiting-review needs the operator; locked is complete; abandoned is idle. */
function demoHexMeta(phase: DemoBuilderPhase): DemoHexMeta {
  switch (phase) {
    case 'generating':
      return { label: 'building the demo', glow: STATUS_COLOR.active, frac: 0.4, active: true };
    case 'awaiting-review':
      return { label: 'demo ready — your call', glow: STATUS_COLOR.attention, frac: 0.8, active: false };
    case 'locking':
      return { label: 'locking the demo in', glow: STATUS_COLOR.active, frac: 0.92, active: true };
    case 'locked':
      return { label: 'locked', glow: STATUS_COLOR.complete, frac: 1, active: false };
    case 'abandoned':
      return { label: 'abandoned', glow: STATUS_COLOR.idle, frac: 1, active: false };
    default:
      return { label: phase, glow: STATUS_COLOR.idle, frac: 0, active: false };
  }
}

export default function DemoBuilderPage({
  params,
}: {
  params: { sessionId: string };
}): JSX.Element {
  const sessionId = decodeURIComponent(params.sessionId);
  const cycleId = `_demo-${sessionId}`;

  const [session, setSession] = useState<DemoSessionSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [demoProcess, setDemoProcess] = useState<DemoStep[]>([]);
  // The forge demo-element library — used to resolve an `element` id on a
  // demoProcess step to its human name in the demo-process-ref panel.
  const [elements, setElements] = useState<DemoElementSummary[]>([]);
  // Previously-locked demos for this project (newest first), with their
  // bridge-relative demoUrls pre-resolved to absolute so a View click is sync.
  const [history, setHistory] = useState<ResolvedHistoryEntry[]>([]);
  const nowMs = useNowTicker();

  const loadSession = useCallback(() => {
    listDemoSessions()
      .then((list) => {
        setSession(list.find((s) => s.sessionId === sessionId) ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [sessionId]);

  useEffect(() => {
    loadSession();
    const poll = setInterval(loadSession, 3000);
    return () => clearInterval(poll);
  }, [loadSession]);

  // Load the forge demo-element library once (to label composed demoProcess steps).
  useEffect(() => {
    let cancelled = false;
    listDemoElements()
      .then((els) => { if (!cancelled) setElements(els); })
      .catch(() => { /* leave empty — badges fall back to the raw element id */ });
    return () => { cancelled = true; };
  }, []);

  // Resolve the configured demo process for this session's project so the
  // generating/review views can show the demo adheres to it.
  useEffect(() => {
    if (!session?.project) return;
    let cancelled = false;
    fetchStudioProjects()
      .then((ps) => {
        if (cancelled) return;
        const p = ps.find((x) => x.id === session.project);
        setDemoProcess(Array.isArray(p?.demoProcess) ? p!.demoProcess! : []);
      })
      .catch(() => { /* leave empty */ });
    return () => { cancelled = true; };
  }, [session?.project]);

  // Load the project's previously-locked demo history once the project is known,
  // and refresh it whenever the phase becomes 'locked' (a new lock appends a
  // snapshot). Pre-resolve each bridge-relative demoUrl to absolute so the
  // per-row "View" click can open synchronously in a new tab.
  useEffect(() => {
    if (!session?.project) return;
    let cancelled = false;
    listDemoHistory(session.project)
      .then(async (entries) => {
        const resolved = await Promise.all(
          entries.map(async (entry) => ({
            ...entry,
            resolvedUrl: await architectFileUrl(entry.demoUrl),
          })),
        );
        if (!cancelled) setHistory(resolved);
      })
      .catch(() => { /* leave existing history */ });
    return () => { cancelled = true; };
  }, [session?.project, session?.phase]);

  const events = useCycleEvents(cycleId, (msg) => {
    if (msg.type === 'demo-list-changed') loadSession();
  });

  const meta = session ? demoHexMeta(session.phase) : null;

  return (
    <StudioArchitectShell
      dataPage="demo-builder"
      ready={loaded}
      title="demo"
      idLabel={sessionId}
      maxWidth={1480}
      mainData={{ 'data-session-id': sessionId, 'data-demo-phase': session?.phase ?? '' }}
    >
      {!loaded ? (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>Loading session…</div>
      ) : !session ? (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>
          Session not found (it may still be starting, or has been locked/abandoned).{' '}
          <Link href="/" style={{ color: 'var(--ember)' }}>
            Back to Forge Studio
          </Link>
          .
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>
          {meta && (
            <StageHex
              title="demo"
              component="demo-hex"
              statusLabel={meta.label}
              glow={meta.glow}
              frac={meta.frac}
              active={meta.active}
              events={events}
              nowMs={nowMs}
              extraData={{
                'data-demo-phase': session.phase,
                'data-demo-active': meta.active ? 'true' : 'false',
              }}
            />
          )}

          <div style={{ minWidth: 0 }}>
            <Link href={`/projects/${encodeURIComponent(session.project)}`} data-action="back-to-project" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--dim)', textDecoration: 'none', marginBottom: 12 }}>← Back to project</Link>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 4, fontWeight: 600 }}>
              Building DEMO.html
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 16, fontFamily: 'var(--font-mono)' }}>
              {session.project}
            </div>

            {session.targetElement && (
              <div
                data-section="demo-target-element"
                data-target-element={session.targetElement}
                style={{
                  fontSize: 12.5, color: 'var(--steel, #5cc8ff)', lineHeight: 1.5,
                  padding: '10px 14px', marginBottom: 16,
                  background: 'rgba(92,200,255,.07)', border: '1px solid rgba(92,200,255,.3)',
                  borderRadius: 10,
                }}
              >
                ⟳ Iterating the{' '}
                <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>
                  &lsquo;{elementName(elements, session.targetElement)}&rsquo;
                </strong>{' '}
                element — perfect this one, then compose the full demo.
              </div>
            )}

            {session.phase === 'briefing' && (
              <SessionBriefing
                heading="Demo agent"
                modeLabel={session.mode === 'update' ? 'update demo' : 'create demo'}
                notesPlaceholder={
                  session.mode === 'update'
                    ? 'What should change about the current demo? (optional)'
                    : 'Look-and-feel notes for the demo (optional)'
                }
                onSubmit={(notes) =>
                  demoBuilderBrief({
                    project: session.project,
                    sessionId: session.sessionId,
                    brief: notes,
                  }).then(() => loadSession())
                }
              />
            )}

            {(session.phase === 'generating' || session.phase === 'locking') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Status
                  label={
                    session.phase === 'locking'
                      ? 'Locking the demo in…'
                      : 'The demo agent is building the demo…'
                  }
                />
                <DemoProcessRef steps={demoProcess} elements={elements} targetElement={session.targetElement} />
                <ArchitectActivityLog events={events} />
              </div>
            )}

            {session.phase === 'awaiting-review' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <DemoReview
                  project={session.project}
                  sessionId={session.sessionId}
                  demoUrl={session.demoUrl}
                  iteration={session.iteration}
                />
                <DemoProcessRef steps={demoProcess} elements={elements} targetElement={session.targetElement} />
              </div>
            )}

            {session.phase === 'locked' && (
              <div
                data-section="demo-status"
                style={{
                  border: '1px solid rgba(74,222,128,.4)',
                  borderRadius: 10,
                  padding: '16px 18px',
                  background: 'rgba(74,222,128,.07)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <span style={{ fontSize: 13, color: 'var(--green)' }}>
                  Demo locked — reproducible from .forge/demo/.
                </span>
                <Link
                  href={`/projects/${encodeURIComponent(session.project)}`}
                  data-action="back-to-project"
                  style={btnLinkStyle}
                >
                  Back to the project →
                </Link>
              </div>
            )}

            {session.phase === 'abandoned' && <Status label="Demo abandoned." />}

            <PreviousDemos history={history} />
          </div>
        </div>
      )}
    </StudioArchitectShell>
  );
}

/** A {@link DemoHistoryEntry} with its bridge-relative demoUrl pre-resolved to
 *  an absolute URL (so the View action can `window.open` synchronously). */
type ResolvedHistoryEntry = DemoHistoryEntry & { resolvedUrl: string };

/** Format a lockedAt ISO timestamp readably; fall back to the entry id when null. */
function historyLabel(entry: ResolvedHistoryEntry): string {
  if (!entry.lockedAt) return entry.id;
  const d = new Date(entry.lockedAt);
  return Number.isNaN(d.getTime()) ? entry.lockedAt : d.toLocaleString();
}

/** Previously-locked demos for this project (newest first). Renders nothing when
 *  the project has no locked demos yet. Each row links out to the snapshotted
 *  DEMO.html (pre-resolved absolute URL) in a new tab. */
function PreviousDemos({ history }: { history: ResolvedHistoryEntry[] }): JSX.Element | null {
  if (history.length === 0) return null;
  return (
    <div
      data-section="demo-history"
      data-demo-history-count={history.length}
      style={{
        marginTop: 16,
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '12px 16px',
        background: 'var(--panel)',
      }}
    >
      <div style={{ fontSize: 10.5, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>
        Previous demos
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {history.map((entry) => (
          <li
            key={entry.id}
            data-demo-history-id={entry.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              fontSize: 12.5,
              color: 'var(--dim)',
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ color: 'var(--text)' }}>{historyLabel(entry)}</span>
              {entry.iterations != null && (
                <span style={{ marginLeft: 8, color: 'var(--faint)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  {entry.iterations} iter
                </span>
              )}
            </span>
            <button
              type="button"
              data-action="view-previous-demo"
              onClick={() => entry.resolvedUrl && window.open(entry.resolvedUrl, '_blank')}
              disabled={!entry.resolvedUrl}
              style={{
                flex: '0 0 auto',
                fontSize: 12,
                color: 'var(--ember)',
                background: 'transparent',
                border: 'none',
                cursor: entry.resolvedUrl ? 'pointer' : 'default',
                padding: 0,
                opacity: entry.resolvedUrl ? 1 : 0.5,
              }}
            >
              View →
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const btnLinkStyle: React.CSSProperties = {
  flex: '0 0 auto',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: '#238636',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '6px 14px',
  textDecoration: 'none',
  alignSelf: 'flex-start',
};

function Status({ label }: { label: string }): JSX.Element {
  return (
    <div
      data-section="demo-status"
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '14px 18px',
        background: 'var(--panel)',
        fontSize: 13,
        color: 'var(--dim)',
      }}
    >
      {label}
    </div>
  );
}

/** Resolve a library element id to its human name; falls back to the raw id. */
function elementName(elements: DemoElementSummary[], id: string): string {
  return elements.find((e) => e.id === id)?.name ?? id;
}

/** The configured demo process for the project — surfaced so it's clear the
 *  demo adheres to it. Steps composed from a forge library element render a
 *  small element badge; the element matching the session's per-element
 *  iteration target (`targetElement`) is marked as the focused element.
 *  Empty steps = nothing configured yet. */
function DemoProcessRef({
  steps,
  elements,
  targetElement,
}: {
  steps: DemoStep[];
  elements: DemoElementSummary[];
  targetElement: string | null;
}): JSX.Element | null {
  if (steps.length === 0) return null;
  return (
    <div
      data-section="demo-process-ref"
      data-step-count={steps.length}
      style={{
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '12px 16px',
        background: 'var(--panel)',
      }}
    >
      <div style={{ fontSize: 10.5, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 8 }}>
        The demo process this follows
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--dim)', lineHeight: 1.7 }}>
        {steps.map((s, i) => {
          const isFocus = !!s.element && s.element === targetElement;
          return (
            <li key={i} data-step-kind={s.kind} data-step-element={s.element ?? ''}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--steel, #5cc8ff)', marginRight: 6 }}>
                [{STEP_KIND_LABEL[s.kind]}]
              </span>
              {s.text}
              {s.element && (
                <span
                  data-element-badge={s.element}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    marginLeft: 8, padding: '1px 8px', borderRadius: 999,
                    fontSize: 10.5, fontWeight: 600, verticalAlign: 'middle',
                    border: isFocus ? '1px solid rgba(92,200,255,.5)' : '1px solid var(--line-2)',
                    background: isFocus ? 'rgba(92,200,255,.12)' : 'var(--bg-2)',
                    color: isFocus ? 'var(--steel, #5cc8ff)' : 'var(--text)',
                  }}
                >
                  {elementName(elements, s.element)}
                  {isFocus && (
                    <span data-element-focus="true" style={{ color: 'var(--steel, #5cc8ff)', fontSize: 10 }}>● focus</span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
