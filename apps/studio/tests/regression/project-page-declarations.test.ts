// @vitest-environment jsdom
/**
 * forge-mfv5.1.32 — the REAL project page: the stored demo means and acceptance tier show in the
 * editor and the readiness panel, and the Save PUT carries an edit of them; an acceptance tier
 * without a match never reaches the bridge. Harness: project-page-load-truth.test.ts's (a mocked
 * bridge behind `fetch`); the project is gitweave with its own declarations.
 *
 * RUN: npx vitest run apps/studio/tests/regression/project-page-declarations.test.ts
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/projects/gitweave',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => React.createElement('a', { href, ...rest }, children),
}));

import ProjectBuilderPage from '@/app/projects/[id]/page';

const GITWEAVE = {
  id: 'gitweave', name: 'gitweave', northStar: 'One control repo weaves a GitHub org.', instructions: 'i', instructionsSource: 'project.json',
  demoProcess: [{ kind: 'capture', text: 'Run `gw plan` before and after.' }], skills: ['demo-design'], kb: 'gitweave',
  demoMeans: { commands: ['gw plan'], api: { commands: ['gw apply --json'], ignoreKeys: ['default_branch_sha'] } },
  acceptance: { match: 'tests/acceptance', requiresEnv: ['GW_ORG'] },
};
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
let puts: Array<Record<string, unknown>>;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  puts = [];
  const routes: Record<string, unknown> = {
    '/api/studio/projects': { projects: [GITWEAVE] },
    '/api/studio/kbs': { kbs: [{ id: 'gitweave', name: 'gitweave', binding: { kind: 'project', ref: 'gitweave' } }] },
    '/api/studio/flows': { flows: [{ id: 'develop', name: 'develop', kickoff: { kind: 'roadmap' } }] },
    '/api/studio/catalog': { catalog: { skills: [{ id: 'demo-design', name: 'demo-design' }] } },
    '/api/studio/projects/gitweave/preflight': { clauses: [{ id: 'C1', title: 'config', hard: true, pass: true, detail: '' }], ready: true, runnableGate: { pass: true, detail: '' } },
    '/api/studio/projects/gitweave/repo-status': { pending: false, branch: 'forge-studio', uncommitted: [] },
    '/api/cycles': { live: [], recent: [] },
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (init?.method === 'PUT' && path === '/api/studio/projects/gitweave') {
      puts.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return ok({ ok: true, id: 'gitweave', save: { merged: true, pushed: false, detail: 'merged' } });
    }
    return path in routes ? ok(routes[path]) : new Response(JSON.stringify({ error: `no route ${path}` }), { status: 404 });
  }));
  vi.stubGlobal('WebSocket', class { readyState = 3; addEventListener() {} removeEventListener() {} close() {} send() {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function settle(): Promise<void> { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); }
async function mount(): Promise<void> {
  await act(async () => { root.render(React.createElement(ProjectBuilderPage, { params: { id: 'gitweave' } })); });
  await settle();
}
const q = <T extends Element = HTMLElement>(sel: string): T => { const el = container.querySelector<T>(sel); if (!el) throw new Error(`missing ${sel}`); return el; };
async function typeInto(sel: string, value: string): Promise<void> {
  await act(async () => {
    const el = q<HTMLTextAreaElement | HTMLInputElement>(sel);
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function save(): Promise<void> { await act(async () => { q<HTMLButtonElement>('[data-action="save-project"]').click(); }); await settle(); }

test('the stored declarations show in the editor and the readiness panel', async () => {
  await mount();
  expect(q<HTMLTextAreaElement>('[data-field="demo-means-commands"]').value).toBe('gw plan');
  expect(q<HTMLInputElement>('[data-field="acceptance-match"]').value).toBe('tests/acceptance');
  expect(q('[data-readiness-item="demo-means"]').getAttribute('data-declared')).toBe('true');
  expect(q('[data-readiness-item="acceptance-tier"]').textContent).toContain('GW_ORG');
});

test('edit both → Save → the PUT carries demoMeans and acceptance', async () => {
  await mount();
  await typeInto('[data-field="demo-means-commands"]', 'gw plan\ngw plan --fixture tests/fixtures/org.json');
  await typeInto('[data-field="acceptance-requires-env"]', 'GW_ORG\nGW_APP_ID');
  await save();
  expect(puts).toHaveLength(1);
  expect(puts[0].demoMeans).toEqual({ ...GITWEAVE.demoMeans, commands: ['gw plan', 'gw plan --fixture tests/fixtures/org.json'] });
  expect(puts[0].acceptance).toEqual({ match: 'tests/acceptance', requiresEnv: ['GW_ORG', 'GW_APP_ID'] });
});

test('refusal: an acceptance tier without a match is refused by name and never reaches the bridge', async () => {
  await mount();
  await typeInto('[data-field="acceptance-match"]', '');
  expect(q('[data-declarations-error]').textContent).toContain('an acceptance tier needs a match');
  await save();
  expect(puts).toHaveLength(0);
  expect(container.textContent).toContain('refused — an acceptance tier needs a match');
});

test('a Save that never touched the declarations does not send them', async () => {
  await mount();
  await typeInto('[data-field="north-star"]', 'A new north star.');
  await save();
  expect(puts).toHaveLength(1);
  expect('demoMeans' in puts[0]).toBe(false);
  expect('acceptance' in puts[0]).toBe(false);
});
