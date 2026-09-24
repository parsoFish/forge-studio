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

// ---------------------------------------------------------------------------
// T2 review of 95cb287f (forge-8vfn.5.16) — the unbounded request-path scan
// class #834 (forge-hqkm/omk0) fixed for ingest-activity/standalone-history
// applies here too: GET /api/studio/hooks/:id must never open every cycle's
// events.jsonl. `scanHookFireSummary` is the bounded-read engine a route
// wires with real guarded IO and a test wires with COUNTING fakes; the
// sort+bound mechanism it uses (`selectRecentEntries`) moved to
// `@forge/kernel` (T2's follow-up review) and has its own tests there —
// `packages/kernel/tests/unit/guarded-scan.test.ts`.
//
// WHAT EACH TEST KILLS:
//  - "scanHookFireSummary opens at most maxCycles readTail calls" kills an
//    implementation that still loops the full cycle list for reads even
//    after bounding the SELECTION — the bound must reach the actual I/O,
//    not just an intermediate array.
//  - "a fire recorded only in an OUT-OF-WINDOW cycle is invisible" is the
//    behavioural proof, independent of call-counting: bounded-but-wrong
//    (e.g. off-by-one) would still show the wrong fireCount here.
// ---------------------------------------------------------------------------

import { scanHookFireSummary, HOOK_FIRE_SCAN_MAX_CYCLES } from '../../studio/hook-fire-summary.ts';

describe('scanHookFireSummary (bounded engine)', () => {
  it('opens readTail for at most maxCycles entries, even when far more cycles exist', () => {
    const totalCycles = HOOK_FIRE_SCAN_MAX_CYCLES + 25;
    const ids = Array.from({ length: totalCycles }, (_, i) => `cycle-${i}`);
    // newest = highest index, by construction
    const mtimeOf = (id: string): number => Number(id.replace('cycle-', ''));
    let readTailCalls = 0;
    const scan = scanHookFireSummary('any-hook', {
      listCycleIds: () => ids,
      mtimeOf,
      readTail: () => {
        readTailCalls++;
        return `{"message":"hook.fire","started_at":"2026-01-01T00:00:00.000Z","metadata":{"hookId":"any-hook","outcome":"ran"}}\n`;
      },
    });
    assert.equal(readTailCalls, HOOK_FIRE_SCAN_MAX_CYCLES, `expected exactly ${HOOK_FIRE_SCAN_MAX_CYCLES} readTail calls, got ${readTailCalls} (${totalCycles} cycles existed)`);
    assert.ok(scan, 'the in-window cycles do carry a real fire');
    assert.equal(scan!.fireCount, HOOK_FIRE_SCAN_MAX_CYCLES);
  });

  it('a fire recorded ONLY in an out-of-window (older-than-bound) cycle is invisible — never a false claim of "never fired"', () => {
    const totalCycles = HOOK_FIRE_SCAN_MAX_CYCLES + 5;
    const ids = Array.from({ length: totalCycles }, (_, i) => `cycle-${i}`); // cycle-0 is OLDEST
    const mtimeOf = (id: string): number => Number(id.replace('cycle-', ''));
    const scan = scanHookFireSummary('target-hook', {
      listCycleIds: () => ids,
      // Only the OLDEST cycle (outside the newest-`max` window) carries a
      // real fire for target-hook; every in-window cycle is empty.
      mtimeOf,
      readTail: (id) =>
        id === 'cycle-0'
          ? `{"message":"hook.fire","started_at":"2026-01-01T00:00:00.000Z","metadata":{"hookId":"target-hook","outcome":"ran"}}\n`
          : '',
    });
    assert.equal(scan, null, 'a fire outside the scanned window must not be visible — this is the honest cost of bounding, not a bug, but it must be true');
  });
});
