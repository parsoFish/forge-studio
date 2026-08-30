'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchRecentAgentRunsWithMeta } from './agents-index';
import { deriveFlowLedgerRows } from './flow-ledger';
import { buildHomeLedgerRows } from './home-view';
import type { LedgerRow } from './history-ledger';
import type { Agent, Run } from './studio-client';

/**
 * The merged everything-ledger — flow runs + standalone agent runs in one
 * newest-first list.
 *
 * LIFTED, not forked (W8-B1). This shape lived inline in `app/page.tsx` as
 * Home's own second effect. `/monitor` needs the identical list — it is the
 * pillar whose whole promise is "everything running, in one place" — and a
 * second copy of a fetch-plus-merge is how two surfaces start disagreeing
 * about what ran. Home keeps a summary strip; Monitor owns the depth; both
 * read THIS hook, so there is only ever one list and one set of counts
 * (`buildMonitorSummary`, lib/monitor-view.ts) derived from it.
 *
 * No new transport: `fetchRecentAgentRunsWithMeta` is the existing
 * `GET /api/agents/runs/recent` aggregate read, and the flow half comes from
 * `runs` the caller already fetched via `useStudioHomeData`. No interval, no
 * WebSocket, no `/api/` literal — structurally enforced by
 * `scripts/home-no-new-polling.test.ts`.
 */
export type EverythingLedger = {
  /**
   * The FULL merged list, uncapped. Paging is a presentation concern the
   * surface owns (Home slices to a strip-sized window, Monitor pages through
   * `HistoryLedger`) — a cap applied here would silently decide what the
   * counts in `buildMonitorSummary` are allowed to see.
   */
  rows: LedgerRow[];
  /**
   * Whether the standalone-agent half has resolved. The flow half renders
   * immediately off `runs`; the agent half folds in when its independent
   * read lands — never a blank ledger while known rows exist, and never a
   * fabricated "no activity" while the read is still in flight.
   */
  agentRowsReady: boolean;
  /** Per-agent history reads that came back unresolved — surfaced, not discarded. */
  unresolved: number;
  /** How many reads the aggregate attempted, the denominator for `unresolved`. */
  total: number;
  /** Re-run the agent-half read only; the rest of the surface is untouched. */
  retry: () => void;
};

export function useEverythingLedger(args: {
  agents: Agent[];
  runs: Run[];
  /** The caller's own first-load gate (`useStudioHomeData().ready`). */
  ready: boolean;
}): EverythingLedger {
  const { agents, runs, ready } = args;

  const [agentRows, setAgentRows] = useState<LedgerRow[]>([]);
  const [agentRowsReady, setAgentRowsReady] = useState(false);
  const [meta, setMeta] = useState<{ unresolved: number; total: number }>({ unresolved: 0, total: 0 });
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((k) => k + 1), []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    async function load(): Promise<void> {
      // `'standalone'`: the flow half is already derived locally from `runs`
      // and `buildHomeLedgerRows` drops every duplicate, keeping the local
      // copy. Asking the route for the flow half too spends the whole
      // 20-row window on rows this hook then discards — on a busy install no
      // standalone run reaches the ledger at all. The server applies the
      // filter before the bound, so the budget buys only the rows this route
      // alone can supply.
      const { rows, unresolved, total } = await fetchRecentAgentRunsWithMeta(agents, undefined, 'standalone');
      if (cancelled) return;
      setAgentRows(rows);
      setMeta({ unresolved, total });
      setAgentRowsReady(true);
    }
    void load();
    return () => { cancelled = true; };
    // `agents` is replaced only by the caller's full load (mount / Retry /
    // bridge recovery — the runs+sessions live refresh never touches it), so
    // depending on it re-runs the fan-out exactly when the roster was
    // re-read: after an outage the agent rows refill with the roster instead
    // of freezing at the outage result. `retryKey`: the notice's own Retry.
  }, [ready, agents, retryKey]);

  const flowRows = deriveFlowLedgerRows(runs);
  const rows = agentRowsReady
    ? buildHomeLedgerRows(flowRows, agentRows, Number.MAX_SAFE_INTEGER)
    : flowRows;

  return { rows, agentRowsReady, unresolved: meta.unresolved, total: meta.total, retry };
}
