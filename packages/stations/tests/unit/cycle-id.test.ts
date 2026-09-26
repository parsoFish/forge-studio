import { test } from 'node:test';
import assert from 'node:assert/strict';

import { requireCycleId } from '../../phases/cycle-id.ts';
import type { CycleInput } from '@forge/flows';

const input = (cycleId?: string) =>
  ({ initiativeId: 'INIT-2026-09-26-x', cycleId }) as unknown as CycleInput;
const CYCLE_ID = '2026-09-26T07-16-37_INIT-2026-09-26-x';

test('forge-8vfn.8.1.17: the threaded cycleId is returned as-is', () => {
  assert.equal(requireCycleId(input(CYCLE_ID), 'site'), CYCLE_ID);
});

test('forge-8vfn.8.1.17: a missing cycleId throws naming the site, never falls back', () => {
  const named = (site: string) => new RegExp(`${site.replace(/[()]/g, '\\$&')}: input\\.cycleId is required`);
  assert.throws(() => requireCycleId(input(undefined), 'runProjectManager'), named('runProjectManager'));
  assert.throws(() => requireCycleId(input(''), 'execAgent(dev)'), named('execAgent(dev)'));
});
