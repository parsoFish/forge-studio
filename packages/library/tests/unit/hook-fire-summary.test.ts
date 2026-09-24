/**
 * forge-8vfn.5.16 (M7-C U2) — `deriveHookFireSummary` is the pure reducer
 * the hook detail route (`bridge-studio-hooks-detail.ts`) folds a run's
 * `hook.fire` events (packages/agents/studio/hook-dispatch.ts's
 * `emitHookFire`) down into "when did this hook last fire, with what
 * outcome, and how many times total".
 *
 * WHAT EACH TEST KILLS:
 *  - "no matching events -> null" kills an implementation that fabricates a
 *    zero-ish summary (e.g. `{lastFireAt: '', ...}`) for a hook that has
 *    never fired — the detail route's data-hook-last-fire-* must stay
 *    ABSENT, never a fake empty value.
 *  - "picks the LATEST by started_at" kills an implementation that trusts
 *    array order (the scan walks cycles in `listCycles` order, not fire
 *    order) or takes the first/last array element blindly.
 *  - "counts ALL matching fires, not just the latest" kills an
 *    implementation that derives fireCount from array length pre-filter, or
 *    that only counts the winning outcome.
 *  - "ignores events for a DIFFERENT hookId" kills a filter that matches on
 *    message alone, which would blend every hook's fire history together.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EventLogEntry } from '@forge/kernel';

import { deriveHookFireSummary } from '../../studio/hook-fire-summary.ts';

function fireEvent(hookId: string, outcome: string, startedAt: string): EventLogEntry {
  return {
    event_id: `EV_${startedAt}_${hookId}`,
    cycle_id: 'c1',
    initiative_id: 'c1',
    phase: 'orchestrator',
    skill: `hook:${hookId}`,
    event_type: outcome === 'ran' ? 'log' : 'error',
    input_refs: [],
    output_refs: [],
    started_at: startedAt,
    message: 'hook.fire',
    metadata: { hookId, event: 'SessionEnd', outcome, exitCode: 0, durationMs: 12 },
  };
}

describe('deriveHookFireSummary', () => {
  it('no matching events -> null, never a fabricated empty summary', () => {
    assert.equal(deriveHookFireSummary([], 'my-hook'), null);
    const unrelated: EventLogEntry[] = [fireEvent('other-hook', 'ran', '2026-09-25T00:00:00.000Z')];
    assert.equal(deriveHookFireSummary(unrelated, 'my-hook'), null);
  });

  it('picks the LATEST fire by started_at, regardless of array order', () => {
    const events: EventLogEntry[] = [
      fireEvent('my-hook', 'ran', '2026-09-25T10:00:00.000Z'),
      fireEvent('my-hook', 'refused', '2026-09-25T12:00:00.000Z'),
      fireEvent('my-hook', 'error', '2026-09-25T11:00:00.000Z'),
    ];
    const summary = deriveHookFireSummary(events, 'my-hook');
    assert.ok(summary);
    assert.equal(summary!.lastFireAt, '2026-09-25T12:00:00.000Z');
    assert.equal(summary!.lastFireOutcome, 'refused');
  });

  it('counts ALL matching fires, not just the latest', () => {
    const events: EventLogEntry[] = [
      fireEvent('my-hook', 'ran', '2026-09-25T10:00:00.000Z'),
      fireEvent('my-hook', 'ran', '2026-09-25T11:00:00.000Z'),
      fireEvent('my-hook', 'ran', '2026-09-25T12:00:00.000Z'),
    ];
    const summary = deriveHookFireSummary(events, 'my-hook');
    assert.equal(summary!.fireCount, 3);
  });

  it('ignores events for a different hookId, and non-fire events', () => {
    const events: EventLogEntry[] = [
      fireEvent('other-hook', 'ran', '2026-09-25T13:00:00.000Z'),
      fireEvent('my-hook', 'ran', '2026-09-25T09:00:00.000Z'),
      { ...fireEvent('my-hook', 'ran', '2026-09-25T14:00:00.000Z'), message: 'hook-dispatch-error' },
    ];
    const summary = deriveHookFireSummary(events, 'my-hook');
    assert.equal(summary!.fireCount, 1);
    assert.equal(summary!.lastFireAt, '2026-09-25T09:00:00.000Z');
  });
});
