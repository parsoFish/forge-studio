// @vitest-environment jsdom
/**
 * forge-mfv5.1.54 (D-06): the roadmap drawer's Requeue door. A Requeue the bridge refused
 * (400 branch-discard-refused — it would delete branch commits not on origin/main) shows the
 * branch + count and a confirm; only that confirm asks for `requeue-discard`.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/link', () => ({ default: (p: { children?: React.ReactNode }) => React.createElement('a', null, p.children) }));

import { InitiativeDetail } from '@/components/studio/InitiativeDetail';

const REFUSED = { ok: false, error: 'refused', data: { code: 'branch-discard-refused', branch: 'forge/INIT-2026-10-17-i4', unmergedCommits: ['a1 Merge WI-1', 'b2 Merge WI-2', 'c3 Merge WI-3'] } };
const action = vi.fn();
const props = () => ({
  expanded: true, initiativeId: 'INIT-2026-10-17-i4', status: 'failed', dependsOnInitiatives: [], blocked: false, blockedBy: [], unplanned: false,
  wiLevels: null, runCycleIds: ['CY-1'], plan: { state: 'idle' }, canStartDevelopment: false, develop: { state: 'idle' },
  attempt: { attemptCount: 1, priorCycleIds: [] }, recoveryDetail: null, recoveryBusy: false, recoveryNote: '',
  onInspectRecovery: () => {}, onRecoveryAction: action,
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); action.mockReset(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const q = (sel: string): HTMLElement | null => container.querySelector<HTMLElement>(sel);
async function click(sel: string): Promise<void> {
  await act(async () => { q(sel)!.click(); });
  await act(async () => {});
}

test('a refused Requeue asks in the drawer; confirm requests requeue-discard, cancel requests nothing', async () => {
  action.mockResolvedValue(REFUSED);
  await act(async () => { root.render(React.createElement(InitiativeDetail as never, props() as never)); });
  await click('[data-action="recovery-requeue"]');
  expect(action.mock.calls).toEqual([['requeue']]);
  expect(q('[data-component="discard-branch-confirm"]')?.getAttribute('data-unmerged-commits')).toBe('3');
  await click('[data-action="cancel-discard-branch"]');
  expect(q('[data-component="discard-branch-confirm"]')).toBeNull();
  await click('[data-action="recovery-requeue"]');
  await click('[data-action="confirm-discard-branch"]');
  expect(action.mock.calls).toEqual([['requeue'], ['requeue'], ['requeue-discard']]);
});

test('a Requeue that succeeds or fails otherwise shows no discard confirm', async () => {
  action.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'x', data: {} });
  await act(async () => { root.render(React.createElement(InitiativeDetail as never, props() as never)); });
  await click('[data-action="recovery-requeue"]');
  expect(q('[data-component="discard-branch-confirm"]')).toBeNull();
  await click('[data-action="recovery-requeue"]');
  expect(q('[data-component="discard-branch-confirm"]')).toBeNull();
});
