// @vitest-environment jsdom
/**
 * forge-nk1y.12 (D-48) — the Kickoff gate's "Add work item": a `<details>` below
 * Start development, so the gate's primary act stays first (D-46). The fields
 * map onto the request; the submit is disabled with a reason until the required
 * fields are filled; success names the added WI and the uncovered criteria; a
 * refusal shows the server's detail. Technique: jsdom + react-dom/client + act.
 *
 * RUN: npx vitest run tests/regression/kickoff-add-work-item.test.ts   (from apps/studio/)
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Input = { initiativeId: string; summary: string; acceptanceCriteria: unknown[]; qualityGateCmd: string[]; filesInScope: string[] };
type Result = { ok: true; workItemId: string; uncoveredAcceptanceCriteria: string[] } | { ok: false; error: string };
const addMock = vi.fn<(input: Input) => Promise<Result>>();

vi.mock('@/lib/bridge-client', () => ({ addKickoffWorkItem: (input: Input) => addMock(input) }));

import { KickoffAddWorkItem } from '@/components/studio/KickoffAddWorkItem';

const INIT = 'INIT-2026-10-09-stranded-kickoff';
let container: HTMLDivElement;
let root: Root;
const onAdded = vi.fn();

beforeEach(async () => {
  addMock.mockReset();
  onAdded.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(React.createElement(KickoffAddWorkItem, { initiativeId: INIT, onAdded })); });
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

/** React tracks the value setter; set through the prototype and fire `input`. */
async function type(sel: string, value: string): Promise<void> {
  const el = q<HTMLInputElement | HTMLTextAreaElement>(sel);
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function fillAll(gate = 'node --test tests/retire.test.ts'): Promise<void> {
  await type('[data-field="kickoff-wi-summary"]', 'Retire the legacy specs.');
  await type('[data-field="kickoff-ac-given-1"]', 'the legacy specs');
  await type('[data-field="kickoff-ac-when-1"]', 'the retire test runs');
  await type('[data-field="kickoff-ac-then-1"]', 'none remain');
  await type('[data-field="kickoff-wi-gate-cmd"]', gate);
  await type('[data-field="kickoff-wi-files"]', 'specs/legacy.md\ntests/retire.test.ts');
}

const submit = () => q<HTMLButtonElement>('[data-action="add-kickoff-work-item"]');
const panel = () => q('[data-component="kickoff-add-work-item"]');

test('collapsed under "Add work item", editing, with prefixed AC rows and named acts', () => {
  const details = q<HTMLDetailsElement>('details');
  expect(details.open).toBe(false);
  expect(details.querySelector('summary')?.textContent).toBe('Add work item');
  expect(panel().getAttribute('data-form-state')).toBe('editing');
  for (const h of ['kickoff-ac-given-1', 'kickoff-ac-when-1', 'kickoff-ac-then-1']) q(`[data-field="${h}"]`);
  q('[data-action="kickoff-add-criterion"]');
  q('[data-action="kickoff-remove-criterion-1"]');
});

test('the submit is disabled with a reason while required fields are empty', () => {
  expect(submit().disabled).toBe(true);
  expect(submit().getAttribute('data-disabled-reason')).toMatch(/summary/);
});

test('fields map onto the request; success shows the added WI and the uncovered criteria, and refreshes', async () => {
  addMock.mockResolvedValue({ ok: true, workItemId: 'WI-6', uncoveredAcceptanceCriteria: ['AC2 (uncarried: `pytest`; when: x)'] });
  await fillAll();
  expect(submit().disabled).toBe(false);
  await act(async () => { submit().click(); });
  expect(addMock).toHaveBeenCalledWith({
    initiativeId: INIT,
    summary: 'Retire the legacy specs.',
    acceptanceCriteria: [{ given: 'the legacy specs', when: 'the retire test runs', then: 'none remain' }],
    qualityGateCmd: ['node', '--test', 'tests/retire.test.ts'],
    filesInScope: ['specs/legacy.md', 'tests/retire.test.ts'],
  });
  expect(panel().getAttribute('data-form-state')).toBe('added');
  const added = q('[data-kickoff-wi-added]');
  expect(added.getAttribute('data-kickoff-wi-added')).toBe('WI-6');
  expect(added.getAttribute('data-uncovered-acs')).toBe('1');
  expect(added.textContent).toContain('AC2 (uncarried: `pytest`; when: x)');
  expect(onAdded).toHaveBeenCalledTimes(1);
});

test('a refusal shows the server detail and stays editable', async () => {
  addMock.mockResolvedValue({ ok: false, error: 'not at the kickoff gate (a work item is complete)' });
  await fillAll();
  await act(async () => { submit().click(); });
  expect(panel().getAttribute('data-form-state')).toBe('error');
  expect(q('[role="alert"]').textContent).toBe('not at the kickoff gate (a work item is complete)');
  expect(container.querySelector('[data-kickoff-wi-added]')).toBeNull();
  expect(onAdded).not.toHaveBeenCalled();
});

test('a quote in the gate command is refused client-side by name; nothing is sent', async () => {
  await fillAll('bash -c "a b"');
  expect(submit().disabled).toBe(true);
  expect(submit().getAttribute('data-disabled-reason')).toMatch(/quote/);
  expect(addMock).not.toHaveBeenCalled();
});

test('adding a criterion adds a numbered row', async () => {
  await act(async () => { q<HTMLButtonElement>('[data-action="kickoff-add-criterion"]').click(); });
  q('[data-field="kickoff-ac-given-2"]');
  q('[data-action="kickoff-remove-criterion-2"]');
});
