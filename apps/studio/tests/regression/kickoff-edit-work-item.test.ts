// @vitest-environment jsdom
/**
 * forge-nk1y.32 (D-48 amended) — "Edit work item" at the Kickoff gate, inside
 * the Add work item `<details>` (`data-component="kickoff-edit-wi"`):
 *
 *   - pick a work item (`kickoff-edit-wi-id`); one ADDED at the gate (the
 *     roadmap serves its `kickoff` fields) prefills the shared authoring fields
 *     (prefix `kickoff-edit`) and the dependency boxes (`kickoff-edit-dep-<id>`);
 *     Save (`save-kickoff-wi`) PATCHes the full set;
 *   - a plan work item shows the dependency boxes only and saves dependsOn only;
 *   - Save is disabled with a reason until a work item is picked;
 *   - a files line that is not one relative path is refused client-side, by name.
 *
 * RUN: npx vitest run --root apps/studio apps/studio/tests/regression/kickoff-edit-work-item.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { KICKOFF_INIT as INIT, KICKOFF_WIS as WIS, WI14_LINE, AC14 } from '../test-fixtures/kickoff-i2-work-items';

type EditResult = { ok: true; workItemId: string; dependsOn: string[] } | { ok: false; error: string };
const editMock = vi.fn<(input: Record<string, unknown>) => Promise<EditResult>>();

vi.mock('@/lib/bridge-client', () => ({
  addKickoffWorkItem: vi.fn(),
  editKickoffWorkItem: (input: Record<string, unknown>) => editMock(input),
}));

import { KickoffAddWorkItem } from '@/components/studio/KickoffAddWorkItem';

let container: HTMLDivElement;
let root: Root;
const onAdded = vi.fn();

beforeEach(async () => {
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
const panel = () => q('[data-component="kickoff-edit-wi"]');
const btn = (action: string) => q<HTMLButtonElement>(`[data-action="${action}"]`);
const val = (field: string) => q<HTMLInputElement | HTMLTextAreaElement>(`[data-field="${field}"]`).value;
const checked = () => {
  const boxes = [...container.querySelectorAll<HTMLInputElement>('[data-field^="kickoff-edit-dep-"]')];
  return boxes.filter((b) => b.checked).map((b) => b.getAttribute('data-field')!.slice('kickoff-edit-dep-'.length));
};

async function type(sel: string, value: string): Promise<void> {
  const el = q<HTMLInputElement | HTMLTextAreaElement>(sel);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function pick(id: string): Promise<void> {
  const sel = q<HTMLSelectElement>('[data-field="kickoff-edit-wi-id"]');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, id);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

test('inside the Add work item details; Save disabled with a reason until a work item is picked', () => {
  expect(panel().closest('details')).not.toBeNull();
  expect(panel().getAttribute('data-form-state')).toBe('editing');
  const options = [...q<HTMLSelectElement>('[data-field="kickoff-edit-wi-id"]').options].map((o) => o.value).filter(Boolean);
  expect(options).toEqual(['WI-9a', 'WI-10', 'WI-11', 'WI-12', 'WI-13', 'WI-14']);
  expect(btn('save-kickoff-wi').disabled).toBe(true);
  expect(btn('save-kickoff-wi').getAttribute('data-disabled-reason')).toMatch(/pick a work item/);
});

test('pick WI-14: fields and dependencies prefill; the two-paths line is refused client-side, by name', async () => {
  await pick('WI-14');
  expect(val('kickoff-edit-wi-summary')).toBe('No Terraform references left in agent context or docs');
  expect(val('kickoff-edit-ac-given-1')).toBe(AC14.given);
  expect(val('kickoff-edit-wi-gate-cmd')).toBe('python3 -m pytest tests/test_docs_no_terraform_tokens.py');
  expect(val('kickoff-edit-wi-files')).toBe(WI14_LINE);
  expect(checked()).toEqual(['WI-9a', 'WI-10', 'WI-11']);
  expect(btn('save-kickoff-wi').disabled).toBe(true);
  // forge-mfv5.1.43: WI-14 predates per-criterion checks — the form re-authors its criteria, so it asks for one first.
  expect(btn('save-kickoff-wi').getAttribute('data-disabled-reason')).toMatch(/AC1 needs a check command/);
  await type('[data-field="kickoff-edit-ac-check-1"]', 'python3 -m pytest tests/test_docs_no_terraform_tokens.py');
  const reason = `files_in_scope entry "${WI14_LINE}" refused: contains whitespace — one relative path per entry`;
  expect(btn('save-kickoff-wi').getAttribute('data-disabled-reason')).toBe(reason);
  expect(editMock).not.toHaveBeenCalled();
});

test('fix WI-14\'s files (one per line) and Save: PATCHes the full set, refreshes', async () => {
  editMock.mockResolvedValue({ ok: true, workItemId: 'WI-14', dependsOn: ['WI-9a', 'WI-10', 'WI-11'] });
  await pick('WI-14');
  await type('[data-field="kickoff-edit-wi-files"]', WI14_LINE.replace(' ', '\n'));
  await type('[data-field="kickoff-edit-ac-check-1"]', 'python3 -m pytest tests/test_docs_no_terraform_tokens.py');
  await act(async () => { btn('save-kickoff-wi').click(); });
  expect(editMock).toHaveBeenCalledWith({
    initiativeId: INIT,
    workItemId: 'WI-14',
    summary: 'No Terraform references left in agent context or docs',
    acceptanceCriteria: [{ ...AC14, check: { argv: ['python3', '-m', 'pytest', 'tests/test_docs_no_terraform_tokens.py'], expect: 'pass' } }],
    qualityGateCmd: ['python3', '-m', 'pytest', 'tests/test_docs_no_terraform_tokens.py'],
    filesInScope: ['tests/test_docs_no_terraform_tokens.py', '.github/copilot-context.md'],
    dependsOn: ['WI-9a', 'WI-10', 'WI-11'],
  });
  expect(panel().getAttribute('data-form-state')).toBe('saved');
  expect(onAdded).toHaveBeenCalledTimes(1);
});

test('a plan work item: dependency boxes only; Save sends dependsOn only', async () => {
  editMock.mockResolvedValue({ ok: true, workItemId: 'WI-12', dependsOn: [] });
  await pick('WI-12');
  expect(container.querySelector('[data-field="kickoff-edit-wi-summary"]')).toBeNull();
  expect(checked()).toEqual(['WI-11']);
  await act(async () => { q<HTMLInputElement>('[data-field="kickoff-edit-dep-WI-11"]').click(); });
  await act(async () => { btn('save-kickoff-wi').click(); });
  expect(editMock).toHaveBeenCalledWith({ initiativeId: INIT, workItemId: 'WI-12', dependsOn: [] });
});

test('a refusal shows the server detail', async () => {
  editMock.mockResolvedValue({ ok: false, error: 'WI-12: work-item dependency cycle: WI-12 → WI-13 → WI-12' });
  await pick('WI-12');
  await act(async () => { btn('save-kickoff-wi').click(); });
  expect(panel().getAttribute('data-form-state')).toBe('error');
  expect(q('[data-component="kickoff-edit-wi"] [role="alert"]').textContent).toContain('dependency cycle');
  expect(onAdded).not.toHaveBeenCalled();
});

test('InitiativeDetail threads the roadmap\'s kickoff fields to the control (the added WI is labelled)', async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { InitiativeDetail } = await import('@/components/studio/InitiativeDetail');
  const wi14 = WIS[5]!;
  const props = {
    expanded: true, initiativeId: INIT, dependsOnInitiatives: [], blocked: false, blockedBy: [], unplanned: false,
    runCycleIds: [], plan: { status: 'idle', error: null }, canStartDevelopment: true,
    develop: { status: 'idle', error: null }, onStart: () => {}, attempt: { attemptCount: 1, priorCycleIds: [] },
    recoveryDetail: null, recoveryBusy: false, recoveryNote: '', onInspectRecovery: () => {}, onRecoveryAction: () => {},
    status: 'awaiting-kickoff',
    wiLevels: {
      levelById: new Map(),
      maxLevel: 0,
      byLevel: new Map([[0, [{ id: 'WI-9a', title: 'a', dependsOn: [] }, { ...wi14, title: 'b' }]]]),
    },
  };
  const html = renderToStaticMarkup(React.createElement(InitiativeDetail as never, props as never));
  expect(html).toContain('data-component="kickoff-edit-wi"');
  expect(html).toMatch(/WI-14(<!-- -->)? \(added at the gate\)/);
  expect(html).not.toMatch(/WI-9a(<!-- -->)? \(added at the gate\)/);
});
