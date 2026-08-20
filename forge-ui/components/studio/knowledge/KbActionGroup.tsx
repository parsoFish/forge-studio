'use client';

/**
 * KbActionGroup (W7-B2, knowledge-05/06/09/19/24/32/33) — the ONE action
 * group on the KB health tab: Drain to green (primary) · Consolidate ·
 * Cleanup plan · Refresh this KB's index · Delete (danger). Replaces the
 * header-strip `KbMaintenancePanel` (deleted) and the drain panel's own
 * dispatch button.
 *
 * Mutual gate: every action is disabled while ANY KB job runs, with the
 * server's own reason shown — the same `deriveKbActiveJob` fact the bridge
 * routes 409 with (cli/kb-job-state.ts), fetched from
 * `GET /api/studio/kbs/:id/active-job` and re-checked while anything is in
 * flight. The UI gate is convenience; the SERVER 409s are the enforcement
 * (declared-data-fails-open discipline).
 *
 * Three brain-fix entry points, now explained side by side (knowledge-32):
 * drain loops lint→fix rounds to green; consolidate is one deterministic +
 * agent pass over the current agent-tier findings; cleanup plan drafts a
 * REVIEWED plan first (its kickoff now goes through the one form —
 * /sessions/kb-cleanup/new?kb=…, knowledge-33). Consolidate's outcome stays
 * on screen until the next action (knowledge-19 — no more 6-second pill);
 * run history lives in the RecentRuns ledger below the panel.
 *
 * Delete requires TYPING the kb id (knowledge-24) — a mis-click plus Enter
 * can no longer erase a brain.
 *
 * CONTAINER/VIEW split as everywhere else on this screen:
 * `KbActionGroupView` is pure and render-pin-tested
 * (lib/kb-action-group-render.test.ts).
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  dispatchKbDrain, runKbMaintenance, deleteKb,
  fetchActiveOrLatestConsolidate, fetchKbActiveJob,
  type KbActiveJob,
} from '@/lib/studio-client';
import { pollAgentFix, pollDisplayState, type PolledAgentFixStatus, type PollDisplayState } from '@/lib/agent-dispatch';
import { consolidateResultLabel } from '@/lib/kb-consolidate';
import type { KbDrainDisplayState } from '@/lib/kb-drain-view';

const ACTIVE_JOB_POLL_MS = 5000;

export function KbActionGroup({
  kbId,
  drainState,
  onDrainDispatched,
  onMaintained,
  onDeleted,
}: {
  kbId: string;
  /** The drain panel's live display state (reported up by KbDrainPanel) —
   *  gates the group the instant a drain is dispatched/observed locally,
   *  without waiting a server poll round-trip. */
  drainState: KbDrainDisplayState;
  /** Fired after a successful drain dispatch — the page bumps the drain
   *  panel's attachNonce so it re-attaches to the new run. */
  onDrainDispatched?: () => void;
  onMaintained?: () => void;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'drain' | 'consolidate' | 'index' | 'delete' | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [activeJob, setActiveJob] = useState<KbActiveJob>(null);
  const [activeJobReason, setActiveJobReason] = useState<string | null>(null);

  const [consolidateRunId, setConsolidateRunId] = useState<string | null>(null);
  const [consolidateStatus, setConsolidateStatus] = useState<PolledAgentFixStatus | null>(null);
  const [consolidatePollNonce, setConsolidatePollNonce] = useState(0);

  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteText, setDeleteText] = useState('');

  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const refreshActiveJob = useCallback(async () => {
    const r = await fetchKbActiveJob(kbId);
    if (!mountedRef.current) return;
    if (r.ok) {
      setActiveJob(r.job);
      setActiveJobReason(r.job ? r.reason ?? null : null);
    }
    // A failed read keeps the last known job state — the server still 409s.
  }, [kbId]);

  // Active-job fact: on mount / kb change, then re-checked while anything
  // local or remote is in flight (bounded — idle KBs are not polled).
  useEffect(() => {
    setActiveJob(null);
    setActiveJobReason(null);
    setActionResult(null);
    setActionError(null);
    setDeleteArmed(false);
    setDeleteText('');
    void refreshActiveJob();
  }, [kbId, refreshActiveJob]);
  const somethingRuns = activeJob !== null || busy !== null || drainState === 'running';
  useEffect(() => {
    if (!somethingRuns) return;
    const t = setInterval(() => { void refreshActiveJob(); }, ACTIVE_JOB_POLL_MS);
    return () => clearInterval(t);
  }, [somethingRuns, refreshActiveJob]);

  // Consolidate reattach (unchanged shape from the deleted KbMaintenance).
  useEffect(() => {
    let cancelled = false;
    setConsolidateRunId(null);
    setConsolidateStatus(null);
    fetchActiveOrLatestConsolidate(kbId).then((r) => {
      if (cancelled) return;
      if (r.runId && r.state) {
        setConsolidateRunId(r.runId);
        setConsolidateStatus({ ok: r.ok, state: r.state, cleared: r.cleared });
      }
    }).catch(() => { /* reattach is best-effort; dispatch errors surface on action */ });
    return () => { cancelled = true; };
  }, [kbId]);

  useEffect(() => {
    if (!consolidateRunId) return;
    return pollAgentFix(kbId, consolidateRunId, {
      onUpdate: (s) => {
        if (!mountedRef.current) return;
        setConsolidateStatus(s);
        const display = pollDisplayState(s);
        if (display !== 'watching') {
          setActionResult(consolidateResultLabel(s) ?? null);
          void refreshActiveJob();
        }
        if (display === 'terminal') onMaintained?.();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId, consolidateRunId, consolidatePollNonce]);

  const handleDrain = useCallback(async () => {
    setBusy('drain');
    setActionError(null);
    setActionResult(null);
    const r = await dispatchKbDrain(kbId);
    if (!mountedRef.current) return;
    setBusy(null);
    if (!r.ok) {
      setActionError(r.error ?? 'drain dispatch failed');
      void refreshActiveJob();
      return;
    }
    onDrainDispatched?.();
    void refreshActiveJob();
  }, [kbId, onDrainDispatched, refreshActiveJob]);

  const handleConsolidate = useCallback(async () => {
    setBusy('consolidate');
    setActionError(null);
    setActionResult(null);
    setConsolidateStatus(null);
    const r = await runKbMaintenance(kbId, 'consolidate');
    if (!mountedRef.current) return;
    setBusy(null);
    const runId = typeof r.data?.runId === 'string' ? r.data.runId : '';
    if (!r.ok || !runId) {
      setActionError(r.error ?? 'consolidate dispatch failed');
      void refreshActiveJob();
      return;
    }
    setConsolidateRunId(runId);
    void refreshActiveJob();
  }, [kbId, refreshActiveJob]);

  const handleIndex = useCallback(async () => {
    setBusy('index');
    setActionError(null);
    setActionResult(null);
    const r = await runKbMaintenance(kbId, 'index');
    if (!mountedRef.current) return;
    setBusy(null);
    if (!r.ok) {
      setActionError(r.error ?? 'index refresh failed');
      void refreshActiveJob();
      return;
    }
    const kbHalf = r.data?.kb as { applied?: number; skipped?: number } | undefined;
    const applied = typeof kbHalf?.applied === 'number' ? kbHalf.applied : 0;
    setActionResult(`index refreshed ✓ — ${applied} link${applied === 1 ? '' : 's'} repaired in this KB + brain meta-index rebuilt`);
    onMaintained?.();
  }, [kbId, onMaintained]);

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteText !== kbId) return;
    setBusy('delete');
    setActionError(null);
    const r = await deleteKb(kbId);
    if (!mountedRef.current) return;
    setBusy(null);
    setDeleteArmed(false);
    setDeleteText('');
    if (!r.ok) {
      setActionError(r.error ?? 'delete failed');
      void refreshActiveJob();
      return;
    }
    onDeleted?.();
  }, [kbId, deleteText, onDeleted, refreshActiveJob]);

  const consolidatePollState = pollDisplayState(consolidateStatus);

  return (
    <KbActionGroupView
      kbId={kbId}
      activeJob={activeJob}
      activeJobReason={activeJobReason}
      drainState={drainState}
      busy={busy}
      consolidatePollState={consolidatePollState}
      consolidateState={consolidateStatus?.state ?? null}
      actionResult={actionResult}
      actionError={actionError}
      deleteArmed={deleteArmed}
      deleteText={deleteText}
      onDrain={() => void handleDrain()}
      onConsolidate={() => void handleConsolidate()}
      onRecheckConsolidate={() => setConsolidatePollNonce((n) => n + 1)}
      onCleanupPlan={() => router.push(`/sessions/kb-cleanup/new?kb=${encodeURIComponent(kbId)}`)}
      onRefreshIndex={() => void handleIndex()}
      onDeleteArm={() => { setDeleteArmed(true); setDeleteText(''); }}
      onDeleteCancel={() => { setDeleteArmed(false); setDeleteText(''); }}
      onDeleteTextChange={setDeleteText}
      onDeleteConfirm={() => void handleDeleteConfirm()}
    />
  );
}

// ---------------------------------------------------------------------------
// View — pure, hooks-free. Exported for lib/kb-action-group-render.test.ts.
// ---------------------------------------------------------------------------

export type KbActionGroupViewProps = {
  kbId: string;
  activeJob: KbActiveJob;
  activeJobReason: string | null;
  drainState: KbDrainDisplayState;
  busy: 'drain' | 'consolidate' | 'index' | 'delete' | null;
  consolidatePollState: PollDisplayState | null;
  consolidateState: string | null;
  actionResult: string | null;
  actionError: string | null;
  deleteArmed: boolean;
  deleteText: string;
  onDrain: () => void;
  onConsolidate: () => void;
  onRecheckConsolidate: () => void;
  onCleanupPlan: () => void;
  onRefreshIndex: () => void;
  onDeleteArm: () => void;
  onDeleteCancel: () => void;
  onDeleteTextChange: (text: string) => void;
  onDeleteConfirm: () => void;
};

const groupBtn: CSSProperties = {
  fontSize: 11.5, padding: '5px 11px', background: 'var(--panel-2)', color: 'var(--text)',
  border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer',
};
const primaryBtn: CSSProperties = {
  ...groupBtn, fontSize: 12, padding: '7px 14px', color: 'var(--c-kb)', border: '1px solid var(--c-kb)', fontWeight: 600,
};

/** The reason shown when only LOCAL state (not yet the server fact) gates. */
function localGateReason(drainState: KbDrainDisplayState, consolidatePollState: PollDisplayState | null): string | null {
  if (drainState === 'running') return 'a drain-to-green run is active for this kb — wait for it to finish or stop it';
  if (consolidatePollState === 'watching') return 'a consolidate run is active for this kb — wait for it to finish';
  return null;
}

export function KbActionGroupView({
  kbId, activeJob, activeJobReason, drainState, busy,
  consolidatePollState, consolidateState, actionResult, actionError,
  deleteArmed, deleteText,
  onDrain, onConsolidate, onRecheckConsolidate, onCleanupPlan, onRefreshIndex,
  onDeleteArm, onDeleteCancel, onDeleteTextChange, onDeleteConfirm,
}: KbActionGroupViewProps) {
  const gateReason = activeJob ? (activeJobReason ?? 'a job is active for this kb') : localGateReason(drainState, consolidatePollState);
  const gated = gateReason !== null || busy !== null || drainState === 'attaching';

  const explain: CSSProperties = { fontSize: 11, color: 'var(--faint)', lineHeight: 1.45 };
  const row: CSSProperties = { display: 'flex', alignItems: 'baseline', gap: 10, padding: '6px 0', borderTop: '1px solid var(--line)' };

  return (
    <div
      data-component="kb-action-group"
      data-active-job={activeJob?.kind ?? (drainState === 'running' ? 'drain' : consolidatePollState === 'watching' ? 'consolidate' : 'none')}
      style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '12px 16px', background: 'var(--bg-2)' }}
    >
      <div className="panel-head" style={{ padding: 0, marginBottom: 4 }}>KB ACTIONS</div>
      <div style={{ ...explain, marginBottom: 6 }}>
        One job at a time — every action below edits this KB&apos;s files, so a running job disables the rest.
      </div>

      {gateReason && (
        <div data-component="kb-action-gate-reason" role="status" style={{ fontSize: 11.5, color: 'var(--amber)', marginBottom: 6 }}>
          {gateReason}
        </div>
      )}

      <div style={row}>
        <button data-action="drain-to-green" style={{ ...primaryBtn, opacity: gated ? 0.55 : 1 }} disabled={gated} onClick={onDrain} title={gateReason ?? undefined}>
          {busy === 'drain' ? 'Starting…' : drainState === 'running' ? 'Draining…' : 'Drain to green'}
        </button>
        <span style={explain}>
          Loops lint → auto-fixes → one agent turn per finding, round by round, until green or an honest stop.
          Structural fixes land directly; prose edits become drafts you approve.
        </span>
      </div>

      <div style={row}>
        <button
          data-action="kb-maintain-session"
          style={{ ...groupBtn, opacity: gated ? 0.55 : 1 }}
          disabled={gated}
          onClick={onConsolidate}
          title={gateReason ?? undefined}
        >
          {busy === 'consolidate' ? 'Starting…' : consolidatePollState === 'watching' ? 'Consolidating…' : 'Consolidate'}
        </button>
        {consolidatePollState === 'timed-out' && (
          <button data-action="re-check" style={groupBtn} onClick={onRecheckConsolidate}>Re-check</button>
        )}
        <span style={explain}>
          ONE pass over the current agent-tier findings (deterministic index repairs first) — drain runs this same
          pass inside its rounds.
        </span>
      </div>

      <div style={row}>
        <button data-action="start-kb-cleanup" style={{ ...groupBtn, opacity: gated ? 0.55 : 1 }} disabled={gated} onClick={onCleanupPlan} title={gateReason ?? undefined}>
          Cleanup plan
        </button>
        <span style={explain}>
          Review-first: an agent drafts a cleanup plan as a session you approve before anything is applied.
          Opens the one kickoff form (model choice included).
        </span>
      </div>

      <div style={row}>
        <button data-action="kb-index" style={{ ...groupBtn, opacity: gated ? 0.55 : 1 }} disabled={gated} onClick={onRefreshIndex} title={gateReason ?? undefined}>
          {busy === 'index' ? 'Refreshing…' : 'Refresh this KB’s index'}
        </button>
        <span style={explain}>
          Repairs THIS KB&apos;s category-index links, then rebuilds the brain meta-index counts.
        </span>
      </div>

      {(actionResult || actionError) && (
        <div
          data-component="kb-action-result"
          {...(consolidateState ? { 'data-consolidate-state': consolidateState } : {})}
          {...(consolidatePollState ? { 'data-poll-state': consolidatePollState } : {})}
          style={{ fontSize: 11.5, color: actionError ? 'var(--error, #f87171)' : 'var(--dim)', fontFamily: 'var(--font-mono)', padding: '8px 0 2px' }}
        >
          {actionError ?? actionResult}
        </div>
      )}
      {!actionResult && !actionError && (consolidateState || consolidatePollState) && (
        <div
          data-component="kb-action-consolidate-state"
          {...(consolidateState ? { 'data-consolidate-state': consolidateState } : {})}
          {...(consolidatePollState ? { 'data-poll-state': consolidatePollState } : {})}
          style={{ fontSize: 0, height: 0, overflow: 'hidden' }}
        />
      )}

      {/* Danger zone — typed-id confirm (knowledge-24), OUT of the header. */}
      <div data-section="kb-danger-zone" style={{ ...row, borderTop: '1px dashed var(--line-2)', marginTop: 8 }}>
        {!deleteArmed ? (
          <button
            data-action="kb-delete"
            style={{ ...groupBtn, color: 'var(--error, #f87171)', borderColor: 'var(--error, #f87171)', opacity: gated ? 0.55 : 1 }}
            disabled={gated}
            onClick={onDeleteArm}
            title={gateReason ?? undefined}
          >
            Delete…
          </button>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <input
              data-field="kb-delete-confirm"
              value={deleteText}
              onChange={(e) => onDeleteTextChange(e.target.value)}
              placeholder={`type "${kbId}" to confirm`}
              style={{ fontSize: 11.5, padding: '4px 8px', background: 'var(--panel-2)', color: 'var(--text)', border: '1px solid var(--error, #f87171)', borderRadius: 5, fontFamily: 'var(--font-mono)' }}
            />
            <button
              data-action="kb-delete-confirm"
              style={{ ...groupBtn, color: 'var(--error, #f87171)', borderColor: 'var(--error, #f87171)' }}
              disabled={deleteText !== kbId || busy === 'delete'}
              onClick={onDeleteConfirm}
            >
              {busy === 'delete' ? 'Deleting…' : 'Delete this KB'}
            </button>
            <button data-action="kb-delete-cancel" style={groupBtn} onClick={onDeleteCancel}>Cancel</button>
          </span>
        )}
        <span style={explain}>
          Permanently removes the KB&apos;s brain directory and its anchored sessions. Cannot be undone —
          type the KB id to confirm.
        </span>
      </div>

      {/* Cross-link so history is one glance away (knowledge-19/20). */}
      <div style={{ paddingTop: 8 }}>
        <Link href={`/knowledge?id=${encodeURIComponent(kbId)}&tab=health#kb-recent-runs`} data-action="goto-kb-runs" style={{ fontSize: 11, color: 'var(--faint)' }}>
          run history ↓
        </Link>
      </div>
    </div>
  );
}
