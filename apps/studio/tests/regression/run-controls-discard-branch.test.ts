// @vitest-environment jsdom
/**
 * forge-mfv5.1.54 (D-06): the Requeue door in Studio. The bridge refuses a fresh Requeue that
 * would delete branch commits not on origin/main (400 branch-discard-refused); RunControls then
 * shows the branch + commit count and a confirm, and ONLY that confirm re-posts with
 * `discardBranch: true`. The bridge client is mocked — nothing reaches a bridge.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const requeue = vi.fn();

vi.mock('@/lib/bridge-client', () => ({
  resumeRun: vi.fn(async () => ({ ok: true })),
  recoveryRequeue: (...args: unknown[]) => requeue(...args),
  recoveryAbandon: vi.fn(async () => ({ ok: true })),
  recoveryStop: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/lib/use-serve-status', () => ({ useServeStatus: () => ({ status: null, ready: true, refresh: async () => {} }) }));
vi.mock('@/components/studio/EnqueueOutcomeLine', () => ({ EnqueueOutcomeLine: () => null }));

import { RunControls } from '@/components/studio/RunControls';
import type { Run } from '@/lib/studio-client';

const RUN = {
  id: '2026-10-17T02-17-04_INIT-2026-10-17-i4', flowId: 'forge-develop', initiativeId: 'INIT-2026-10-17-i4', initiative: 'i4',
  status: 'failed', origin: 'architect', costUsd: 11, phases: {}, phaseMeta: {}, artifactsReady: {}, flowLineage: ['forge-develop'],
} as unknown as Run;
const REFUSED = {
  ok: false,
  error: 'requeue: refusing a fresh re-run — forge/INIT-2026-10-17-i4 carries 2 commit(s) not on origin/main',
  data: { code: 'branch-discard-refused', branch: 'forge/INIT-2026-10-17-i4', unmergedCommits: ['aaed42f Merge WI-12', 'b1 Merge WI-11'] },
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); requeue.mockReset(); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const q = (sel: string): HTMLElement | null => container.querySelector<HTMLElement>(sel);
async function click(sel: string): Promise<void> {
  await act(async () => { q(sel)!.click(); });
  await act(async () => {});
}

test('a refused Requeue shows the branch and its commit count, and posts nothing more until confirmed', async () => {
  requeue.mockResolvedValueOnce(REFUSED);
  await act(async () => { root.render(React.createElement(RunControls, { run: RUN })); });
  await click('[data-action="requeue-run"]');
  expect(requeue).toHaveBeenCalledTimes(1);
  expect(requeue.mock.calls[0]).toEqual(['INIT-2026-10-17-i4', { resetRetries: true }]);
  const panel = q('[data-component="discard-branch-confirm"]');
  expect(panel?.getAttribute('data-branch')).toBe('forge/INIT-2026-10-17-i4');
  expect(panel?.getAttribute('data-unmerged-commits')).toBe('2');
  expect(panel?.textContent).toMatch(/2 commit\(s\) not on origin\/main/);
  expect(q('[data-component="run-control-error"]')?.textContent).toMatch(/refusing a fresh re-run/);
});

test('confirm re-posts with discardBranch:true; cancel drops the panel without posting', async () => {
  requeue.mockResolvedValueOnce(REFUSED).mockResolvedValueOnce({ ok: true });
  await act(async () => { root.render(React.createElement(RunControls, { run: RUN })); });
  await click('[data-action="requeue-run"]');
  await click('[data-action="cancel-discard-branch"]');
  expect(q('[data-component="discard-branch-confirm"]')).toBeNull();
  expect(requeue).toHaveBeenCalledTimes(1);

  requeue.mockReset();
  requeue.mockResolvedValueOnce(REFUSED).mockResolvedValueOnce({ ok: true });
  await click('[data-action="requeue-run"]');
  await click('[data-action="confirm-discard-branch"]');
  expect(requeue).toHaveBeenCalledTimes(2);
  expect(requeue.mock.calls[1]).toEqual(['INIT-2026-10-17-i4', { resetRetries: true, discardBranch: true }]);
  expect(q('[data-component="discard-branch-confirm"]')).toBeNull();
});

test('any other Requeue failure shows its error and no discard confirm', async () => {
  requeue.mockResolvedValueOnce({ ok: false, error: 'requeue: no manifest', data: { error: 'requeue: no manifest' } });
  await act(async () => { root.render(React.createElement(RunControls, { run: RUN })); });
  await click('[data-action="requeue-run"]');
  expect(q('[data-component="discard-branch-confirm"]')).toBeNull();
  expect(q('[data-component="run-control-error"]')?.textContent).toMatch(/no manifest/);
});
