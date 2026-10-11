// @vitest-environment jsdom
/**
 * forge-nk1y.32 12b (D-48 amended) — "Delete" in the Kickoff gate's Edit work
 * item control (`data-component="kickoff-edit-wi"`): `delete-kickoff-wi` asks
 * to confirm (`confirm-delete-kickoff-wi` / `cancel-delete-kickoff-wi`), then
 * DELETEs — work items added at the gate only; disabled with a reason until one
 * is picked, and for a plan work item.
 *
 * RUN: npx vitest run --root apps/studio apps/studio/tests/regression/kickoff-delete-work-item.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KICKOFF_INIT as INIT, KICKOFF_WIS as WIS } from '../test-fixtures/kickoff-i2-work-items';

type DeleteResult = { ok: true; workItemId: string } | { ok: false; error: string };
const deleteMock = vi.fn<(input: Record<string, unknown>) => Promise<DeleteResult>>();

vi.mock('@/lib/bridge-client', () => ({
  addKickoffWorkItem: vi.fn(),
  editKickoffWorkItem: vi.fn(),
  deleteKickoffWorkItem: (input: Record<string, unknown>) => deleteMock(input),
}));

import { KickoffAddWorkItem } from '@/components/studio/KickoffAddWorkItem';

let container: HTMLDivElement;
let root: Root;
const onAdded = vi.fn();

beforeEach(async () => {
  deleteMock.mockReset();
  onAdded.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(KickoffAddWorkItem, { initiativeId: INIT, workItems: WIS, onAdded })); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const q = <T extends Element>(sel: string): T => {
  const el = container.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};
const panel = () => q('[data-component="kickoff-edit-wi"]');
const btn = (action: string) => q<HTMLButtonElement>(`[data-action="${action}"]`);

async function pick(id: string): Promise<void> {
  const sel = q<HTMLSelectElement>('[data-field="kickoff-edit-wi-id"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, id);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('Delete is disabled with a reason until a work item is picked, and for a plan work item', async () => {
  expect(btn('delete-kickoff-wi').disabled).toBe(true);
  expect(btn('delete-kickoff-wi').getAttribute('data-disabled-reason')).toMatch(/pick a work item/);
  await pick('WI-12');
  expect(btn('delete-kickoff-wi').disabled).toBe(true);
  expect(btn('delete-kickoff-wi').getAttribute('data-disabled-reason')).toMatch(/plan work item/);
});

test('Delete asks to confirm, then DELETEs and refreshes; cancel sends nothing', async () => {
  deleteMock.mockResolvedValue({ ok: true, workItemId: 'WI-14' });
  await pick('WI-14');
  await act(async () => { btn('delete-kickoff-wi').click(); });
  expect(deleteMock).not.toHaveBeenCalled();
  await act(async () => { btn('cancel-delete-kickoff-wi').click(); });
  expect(container.querySelector('[data-action="confirm-delete-kickoff-wi"]')).toBeNull();
  await act(async () => { btn('delete-kickoff-wi').click(); });
  await act(async () => { btn('confirm-delete-kickoff-wi').click(); });
  expect(deleteMock).toHaveBeenCalledWith({ initiativeId: INIT, workItemId: 'WI-14' });
  expect(panel().getAttribute('data-form-state')).toBe('deleted');
  expect(onAdded).toHaveBeenCalledTimes(1);
});

test('a refusal shows the server detail', async () => {
  deleteMock.mockResolvedValue({ ok: false, error: 'WI-13 is a dependency of WI-14 — edit their dependencies first' });
  await pick('WI-13');
  await act(async () => { btn('delete-kickoff-wi').click(); });
  await act(async () => { btn('confirm-delete-kickoff-wi').click(); });
  expect(panel().getAttribute('data-form-state')).toBe('error');
  expect(q('[data-component="kickoff-edit-wi"] [role="alert"]').textContent).toContain('dependency of WI-14');
  expect(onAdded).not.toHaveBeenCalled();
});
