/**
 * Unit tests for live-activity derivations (Fix B: canonicalPhase in ownerId).
 */
import { test, expect } from 'vitest';
import { deriveLiveToolBursts, derivePerWiActivity, deriveStageTotals } from './live-activity.ts';
import type { EventLogEntry } from './bridge-client.ts';

const NOW = 1_700_000_000_000;

function toolEv(
  phase: string,
  overrides: Partial<EventLogEntry> & { work_item_id?: string } = {},
): EventLogEntry {
  const { work_item_id, ...rest } = overrides;
  return {
    event_id: `e-${Math.random()}`,
    initiative_id: 'INIT-x',
    started_at: new Date(NOW - 100).toISOString(), // within default 2800ms window
    phase,
    skill: phase,
    event_type: 'tool_use',
    metadata: {
      tool: 'Bash',
      input_summary: 'npm test',
      ...(work_item_id ? { work_item_id } : {}),
    },
    ...rest,
  } as EventLogEntry;
}

test('deriveLiveToolBursts: unifier tool_use (phase:unifier, no work_item_id) → ownerId:unifier, ownerKind:phase', () => {
  const events = [toolEv('unifier')];
  const bursts = deriveLiveToolBursts(events, NOW);
  expect(bursts).toHaveLength(1);
  expect(bursts[0]!.ownerId).toBe('unifier');
  expect(bursts[0]!.ownerKind).toBe('phase');
});

test('deriveLiveToolBursts: WI event → ownerId is the work_item_id', () => {
  const events = [toolEv('developer-loop', { work_item_id: 'WI-3' })];
  const bursts = deriveLiveToolBursts(events, NOW);
  expect(bursts).toHaveLength(1);
  expect(bursts[0]!.ownerId).toBe('WI-3');
  expect(bursts[0]!.ownerKind).toBe('wi');
});

test('deriveLiveToolBursts: closure event folds to review-loop via canonicalPhase', () => {
  const events = [toolEv('closure')];
  const bursts = deriveLiveToolBursts(events, NOW);
  expect(bursts).toHaveLength(1);
  expect(bursts[0]!.ownerId).toBe('review-loop');
  expect(bursts[0]!.ownerKind).toBe('phase');
});

test('deriveLiveToolBursts: stale events (outside window) produce no bursts', () => {
  const staleEv = toolEv('unifier');
  (staleEv as unknown as Record<string, unknown>).started_at = new Date(NOW - 5000).toISOString();
  expect(deriveLiveToolBursts([staleEv], NOW)).toHaveLength(0);
});

// --- live token reconciliation (operator: "see some cost live, not only at closure") ---
function ev(partial: Partial<EventLogEntry> & { work_item_id?: string; input_tokens?: number; output_tokens?: number }): EventLogEntry {
  const { work_item_id, input_tokens, output_tokens, ...rest } = partial;
  return {
    event_id: `e-${Math.random()}`,
    initiative_id: 'INIT-x',
    started_at: new Date(NOW).toISOString(),
    phase: 'developer-loop',
    skill: 'developer-ralph',
    event_type: 'log',
    metadata: {
      ...(work_item_id ? { work_item_id } : {}),
      ...(input_tokens !== undefined ? { input_tokens } : {}),
      ...(output_tokens !== undefined ? { output_tokens } : {}),
    },
    ...rest,
  } as EventLogEntry;
}
const usageDelta = (wi: string, inTok: number, outTok: number) =>
  ev({ event_type: 'log', message: 'usage_delta', work_item_id: wi, input_tokens: inTok, output_tokens: outTok });
const iterationEv = (wi: string, tIn: number, tOut: number, cost: number) =>
  ev({ event_type: 'iteration', work_item_id: wi, tokens_in: tIn, tokens_out: tOut, cost_usd: cost });

test('derivePerWiActivity: per-turn usage_delta ticks tokens live before the iteration lands', () => {
  const out = derivePerWiActivity([usageDelta('WI-1', 3000, 1000), usageDelta('WI-1', 2000, 500)]);
  expect(out['WI-1']!.tokens).toBe(6500); // 4000 + 2500 in-flight; no $ mid-flight (no pricing)
  expect(out['WI-1']!.costUsd).toBe(0);
});

test('derivePerWiActivity: the iteration total supersedes in-flight (no double-count)', () => {
  const out = derivePerWiActivity([
    usageDelta('WI-1', 3000, 1000),
    usageDelta('WI-1', 2000, 500),
    iterationEv('WI-1', 5200, 1400, 0.4), // authoritative 6600 tokens, $0.40
  ]);
  expect(out['WI-1']!.tokens).toBe(6600); // committed only — in-flight 6500 was reset, NOT added
  expect(out['WI-1']!.costUsd).toBe(0.4);
});

test('derivePerWiActivity: post-iteration usage_delta ticks the next turn live', () => {
  const out = derivePerWiActivity([
    iterationEv('WI-1', 5000, 1000, 0.3), // committed 6000
    usageDelta('WI-1', 1500, 500),        // in-flight 2000
  ]);
  expect(out['WI-1']!.tokens).toBe(8000);
});

test('deriveStageTotals: reconciles per-owner across the cycle (no double-count)', () => {
  const totals = deriveStageTotals([
    usageDelta('WI-1', 3000, 1000),
    iterationEv('WI-1', 4500, 1500, 0.5), // WI-1 authoritative 6000, resets its in-flight
    usageDelta('WI-2', 2000, 0),          // WI-2 still running: in-flight 2000
  ], 1);
  expect(totals.tokens).toBe(8000); // 6000 committed + 2000 WI-2 in-flight
  expect(totals.costUsd).toBe(0.5);
});
