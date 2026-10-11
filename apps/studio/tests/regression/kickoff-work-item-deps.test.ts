// @vitest-environment jsdom
/**
 * forge-mfv5.1.36 (D-48 amended) — dependencies at the Kickoff gate in Studio:
 *
 *   - the add form lists the initiative's work items in natural id order as
 *     checkboxes (`data-field="kickoff-wi-dep-<id>"`), PRE-CHECKED with the
 *     plan's leaves, and submits the checked set as `dependsOn`;
 *   - "Edit dependencies" (`data-component="kickoff-edit-deps"`) picks a work
 *     item (`kickoff-deps-wi`), shows the others as checkboxes
 *     (`kickoff-dep-<id>`) checked with its current dependencies, and Save
 *     (`save-kickoff-deps`) PATCHes;
 *   - both live inside the add `<details>`, which renders only at the gate.
 *
 * RUN: npx vitest run apps/studio/tests/regression/kickoff-work-item-deps.test.ts (from apps/studio)
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

type AddResult = { ok: true; workItemId: string; uncoveredAcceptanceCriteria: string[] } | { ok: false; error: string };
type EditInput = { initiativeId: string; workItemId: string; dependsOn: string[] };
type EditResult = { ok: true; workItemId: string; dependsOn: string[] } | { ok: false; error: string };
const addMock = vi.fn<(input: Record<string, unknown>) => Promise<AddResult>>();
const editMock = vi.fn<(input: EditInput) => Promise<EditResult>>();

vi.mock('@/lib/bridge-client', () => ({
  addKickoffWorkItem: (input: Record<string, unknown>) => addMock(input),
  editKickoffWorkItemDeps: (input: EditInput) => editMock(input),
}));

import { KickoffAddWorkItem } from '@/components/studio/KickoffAddWorkItem';
import { InitiativeDetail } from '@/components/studio/InitiativeDetail';

const INIT = 'INIT-2026-10-11-i2-apply-engine-terraform-retired';
/** A slice of gitweave I2, served in readdir (lexical) order on purpose. */
const WIS = [
  { id: 'WI-1', dependsOn: [] }, { id: 'WI-10', dependsOn: ['WI-9a'] }, { id: 'WI-13', dependsOn: [] },
  { id: 'WI-2', dependsOn: ['WI-1'] }, { id: 'WI-8', dependsOn: ['WI-2'] }, { id: 'WI-9a', dependsOn: ['WI-1'] },
];
let container: HTMLDivElement;
let root: Root;
const onAdded = vi.fn();

beforeEach(async () => {
  addMock.mockReset();
  editMock.mockReset();
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
const box = (field: string) => q<HTMLInputElement>(`[data-field="${field}"]`);
const fields = (prefix: string) => [...container.querySelectorAll<HTMLInputElement>(`[data-field^="${prefix}"]`)].map((e) => e.getAttribute('data-field')!.slice(prefix.length));

async function type(sel: string, value: string): Promise<void> {
  const el = q<HTMLInputElement | HTMLTextAreaElement>(sel);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function fillAll(): Promise<void> {
  await type('[data-field="kickoff-wi-summary"]', 'Reset before apply, live.');
  await type('[data-field="kickoff-ac-given-1"]', 'a stray team');
  await type('[data-field="kickoff-ac-when-1"]', 'the reset test runs');
  await type('[data-field="kickoff-ac-then-1"]', 'it is gone');
  await type('[data-field="kickoff-wi-gate-cmd"]', 'python3 -m pytest tests/acceptance/test_gw_reset_before_apply.py');
  await type('[data-field="kickoff-wi-files"]', 'tests/acceptance/test_gw_reset_before_apply.py');
}

async function selectWi(id: string): Promise<void> {
  const sel = q<HTMLSelectElement>('[data-field="kickoff-deps-wi"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, id);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// ---- the add form ------------------------------------------------------------

test('add form: one checkbox per work item in natural order, the plan\'s leaves pre-checked, with the statement', () => {
  expect(fields('kickoff-wi-dep-')).toEqual(['WI-1', 'WI-2', 'WI-8', 'WI-9a', 'WI-10', 'WI-13']);
  const checked = fields('kickoff-wi-dep-').filter((id) => box(`kickoff-wi-dep-${id}`).checked);
  expect(checked).toEqual(['WI-8', 'WI-10', 'WI-13']);
  expect(q('[data-component="kickoff-add-work-item"]').textContent).toContain('Runs after the checked work items (default: the plan\'s last ones)');
});

test('add form submits the checked set as dependsOn, in natural order', async () => {
  addMock.mockResolvedValue({ ok: true, workItemId: 'WI-14', uncoveredAcceptanceCriteria: [] });
  await fillAll();
  await act(async () => { box('kickoff-wi-dep-WI-13').click(); }); // uncheck
  await act(async () => { box('kickoff-wi-dep-WI-2').click(); }); // check
  await act(async () => { q<HTMLButtonElement>('[data-action="add-kickoff-work-item"]').click(); });
  expect(addMock).toHaveBeenCalledTimes(1);
  expect(addMock.mock.calls[0]![0].dependsOn).toEqual(['WI-2', 'WI-8', 'WI-10']);
});

test('add form with every box unchecked sends dependsOn: [] (a root, on purpose)', async () => {
  addMock.mockResolvedValue({ ok: true, workItemId: 'WI-14', uncoveredAcceptanceCriteria: [] });
  await fillAll();
  for (const id of ['WI-8', 'WI-10', 'WI-13']) await act(async () => { box(`kickoff-wi-dep-${id}`).click(); });
  await act(async () => { q<HTMLButtonElement>('[data-action="add-kickoff-work-item"]').click(); });
  expect(addMock.mock.calls[0]![0].dependsOn).toEqual([]);
});

// ---- edit dependencies ---------------------------------------------------------

test('edit: pick a WI, its current dependencies are checked, the others listed (never itself), Save PATCHes and refreshes', async () => {
  editMock.mockResolvedValue({ ok: true, workItemId: 'WI-13', dependsOn: ['WI-8', 'WI-10'] });
  const panel = q('[data-component="kickoff-edit-deps"]');
  expect(panel.closest('details')).not.toBeNull();
  expect([...q<HTMLSelectElement>('[data-field="kickoff-deps-wi"]').options].map((o) => o.value).filter(Boolean))
    .toEqual(['WI-1', 'WI-2', 'WI-8', 'WI-9a', 'WI-10', 'WI-13']);
  await selectWi('WI-10');
  expect(fields('kickoff-dep-')).toEqual(['WI-1', 'WI-2', 'WI-8', 'WI-9a', 'WI-13']);
  expect(box('kickoff-dep-WI-9a').checked).toBe(true);
  await selectWi('WI-13');
  expect(fields('kickoff-dep-').filter((id) => box(`kickoff-dep-${id}`).checked)).toEqual([]);
  await act(async () => { box('kickoff-dep-WI-10').click(); });
  await act(async () => { box('kickoff-dep-WI-8').click(); });
  await act(async () => { q<HTMLButtonElement>('[data-action="save-kickoff-deps"]').click(); });
  expect(editMock).toHaveBeenCalledWith({ initiativeId: INIT, workItemId: 'WI-13', dependsOn: ['WI-8', 'WI-10'] });
  expect(panel.getAttribute('data-form-state')).toBe('saved');
  expect(onAdded).toHaveBeenCalledTimes(1);
});

test('edit: Save is disabled with a reason until a WI is picked; a refusal shows the server detail', async () => {
  const save = () => q<HTMLButtonElement>('[data-action="save-kickoff-deps"]');
  expect(save().disabled).toBe(true);
  expect(save().getAttribute('data-disabled-reason')).toMatch(/work item/);
  editMock.mockResolvedValue({ ok: false, error: 'WI-1: work-item dependency cycle: WI-1 → WI-2 → WI-1' });
  await selectWi('WI-1');
  await act(async () => { box('kickoff-dep-WI-2').click(); });
  await act(async () => { save().click(); });
  expect(q('[data-component="kickoff-edit-deps"]').getAttribute('data-form-state')).toBe('error');
  expect(q('[data-component="kickoff-edit-deps"] [role="alert"]').textContent).toContain('dependency cycle');
  expect(onAdded).not.toHaveBeenCalled();
});

// ---- only at the Kickoff gate ----------------------------------------------------

const BASE = {
  expanded: true, initiativeId: INIT, dependsOnInitiatives: [], blocked: false, blockedBy: [],
  unplanned: false, runCycleIds: [], plan: { status: 'idle', error: null } as never,
  canStartDevelopment: true, develop: { status: 'idle', error: null } as never, onStart: () => {},
  attempt: { attemptCount: 1, priorCycleIds: [] }, recoveryDetail: null, recoveryBusy: false, recoveryNote: '',
  onInspectRecovery: () => {}, onRecoveryAction: () => {},
  wiLevels: { levelById: new Map(), maxLevel: 1, byLevel: new Map([[0, [{ id: 'WI-1', title: 'a', dependsOn: [], status: 'pending' }]], [1, [{ id: 'WI-2', title: 'b', dependsOn: ['WI-1'], status: 'pending' }]]]) },
};
const render = (status: string): string => renderToStaticMarkup(React.createElement(InitiativeDetail as never, { ...BASE, status } as never));

test('InitiativeDetail: the dependency controls render at the Kickoff gate, fed the roadmap\'s work items, and nowhere else', () => {
  const html = render('awaiting-kickoff');
  expect(html).toContain('data-component="kickoff-edit-deps"');
  expect(html).toContain('data-field="kickoff-wi-dep-WI-2"');
  expect(html).toMatch(/data-field="kickoff-wi-dep-WI-2"[^>]*checked/);
  for (const status of ['pending', 'ready-for-review', 'in-flight', 'failed']) {
    expect(render(status)).not.toContain('data-component="kickoff-edit-deps"');
  }
});
