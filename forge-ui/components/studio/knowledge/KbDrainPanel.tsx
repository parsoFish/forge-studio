'use client';

/**
 * KbDrainPanel — the ONE button on KB health (W6-B13): click "Drain to
 * green" and forge iteratively fixes every auto- and agent-tier lint
 * finding for this KB, server-side, until it's green or honestly stops and
 * says why (`cli/bridge-studio-kb-drain.ts`'s `runKbDrain` state machine —
 * see that file's own header for the full green/needs-you/no-progress/
 * round-cap/cost-ceiling/failed table). This component is a pure OBSERVER
 * of that server state: nav-away never loses the work, because the work was
 * never IN this component — `_logs/_kb-drain-<runId>/status.json` is the
 * single source of truth, and mounting always re-attaches to it first
 * (`fetchActiveOrLatestKbDrain`) instead of assuming a fresh, run-less
 * state.
 *
 * REPLACES `LintResolutionPanel.tsx` (deleted): that component owned a
 * client-side "fix all N with agent" loop (`fixAllAgent`, dispatching one
 * turn per finding and polling each to completion IN THE BROWSER) — the
 * exact fragile-loop poll-state pattern this batch retires (see
 * `cli/bridge-studio-kb-drain.ts`'s own header for why that logic moved
 * server-side). The ONE piece that survives is the USER tier: an operator
 * decision the drain loop never makes on its own. When the server reports
 * `state: 'needs-you'`, this panel walks the operator through each
 * remaining user-tier finding one at a time, same UX as the old panel's own
 * Stage 3 — but its poll (`pollAgentFix`, `lib/agent-dispatch.ts`) now has
 * an explicit `'timed-out'` state instead of the old `pollFix`'s silent
 * still-'running'-forever (sweep finding C9#2), and stepping past the last
 * finding reaches an explicit "reviewed all N" completion instead of
 * re-showing the same last item forever (sweep finding C9#3) —
 * `resolveUserTierStep`, `lib/kb-drain-view.ts`.
 *
 * CONTAINER/VIEW SPLIT (review round, reviewer HIGH finding): this file's
 * "interesting" states (running/green/needs-you/...) only ever exist via
 * async fetch/poll results, which `renderToStaticMarkup` never runs — a
 * single-component RunPanel-style render test could only ever observe this
 * file's permanently-stuck 'attaching' initial state. `KbDrainPanelView`
 * below is the pure, hooks-free presentational half (state in via props,
 * callbacks out via props) — exported specifically so
 * `lib/kb-drain-panel-render.test.ts` can drive every terminal-vocab value +
 * 'running' + the disabled-button matrix directly, the same way
 * `KbHealth.tsx` (already a plain props-in component) is tested. `KbDrainPanel`
 * itself stays the container: all hooks/effects/fetch/poll wiring, verified
 * by `tsc`/`next build` plus `lib/kb-drain-view.test.ts` +
 * `lib/agent-dispatch.test.ts` (no jsdom in this repo — see `RunPanel.tsx`'s
 * own header for why a simulated click/effect pass isn't available for the
 * CONTAINER half).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  dispatchKbDrain, fetchActiveOrLatestKbDrain, dispatchAgentFix,
  type KbDrainPerFinding,
} from '@/lib/studio-client';
import { pollKbDrain, pollAgentFix, type PolledKbDrainStatus } from '@/lib/agent-dispatch';
import {
  drainStateCopy, findingsByTier, resolveUserTierStep, isKbDrainTerminal,
  KB_DRAIN_MAX_ROUNDS_DISPLAY, type KbDrainDisplayState,
} from '@/lib/kb-drain-view';
import { ActivityLog } from '@/components/studio/ActivityLog';
import { useCycleEvents } from '@/lib/use-cycle-events';
import type { EventLogEntry } from '@/lib/bridge-client';

const primaryBtn: CSSProperties = {
  fontSize: 12, padding: '7px 14px', background: 'var(--panel-2)', color: 'var(--c-kb)',
  border: '1px solid var(--c-kb)', borderRadius: 5, cursor: 'pointer', fontWeight: 600,
};
const btn: CSSProperties = {
  fontSize: 11.5, padding: '5px 11px', background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer',
};

const OUTCOME_GLYPH: Record<KbDrainPerFinding['outcome'], string> = { cleared: '✓', 'not-cleared': '⚠', 'needs-you': '?' };

// ---------------------------------------------------------------------------
// Container — hooks, effects, fetch/poll wiring. No render-shape decisions
// live here beyond deriving the props KbDrainPanelView needs.
// ---------------------------------------------------------------------------

export function KbDrainPanel({ kbId, onChanged }: { kbId: string; onChanged?: () => void }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<PolledKbDrainStatus | null>(null);
  const [attaching, setAttaching] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [pollNonce, setPollNonce] = useState(0);

  // User-tier walkthrough (the one surviving piece of LintResolutionPanel).
  const [userIdx, setUserIdx] = useState(0);
  const [userNote, setUserNote] = useState('');
  const [userBusy, setUserBusy] = useState(false);
  const [userMsg, setUserMsg] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // The in-flight user-tier fix poll's own stop fn (review round, reviewer
  // MEDIUM finding): `submitUserAnswer` dispatches this imperatively (not
  // from inside a useEffect, since it's a click handler), so nothing
  // previously cancelled it on unmount — an unmounted panel would still take
  // a late `onUpdate` callback and try to `setState` on a dead component.
  // Stored here and cancelled in the SAME unmount cleanup as the runId poll
  // effect below. The underlying mechanism this relies on — a still-running
  // poll, once its returned stop fn is called, makes zero further fetch
  // calls — is pinned directly in `lib/agent-dispatch.test.ts` ("pollAgentFix:
  // 'unmount mid-poll'…"); this file's own container wiring is otherwise only
  // verified by `tsc`/`next build` (no jsdom in this repo).
  const userPollStopRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => { userPollStopRef.current?.(); };
  }, []);

  // Reattach on mount / kbId change — GET the active-or-latest run instead
  // of assuming a fresh, run-less state. This is what makes nav-away and
  // back show the SAME live/terminal state rather than resetting to idle.
  useEffect(() => {
    let cancelled = false;
    setAttaching(true);
    setRunId(null);
    setStatus(null);
    setUserIdx(0);
    setUserNote('');
    setUserMsg(null);
    fetchActiveOrLatestKbDrain(kbId).then((r) => {
      if (cancelled) return;
      setAttaching(false);
      if (r.runId) {
        setRunId(r.runId);
        setStatus(r);
      }
    }).catch(() => { if (!cancelled) setAttaching(false); });
    return () => { cancelled = true; };
  }, [kbId]);

  // Poll while a run is known. `pollNonce` lets the "Re-check" button
  // restart a bounded poll for the SAME runId after a watch timeout,
  // without needing runId itself to change. The returned stop fn is the
  // effect's own cleanup — cancelled automatically on unmount or re-run.
  useEffect(() => {
    if (!runId) return;
    return pollKbDrain(kbId, runId, { onUpdate: (s) => { if (mountedRef.current) setStatus(s); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, kbId, pollNonce]);

  const attachRun = useCallback((r: PolledKbDrainStatus) => {
    setUserIdx(0); setUserNote(''); setUserMsg(null);
    setStatus(r);
    setRunId(r.runId);
    setPollNonce((n) => n + 1);
  }, []);

  const handleDrain = useCallback(async () => {
    setDispatching(true);
    setDispatchError(null);
    const r = await dispatchKbDrain(kbId);
    if (!mountedRef.current) return;
    setDispatching(false);
    if (r.ok && r.runId) {
      attachRun({ ok: true, runId: r.runId, kbId, state: 'running', round: 0, counts: { auto: 0, agent: 0, user: 0 }, perFinding: [], costUsd: 0, updatedAt: new Date().toISOString() });
      return;
    }
    // 409 (already active) or any other dispatch failure — studioPost drops
    // the response body on a non-2xx, so recover the REAL active run via
    // the reattach route rather than trust anything off this call's error
    // path (covers a double-click race honestly instead of surfacing a
    // spurious "already active" error the operator can't act on).
    const active = await fetchActiveOrLatestKbDrain(kbId);
    if (!mountedRef.current) return;
    if (active.runId) {
      attachRun(active);
      return;
    }
    setDispatchError(r.error ?? 'drain dispatch failed');
  }, [kbId, attachRun]);

  const handleRecheck = useCallback(() => {
    setPollNonce((n) => n + 1);
  }, []);

  const cycleId = runId ? `_kb-drain-${runId}` : '';
  const events = useCycleEvents(cycleId);

  const displayState: KbDrainDisplayState = status?.state ?? (attaching ? 'attaching' : 'idle');
  const tiers = status ? findingsByTier(status.perFinding) : { auto: [], agent: [], user: [] };
  const userStep = resolveUserTierStep(tiers.user, userIdx);

  const submitUserAnswer = useCallback(async () => {
    const f = userStep.finding;
    if (!f) return;
    setUserBusy(true);
    setUserMsg(null);
    const decision = userNote.trim();
    const fixHint = decision
      ? `The operator decided: ${decision}\n\nApply this decision to resolve the finding: ${f.message}`
      : f.message;
    const d = await dispatchAgentFix(kbId, { file: f.file, check: f.check, kind: f.kind, fixHint, message: f.message });
    if (!mountedRef.current) return;
    if (!d.ok || !d.runId) {
      setUserBusy(false);
      setUserMsg(d.error ?? 'dispatch failed');
      return;
    }
    userPollStopRef.current = pollAgentFix(kbId, d.runId, {
      onUpdate: (s) => {
        if (!mountedRef.current || s.state === 'running') return;
        setUserBusy(false);
        if (s.state === 'cleared') {
          setUserNote('');
          setUserMsg(null);
          // Re-verify with a fresh drain pass — resolving a user-tier
          // finding continues the SAME "drain to green" loop, never a
          // client-side guess about what's left.
          void handleDrain();
        } else if (s.state === 'timed-out') {
          setUserMsg('still working — the fix may still land; re-check in a moment (never silently reset)');
        } else {
          setUserMsg(`agent could not apply it (${s.state}) — refine your answer and retry`);
        }
      },
    });
  }, [kbId, userNote, userStep.finding, handleDrain]);

  const skipUser = useCallback(() => {
    setUserNote('');
    setUserMsg(null);
    setUserIdx((i) => i + 1);
  }, []);

  const hasStatus = displayState !== 'idle' && displayState !== 'attaching';

  return (
    <>
      <KbDrainPanelView
        displayState={displayState}
        round={status?.round ?? 0}
        runId={runId}
        costUsd={status?.costUsd ?? 0}
        counts={status?.counts ?? { auto: 0, agent: 0, user: 0 }}
        perFinding={status?.perFinding ?? []}
        dispatching={dispatching}
        attaching={attaching}
        dispatchError={dispatchError}
        userIdx={userIdx}
        userNote={userNote}
        userBusy={userBusy}
        userMsg={userMsg}
        events={events}
        onDrain={() => void handleDrain()}
        onRecheck={handleRecheck}
        onUserNoteChange={setUserNote}
        onSubmitUserAnswer={() => void submitUserAnswer()}
        onSkipUser={skipUser}
      />
      {onChanged && hasStatus && isKbDrainTerminal(displayState) && (
        <DrainChangedSignal onChanged={onChanged} state={displayState} />
      )}
    </>
  );
}

/** Fires `onChanged` exactly once per (freshly reached) terminal state —
 *  refreshes the parent's own KB detail fetch so the rest of the Health tab
 *  (KbHealth's counts) reflects the drain's real effect, without the panel
 *  re-running its own separate fetch of the same data. A side-effect-only
 *  component (returns null) — kept OUT of KbDrainPanelView so that view
 *  stays free of any useEffect at all. */
function DrainChangedSignal({ onChanged, state }: { onChanged: () => void; state: KbDrainDisplayState }) {
  const lastRef = useRef<KbDrainDisplayState | null>(null);
  useEffect(() => {
    if (lastRef.current === state) return;
    lastRef.current = state;
    onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return null;
}

// ---------------------------------------------------------------------------
// View — pure, hooks-free, props-in/JSX-out. Exported so
// lib/kb-drain-panel-render.test.ts can drive every state directly via
// `renderToStaticMarkup`, the same way KbHealth.tsx is tested.
// ---------------------------------------------------------------------------

export type KbDrainPanelViewProps = {
  displayState: KbDrainDisplayState;
  round: number;
  runId: string | null;
  costUsd: number;
  counts: { auto: number; agent: number; user: number };
  perFinding: KbDrainPerFinding[];
  dispatching: boolean;
  attaching: boolean;
  dispatchError: string | null;
  userIdx: number;
  userNote: string;
  userBusy: boolean;
  userMsg: string | null;
  events: EventLogEntry[];
  onDrain: () => void;
  onRecheck: () => void;
  onUserNoteChange: (note: string) => void;
  onSubmitUserAnswer: () => void;
  onSkipUser: () => void;
};

export function KbDrainPanelView({
  displayState, round, runId, costUsd, counts, perFinding, dispatching, attaching,
  dispatchError, userIdx, userNote, userBusy, userMsg, events,
  onDrain, onRecheck, onUserNoteChange, onSubmitUserAnswer, onSkipUser,
}: KbDrainPanelViewProps) {
  const hasStatus = displayState !== 'idle' && displayState !== 'attaching';
  const copy = drainStateCopy(displayState, costUsd);
  const tiers = findingsByTier(perFinding);
  const userStep = resolveUserTierStep(tiers.user, userIdx);
  const progressFindings = [...tiers.auto, ...tiers.agent];
  const disableDrainButton = dispatching || displayState === 'running' || attaching;

  return (
    <div
      id="kb-drain-panel"
      data-component="kb-drain-panel"
      data-drain-state={displayState}
      data-drain-round={round}
      data-drain-run-id={runId ?? ''}
      style={{ borderBottom: '1px solid var(--line)', padding: '14px 16px' }}
    >
      <div className="panel-head" style={{ padding: 0, marginBottom: 10 }}>
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" fill="none" stroke="var(--c-kb)" strokeWidth="1.5" /></svg>
        DRAIN TO GREEN
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          data-action="drain-to-green"
          style={{ ...primaryBtn, opacity: disableDrainButton ? 0.6 : 1 }}
          disabled={disableDrainButton}
          onClick={onDrain}
        >
          {dispatching ? 'Starting…' : displayState === 'running' ? 'Draining…' : 'Drain to green'}
        </button>

        {hasStatus && (
          <span data-component="drain-state-chip" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
            {copy.label}{round > 0 ? ` · round ${round}/${KB_DRAIN_MAX_ROUNDS_DISPLAY}` : ''}
          </span>
        )}

        {hasStatus && (
          <span style={{ fontSize: 11.5, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
            auto {counts.auto} · agent {counts.agent} · you {counts.user} · ${costUsd.toFixed(2)}
          </span>
        )}

        {displayState === 'timed-out' && (
          <button data-action="recheck-drain" style={btn} onClick={onRecheck}>Re-check</button>
        )}
      </div>

      {dispatchError && (
        <div data-component="drain-dispatch-error" style={{ fontSize: 11.5, color: 'var(--error, #f87171)', marginTop: 8 }}>
          {dispatchError}
        </div>
      )}

      {(hasStatus || attaching) && (
        <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 8 }}>{copy.detail}</div>
      )}

      {/* This-round progress — auto+agent tier findings, whatever the
          terminal (or in-flight) state. */}
      {progressFindings.length > 0 && (
        <div data-drain-section="progress" style={{ marginTop: 12 }}>
          {progressFindings.map((f) => <FindingRow key={f.key} f={f} />)}
        </div>
      )}

      {/* USER tier — the one surviving piece of LintResolutionPanel. Only
          shown once the server has actually stopped and said "needs-you". */}
      {displayState === 'needs-you' && (
        <div data-drain-section="needs-you" data-user-index={userIdx} data-user-total={userStep.total} style={{ marginTop: 14 }}>
          {userStep.finding ? (
            <>
              <FindingRow f={userStep.finding} />
              <textarea
                data-component="user-resolution-input"
                value={userNote}
                onChange={(e) => onUserNoteChange(e.target.value)}
                placeholder="What should forge do about this?"
                rows={3}
                style={{ width: '100%', marginTop: 8, fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, padding: 7, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button
                  data-action="submit-user-resolution"
                  style={{ ...btn, borderColor: 'var(--c-kb)', color: 'var(--c-kb)' }}
                  disabled={userBusy || userNote.trim() === ''}
                  onClick={onSubmitUserAnswer}
                >
                  {userBusy ? 'Applying…' : 'Apply answer'}
                </button>
                <button data-action="skip-user-resolution" style={btn} disabled={userBusy} onClick={onSkipUser}>
                  Skip
                </button>
              </div>
              {userMsg && <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 6 }}>{userMsg}</div>}
            </>
          ) : userStep.done ? (
            <div data-component="user-tier-exhausted" style={{ fontSize: 12, color: 'var(--dim)' }}>
              Reviewed all {userStep.total} — none resolved yet. Re-run drain, or address them another way.
            </div>
          ) : null}
        </div>
      )}

      {displayState === 'green' && (
        <div data-component="drain-green" style={{ marginTop: 12, fontSize: 12, color: 'var(--c-kb)' }}>
          All lint findings resolved ✓
        </div>
      )}

      {runId && (
        <ActivityLog
          label="kb drain"
          events={events}
          phaseLabel={displayState}
          phaseActive={displayState === 'running'}
          costUsd={hasStatus ? costUsd : undefined}
        />
      )}
    </div>
  );
}

function FindingRow({ f }: { f: KbDrainPerFinding }) {
  return (
    <div
      data-drain-finding
      data-drain-finding-tier={f.tier}
      data-drain-finding-outcome={f.outcome}
      style={{ display: 'flex', gap: 6, alignItems: 'baseline', padding: '3px 0', fontSize: 11.5, color: 'var(--dim)', borderTop: '1px solid var(--line)' }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', color: f.outcome === 'not-cleared' ? 'var(--amber)' : 'var(--faint)', fontSize: 10 }}>
        {OUTCOME_GLYPH[f.outcome]}
      </span>
      <span style={{ flex: 1 }}>{f.message}</span>
    </div>
  );
}
