/**
 * forge-nk1y.3 — every pending reflection becomes a Waiting on you row that
 * opens the ReflectionGate (the same door as the verdict page's "Reflect on
 * this cycle →"), and each status keeps its own name on the row.
 */
import { test, expect } from 'vitest';
import { buildReflectionAttention, reflectionGateHref } from '../../lib/reflection-attention.ts';
import { gateAttentionStatusDot } from '../../lib/home-view.ts';
import type { PendingReflection } from '../../lib/bridge-client.ts';

const STRANGER: PendingReflection = {
  cycleId: '2026-10-09T01-34-13_INIT-2026-10-09-min-commits-filter',
  initiativeId: 'INIT-2026-10-09-min-commits-filter',
  questions: 4,
  status: 'awaiting',
};

test('the stranger\'s unanswered reflection is a reflection row that opens the gate', () => {
  const [row] = buildReflectionAttention([STRANGER]);
  expect(row).toEqual({
    id: `reflection-${STRANGER.cycleId}`,
    kind: 'reflection',
    text: 'INIT-2026-10-09-min-commits-filter · the reflection asks 4 questions',
    sub: 'reflection · awaiting',
    status: 'gated',
    href: '/artifact?run=2026-10-09T01-34-13_INIT-2026-10-09-min-commits-filter&type=reflection&mode=view',
    cycleId: STRANGER.cycleId,
  });
});

test('the gate href matches the verdict page\'s "Reflect on this cycle →" door', () => {
  expect(reflectionGateHref('C1')).toBe('/artifact?run=C1&type=reflection&mode=view');
});

test('unasked and unreadable keep their own status and wording; none is dropped', () => {
  const rows = buildReflectionAttention([
    { ...STRANGER, cycleId: 'A_INIT-a', initiativeId: 'INIT-a', questions: 0, status: 'unasked' },
    { ...STRANGER, cycleId: 'B_INIT-b', initiativeId: 'INIT-b', questions: 0, status: 'unreadable' },
  ]);
  expect(rows.map((r) => [r.status, r.text])).toEqual([
    ['unasked', 'INIT-a · the reflector asked nothing — close the reflection'],
    ['unreadable', 'INIT-b · the reflection\'s questions cannot be read'],
  ]);
});

test('every reflection status has a real status-dot frame, never the fallback guess', () => {
  expect(gateAttentionStatusDot('gated')).toBe('retrying');
  expect(gateAttentionStatusDot('unasked')).toBe('retrying');
  expect(gateAttentionStatusDot('unreadable')).toBe('failed');
});

test('one question is singular', () => {
  const [row] = buildReflectionAttention([{ ...STRANGER, questions: 1 }]);
  expect(row.text).toBe('INIT-2026-10-09-min-commits-filter · the reflection asks 1 question');
});

test('Waiting on you lists the stranger\'s unanswered reflection beside the project gates (the Q9 defect: it listed none)', async () => {
  const { buildWaitingOnYou } = await import('../../lib/reflection-attention.ts');
  const items = buildWaitingOnYou({ attention: [], reflections: [STRANGER], sessions: [], kbs: [] });
  expect(items.map((i) => [i.kind, i.href])).toEqual([
    ['reflection', '/artifact?run=2026-10-09T01-34-13_INIT-2026-10-09-min-commits-filter&type=reflection&mode=view'],
  ]);
});
