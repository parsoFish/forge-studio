'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  listDemoSessions,
  demoBuilderBrief,
  startDemoBuilder,
  demoFragmentUrl,
  listDemoHistory,
  listDemoElements,
  architectFileUrl,
  type DemoSessionSummary,
  type DemoBuilderPhase,
  type DemoHistoryEntry,
  type DemoElementSummary,
} from '@/lib/bridge-client';
import { fetchStudioProjects, type DemoStep } from '@/lib/studio-client';
import { SessionBriefing } from '@/components/SessionBriefing';
import { DemoReview } from '@/components/DemoReview';
import { ArchitectActivityLog } from '@/components/ArchitectActivityLog';
import { useCycleEvents } from '@/lib/use-cycle-events';
import { STATUS_COLOR } from '@/lib/status-colors';

/**
 * R1-03-F2 — the demo-builder review surface, folded off the standalone
 * `/demo/<sessionId>` route into the project page (beneath the Demo Timeline
 * panel). Behaviourally this is the same phase machine, briefing surface,
 * review gate, and demo-process panel the old page rendered — only the
 * chrome changed: no StudioNav/breadcrumb (the project page already has its
 * own), the 260px StageHex column collapses to a compact status strip, and
 * "back to project" links become an explicit close action so the panel can
 * live inline without navigating away.
 *
 * The panel opens its OWN `useCycleEvents` socket (scoped to `_demo-<sessionId>`),
 * exactly as the old page did. The project page itself does not open any
 * cycle-events / bridge subscription of its own, so there is no collision to
 * scope around — this remains a single extra socket for as long as the panel
 * is mounted, same cost as before.
 */

const STEP_KIND_LABEL: Record<DemoStep['kind'], string> = {
  capture: 'capture',
  verify: 'verify',
  present: 'present',
};

type DemoHexMeta = { label: string; glow: string; frac: number; active: boolean };

/** Demo phase → compact status-strip meta. generating/locking read active
 *  (working); awaiting-review needs the operator; locked is complete;
 *  abandoned is idle. */
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

export function DemoBuilderPanel({
  projectId,
  sessionId,
  onClose,
}: {
  projectId: string;
  sessionId: string;
  /** Called on every explicit close affordance (the top-right ✕ and the
   *  post-lock "Close" button) — the page owns clearing the active session id
   *  + query param and refetching project/preflight so ContractReadiness reacts. */
  onClose: () => void;
}): JSX.Element {
  const cycleId = `_demo-${sessionId}`;

  const [session, setSession] = useState<DemoSessionSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Which iterate action is in-flight: an element id, or '__whole__', or null.
  const [iterating, setIterating] = useState<string | null>(null);
  const [iterateError, setIterateError] = useState<string | null>(null);
  // When set, the panel shows that output in-app (an iframe) with a back button,
  // instead of opening a new tab.
  const [viewing, setViewing] = useState<{ url: string; label: string } | null>(null);
  const [demoProcess, setDemoProcess] = useState<DemoStep[]>([]);
  // The forge demo-element library — used to resolve an `element` id on a
  // demoProcess step to its human name in the demo-process-ref panel.
  const [elements, setElements] = useState<DemoElementSummary[]>([]);
  // Previously-locked demos for this project (newest first), with their
  // bridge-relative demoUrls pre-resolved to absolute so a View click is sync.
  const [history, setHistory] = useState<ResolvedHistoryEntry[]>([]);

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

  // Iterate ONE component: open a demo session focused on that element, brief it
  // with the component's own prompt (so it runs immediately on just that part).
  // Unlike the old standalone page, this does NOT navigate — the per-element
  // session runs in the background and this panel keeps showing the session it
  // was opened for; the operator returns to the timeline to pick it up once
  // `demo-list-changed` surfaces it (mirrors how the WHOLE-demo relaunch from
  // the timeline is handled by the page, not this panel — see DemoTimeline's
  // `onSessionStarted`).
  async function iteratePart(element: string, prompt: string): Promise<void> {
    if (iterating || !session) return;
    setIterateError(null);
    setIterating(element);
    try {
      const start = await startDemoBuilder({
        project: session.project,
        mode: session.hasLockedDemo ? 'update' : 'create',
        targetElement: element,
      });
      if (!start.ok || !start.sessionId) {
        setIterateError(start.error ?? 'failed to start the demo agent');
        return;
      }
      await demoBuilderBrief({ project: session.project, sessionId: start.sessionId, brief: prompt, targetElement: element });
    } catch (err) {
      setIterateError(err instanceof Error ? err.message : String(err));
    } finally {
      setIterating(null);
    }
  }

  // Show the current/locked DEMO.html (if one exists) in-app with a back button.
  async function viewCurrentDemo(): Promise<void> {
    if (!session?.demoUrl) return;
    const u = await architectFileUrl(session.demoUrl);
    if (u) setViewing({ url: u, label: 'the full demo' });
  }

  return (
    <div
      data-section="demo-builder-panel"
      data-demo-session={sessionId}
      data-demo-phase={session?.phase ?? ''}
      style={{
        marginTop: 20,
        border: '1px solid var(--line)',
        borderRadius: 10,
        padding: '18px 20px',
        background: 'var(--bg-2)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 700 }}>Building DEMO.html</div>
          <div style={{ fontSize: 11.5, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>{sessionId}</div>
        </div>
        <button
          type="button"
          data-action="close-demo-panel"
          onClick={onClose}
          style={{
            fontSize: 12, fontWeight: 600, color: 'var(--text)', background: 'var(--panel-2)',
            border: '1px solid var(--line-2)', borderRadius: 6, padding: '5px 11px', cursor: 'pointer',
          }}
        >
          ✕ Close
        </button>
      </div>

      {!loaded ? (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>Loading session…</div>
      ) : !session ? (
        <div style={{ color: 'var(--dim)', fontSize: 13 }}>
          Session not found (it may still be starting, or has been locked/abandoned).
        </div>
      ) : viewing ? (
        <DemoViewer url={viewing.url} label={viewing.label} onBack={() => setViewing(null)} />
      ) : (
        <>
          {meta && <StatusStrip meta={meta} phase={session.phase} />}

          {/* View the current/locked demo — available in every phase when a
              DEMO.html exists in the repo (so an already-built demo is viewable). */}
          {session.demoUrl && (
            <button
              type="button"
              data-action="view-current-demo"
              onClick={() => void viewCurrentDemo()}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 16,
                fontSize: 12.5, fontWeight: 600, color: '#fff', background: '#1f6feb',
                border: '1px solid var(--line)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
              }}
            >
              ⧉ View the current demo
            </button>
          )}

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
              <ArchitectActivityLog events={events} />
            </div>
          )}

          {session.phase === 'awaiting-review' && (
            <DemoReview
              project={session.project}
              sessionId={session.sessionId}
              demoUrl={session.demoUrl}
              iteration={session.iteration}
            />
          )}

          {iterateError && (
            <div data-section="iterate-error" style={{ fontSize: 12, color: 'var(--red, #f85149)', marginTop: 12 }}>
              {iterateError}
            </div>
          )}

          {/* The demo process — shown in EVERY phase. Each part can be iterated
              on its own (or the whole demo), and its output viewed independently. */}
          <DemoProcessPanel
            steps={demoProcess}
            elements={elements}
            project={session.project}
            sessionId={session.sessionId}
            fragments={session.fragments}
            targetElement={session.targetElement}
            iterating={iterating}
            onIteratePart={iteratePart}
            onView={(url, label) => setViewing({ url, label })}
          />

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
              <button type="button" data-action="close-demo-panel" onClick={onClose} style={btnStyle}>
                Close →
              </button>
            </div>
          )}

          {session.phase === 'abandoned' && <Status label="Demo abandoned." />}

          <PreviousDemos history={history} onView={(url, label) => setViewing({ url, label })} />
        </>
      )}
    </div>
  );
}

/** A {@link DemoHistoryEntry} with its bridge-relative demoUrl pre-resolved to
 *  an absolute URL (so the in-app View action can open it synchronously). */
type ResolvedHistoryEntry = DemoHistoryEntry & { resolvedUrl: string };

/** Format a lockedAt ISO timestamp readably; fall back to the entry id when null. */
function historyLabel(entry: ResolvedHistoryEntry): string {
  if (!entry.lockedAt) return entry.id;
  const d = new Date(entry.lockedAt);
  return Number.isNaN(d.getTime()) ? entry.lockedAt : d.toLocaleString();
}

/** Compact status strip — replaces the old page's 260px StageHex column now
 *  that this panel lives inline in the project page rather than as its own
 *  screen. Carries the same phase/active facts StageHex exposed via extraData. */
function StatusStrip({ meta, phase }: { meta: DemoHexMeta; phase: DemoBuilderPhase }): JSX.Element {
  return (
    <div
      data-section="demo-status-strip"
      data-demo-phase={phase}
      data-demo-active={meta.active ? 'true' : 'false'}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 8, background: 'var(--panel)',
      }}
    >
      <span
        style={{
          width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: meta.glow,
          boxShadow: meta.active ? `0 0 8px ${meta.glow}` : 'none',
        }}
      />
      <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600, whiteSpace: 'nowrap' }}>{meta.label}</span>
      <div style={{ flex: 1, height: 4, background: 'var(--line)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(meta.frac * 100)}%`, height: '100%', background: meta.glow, transition: 'width .3s' }} />
      </div>
    </div>
  );
}

/** Previously-locked demos for this project (newest first). Renders nothing when
 *  the project has no locked demos yet. Each row links out to the snapshotted
 *  DEMO.html (pre-resolved absolute URL) in a new tab. */
function PreviousDemos({ history, onView }: { history: ResolvedHistoryEntry[]; onView: (url: string, label: string) => void }): JSX.Element | null {
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
              onClick={() => entry.resolvedUrl && onView(entry.resolvedUrl, historyLabel(entry))}
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

const btnStyle: React.CSSProperties = {
  flex: '0 0 auto',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: '#238636',
  border: '1px solid var(--line)',
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
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

/** In-app viewer for a demo output (the full demo or one component) — a sandboxed
 *  iframe + a back button to the demo editor. No new tab. */
function DemoViewer({ url, label, onBack }: { url: string; label: string; onBack: () => void }): JSX.Element {
  return (
    <div data-section="demo-viewer">
      <button
        type="button"
        data-action="back-to-editor"
        onClick={onBack}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 12,
          fontSize: 12.5, fontWeight: 600, color: 'var(--text)', background: 'var(--panel-2)',
          border: '1px solid var(--line-2)', borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
        }}
      >
        ← Back to the demo editor
      </button>
      <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 12 }}>Viewing {label}</div>
      <iframe
        data-demo-view-iframe
        src={url}
        sandbox=""
        title={label}
        style={{ width: '100%', height: 'min(80vh, 1000px)', minHeight: 600, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }}
      />
    </div>
  );
}

/** Resolve a library element id to its human name; falls back to the raw id. */
function elementName(elements: DemoElementSummary[], id: string): string {
  return elements.find((e) => e.id === id)?.name ?? id;
}

/** The demo process — each part shown in every phase. The WHOLE demo is updated
 *  via the briefing "Start the agent" (notes prompt). Each element-bound component
 *  carries its own prompt box + an iterate button that runs the agent on JUST that
 *  component, plus a "view output" link to its rendered fragment. Empty steps =
 *  nothing configured yet (render nothing). */
function DemoProcessPanel({
  steps,
  elements,
  project,
  sessionId,
  fragments,
  targetElement,
  iterating,
  onIteratePart,
  onView,
}: {
  steps: DemoStep[];
  elements: DemoElementSummary[];
  project: string;
  sessionId: string;
  fragments: string[];
  targetElement: string | null;
  iterating: string | null;
  onIteratePart: (element: string, prompt: string) => void;
  onView: (url: string, label: string) => void;
}): JSX.Element | null {
  const [prompts, setPrompts] = useState<Record<string, string>>({});
  if (steps.length === 0) return null;

  async function viewOutput(element: string): Promise<void> {
    const u = await architectFileUrl(demoFragmentUrl(project, sessionId, element));
    if (u) onView(u, `the ${elementName(elements, element)} component`);
  }

  const anyBusy = iterating !== null;

  return (
    <div
      data-section="demo-process"
      data-step-count={steps.length}
      style={{ marginTop: 16, border: '1px solid var(--line)', borderRadius: 10, padding: '12px 16px', background: 'var(--panel)' }}
    >
      <div style={{ fontSize: 10.5, fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--faint)', marginBottom: 4 }}>
        The demo process — {steps.length} part{steps.length !== 1 ? 's' : ''}
      </div>
      <div style={{ fontSize: 11, color: 'var(--dim)', fontStyle: 'italic', marginBottom: 10 }}>
        Update the whole demo via “Start the agent” above. Or iterate one component below with its own prompt.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {steps.map((s, i) => {
          const isFocus = !!s.element && s.element === targetElement;
          const hasOutput = !!s.element && fragments.includes(s.element);
          const el = s.element;
          return (
            <div
              key={i}
              data-step-kind={s.kind}
              data-step-element={el ?? ''}
              style={{
                display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px',
                borderRadius: 8, border: `1px solid ${isFocus ? 'rgba(92,200,255,.4)' : 'var(--line-2)'}`,
                background: isFocus ? 'rgba(92,200,255,.06)' : 'var(--panel-2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--steel, #5cc8ff)', flexShrink: 0 }}>
                  {i + 1}. [{STEP_KIND_LABEL[s.kind]}]
                </span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {el ? elementName(elements, el) : (s.text || '— free text —')}
                  {el && s.text && <span style={{ color: 'var(--faint)', marginLeft: 6, fontSize: 11.5 }}>{s.text}</span>}
                  {isFocus && <span data-element-focus="true" style={{ color: 'var(--steel, #5cc8ff)', fontSize: 10, marginLeft: 6 }}>● focus</span>}
                </span>
                {el && (
                  <button
                    type="button"
                    data-action="view-element-output"
                    data-element-id={el}
                    onClick={() => hasOutput && void viewOutput(el)}
                    disabled={!hasOutput}
                    title={hasOutput ? 'View this part’s output' : 'No output rendered yet'}
                    style={{ flexShrink: 0, fontSize: 11.5, color: hasOutput ? 'var(--ember)' : 'var(--faint)', background: 'transparent', border: 'none', cursor: hasOutput ? 'pointer' : 'default', padding: 0 }}
                  >
                    View output →
                  </button>
                )}
              </div>

              {el ? (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                  <textarea
                    className="input"
                    data-element-prompt={el}
                    rows={1}
                    value={prompts[el] ?? ''}
                    onChange={(e) => setPrompts((p) => ({ ...p, [el]: e.target.value }))}
                    placeholder={`Notes for the ${elementName(elements, el)} component (optional)…`}
                    style={{ flex: 1, fontSize: 12, resize: 'vertical', minHeight: 32, boxSizing: 'border-box' }}
                  />
                  <button
                    type="button"
                    className="btn btn-ghost"
                    data-action="iterate-element"
                    data-element-id={el}
                    onClick={() => onIteratePart(el, prompts[el] ?? '')}
                    disabled={anyBusy}
                    style={{ flexShrink: 0, fontSize: 11.5, opacity: anyBusy ? 0.6 : 1, whiteSpace: 'nowrap' }}
                  >
                    {iterating === el ? 'Starting…' : '⟳ Iterate this component'}
                  </button>
                </div>
              ) : (
                <div style={{ fontSize: 11, color: 'var(--faint)', fontStyle: 'italic' }}>
                  Free-text step — bind it to a forge element in the project builder to iterate it on its own.
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
