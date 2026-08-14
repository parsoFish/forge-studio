'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { subscribe, fetchProjectAttention, type ProjectAttentionItem } from '@/lib/bridge-client';
import {
  fetchRuns,
  fetchStudioAgents,
  fetchStudioFlows,
  fetchStudioKbs,
  fetchStudioProjects,
  type Agent,
  type Flow,
  type Kb,
  type Project,
  type Run,
} from '@/lib/studio-client';
import { StudioPage } from '@/components/StudioPage';
import { HistoryLedger } from '@/components/studio/HistoryLedger';
import { deriveFlowLedgerRows } from '@/lib/flow-ledger';
import {
  buildConstellation,
  buildHomeAttention,
  buildKbAttention,
  type HomeAttentionItem,
  type HomeHex,
  type HomeStatus,
} from '@/lib/home-view';
import { useNowTicker } from '@/lib/use-now-ticker';

// ---------------------------------------------------------------------------
// Home — the operator dashboard at `/` (R6-07).
//
// Reads the SAME six existing surfaces Library already reads (fetchStudio* +
// fetchRuns + fetchProjectAttention) and composes them through the pure
// `home-view.ts` derivation module — no new endpoint, no bespoke poll loop.
// Live refresh reuses the one bridge WebSocket (subscribe()) exactly as
// Library does: a `cycle-list-changed` message re-fetches runs.
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

// forge-2am: same styling-only mapping, for a KB attention row's own
// 'fail'|'warn'|'unknown' status vocab onto the shared 5-state status-dot
// CSS. The DOM-contract attribute (data-attention-status) always carries the
// real buildKbAttention() value untouched.
const KB_ATTENTION_STATUS_FRAME: Record<Extract<HomeAttentionItem, { kind: 'kb' }>['status'], string> = {
  fail: 'failed',
  warn: 'retrying',
  unknown: 'pending',
};

export default function HomePage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [kbs, setKbs] = useState<Kb[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [attention, setAttention] = useState<ProjectAttentionItem[]>([]);
  const [ready, setReady] = useState(false);
  const nowMs = useNowTicker();

  // ---- data loading (mirrors app/library/page.tsx exactly) ----
  async function loadAll(signal: { cancelled: boolean }): Promise<void> {
    try {
      const [a, f, p, k, r, at] = await Promise.all([
        fetchStudioAgents(),
        fetchStudioFlows(),
        fetchStudioProjects(),
        fetchStudioKbs(),
        fetchRuns(),
        fetchProjectAttention(),
      ]);
      if (signal.cancelled) return;
      setAgents(a);
      setFlows(f);
      setProjects(p);
      setKbs(k);
      setRuns(r);
      setAttention(at);
    } finally {
      if (!signal.cancelled) setReady(true);
    }
  }

  async function refreshRuns(signal: { cancelled: boolean }): Promise<void> {
    const r = await fetchRuns();
    if (signal.cancelled) return;
    setRuns(r);
  }

  useEffect(() => {
    // intentional mount-only — loadAll/refreshRuns are stable fetch helpers
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const signal = { cancelled: false };

    void loadAll(signal);

    // Subscribe to bridge WS to re-fetch runs on cycle-list-changed — the one
    // live-refresh transport Studio has; Home adds no second poll loop.
    const sub = subscribe({
      onState: () => { /* page does not show connection state */ },
      onMessage: (msg) => {
        if (signal.cancelled) return;
        if (msg.type === 'cycle-list-changed') {
          void refreshRuns(signal);
        }
      },
    });

    return () => {
      signal.cancelled = true;
      sub.close();
    };
  }, []);

  // ---- derivation (pure — all done via lib/home-view.ts) ----
  const constellation = buildConstellation({ flows, agents, projects, kbs, runs, attention });
  // forge-2am: the attention strip folds the pre-existing project-gate rows
  // and the KB-lint rows into ONE list. Both read the SAME already-fetched
  // fetchStudioKbs() result Home already loads (no new fetch, no new poll —
  // see this file's header + scripts/home-no-new-polling.test.ts).
  const attentionItems: HomeAttentionItem[] = [...buildHomeAttention(attention), ...buildKbAttention(kbs)];
  const ledgerRows = deriveFlowLedgerRows(runs);
  const liveCount = constellation.filter((h) => h.status === 'active').length;

  return (
    <StudioPage
      dataPage="home"
      ready={ready}
      data={{
        'data-live-count': liveCount,
        'data-attention-count': attentionItems.length,
        'data-hex-count': constellation.length,
      }}
      eyebrow="forge studio"
      title="Everything running, at a glance"
      lede="One surface for the whole fleet: live flows and agents, the portfolio behind them, and every run that shaped it."
      actions={
        <>
          <Link className="btn" href="/projects" data-action="onboard-project" style={{ textDecoration: 'none' }}>
            Onboard a project
          </Link>
          <Link className="btn btn-primary" href="/flows/forge-develop" data-action="watch-live-run" style={{ textDecoration: 'none' }}>
            Watch live run
          </Link>
        </>
      }
    >
      {/* ===== ATTENTION STRIP — what needs the operator right now ===== */}
      {attentionItems.length > 0 && (
        <section
          data-section="attention-strip"
          aria-label="Projects and knowledge bases needing attention"
          style={{ marginBottom: 32, display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {attentionItems.map((item) => {
            if (item.kind === 'kb') {
              // forge-2am: a KB-lint row — status/counts come straight from
              // THIS kb's own lint summary (buildKbAttention), never
              // cross-attributed from another kb or fabricated on absence.
              return (
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
                  <span className="status-dot" data-status={KB_ATTENTION_STATUS_FRAME[item.status]} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, display: 'block' }}>{item.text}</span>
                    <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>{item.sub}</span>
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--faint)', fontFamily: 'var(--font-mono)' }}>open →</span>
                </Link>
              );
            }

            // The raw ProjectAttentionItem behind this fired row — Home mirrors
            // R4-11-F4's full DOM contract (the same data-attention-* count
            // vocabulary the Library strip carries) so both attention surfaces
            // speak ONE shared vocabulary, plus data-attention-status for the
            // derived condition. Counts come straight from the same
            // fetchProjectAttention() row, never re-derived. Every attribute
            // this row rendered before forge-2am is unchanged; it only gains
            // data-attention-kind alongside them.
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
              <span className="status-dot" data-status="retrying" />
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
            <div data-component="constellation-empty" className="muted" style={{ fontStyle: 'italic', fontSize: 12, padding: '10px 4px' }}>
              Nothing registered yet.
            </div>
          ) : (
            constellation.map((hex) => <HomeHexCell key={`${hex.kind}-${hex.id}`} hex={hex} />)
          )}
        </div>
      </section>

      {/* ===== RECENT ACTIVITY — cross-object run ledger (total reuse) ===== */}
      <section data-section="activity" aria-label="Recent activity">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>
          Recent activity
        </h2>
        <HistoryLedger rows={ledgerRows} nowMs={nowMs} />
      </section>
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
