import { describe, it, expect } from 'vitest';

import { consolidateResultLabel } from './kb-consolidate';
import type { PolledAgentFixStatus } from './agent-dispatch';

// ---------------------------------------------------------------------------
// W6-B14: `runConsolidateToTerminal`'s own bounded-loop tests are gone with
// it (see kb-consolidate.ts's header) — the poll mechanics it used to
// hand-roll are now covered generically by `pollAgentFix`'s own suite in
// `agent-dispatch.test.ts`. What remains here is the PURE label mapping,
// now over `PolledAgentFixStatus` (the shared poll status shape) instead of
// the old bespoke `ConsolidateOutcome` — including the new `timed-out`
// state `runConsolidateToTerminal` could never honestly represent (it only
// ever returned `state:'running'` once its own budget ran out).
// ---------------------------------------------------------------------------

function status(overrides: Partial<PolledAgentFixStatus> = {}): PolledAgentFixStatus {
  return { ok: true, state: 'running', cleared: false, ...overrides };
}

describe('consolidateResultLabel', () => {
  it('no status yet (null) -> null, never a fabricated/stale label', () => {
    expect(consolidateResultLabel(null)).toBeNull();
  });

  it('"running" -> an honest in-progress label', () => {
    expect(consolidateResultLabel(status({ state: 'running' }))).toBe('consolidate: running…');
  });

  it('"cleared" -> the honest cleared label', () => {
    expect(consolidateResultLabel(status({ state: 'cleared', cleared: true }))).toBe('consolidate: cleared ✓');
  });

  it('"not-cleared" -> some findings remain', () => {
    expect(consolidateResultLabel(status({ state: 'not-cleared' }))).toBe('consolidate: some findings remain');
  });

  it('"failed" -> failed', () => {
    expect(consolidateResultLabel(status({ state: 'failed' }))).toBe('consolidate: failed');
  });

  it('"timed-out" -> the poll-ceiling label, distinct from every other state — the run may still be going server-side, never rendered as if it silently stopped', () => {
    const label = consolidateResultLabel(status({ state: 'timed-out' }));
    expect(label).toBe('consolidate: still running — re-check in a moment');
    expect(label).not.toBe(consolidateResultLabel(status({ state: 'running' })));
  });
});

it('W7-FIX-A1 A1-10: consolidateResultLabel — a failed read (ok:false, state "unknown") names the read failure, never "running…"; an answered "unknown" is an honest unknown', () => {
  expect(consolidateResultLabel({ ok: false, state: 'unknown', cleared: false, error: 'bridge unreachable (Failed to fetch)' })).toBe('consolidate: status could not be read — bridge unreachable (Failed to fetch)');
  expect(consolidateResultLabel({ ok: true, state: 'unknown', cleared: false })).toBe('consolidate: status unknown');
});
