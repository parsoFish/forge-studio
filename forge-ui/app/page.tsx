'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useStudioHomeData } from '@/lib/use-studio-home-data';
import { fetchRecentAgentRunsWithMeta } from '@/lib/agents-index';
import type { LedgerRow } from '@/lib/history-ledger';
import { StudioPage } from '@/components/StudioPage';
import { FetchErrorState } from '@/components/FetchErrorState';
import { HistoryLedger } from '@/components/studio/HistoryLedger';
import { UnresolvedHistoriesNotice } from '@/components/studio/UnresolvedHistoriesNotice';
import { HomeSessionsStrip } from '@/components/studio/HomeSessionsStrip';
import { SchedulerCard } from '@/components/SchedulerCard';
import { deriveFlowLedgerRows } from '@/lib/flow-ledger';
import {
  buildConstellation,
  buildHomeAttention,
  buildKbAttention,
  buildHomeLedgerRows,
  buildHomeSessionsStrip,
  deriveWatchLiveRun,
  gateAttentionStatusDot,
  HOME_LEDGER_LIMIT,
  type HomeAttentionItem,
  type HomeHex,
  type HomeStatus,
} from '@/lib/home-view';
import { useNowTicker } from '@/lib/use-now-ticker';
import type { SessionIndexRow } from '@/lib/studio-client';
import type { CancelOutcome } from '@/lib/session-lifecycle-client';

// ---------------------------------------------------------------------------
// Home — the operator dashboard at `/` (R6-07).
//
// Data plumbing (the six cross-object reads + the bridge WS subscribe()) is
// EXTRACTED into `lib/use-studio-home-data.ts` (W6-IA-4, sweep finding
// C1#5) — this file no longer byte-duplicates that shape with the old
// Library landing page (which itself was rebuilt into five shelves reading
// entirely different sources, so the two pages' fetch sets are no longer
// even related). Home is the hook's only caller.
//
// The MERGED everything-ledger (flow runs + standalone agent runs, W6-IA-4
// item 2) is Home-only, layered on top of the shared hook: once the shared
// roster (`agents`) is ready, a second, independent effect fans out
// `lib/agents-index.ts`'s `fetchRecentAgentRuns` — mirroring
// `app/agents/page.tsx`'s own two-effect precedent exactly (the roster must
// resolve first; the runs ledger is a SEPARATE readiness fact so it never
// blocks the rest of the page).
// ---------------------------------------------------------------------------

// Maps HomeStatus (home-view.ts's own 3-state vocab: active/gated/idle) onto
// the shared .hex-frame / .status-dot CSS's 5-state vocab (pending/active/
// complete/retrying/failed) for STYLING ONLY. The DOM-contract attributes
// (data-hex-status, data-attention-status) always carry the real HomeStatus
// value untouched — this map never leaks into derivation, only presentation.
const HOME_STATUS_FRAME: Record<HomeStatus, string> = {
  active: 'active',
  gated: 'retrying',
  idle: 'pending',
};

// (forge-2am's KB_ATTENTION_STATUS_FRAME retired by W7-B1: the KB attention
// rows now render a `badge-kb` chip + a severity accent border instead of a
// status-dot, so no styling-only frame mapping is needed for them — the
// DOM-contract attribute `data-attention-status` still carries the real
// buildKbAttention() value untouched.)

export default function HomePage() {
  const { agents, flows, projects, kbs, runs, attention, sessions, ready, error, reload, refreshSessions } = useStudioHomeData();
  const nowMs = useNowTicker();

  // ---- Home-only: merged everything-ledger (W6-IA-4 item 2) ----
  const [recentAgentRuns, setRecentAgentRuns] = useState<LedgerRow[]>([]);
  const [recentAgentRunsReady, setRecentAgentRunsReady] = useState(false);
  // W7-FIX-A1 (A1-09): per-agent history reads that came back 'unresolved'
  // — surfaced above the ledger, never discarded (a total outage is not "no
  // activity"). Retry re-runs the fan-out only (the rest of Home is unchanged).
  const [recentAgentRunsMeta, setRecentAgentRunsMeta] = useState<{ unresolved: number; total: number }>({ unresolved: 0, total: 0 });
  const [recentAgentRunsKey, setRecentAgentRunsKey] = useState(0);
  const retryRecentAgentRuns = useCallback(() => setRecentAgentRunsKey((k) => k + 1), []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function loadRecentAgentRuns(): Promise<void> {
      const { rows, unresolved, total } = await fetchRecentAgentRunsWithMeta(agents);
      if (cancelled) return;
      setRecentAgentRuns(rows);
      setRecentAgentRunsMeta({ unresolved, total });
      setRecentAgentRunsReady(true);
    }
    void loadRecentAgentRuns();
    return () => { cancelled = true; };
    // `agents` is set ONLY by useStudioHomeData's full load (mount / Retry /
    // bridge recovery — the runs+sessions live refresh never touches it), so
    // depending on it re-runs the fan-out exactly when the roster was
    // re-read: after an outage the agent rows refill with the roster instead
    // of freezing at the outage result (W7-FIX-A1 review) — mirrors
    // app/agents/page.tsx. `recentAgentRunsKey`: the notice's Retry alone.
  }, [ready, agents, recentAgentRunsKey]);

  // ---- derivation (pure — all done via lib/home-view.ts) ----
  // W7-B1 (home-sessions-14): the in-flight `sessions` index feeds hex
  // status too — 13 sessions with agents actively running must never again
  // read "0 live / all idle". Same already-fetched read, no new transport.
  const constellation = buildConstellation({ flows, agents, projects, kbs, runs, attention, sessions });
  // forge-2am → W7-B1 (home-sessions-01/02): the two attention sources are
  // now two NAMED strips — project gates under "Projects needing attention"
  // (`attention-strip`), KB lint under "Knowledge bases needing attention"
  // (`kbs-needing-attention`, a visually distinct row treatment with an
  // explicit "Drain to green" destination). Both still read the SAME
  // already-fetched data useStudioHomeData() loads (no new fetch, no new
  // poll — see this file's header + scripts/home-no-new-polling.test.ts).
  const gateAttentionItems = buildHomeAttention(attention);
  const kbAttentionItems = buildKbAttention(kbs).filter((i): i is Extract<HomeAttentionItem, { kind: 'kb' }> => i.kind === 'kb');
  const attentionCount = gateAttentionItems.length + kbAttentionItems.length;
  // W6-B11 — the sessions strip: ≤4 cards, needs-you first (the fetched
  // `sessions` array already arrives needs-you-first-then-newest, straight
  // off the bridge's own sort — see buildHomeSessionsStrip's header).
  const sessionsStrip = buildHomeSessionsStrip(sessions);
  // W7A2-02 — the last cancel from the strip: held here so the outcome
  // notice survives the refetch that drops the card.
  const [lastCancel, setLastCancel] = useState<{ row: SessionIndexRow; outcome: CancelOutcome } | null>(null);
  const flowLedgerRows = deriveFlowLedgerRows(runs);
  // W6-IA-4: the flow-run rows render immediately (they come from `ready`,
  // the same gate the rest of the page uses); the agent rows fold in once
  // their own independent fetch resolves — never a fabricated wait, and
  // never a blank ledger while the (typically fast) flow-run rows are
  // already known.
  // W7-B1 (home-sessions-25): the 30-row cap becomes PAGING — the full
  // merged list is derived once (same pure merge, uncapped), the page
  // renders a growing slice, and the footer says "showing X of N" with a
  // Show-more control instead of truncating silently.
  const allLedgerRows = recentAgentRunsReady
    ? buildHomeLedgerRows(flowLedgerRows, recentAgentRuns, Number.MAX_SAFE_INTEGER)
    : flowLedgerRows;
  const [ledgerShown, setLedgerShown] = useState(HOME_LEDGER_LIMIT);
  const ledgerRows = allLedgerRows.slice(0, ledgerShown);
  const liveCount = constellation.filter((h) => h.status === 'active').length;
  // W6-IA-4 sweep finding C1#2 → W7-B1 (home-sessions-15): derived from an
  // ACTUAL live run — and the page now also KNOWS whether the target is
  // live, so the fallback renders as a plain "Browse flows", never a
  // primary "Watch live run" promise the click cannot keep.
  const watchLiveRun = deriveWatchLiveRun(runs);

  return (
    <StudioPage
      dataPage="home"
      ready={ready}
      data={{
        'data-live-count': liveCount,
        'data-attention-count': attentionCount,
        'data-hex-count': constellation.length,
        // W7-A1: loading | ok | error — an outage is an honest ERROR state,
        // never the first-run empty fleet (home-sessions-30 / crosscut-01).
        'data-fetch-status': error ? 'error' : ready ? 'ok' : 'loading',
      }}
      eyebrow="forge studio"
      title="Everything running, at a glance"
      lede="One surface for the whole fleet: live flows and agents, the portfolio behind them, and every run that shaped it."
      actions={
        <>
          {/* W6-IA-1: points at the real onboarding form, not the projects
              index — `data-action="onboard-project-cta"` (not
              "onboard-project") to keep this navigation-only link distinct
              from ProjectOnboardForm's own submit button on /projects/new,
              which owns the "onboard-project" action id (see
              docs/forge-ui-dom-and-harness.md's /projects section). */}
          <Link className="btn" href="/projects/new" data-action="onboard-project-cta" style={{ textDecoration: 'none' }}>
            Onboard a project
          </Link>
          {/* W7-B1 (home-sessions-15): the primary "Watch live run" promise
              renders ONLY when something is actually live/gated; the
              fallback is an honest, secondary "Browse flows" — same
              destination the old silent degrade used, now saying so. */}
          {watchLiveRun.live ? (
            <Link className="btn btn-primary" href={watchLiveRun.href} data-action="watch-live-run" data-live="true" style={{ textDecoration: 'none' }}>
              Watch live run
            </Link>
          ) : (
            <Link className="btn" href={watchLiveRun.href} data-action="browse-flows" data-live="false" style={{ textDecoration: 'none' }}>
              Browse flows
            </Link>
          )}
        </>
      }
    >
      {/* ===== W7-A1: BRIDGE READ FAILED — the shared failure state renders
          FIRST (never the "Nothing registered yet" fleet-is-empty screen).
          If an earlier read succeeded in this tab, that last-known snapshot
          stays visible UNDER the failure box (it is real data, just not
          fresh); with nothing ever loaded, the box is the whole body. Retry
          re-runs the hook's load; a bridge recovery does the same
          automatically (useBridgeRecovery inside the hook). ===== */}
      {error ? (
        <div style={{ marginBottom: 24 }}>
          <FetchErrorState what="the fleet" error={error.message} status={error.status} onRetry={reload} />
        </div>
      ) : null}
      {error && constellation.length === 0 ? null : (
      <>
      {/* ===== ACTIVE SESSIONS — the in-flight interactive-session strip
          (W6-B11, IA-4's marked slot). Extracted into HomeSessionsStrip
          (review fix) so its data-* contract gets a renderToStaticMarkup
          pin — see components/studio/HomeSessionsStrip.tsx for the full
          contract description. ===== */}
      <HomeSessionsStrip
        strip={sessionsStrip}
        ready={ready}
        lastCancel={lastCancel}
        onCancelled={(row, outcome) => { setLastCancel({ row, outcome }); void refreshSessions(); }}
      />

      {/* ===== SCHEDULER — the daemon that turns queued work into runs (W7-A3,
          flows-01/23; ADR-031 wave-7 amendment). Its own component owns its
          read (`useSchedulerStatus`, slow visible-only poll) — Home itself
          adds no fetch, no interval, no endpoint literal. `queuedCount` is
          derived from the runs the shared hook already loaded. ===== */}
      <section data-section="scheduler" aria-label="Scheduler" style={{ marginBottom: 24 }}>
        <SchedulerCard queuedCount={runs.filter((r) => r.status === 'planned').length} />
      </section>

      {/* ===== PROJECTS NEEDING ATTENTION — gated reviews / flagged work.
          W7-B1 (home-sessions-01): every Home strip is NAMED on screen —
          this one carried only an aria-label before, invisible to a sighted
          operator. Rows fire on real conditions only (buildHomeAttention). */}
      {gateAttentionItems.length > 0 && (
        <section
          data-section="attention-strip"
          aria-label="Projects needing attention"
          style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>
            Projects needing attention
          </h2>
          {gateAttentionItems.map((item) => {
            if (item.kind !== 'gate') return null;
            // The raw ProjectAttentionItem behind this fired row — Home mirrors
            // R4-11-F4's full DOM contract (the same data-attention-* count
            // vocabulary the Library strip carries) so both attention surfaces
            // speak ONE shared vocabulary, plus data-attention-status for the
            // derived condition. Counts come straight from the same
            // attention-aggregate row, never re-derived.
            const raw = attention.find((a) => a.projectId === item.projectId);
            return (
            <Link
              key={item.id}
              href={item.href}
              data-attention-item
              data-attention-kind="gate"
              data-attention-project={item.projectId}
              data-attention-status={item.status}
              {...(raw ? {
                'data-attention-planned': raw.planned,
                'data-attention-in-flight': raw.inFlight,
                'data-attention-gated': raw.gated,
                'data-attention-merged': raw.merged,
                'data-attention-flagged': raw.flagged,
              } : {})}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '9px 14px',
                background: 'var(--panel)',
                border: '1px solid var(--ember)',
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                color: 'var(--text)',
              }}
            >
              {/* W6-IA-4 sweep finding C1#3: was a hardcoded data-status=
                  "retrying" for EVERY gate row regardless of item.status
                  ('gated' | 'flagged'). Now mapped through
                  GATE_ATTENTION_STATUS_FRAME, mirroring
                  KB_ATTENTION_STATUS_FRAME's own established pattern. */}
              <span className="status-dot" data-status={gateAttentionStatusDot(item.status)} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{item.text}</span>
                <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{item.sub}</span>
              </span>
              <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>open →</span>
            </Link>
            );
          })}
        </section>
      )}

      {/* ===== KBs NEEDING ATTENTION — W7-B1 (home-sessions-01/02): the
          KB-lint rows become their own NAMED strip with a visibly different
          treatment (KB badge + left accent, no ember full-border), so
          "things an agent is running" and "knowledge that needs fixing"
          stop reading as one undifferentiated list. The whole row still
          links to the Health tab (where the finding lives) and SAYS where
          the click goes: Drain to green. Every data-attention-* attribute
          the forge-2am rows carried is unchanged — only the section id,
          heading, and visual treatment are new. */}
      {kbAttentionItems.length > 0 && (
        <section
          data-section="kbs-needing-attention"
          aria-label="Knowledge bases needing attention"
          style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>
            Knowledge bases needing attention
          </h2>
          {kbAttentionItems.map((item) => (
            <Link
              key={item.id}
              href={item.href}
              data-attention-item
              data-attention-kind="kb"
              data-attention-kb={item.kbId}
              data-attention-status={item.status}
              data-attention-lint-errors={item.lint.errors}
              data-attention-lint-flags={item.lint.flags}
              data-attention-checks-run={item.lint.checksRun}
              data-attention-checks-total={item.lint.checksTotal}
              data-action="kb-drain-link"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '9px 14px',
                background: 'var(--panel-2)',
                border: '1px solid var(--line)',
                // Review round 1: three arms for the three-value vocabulary —
                // 'unknown' (the lint RUN itself threw; the server cannot
                // attest) reads neutral, never overstated as a warn finding.
                borderLeft: `3px solid ${item.status === 'fail' ? 'var(--red, #f87171)' : item.status === 'warn' ? 'var(--amber, var(--ember))' : 'var(--faint)'}`,
                borderRadius: 'var(--radius)',
                textDecoration: 'none',
                color: 'var(--text)',
              }}
            >
              <span className="badge badge-kb">KB</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{item.text}</span>
                <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{item.sub}</span>
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ember)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                Drain to green →
              </span>
            </Link>
          ))}
        </section>
      )}

      {/* ===== HEX CONSTELLATION — the signature live-fleet moment ===== */}
      <section
        data-section="constellation"
        aria-label="Live status — flows, agents, projects, knowledge"
        data-hex-count={constellation.length}
        style={{ marginBottom: 40 }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 4 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: 0 }}>
            Active status
          </h2>
          <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
            {ready ? `${liveCount} live` : '—'}
          </span>
        </div>
        <div className="home-constellation" style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius)' }}>
          {constellation.length === 0 ? (
            <div
              data-component="constellation-empty"
              style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 4px', flexWrap: 'wrap' }}
            >
              <span className="muted" style={{ fontStyle: 'italic', fontSize: 12 }}>
                Nothing registered yet.
              </span>
              {/* W6-IA-4 sweep finding C1#4: the empty branch used to be
                  terminal text with no way forward. */}
              <Link
                href="/projects/new"
                className="btn btn-primary"
                data-action="constellation-empty-cta"
                style={{ textDecoration: 'none', fontSize: 12 }}
              >
                Onboard your first project →
              </Link>
            </div>
          ) : (
            constellation.map((hex) => <HomeHexCell key={`${hex.kind}-${hex.id}`} hex={hex} />)
          )}
        </div>
      </section>

      {/* ===== RECENT ACTIVITY — the merged everything-ledger (W6-IA-4) =====
          Interleaves the flow-run ledger with recent standalone agent runs
          (lib/agents-index.ts's fetchRecentAgentRuns + home-view.ts's
          buildHomeLedgerRows, which reuses mergeRecentAgentRuns unchanged)
          into ONE newest-first list — each row carrying a "flow"/"agent"
          kind chip (HistoryLedger's own showKindChip, additive). */}
      <section
        data-section="activity"
        aria-label="Recent activity"
        data-recent-runs-unresolved={recentAgentRunsReady ? recentAgentRunsMeta.unresolved : 0}
        data-ledger-shown={ledgerRows.length}
        data-ledger-total={allLedgerRows.length}
      >
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>
          Recent activity
        </h2>
        {recentAgentRunsReady ? (
          <UnresolvedHistoriesNotice unresolved={recentAgentRunsMeta.unresolved} total={recentAgentRunsMeta.total} onRetry={retryRecentAgentRuns} />
        ) : null}
        <HistoryLedger rows={ledgerRows} nowMs={nowMs} showKindChip />
        {/* W7-B1 (home-sessions-25): the cap is PAGING now, and it says so —
            "showing 30 of 74" + Show more, never a silent truncation the
            operator can't tell from "that's all there is". */}
        {allLedgerRows.length > ledgerRows.length && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '8px 20px', fontSize: 11.5, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>
            <span>showing {ledgerRows.length} of {allLedgerRows.length}</span>
            <button
              type="button"
              data-action="ledger-show-more"
              onClick={() => setLedgerShown((n) => n + HOME_LEDGER_LIMIT)}
              style={{ background: 'none', border: 'none', color: 'var(--ember)', cursor: 'pointer', fontSize: 11.5, fontFamily: 'var(--font-mono)', padding: 0, textDecoration: 'underline' }}
            >
              show {Math.min(HOME_LEDGER_LIMIT, allLedgerRows.length - ledgerRows.length)} more
            </button>
          </div>
        )}
      </section>
      </>
      )}
    </StudioPage>
  );
}

// ---------------------------------------------------------------------------
// HomeHexCell — one clickable hex in the constellation grid.
// ---------------------------------------------------------------------------

function HomeHexCell({ hex }: { hex: HomeHex }) {
  return (
    <Link
      href={hex.href}
      className="home-hex"
      data-hex-kind={hex.kind}
      data-hex-id={hex.id}
      data-hex-status={hex.status}
      title={`${hex.label} — ${hex.status}`}
    >
      <span className="hex-frame" data-status={HOME_STATUS_FRAME[hex.status]}>
        <span className="hex">
          <span className="home-hex-glyph">{hex.glyph}</span>
        </span>
      </span>
      <span className="home-hex-label">{hex.label}</span>
    </Link>
  );
}
