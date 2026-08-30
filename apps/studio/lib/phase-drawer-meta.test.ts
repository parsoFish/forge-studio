/**
 * W7-B7 pins (flows-14) — the per-WI drawer reports the WI's OWN cost, never
 * the pooled dev-phase total. Live repro: WI-1..WI-4 drawers all read
 * "COST $3.21" (the phase total) while their hexes carried 0.63/0.42/1.14/1.02.
 * RUN: cd forge-ui && npx vitest run lib/phase-drawer-meta.test.ts
 */
import { test, expect } from 'vitest';

import { drawerHeaderMeta } from './phase-drawer-meta.ts';

const DEV_PHASE_META = { costUsd: 3.21, retries: 2, model: 'claude-sonnet-4-5' };

test('WI mode: cost is the WI\'s own (the hex\'s data-wi-cost-usd value), NOT the phase total', () => {
  const m = drawerHeaderMeta({ isWi: true, wiCostUsd: 0.63, phaseMeta: DEV_PHASE_META });
  expect(m.cost).toBe('$0.63');
});

test('WI mode: phase-level model + retries are OMITTED, never attributed to one work item', () => {
  const m = drawerHeaderMeta({ isWi: true, wiCostUsd: 0.63, phaseMeta: DEV_PHASE_META });
  expect(m.model).toBeNull();
  expect(m.retries).toBeNull();
});

test('WI mode: an unknown WI cost renders "—" — never the phase total as a stand-in', () => {
  const m = drawerHeaderMeta({ isWi: true, phaseMeta: DEV_PHASE_META });
  expect(m.cost).toBe('—');
});

test('phase mode: unchanged — phase cost/model/retries render as before', () => {
  expect(drawerHeaderMeta({ isWi: false, phaseMeta: DEV_PHASE_META })).toEqual({
    model: 'claude-sonnet-4-5',
    cost: '$3.21',
    retries: '2',
  });
  expect(drawerHeaderMeta({ isWi: false, phaseMeta: null })).toEqual({ model: null, cost: '—', retries: '0' });
});
