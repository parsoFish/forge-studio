'use client';

/**
 * KbDrainPanel — the live OBSERVER of a KB's drain-to-green run (W6-B13,
 * reshaped by W7-B2). The DISPATCH button moved to `KbActionGroup.tsx` (the
 * one action group, knowledge-32/05) — this panel watches whatever run is
 * active-or-latest, renders per-finding rows (file · rule · outcome, grouped
 * by round — knowledge-08/12), an elapsed ticker + the run's real budget
 * (knowledge-14), a Stop control for a live run, and tails the drain's own
 * progress events (knowledge-01). Nav-away never loses the work: the server's
 * `_logs/_kb-drain-<runId>/status.json` is the single source of truth and
 * mounting always re-attaches (`fetchActiveOrLatestKbDrain`).
 *
 * The USER tier walkthrough (the one operator decision the drain loop never
 * makes on its own) is unchanged from W6-B13 — see `resolveUserTierStep`
 * (lib/kb-drain-view.ts).
 *
 * CONTAINER/VIEW SPLIT (unchanged discipline): `KbDrainPanelView` below is
 * the pure, hooks-free presentational half, exported for
 * `lib/kb-drain-panel-render.test.ts`; the container owns all fetch/poll
 * wiring (verified by `tsc`/`next build` — no jsdom in this repo).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  dispatchKbDrain, fetchActiveOrLatestKbDrain, dispatchAgentFix, cancelKbDrain,
  type KbDrainPerFinding,
} from '@/lib/studio-client';
import { pollKbDrain, pollAgentFix, pollDisplayState, type PolledKbDrainStatus } from '@/lib/agent-dispatch';
import {
  drainStateCopy, findingsByTier, resolveUserTierStep, isKbDrainTerminal,
  findingRounds, formatDrainElapsed, deriveDrainDisplayState,
  findingDisposition, findingRefusalReasons, findingHasDetail, deriveFindingNodeHref,
  KB_DRAIN_MAX_ROUNDS_DISPLAY, KB_DRAIN_OUTCOME_GLYPH, type KbDrainDisplayState,
} from '@/lib/kb-drain-view';
import { ActivityLog } from '@/components/studio/ActivityLog';
import { useCycleEvents } from '@/lib/use-cycle-events';
import type { EventLogEntry } from '@/lib/bridge-client';
import Link from 'next/link';

const btn: CSSProperties = {
  fontSize: 11.5, padding: '5px 11px', background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer',
};

/** W8-B2: the glyph vocabulary moved to `lib/kb-drain-view.ts` so it is
 *  exhaustively type-checked against the wire union in a file that is actually
 *  unit-tested — a new outcome with no glyph is now a compile error here. */
const OUTCOME_GLYPH = KB_DRAIN_OUTCOME_GLYPH;

/** Refused/repaired rows are the ones the operator most needs to notice; a
 *  landed one is ordinary. Colour follows that, not the tier. */
const DISPOSITION_TONE: Record<string, string> = {
  refused: 'var(--amber)',
  repaired: 'var(--c-kb)',
  drafted: 'var(--amber)',
  mixed: 'var(--amber)',
  applied: 'var(--faint)',
  none: 'var(--faint)',
};

// ---------------------------------------------------------------------------
// Container — hooks, effects, fetch/poll wiring.
// ---------------------------------------------------------------------------

export function KbDrainPanel({
  kbId,
  onChanged,
  attachNonce = 0,
  onDisplayStateChange,
}: {
  kbId: string;
  onChanged?: () => void;
  /** W7-B2: bumped by the action group after it dispatches a drain — makes
   *  this panel re-run its active-or-latest reattach without a remount. */
  attachNonce?: number;
  /** Reports every display-state change up (the action group's local gate). */
  onDisplayStateChange?: (state: KbDrainDisplayState) => void;
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<PolledKbDrainStatus | null>(null);
  const [attaching, setAttaching] = useState(true);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [pollNonce, setPollNonce] = useState(0);

  // Stop (cancel) — two-step arm/confirm, mirroring A2's cancel affordance.
  const [cancelArmed, setCancelArmed] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelMsg, setCancelMsg] = useState<string | null>(null);

  // Elapsed ticker — a real clock the view receives (never Date.now() there).
  const [nowMs, setNowMs] = useState(() => Date.now());

  // User-tier walkthrough (unchanged from W6-B13).
  const [userIdx, setUserIdx] = useState(0);
  const [userNote, setUserNote] = useState('');
  const [userBusy, setUserBusy] = useState(false);
  const [userMsg, setUserMsg] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const userPollStopRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    return () => { userPollStopRef.current?.(); };
  }, []);

  // Reattach on mount / kbId change / an action-group dispatch (attachNonce).
  useEffect(() => {
    let cancelled = false;
    setAttaching(true);
    setRunId(null);
    setStatus(null);
    setUserIdx(0);
    setUserNote('');
    setUserMsg(null);
    setCancelArmed(false);
    setCancelMsg(null);
    setDispatchError(null); // a previous KB's read failure is not this KB's state
    fetchActiveOrLatestKbDrain(kbId).then((r) => {
      if (cancelled) return;
      setAttaching(false);
      if (r.runId) {
        setRunId(r.runId);
        setStatus(r);
      } else if (!r.ok) {
        // The reattach READ failed — not "no run has ever run": surface it.
        setDispatchError(`could not read the drain state: ${r.error ?? 'read failed'}`);
      }
    }).catch(() => { if (!cancelled) setAttaching(false); });
    return () => { cancelled = true; };
  }, [kbId, attachNonce]);

  // Poll while a run is known — the poll itself is progress-aware now
  // (lib/agent-dispatch.ts's progressKey): a heartbeating run never times out.
  useEffect(() => {
    if (!runId) return;
    return pollKbDrain(kbId, runId, { onUpdate: (s) => { if (mountedRef.current) setStatus(s); } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, kbId, pollNonce]);

  // W7-B2: the ONE display-state derivation (lib/kb-drain-view.ts) — a
  // bridge-ANSWERED 4xx failed read derives 'unreadable' (the poll stopped;
  // never a fabricated 'running'); transport blips / 5xx keep 'running'
  // while the poll is genuinely still watching.
  const displayState: KbDrainDisplayState = deriveDrainDisplayState(status, attaching);

  // Report state up + tick the elapsed clock while running.
  useEffect(() => {
    onDisplayStateChange?.(displayState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayState]);
  useEffect(() => {
    if (displayState !== 'running') return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [displayState]);

  const attachRun = useCallback((r: PolledKbDrainStatus) => {
    setUserIdx(0); setUserNote(''); setUserMsg(null);
    setStatus(r);
    setRunId(r.runId);
    setPollNonce((n) => n + 1);
  }, []);

  /** Internal redispatch — the user-tier flow re-verifies with a fresh drain
   *  pass after a resolution lands. (The OPERATOR-facing dispatch button
   *  lives in KbActionGroup now.) */
  const handleDrain = useCallback(async () => {
    setDispatchError(null);
    const r = await dispatchKbDrain(kbId);
    if (!mountedRef.current) return;
    if (r.ok && r.runId) {
      attachRun({
        ok: true, runId: r.runId, kbId, state: 'running', round: 0,
        counts: { auto: 0, agent: 0, user: 0 }, perFinding: [], costUsd: 0,
        updatedAt: new Date().toISOString(), startedAt: new Date().toISOString(),
      });
      return;
    }
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

  const handleCancel = useCallback(async () => {
    if (!cancelArmed) {
      setCancelArmed(true);
      return;
    }
    setCancelBusy(true);
    const r = await cancelKbDrain(kbId);
    if (!mountedRef.current) return;
    setCancelBusy(false);
    setCancelArmed(false);
    if (!r.ok) {
      setCancelMsg(r.error ?? 'cancel failed');
      return;
    }
    setCancelMsg(r.mode === 'forced'
      ? 'run was dead (no heartbeat) — terminated directly'
      : 'stop requested — the run halts after its current turn');
    setPollNonce((n) => n + 1);
  }, [kbId, cancelArmed]);

  const cycleId = runId ? `_kb-drain-${runId}` : '';
  const events = useCycleEvents(cycleId);

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
        if (!mountedRef.current || pollDisplayState(s) === 'watching') return;
        setUserBusy(false);
        if (s.state === 'cleared') {
          setUserNote('');
          setUserMsg(null);
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
        kbId={kbId}
        startedAt={status?.startedAt}
        maxRounds={status?.maxRounds}
        maxCostUsd={status?.maxCostUsd}
        nowMs={nowMs}
        attaching={attaching}
        dispatchError={dispatchError}
        readError={status && !status.ok && status.error ? status.error : null}
        cancelArmed={cancelArmed}
        cancelBusy={cancelBusy}
        cancelMsg={cancelMsg}
        userIdx={userIdx}
        userNote={userNote}
        userBusy={userBusy}
        userMsg={userMsg}
        events={events}
        onCancel={() => void handleCancel()}
        onCancelDisarm={() => setCancelArmed(false)}
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

/** Fires `onChanged` exactly once per (freshly reached) terminal state. */
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
// View — pure, hooks-free, props-in/JSX-out. Exported for
// lib/kb-drain-panel-render.test.ts.
// ---------------------------------------------------------------------------

export type KbDrainPanelViewProps = {
  displayState: KbDrainDisplayState;
  round: number;
  runId: string | null;
  costUsd: number;
  counts: { auto: number; agent: number; user: number };
  perFinding: KbDrainPerFinding[];
  /** W8-B2 (ON-3): the KB whose findings these are — the Explore deep link is
   *  DERIVED from it plus the finding's own path, never stored on the row. */
  kbId: string;
  /** W7-B2 (knowledge-14): elapsed + real budget — optional (pre-W7 runs). */
  startedAt?: string;
  maxRounds?: number;
  maxCostUsd?: number;
  nowMs: number;
  attaching: boolean;
  dispatchError: string | null;
  readError?: string | null;
  cancelArmed: boolean;
  cancelBusy: boolean;
  cancelMsg: string | null;
  userIdx: number;
  userNote: string;
  userBusy: boolean;
  userMsg: string | null;
  events: EventLogEntry[];
  onCancel: () => void;
  onCancelDisarm: () => void;
  onRecheck: () => void;
  onUserNoteChange: (note: string) => void;
  onSubmitUserAnswer: () => void;
  onSkipUser: () => void;
};

export function KbDrainPanelView({
  displayState, round, runId, costUsd, counts, perFinding, kbId,
  startedAt, maxRounds, maxCostUsd, nowMs,
  attaching, dispatchError, readError = null,
  cancelArmed, cancelBusy, cancelMsg,
  userIdx, userNote, userBusy, userMsg, events,
  onCancel, onCancelDisarm, onRecheck, onUserNoteChange, onSubmitUserAnswer, onSkipUser,
}: KbDrainPanelViewProps) {
  const hasStatus = displayState !== 'idle' && displayState !== 'attaching';
  const copy = drainStateCopy(displayState, costUsd);
  const tiers = findingsByTier(perFinding);
  const userStep = resolveUserTierStep(tiers.user, userIdx);
  const progressFindings = [...tiers.auto, ...tiers.agent];
  const rounds = findingRounds(progressFindings);
  const roundsDisplay = maxRounds ?? KB_DRAIN_MAX_ROUNDS_DISPLAY;
  const elapsed = displayState === 'running' ? formatDrainElapsed(startedAt, nowMs) : null;

  return (
    <div
      id="kb-drain-panel"
      data-component="kb-drain-panel"
      data-drain-state={displayState}
      data-drain-round={round}
      data-drain-run-id={runId ?? ''}
      {...(readError ? { 'data-drain-read-error': readError } : {})}
      style={{ borderBottom: '1px solid var(--line)', padding: '14px 16px' }}
    >
      <div className="panel-head" style={{ padding: 0, marginBottom: 10 }}>
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6l3 3 5-6" fill="none" stroke="var(--c-kb)" strokeWidth="1.5" /></svg>
        DRAIN TO GREEN
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {hasStatus && (
          <span data-component="drain-state-chip" style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>
            {copy.label}{round > 0 ? ` · round ${round}/${roundsDisplay}` : ''}
          </span>
        )}

        {hasStatus && (
          <span style={{ fontSize: 11.5, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
            auto {counts.auto} · agent {counts.agent} · you {counts.user} · ${costUsd.toFixed(2)}{typeof maxCostUsd === 'number' ? ` of $${maxCostUsd.toFixed(2)}` : ''}
          </span>
        )}

        {elapsed && (
          <span data-component="drain-elapsed" style={{ fontSize: 11.5, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>
            {elapsed} elapsed
          </span>
        )}

        {displayState === 'running' && (
          <>
            <button
              data-action="cancel-drain"
              data-cancel-armed={cancelArmed ? 'true' : 'false'}
              style={{ ...btn, borderColor: cancelArmed ? 'var(--error, #f87171)' : 'var(--line-2)', color: cancelArmed ? 'var(--error, #f87171)' : 'var(--text)' }}
              disabled={cancelBusy}
              onClick={onCancel}
            >
              {cancelBusy ? 'Stopping…' : cancelArmed ? 'Confirm stop' : 'Stop'}
            </button>
            {cancelArmed && !cancelBusy && (
              <button data-action="cancel-drain-keep" style={btn} onClick={onCancelDisarm}>Keep running</button>
            )}
          </>
        )}

        {(displayState === 'timed-out' || displayState === 'unreadable') && (
          <button data-action="recheck-drain" style={btn} onClick={onRecheck}>Re-check</button>
        )}

        {readError && (
          <span data-component="drain-read-error" role="status" style={{ fontSize: 11.5, color: 'var(--error, #f87171)', fontFamily: 'var(--font-mono)' }}>
            status read failed: {readError}{displayState === 'running' ? ' — still watching' : ''}
          </span>
        )}
      </div>

      {cancelMsg && (
        <div data-component="drain-cancel-note" style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 8 }}>
          {cancelMsg}
        </div>
      )}

      {dispatchError && (
        <div data-component="drain-dispatch-error" style={{ fontSize: 11.5, color: 'var(--error, #f87171)', marginTop: 8 }}>
          {dispatchError}
        </div>
      )}

      {(hasStatus || attaching) && (
        <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 8 }}>{copy.detail}</div>
      )}

      {/* Progress — auto+agent rows, EVERY round kept (knowledge-12), grouped
          by round with each row naming its file + rule (knowledge-08). */}
      {progressFindings.length > 0 && (
        <div data-drain-section="progress" style={{ marginTop: 12 }}>
          {rounds.map((r) => (
            <div key={r} data-drain-round-group={r}>
              {rounds.length > 1 && (
                <div style={{ fontSize: 10.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '.06em', padding: '6px 0 2px' }}>
                  round {r}
                </div>
              )}
              {progressFindings.filter((f) => (f.round ?? 0) === r).map((f) => <FindingRow key={`${r}::${f.key}::${f.outcome}`} f={f} kbId={kbId} />)}
            </div>
          ))}
        </div>
      )}

      {/* USER tier — unchanged walkthrough. */}
      {displayState === 'needs-you' && (
        <div data-drain-section="needs-you" data-user-index={userIdx} data-user-total={userStep.total} style={{ marginTop: 14 }}>
          {userStep.finding ? (
            <>
              <FindingRow f={userStep.finding} kbId={kbId} />
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

/**
 * One finding row (W8-B2, ON-3).
 *
 * Operator note ON-3: "it's very hard to see what changes are being proposed
 * when it raises those up to the operator, and there's no way to drill into
 * what it thinks the issues are and what it's trying to do to fix them. The
 * issues should link back to the explore page."
 *
 * So the row now carries, all derived and none of it stored twice:
 *   - the outcome glyph + the DISPOSITION of what the turn proposed;
 *   - a deep link to this finding's own theme in Explore (`?node=`), when the
 *     finding is about a theme node at all;
 *   - a disclosure holding the proposal DIFF per file, the audit's refusal /
 *     repair reasons, the brief the agent was given, and any crash.
 *
 * The disclosure renders only when `findingHasDetail` says there is something
 * inside it — an empty drawer is its own small lie.
 */
function FindingRow({ f, kbId }: { f: KbDrainPerFinding; kbId: string }) {
  const fileBase = f.file.split('/').pop() ?? f.file;
  const disposition = findingDisposition(f);
  const reasons = findingRefusalReasons(f);
  const nodeHref = deriveFindingNodeHref(f, kbId);
  const hasDetail = findingHasDetail(f);
  const proposals = f.proposedChanges ?? [];
  return (
    <div
      data-drain-finding
      data-drain-finding-tier={f.tier}
      data-drain-finding-outcome={f.outcome}
      data-drain-finding-file={fileBase}
      data-drain-finding-disposition={disposition}
      data-drain-finding-proposals={proposals.length}
      data-drain-finding-reasons={reasons.length}
      style={{ padding: '3px 0', fontSize: 11.5, color: 'var(--dim)', borderTop: '1px solid var(--line)' }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', color: f.outcome === 'not-cleared' ? 'var(--amber)' : 'var(--faint)', fontSize: 10 }}>
          {OUTCOME_GLYPH[f.outcome]}
        </span>
        {nodeHref ? (
          <Link
            data-action="open-finding-node"
            data-finding-node-href={nodeHref}
            href={nodeHref}
            style={{ fontFamily: 'var(--font-mono)', color: 'var(--c-kb)' }}
          >
            {fileBase}
          </Link>
        ) : (
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{fileBase}</span>
        )}
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--faint)', fontSize: 10.5 }}>{f.check}</span>
        {disposition !== 'none' && (
          <span
            data-component="drain-finding-disposition"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: DISPOSITION_TONE[disposition] ?? 'var(--faint)' }}
          >
            {disposition}
          </span>
        )}
        <span style={{ flex: 1, minWidth: 180 }}>{f.message}</span>
        {f.draftSession && (
          <Link
            data-action="open-drain-draft"
            href={`/sessions/kb-cleanup/${encodeURIComponent(f.draftSession.id)}?project=${encodeURIComponent(f.draftSession.project)}`}
            style={{ fontSize: 11, color: 'var(--c-kb)' }}
          >
            review draft →
          </Link>
        )}
      </div>
      {hasDetail && (
        <details data-component="drain-finding-detail" style={{ marginTop: 4 }}>
          <summary data-action="toggle-finding-detail" style={{ cursor: 'pointer', fontSize: 11, color: 'var(--c-kb)' }}>
            what it proposed{proposals.length > 1 ? ` (${proposals.length} files)` : ''}
          </summary>
          {f.fixHint && (
            <div data-component="drain-finding-brief" style={{ marginTop: 5, fontSize: 11, color: 'var(--dim)' }}>
              <span style={{ color: 'var(--faint)' }}>brief: </span>{f.fixHint}
            </div>
          )}
          {reasons.length > 0 && (
            <ul data-component="drain-finding-reasons" style={{ margin: '5px 0 0', paddingLeft: 16, fontSize: 11, color: 'var(--amber)' }}>
              {reasons.map((r, i) => <li key={i} data-drain-finding-reason>{r}</li>)}
            </ul>
          )}
          {f.turnError && (
            <div data-component="drain-finding-turn-error" style={{ marginTop: 5, fontSize: 11, color: 'var(--amber)' }}>
              <span style={{ color: 'var(--faint)' }}>the fix turn crashed: </span>{f.turnError}
            </div>
          )}
          {proposals.map((p) => (
            <div key={p.file} data-drain-proposal data-drain-proposal-file={p.file} data-drain-proposal-disposition={p.disposition} style={{ marginTop: 6 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--faint)' }}>{p.file}</div>
              <pre
                data-component="drain-proposal-diff"
                style={{ margin: '3px 0 0', padding: 7, background: 'var(--panel-2)', border: '1px solid var(--line-2)', borderRadius: 5, fontSize: 10.5, fontFamily: 'var(--font-mono)', overflowX: 'auto', whiteSpace: 'pre', maxHeight: 260 }}
              >{p.diff}</pre>
              {p.diffTruncated && (
                <div data-component="drain-proposal-truncated" style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                  diff truncated — open the file to see the rest
                </div>
              )}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
