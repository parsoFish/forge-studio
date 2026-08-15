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
 * `.tsx` wiring here is verified by `tsc`/`next build` plus the pure-logic
 * unit tests in `lib/kb-drain-view.test.ts` and `lib/agent-dispatch.test.ts`
 * — this repo has no jsdom (see `RunPanel.tsx`'s own header for why a
 * simulated click/render pass isn't available), so this file's own
 * correctness rides on those two, plus the source-text pins in
 * `lib/knowledge-page-tabs.test.ts`.
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

const primaryBtn: CSSProperties = {
  fontSize: 12, padding: '7px 14px', background: 'var(--panel-2)', color: 'var(--c-kb)',
  border: '1px solid var(--c-kb)', borderRadius: 5, cursor: 'pointer', fontWeight: 600,
};
const btn: CSSProperties = {
  fontSize: 11.5, padding: '5px 11px', background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer',
};

const OUTCOME_GLYPH: Record<KbDrainPerFinding['outcome'], string> = { cleared: '✓', 'not-cleared': '⚠', 'needs-you': '?' };

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
  // without needing runId itself to change.
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
  const copy = drainStateCopy(displayState, status?.costUsd ?? 0);
  const tiers = status ? findingsByTier(status.perFinding) : { auto: [], agent: [], user: [] };
  const userStep = resolveUserTierStep(tiers.user, userIdx);
  const progressFindings = [...tiers.auto, ...tiers.agent];

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
    pollAgentFix(kbId, d.runId, {
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

  return (
    <div
      id="kb-drain-panel"
      data-component="kb-drain-panel"
      data-drain-state={displayState}
      data-drain-round={status?.round ?? 0}
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
          style={{ ...primaryBtn, opacity: dispatching || displayState === 'running' ? 0.6 : 1 }}
          disabled={dispatching || displayState === 'running' || attaching}
          onClick={() => void handleDrain()}
        >
          {dispatching ? 'Starting…' : displayState === 'running' ? 'Draining…' : 'Drain to green'}
        </button>

        {status && (
          <span data-component="drain-state-chip" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
            {copy.label}{status.round > 0 ? ` · round ${status.round}/${KB_DRAIN_MAX_ROUNDS_DISPLAY}` : ''}
          </span>
        )}

        {status && (
          <span style={{ fontSize: 11.5, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
            auto {status.counts.auto} · agent {status.counts.agent} · you {status.counts.user} · ${status.costUsd.toFixed(2)}
          </span>
        )}

        {displayState === 'timed-out' && (
          <button data-action="recheck-drain" style={btn} onClick={handleRecheck}>Re-check</button>
        )}
      </div>

      {dispatchError && (
        <div data-component="drain-dispatch-error" style={{ fontSize: 11.5, color: 'var(--error, #f87171)', marginTop: 8 }}>
          {dispatchError}
        </div>
      )}

      {(status || attaching) && (
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
      {status?.state === 'needs-you' && (
        <div data-drain-section="needs-you" data-user-index={userIdx} data-user-total={userStep.total} style={{ marginTop: 14 }}>
          {userStep.finding ? (
            <>
              <FindingRow f={userStep.finding} />
              <textarea
                data-component="user-resolution-input"
                value={userNote}
                onChange={(e) => setUserNote(e.target.value)}
                placeholder="What should forge do about this?"
                rows={3}
                style={{ width: '100%', marginTop: 8, fontSize: 12, fontFamily: 'var(--font-mono)', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--line-2)', borderRadius: 5, padding: 7, resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button
                  data-action="submit-user-resolution"
                  style={{ ...btn, borderColor: 'var(--c-kb)', color: 'var(--c-kb)' }}
                  disabled={userBusy || userNote.trim() === ''}
                  onClick={() => void submitUserAnswer()}
                >
                  {userBusy ? 'Applying…' : 'Apply answer'}
                </button>
                <button data-action="skip-user-resolution" style={btn} disabled={userBusy} onClick={skipUser}>
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

      {status?.state === 'green' && (
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
          costUsd={status?.costUsd}
        />
      )}

      {onChanged && status && isKbDrainTerminal(displayState) && <DrainChangedSignal onChanged={onChanged} state={displayState} />}
    </div>
  );
}

/** Fires `onChanged` exactly once per (freshly reached) terminal state —
 *  refreshes the parent's own KB detail fetch so the rest of the Health tab
 *  (KbHealth's counts) reflects the drain's real effect, without the panel
 *  re-running its own separate fetch of the same data. */
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
