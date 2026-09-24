/**
 * forge-byh — a malformed nested Run field from the wire crashes the shared
 * HistoryLedger.
 *
 * `parseRun` (lib/studio-client.ts) normalizes a Run on receipt but never
 * rejected or coerced a malformed NESTED numeric: a wire Run whose
 * `phaseMeta[nodeId].costUsd` is (say) a string flowed straight into
 * `FlowRunTimelineRow.costUsd` and crashed `.toFixed()` when FlowRunDetail
 * rendered it (`components/studio/FlowRunDetail.tsx:322`/`:341`). The
 * TOP-level equivalent — `run.costUsd` itself malformed — reaches the SAME
 * crash shape via `lib/flow-ledger.ts`'s `deriveFlowLedgerRows`, which
 * copies `run.costUsd` verbatim into `LedgerRow.costUsd`, rendered by the
 * shared `components/studio/HistoryLedger.tsx:222` (guarded only by
 * `!== null` — a non-null NON-NUMBER still reaches `.toFixed()`).
 *
 * Decided ONCE here, applied to both callers together (the bead's own
 * direction): a malformed numeric normalizes to whatever its ABSENT
 * counterpart already means — `null` ("not recorded") at the run level,
 * matching `run-cost-null.test.ts`'s already-pinned null-vs-absent
 * contract, and `0` at the phase level, matching
 * `deriveFlowRunTimeline`'s own `meta?.costUsd ?? 0` default for a MISSING
 * phaseMeta entry. Never a crash, never a fabricated-looking real number.
 *
 * These run through the REAL client parse path — `parseRun` → the pure
 * derivation → the real render component — mirroring
 * `run-cost-null.test.ts`'s own convention, not a hand-built row.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { parseRun } from '@/lib/studio-client';
import type { Flow } from '@/lib/studio-client';
import { deriveFlowRunTimeline } from '@/lib/flow-run-timeline';
import { deriveFlowLedgerRows } from '@/lib/flow-ledger';
import { FlowRunDetail } from '@/components/studio/FlowRunDetail';
import { HistoryLedger } from '@/components/studio/HistoryLedger';

function developFlow(): Flow {
  return {
    id: 'forge-develop',
    name: 'Develop',
    goal: 'Build the initiative.',
    nodes: [{ id: 'dev', agent: 'developer-ralph' }],
    edges: [],
    triggers: [],
  };
}

const RAW_RUN_WITH_MALFORMED_PHASE_COST: Record<string, unknown> = {
  id: 'run-byh-1', flowId: 'forge-develop', initiativeId: 'INIT-1', initiative: 'a thing',
  status: 'complete', origin: 'human-directed', costUsd: 4.1,
  phases: { dev: 'complete' },
  phaseMeta: { dev: { costUsd: 'not-a-number', retries: 0 } }, // malformed on the wire
  artifactsReady: {}, workItems: [], flowLineage: ['forge-develop'],
};

const RAW_RUN_WITH_MALFORMED_TOP_LEVEL_COST: Record<string, unknown> = {
  id: 'run-byh-2', flowId: 'forge-develop', initiativeId: 'INIT-1', initiative: 'a thing',
  status: 'complete', origin: 'human-directed',
  costUsd: 'not-a-number', // malformed on the wire
  phases: {}, phaseMeta: {}, artifactsReady: {}, workItems: [], flowLineage: ['forge-develop'],
};

test('RED forge-byh: a malformed phaseMeta[node].costUsd normalizes to 0 (never a crash in FlowRunDetail)', () => {
  const run = parseRun(RAW_RUN_WITH_MALFORMED_PHASE_COST);
  expect(run.phaseMeta['dev'].costUsd).toBe(0);

  const rows = deriveFlowRunTimeline(developFlow(), run);
  const devRow = rows.find((r) => r.nodeId === 'dev')!;
  expect(devRow.costUsd).toBe(0);

  // The real crash site: FlowRunDetail.tsx's timeline calls
  // `row.costUsd.toFixed(2)` unguarded (both `data-phase-cost-usd` and the
  // rendered "$" figure). This must not throw.
  expect(() =>
    renderToStaticMarkup(
      React.createElement(FlowRunDetail as never, {
        runId: run.id,
        found: true,
        flow: developFlow(),
        run,
        rows,
        findings: { doc: null, failed: false },
      } as never),
    ),
  ).not.toThrow();
});

test('RED forge-byh: a malformed top-level run.costUsd normalizes to null (never a crash in HistoryLedger)', () => {
  const run = parseRun(RAW_RUN_WITH_MALFORMED_TOP_LEVEL_COST);
  expect(run.costUsd).toBe(null);

  const ledgerRows = deriveFlowLedgerRows([run]);
  expect(ledgerRows[0].costUsd).toBe(null);

  // The real crash site: HistoryLedger.tsx renders `row.costUsd.toFixed(2)`
  // guarded only by `row.costUsd !== null` — a non-null NON-NUMBER still
  // reached it. This must not throw.
  expect(() =>
    renderToStaticMarkup(React.createElement(HistoryLedger, { rows: ledgerRows } as never)),
  ).not.toThrow();
});
