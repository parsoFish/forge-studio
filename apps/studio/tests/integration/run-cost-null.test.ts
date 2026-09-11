/**
 * forge-ygys — `/monitor` rendered a fabricated `$0.00` for a run whose events
 * carry no cost at all.
 *
 * Every layer states the rule in words and one line broke it.
 * `kernel/event-cost.ts`'s `deriveSessionCostUsd` returns `null` when no event
 * carries `cost_usd` ("a reaped turn reports UNMEASURED rather than $0.00");
 * `bridge-agents-run-state.ts:169` says "never a fabricated 0";
 * `lib/history-ledger.ts` says "NEVER a fabricated `0`/`$0.00` standing in for
 * an absent fact"; and `HistoryLedger.tsx:162` omits the attribute when
 * `costUsd === null`. The `?? 0` in `parseRun` turned the honest null into a
 * number before any of them saw it.
 *
 * Measured on S9 run 4: beat 15 read `data-ledger-cost-usd: "0.00"` on a row
 * whose own log dir held 20 events and NO `cost_usd` field anywhere.
 *
 * These run through the REAL client parse path (§15.342) — a server payload
 * into `parseRun`, then the parsed value into the component — rather than
 * handing the component a hand-built row. A test that constructs its own input
 * proves the component; this bug lived in the step before it.
 */
import { test, expect } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { parseRun } from '@/lib/studio-client';
import { HistoryLedger } from '@/components/studio/HistoryLedger';
import type { LedgerRow } from '../../lib/history-ledger.ts';

const payload = (costUsd: number | null | undefined): Record<string, unknown> => ({
  id: 'run-1', flowId: 'forge-develop', initiativeId: 'INIT-1', initiative: 'a thing',
  status: 'running', origin: 'human-directed', ...(costUsd === undefined ? {} : { costUsd }),
});

const rowFor = (costUsd: number | null): LedgerRow => ({
  id: 'run-1', when: '2026-09-11T00:00:00Z', narrative: null, narrativeKinds: [],
  status: 'running', costUsd, href: '/flows/forge-develop/run/run-1',
} as unknown as LedgerRow);

test('AT-ygys-1 (RED) a server run with costUsd null parses to null — never 0', () => {
  // The whole bug in one line: `costUsd: r.costUsd ?? 0`.
  expect(parseRun(payload(null)).costUsd).toBe(null);
});

test('AT-ygys-2 (RED) a server run with NO costUsd field at all parses to null', () => {
  // The absent case matters separately: a run that has not been priced yet
  // sends no field, and `?? 0` claimed it had spent nothing.
  expect(parseRun(payload(undefined)).costUsd).toBe(null);
});

test('AT-ygys-3 a real cost still parses through untouched', () => {
  // The positive control. Without it, "return null always" passes both above.
  expect(parseRun(payload(0.71176675)).costUsd).toBe(0.71176675);
});

test('AT-ygys-4 a genuine zero is preserved, and is NOT the same fact as absent', () => {
  // A run that truly cost nothing is a different claim from one nobody priced.
  // Collapsing them is what made the fabricated 0.00 unnoticeable.
  expect(parseRun(payload(0)).costUsd).toBe(0);
});

test('AT-ygys-5 the ledger OMITS data-ledger-cost-usd for a null-cost row, and prints it for a zero', () => {
  const absent = renderToStaticMarkup(React.createElement(HistoryLedger, { rows: [rowFor(null)] } as never));
  expect(absent).not.toContain('data-ledger-cost-usd');

  const zero = renderToStaticMarkup(React.createElement(HistoryLedger, { rows: [rowFor(0)] } as never));
  expect(zero).toContain('data-ledger-cost-usd="0.00"');
});
