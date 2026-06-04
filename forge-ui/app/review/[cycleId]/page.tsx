'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

import {
  fetchCycles,
  fetchDemoModel,
  type Cycle,
  type DemoModel,
} from '@/lib/bridge-client';
import { ReviewStageHex } from '@/components/MomentHex';
import { DemoComparison } from '@/components/DemoComparison';
import { ReviewVerdictForm } from '@/components/ReviewVerdictForm';
import { ScreenShell } from '@/components/ScreenShell';
import { useNowTicker } from '@/lib/use-now-ticker';
import { useCycleEvents } from '@/lib/use-cycle-events';

/**
 * ADR 021 — the standalone review screen. Aligned with the architect plan
 * screen: a focused review hex (left) + the rich artifact and controls (right).
 * The structured demo renders large on its own page (the review equivalent of
 * the PLAN gate), with the verdict form below.
 */
export default function ReviewCyclePage({ params }: { params: { cycleId: string } }): JSX.Element {
  const cycleId = decodeURIComponent(params.cycleId);
  const [cycle, setCycle] = useState<Cycle | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [demo, setDemo] = useState<DemoModel | null>(null);
  const [approved, setApproved] = useState(false);
  const nowMs = useNowTicker();

  const loadData = useCallback(() => {
    fetchCycles()
      .then((snap) => {
        const all = [...snap.live, ...snap.recent];
        setCycle(all.find((c) => c.cycleId === cycleId) ?? null);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    // Re-fetch the demo too — a send-back → dev-loop rerun re-renders demo.json
    // (ADR 021 step 12); the screen updates live without a reload.
    fetchDemoModel(cycleId).then((d) => setDemo(d)).catch(() => {});
  }, [cycleId]);
  useEffect(() => { loadData(); }, [loadData]);
  const events = useCycleEvents(cycleId, (msg) => {
    if (msg.type === 'cycle-list-changed' || msg.type === 'snapshot') loadData();
  });

  const ready = cycle?.status === 'ready-for-review';

  return (
    <ScreenShell
      dataPage="review-cycle"
      ready={loaded}
      title="review"
      idLabel={cycle?.initiativeId ?? cycleId}
      maxWidth={1100}
      mainData={{ 'data-cycle-id': cycleId, 'data-cycle-status': cycle?.status ?? '' }}
    >
      {!loaded ? (
        <div style={{ color: '#8b949e', fontSize: 13 }}>Loading cycle…</div>
      ) : !cycle ? (
        <div style={{ color: '#8b949e', fontSize: 13 }}>
          Cycle not found. <Link href="/" style={{ color: '#58a6ff' }}>Back to dashboard</Link>.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 24, alignItems: 'start' }}>
          <ReviewStageHex status={cycle.status} events={events} nowMs={nowMs} />

          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ fontSize: 12, color: '#8b949e' }}>{cycle.project ?? '(no project)'}</div>

            {demo ? (
              <DemoComparison model={demo} cycleId={cycleId} />
            ) : (
              <div style={{ border: '1px solid #21262d', borderRadius: 8, padding: '14px 18px', background: '#0b0f14', fontSize: 13, color: '#8b949e' }}>
                No structured demo (<code>demo.json</code>) filed for this cycle yet.
              </div>
            )}

            {ready ? (
              <ReviewVerdictForm initiativeId={cycle.initiativeId} onSubmitted={(kind) => { if (kind === 'approve') setApproved(true); }} />
            ) : (
              <div style={{ border: '1px solid #30363d', borderRadius: 10, padding: '14px 18px', background: '#0d1117', fontSize: 13, color: '#8b949e' }}>
                This cycle is <strong style={{ color: '#e6edf3' }}>{cycle.status}</strong> — a verdict is only needed once it reaches <code>ready-for-review</code>.
              </div>
            )}

            {approved && (
              <div style={{ border: '1px solid #2ea04366', borderRadius: 10, padding: '14px 18px', background: '#07140d', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ fontSize: 13, color: '#3fb950' }}>Approved — merged. One last step: reflect on the cycle.</span>
                <Link href={`/reflect/${encodeURIComponent(cycleId)}`} data-action="open-reflect"
                  style={{ flex: '0 0 auto', fontSize: 13, fontWeight: 600, color: '#fff', background: '#8957e5', border: '1px solid #30363d', borderRadius: 6, padding: '6px 14px', textDecoration: 'none' }}>
                  Reflect on this cycle →
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </ScreenShell>
  );
}
