// @vitest-environment jsdom
/**
 * forge-mfv5.1.32 — the project page edits `demoMeans` and the acceptance tier, the readiness panel
 * shows both, and Save carries them. gitweave I2's operator had to hand-edit both into the ground's
 * `.forge/project.json`. Values are gitweave's own declarations.
 *
 * RUN: npx vitest run apps/studio/tests/regression/project-declarations-editor.test.ts
 */
import { test, expect, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { DeclarationsEditor } from '@/components/studio/project-builder/DeclarationsEditor';
import { ContractReadiness } from '@/components/studio/project-builder/ContractReadiness';
import { declarationsFromForm, formFromDeclarations, type DeclarationsForm } from '@/lib/project-declarations';
import { buildProjectSavePayload } from '@/lib/project-save-payload';

const GW = {
  demoMeans: { commands: ['gw plan'], api: { commands: ['gw apply --json', 'gw org show --json'], ignoreKeys: ['default_branch_sha'] } },
  acceptance: { match: 'tests/acceptance', requiresEnv: ['GW_ORG', 'GW_APP_ID'] },
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const q = <T extends Element = HTMLElement>(sel: string): T => { const el = container.querySelector<T>(sel); if (!el) throw new Error(`missing ${sel}`); return el; };
const typeInto = async (sel: string, value: string): Promise<void> => {
  await act(async () => {
    const el = q<HTMLTextAreaElement | HTMLInputElement>(sel);
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

function Harness({ initial, onForm }: { initial: DeclarationsForm; onForm: (f: DeclarationsForm) => void }) {
  const [form, setForm] = React.useState(initial);
  return React.createElement(DeclarationsEditor, { value: form, onChange: (f: DeclarationsForm) => { setForm(f); onForm(f); } });
}

test('round trip: stored declarations → form → declarations, unchanged', () => {
  expect(declarationsFromForm(formFromDeclarations(GW))).toEqual({ ok: true, ...GW });
});

test('editing both on the page: Save\'s payload carries demoMeans and acceptance', async () => {
  let form = formFromDeclarations({});
  await act(async () => { root.render(React.createElement(Harness, { initial: form, onForm: (f) => { form = f; } })); });
  await typeInto('[data-field="demo-means-commands"]', 'gw plan\n');
  await typeInto('[data-field="demo-means-api-commands"]', 'gw apply --json\ngw org show --json');
  await typeInto('[data-field="demo-means-ignore-keys"]', 'default_branch_sha');
  await typeInto('[data-field="acceptance-match"]', 'tests/acceptance');
  await typeInto('[data-field="acceptance-requires-env"]', 'GW_ORG\nGW_APP_ID');
  const decl = declarationsFromForm(form);
  expect(decl).toEqual({ ok: true, ...GW });
  const payload = buildProjectSavePayload({ name: 'gitweave', northStar: 'n', instructions: '', demoProcess: [], skills: [], kb: null, kbTouched: false, declarations: decl.ok ? decl : null });
  expect(payload.demoMeans).toEqual(GW.demoMeans);
  expect(payload.acceptance).toEqual(GW.acceptance);
});

test('refusal: an acceptance tier without a match is refused by name, and the editor says so', async () => {
  let form = formFromDeclarations({});
  await act(async () => { root.render(React.createElement(Harness, { initial: form, onForm: (f) => { form = f; } })); });
  await typeInto('[data-field="acceptance-requires-env"]', 'GW_ORG');
  expect(declarationsFromForm(form)).toEqual({ ok: false, reason: 'an acceptance tier needs a match — the substring that marks a live-acceptance gate' });
  expect(q('[data-declarations-error]').textContent).toContain('an acceptance tier needs a match');
});

test('empty fields clear: no means and no tier send null (the Save removes them)', () => {
  expect(declarationsFromForm(formFromDeclarations({}))).toEqual({ ok: true, demoMeans: null, acceptance: null });
});

test('an untouched editor sends nothing, so a Save never rewrites what it did not show', () => {
  const payload = buildProjectSavePayload({ name: 'gitweave', northStar: 'n', instructions: '', demoProcess: [], skills: [], kb: null, kbTouched: false, declarations: null });
  expect('demoMeans' in payload).toBe(false);
  expect('acceptance' in payload).toBe(false);
});

test('the readiness panel shows both declarations', async () => {
  await act(async () => {
    root.render(React.createElement(ContractReadiness, { northStar: 'n', instructions: 'i', demoSteps: [], skills: [], kb: null, preflight: null, demoMeans: GW.demoMeans, acceptance: GW.acceptance }));
  });
  expect(q('[data-readiness-item="demo-means"]').getAttribute('data-declared')).toBe('true');
  expect(q('[data-readiness-item="demo-means"]').textContent).toContain('1 command');
  expect(q('[data-readiness-item="acceptance-tier"]').textContent).toContain('tests/acceptance');
  expect(q('[data-readiness-item="acceptance-tier"]').textContent).toContain('GW_ORG');
});

test('the readiness panel says when neither is declared', async () => {
  await act(async () => {
    root.render(React.createElement(ContractReadiness, { northStar: 'n', instructions: 'i', demoSteps: [], skills: [], kb: null, preflight: null }));
  });
  expect(q('[data-readiness-item="demo-means"]').getAttribute('data-declared')).toBe('false');
  expect(q('[data-readiness-item="acceptance-tier"]').getAttribute('data-declared')).toBe('false');
});
