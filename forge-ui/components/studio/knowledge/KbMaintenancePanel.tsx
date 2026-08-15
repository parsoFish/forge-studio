'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { runKbMaintenance, deleteKb, startKbCleanup, fetchActiveOrLatestConsolidate } from '@/lib/studio-client';
import { pollAgentFix, pollDisplayState, type PolledAgentFixStatus } from '@/lib/agent-dispatch';
import { consolidateResultLabel } from '@/lib/kb-consolidate';

/**
 * KbMaintenance (K3) — manual brain lint / index-refresh / consolidate from
 * the knowledge tab. Extracted from `app/knowledge/page.tsx` (W6-B14, mirrors
 * `RunPanel.tsx`'s own D12 extraction — a Next.js `app/**\/page.tsx` route
 * file can only export the reserved route symbols; a NAMED export here would
 * fail `next build`, so a component this file needs a standalone render-pin
 * test for has to live outside the page file). Pure move for index/cleanup/
 * delete; the consolidate action's mechanics are the actual fix this pass
 * makes — see the header on `../../../lib/kb-consolidate.ts` for the full
 * defect writeup this replaces.
 *
 * W6-B14 (background-work-server-owned-client-observes): consolidate now
 * follows the SAME three-visible-state contract every other fixed poll
 * surface in this app does — `data-poll-state="watching|timed-out|terminal"`
 * plus a `data-action="re-check"` affordance once timed out — via the
 * shared `pollAgentFix` (a consolidate runId polls through the byte-
 * identical fix-agent route a per-finding fix does) and reattaches on mount
 * via `fetchActiveOrLatestConsolidate` (`GET .../consolidate/active`), so a
 * nav-away-and-back shows the SAME live/terminal state instead of silently
 * forgetting a still-running dispatch. `data-consolidate-state` is kept
 * alongside as the pre-existing, domain-specific vocabulary
 * (`scripts/journeys/knowledge.mjs`'s `knowledge-kb-maintain-session` beat
 * already asserts on it) — never removed, only no longer fabricated (the old
 * `runConsolidateToTerminal` invented a `state:'error'` bucket a real poll
 * status never produces; this only ever renders a state the poll itself
 * observed).
 */
export function KbMaintenance({ kbId, onMaintained, onDeleted }: { kbId: string; onMaintained?: () => void; onDeleted?: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'index' | 'consolidate' | 'delete' | 'start-cleanup' | null>(null);
  // Transient result pill (K3's pre-existing contract, unchanged): shows a
  // message for ~6s then clears itself, regardless of which action produced
  // it. `data-consolidate-state`/`data-poll-state` below are the SEPARATE,
  // PERSISTENT state attributes — never cleared by this timer.
  const [result, setResult] = useState<string | null>(null);

  const [consolidateRunId, setConsolidateRunId] = useState<string | null>(null);
  const [consolidateStatus, setConsolidateStatus] = useState<PolledAgentFixStatus | null>(null);
  const [attachingConsolidate, setAttachingConsolidate] = useState(true);
  const [consolidatePollNonce, setConsolidatePollNonce] = useState(0);

  function showResult(text: string) {
    setResult(text);
    setTimeout(() => setResult(null), 6000);
  }

  // Reattach on mount / kbId change — GET the active-or-latest consolidate
  // run instead of assuming a fresh, run-less state (the same shape
  // KbDrainPanel.tsx already established for drain-to-green).
  useEffect(() => {
    let cancelled = false;
    setAttachingConsolidate(true);
    setConsolidateRunId(null);
    setConsolidateStatus(null);
    fetchActiveOrLatestConsolidate(kbId).then((r) => {
      if (cancelled) return;
      setAttachingConsolidate(false);
      if (r.runId && r.state) {
        setConsolidateRunId(r.runId);
        setConsolidateStatus({ ok: r.ok, state: r.state, cleared: r.cleared });
      }
    }).catch(() => { if (!cancelled) setAttachingConsolidate(false); });
    return () => { cancelled = true; };
  }, [kbId]);

  // Poll while a consolidate run is known. `consolidatePollNonce` lets the
  // "Re-check" button restart a bounded poll for the SAME runId after a
  // watch timeout, without needing runId itself to change.
  useEffect(() => {
    if (!consolidateRunId) return;
    return pollAgentFix(kbId, consolidateRunId, {
      onUpdate: (s) => {
        setConsolidateStatus(s);
        if (s.state !== 'running') showResult(consolidateResultLabel(s) ?? '');
        if (s.state !== 'running' && s.state !== 'timed-out') onMaintained?.();
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbId, consolidateRunId, consolidatePollNonce]);

  const consolidatePollState = pollDisplayState(consolidateStatus);
  const consolidateDisableButton = busy === 'consolidate' || consolidatePollState === 'watching' || attachingConsolidate;

  async function run(op: 'index' | 'consolidate') {
    setResult(null);
    if (op === 'consolidate') {
      setBusy('consolidate');
      setConsolidateStatus(null);
      const r = await runKbMaintenance(kbId, 'consolidate');
      setBusy(null);
      const runId = typeof r.data?.runId === 'string' ? r.data.runId : '';
      if (!r.ok || !runId) {
        showResult(r.error ?? 'consolidate dispatch failed');
        return;
      }
      // The poll effect above picks this runId up; no separate await here —
      // a nav-away right after this line still leaves the run discoverable
      // on the next mount via fetchActiveOrLatestConsolidate.
      setConsolidateRunId(runId);
      return;
    }
    setBusy(op);
    const r = await runKbMaintenance(kbId, op);
    setBusy(null);
    if (!r.ok) { setResult(r.error ?? 'failed'); return; }
    showResult('index refreshed ✓');
  }

  // R4-19-F2: the kb-cleanup LAUNCHER — closes the reachability gap the
  // brain theme new-session-kind-needs-ui-wiring.md documents (R4-21's prior
  // instance). Navigates using the `project` this route itself returns,
  // NEVER `kbId` — a non-project-bound KB anchors its session under a
  // server-minted `.kb-<id>` scratch project (`startKbCleanup`'s own header
  // in lib/studio-client.ts), so re-deriving the anchor from `kbId` here
  // would 404 for every such KB. No shared href-builder exists in this
  // codebase (AuthoringLauncher.tsx/KbBind.tsx/skills/new all hand-build
  // their own template string at the call site) — this follows suit.
  async function handleStartCleanup() {
    setBusy('start-cleanup');
    setResult(null);
    const r = await startKbCleanup(kbId);
    setBusy(null);
    if (!r.ok) { setResult(r.error); return; }
    router.push(`/sessions/kb-cleanup/${encodeURIComponent(r.sessionId)}?project=${encodeURIComponent(r.project)}`);
  }

  async function handleDelete() {
    if (!window.confirm(`Delete brain "${kbId}" and all its content? This cannot be undone.`)) return;
    setBusy('delete');
    setResult(null);
    const r = await deleteKb(kbId);
    setBusy(null);
    if (!r.ok) { setResult(r.error ?? 'delete failed'); return; }
    onDeleted?.();
  }

  const btn: CSSProperties = {
    fontSize: 11.5, padding: '4px 10px', background: 'var(--panel-2)', color: 'var(--text)',
    border: '1px solid var(--line-2)', borderRadius: 5, cursor: 'pointer',
  };

  return (
    <div
      data-component="kb-maintenance"
      {...(consolidateStatus ? { 'data-consolidate-state': consolidateStatus.state } : {})}
      {...(consolidatePollState ? { 'data-poll-state': consolidatePollState } : {})}
      style={{ display: 'flex', alignItems: 'center', gap: 6 }}
    >
      <button data-action="kb-index" style={btn} disabled={busy !== null} onClick={() => void run('index')}>
        {busy === 'index' ? 'Refreshing…' : 'Refresh index'}
      </button>
      <button
        data-action="kb-maintain-session"
        style={{ ...btn, opacity: consolidateDisableButton ? 0.6 : 1 }}
        disabled={consolidateDisableButton}
        onClick={() => void run('consolidate')}
        title="Start a consolidate maintenance session"
      >
        {busy === 'consolidate' ? 'Starting…' : consolidatePollState === 'watching' ? 'Consolidating…' : 'Consolidate'}
      </button>
      {consolidatePollState === 'timed-out' && (
        <button
          data-action="re-check"
          style={btn}
          onClick={() => setConsolidatePollNonce((n) => n + 1)}
        >
          Re-check
        </button>
      )}
      <button
        data-action="start-kb-cleanup"
        style={btn}
        disabled={busy !== null}
        onClick={() => void handleStartCleanup()}
        title="Start a kb-cleanup session (draft plan + operator-approved apply)"
      >
        {busy === 'start-cleanup' ? 'Starting…' : 'Cleanup plan'}
      </button>
      <button
        data-action="kb-delete"
        style={{ ...btn, color: 'var(--error, #f87171)', borderColor: 'var(--error, #f87171)' }}
        disabled={busy !== null}
        onClick={() => void handleDelete()}
        title="Delete this knowledge base"
      >
        {busy === 'delete' ? 'Deleting…' : 'Delete'}
      </button>
      {result && <span data-component="kb-maintenance-result" style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--font-mono)' }}>{result}</span>}
    </div>
  );
}
