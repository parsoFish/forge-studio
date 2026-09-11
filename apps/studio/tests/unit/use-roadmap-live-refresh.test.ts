/**
 * `forge-8vfn.7.6.27` (T1 rulings 721(b)/728) — WHICH bridge messages make the
 * project roadmap re-read, and which must not.
 *
 * The roadmap was the ONE live surface with no live refresh. `/flows`,
 * `/flows/[id]` and `/sessions` all subscribe to the bridge socket;
 * `app/projects/[id]/page.tsx` never imported `subscribe`, so a card on screen
 * updated only on navigation, a Retry, or an operator action. M6-C's run 11
 * measured the cost: `cycle.end` at 13:23:30 with the manifest already in
 * `_queue/ready-for-review/`, and beat 8 still reading `planning` at 13:24:30.
 * `RoadmapCanvas.tsx:563` was not disagreeing with the queue — it was never
 * re-run.
 *
 * TWO messages, and the division of labour is the whole point (728):
 *
 *   cycle-list-changed  every `data-initiative-status` transition. `watchQueue`
 *                       (`apps/forge/ui-bridge.ts:495-508`) watches all SIX
 *                       queue dirs and broadcasts this on any change, so a
 *                       manifest moving between them always fires.
 *
 *   event               `data-plan-state`'s planning -> planned. That value
 *                       derives from the WI snapshot under
 *                       `_logs/<cycleId>/work-items-snapshot/`
 *                       (`bridge-studio.ts:984` -> `:1139`), which is NOT a
 *                       queue dir — `watchQueue` does not watch it, so that
 *                       transition fires NO `cycle-list-changed` of its own.
 *                       The PM's own log lines are the only signal, and they
 *                       are already on the socket.
 *
 * Subscribing to `event` ALONE would refresh busily while the PM runs and then
 * not at the queue move; subscribing to `cycle-list-changed` alone leaves run
 * 11's beat 8 exactly as broken as it was. Both, or neither is a fix.
 *
 * RUN: cd apps/studio && npx vitest run tests/unit/use-roadmap-live-refresh.test.ts
 */
import { test, expect } from 'vitest';

import type { BridgeMessage } from '@/lib/bridge-client';
import { refreshesRoadmap } from '@/lib/use-roadmap-live-refresh';

test('a queue move refreshes the roadmap — every data-initiative-status transition rides this one', () => {
  expect(refreshesRoadmap({ type: 'cycle-list-changed' })).toBe(true);
});

test('cycle progress refreshes the roadmap — planning -> planned fires no queue event of its own', () => {
  const msg = {
    type: 'event',
    cycleId: '2026-09-11T13-23-30-abcd1234_INIT-1',
    event: { ts: '2026-09-11T13:23:30.000Z', kind: 'phase-complete' },
  } as unknown as BridgeMessage;
  expect(refreshesRoadmap(msg)).toBe(true);
});

test('the roadmap does NOT re-read for lists it does not render', () => {
  // A refresh here is a filesystem scan of six queue dirs plus a run read, for
  // a surface with no architect/demo/instructions content on it at all.
  for (const type of ['architect-list-changed', 'instructions-list-changed', 'demo-list-changed'] as const) {
    expect(refreshesRoadmap({ type }), `${type} must not refresh the roadmap`).toBe(false);
  }
});

test('the connect-time snapshot does NOT refresh — the mount effect has already read', () => {
  // `subscribe()` delivers `snapshot` on open, which is the same instant the
  // page's own mount effect fetched. Refreshing on it is a guaranteed
  // duplicate read of what was just read.
  const msg = { type: 'snapshot', cycles: { live: [], recent: [] } } as unknown as BridgeMessage;
  expect(refreshesRoadmap(msg)).toBe(false);
});

test('an unknown message type is NOT a refresh — a new kind must be adopted deliberately', () => {
  // Fail CLOSED on the vocabulary. If the bridge grows a message tomorrow, the
  // roadmap must not start refetching on it because a default said yes; the
  // person adding it adds a case here and a line to the doc above.
  expect(refreshesRoadmap({ type: 'kb-drain-finished' } as unknown as BridgeMessage)).toBe(false);
});
