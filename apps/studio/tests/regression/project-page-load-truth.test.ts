// @vitest-environment jsdom
/**
 * forge-nk1y.9 — the project page rendered its PRE-LOAD state as the project's
 * truth.
 *
 * The live capstone opened `/projects/gitweave` and, ten seconds on, read an
 * empty name, five ○ readiness rows (`data-ready-count="0"`,
 * `data-flow-ready="false"`, `data-preflight-status="pending"`) and "Run a flow"
 * disabled with "no runnable flow is installed" — while the bridge served a full
 * contract and preflight was MET. That DOM is byte-for-byte what the page
 * renders before its first read settles: the editor rendered unconditionally
 * while `ready` was false, from `useState('')` / `[]` defaults. Any read that
 * did not settle (a slow or stalled bridge, or a page whose client bundle never
 * ran) therefore showed as an unready project with no flows.
 *
 * The rule: until the page's own reads settle it says it is LOADING and names
 * what it is waiting on; a failed read names which read failed. Neither
 * renders a readiness verdict, a name, or a run-a-flow reason.
 *
 * The bridge is mocked at `fetch`, so the real studio-client parsers run.
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
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

import ProjectBuilderPage from '@/app/projects/[id]/page';

const GITWEAVE = {
  id: 'gitweave',
  name: 'gitweave',
  northStar: 'One control repo weaves a GitHub org.',
  instructions: 'Managed by forge. See AGENTS.md for project-specific rules.',
  instructionsSource: 'project.json',
  demoProcess: [
    { kind: 'capture', text: 'Run the gate before and after.', element: 'cli-capture' },
    { kind: 'capture', text: 'Run git ls-files before and after.', element: 'cli-capture' },
    { kind: 'verify', text: 'The gate is green after the change.', element: 'test-evidence' },
    { kind: 'present', text: 'Attach both captures to the PR.', element: 'narrative' },
  ],
  skills: ['demo-design'],
  kb: 'gitweave',
};

type Reply = { status: number; body: unknown } | 'hang';
const json = (body: unknown, status = 200): Reply => ({ status, body });

/** The bridge's answers for a healthy gitweave; a test overrides one path. */
function healthyRoutes(): Record<string, Reply> {
  return {
    '/api/studio/projects': json({ projects: [GITWEAVE] }),
    '/api/studio/kbs': json({ kbs: [{ id: 'gitweave', name: 'gitweave', binding: { kind: 'project', ref: 'gitweave' } }] }),
    '/api/studio/flows': json({ flows: [{ id: 'develop', name: 'develop', kickoff: { kind: 'roadmap' } }] }),
    '/api/studio/catalog': json({ catalog: { skills: [{ id: 'demo-design', name: 'demo-design' }] } }),
    '/api/studio/projects/gitweave/preflight': json({
      clauses: [{ id: 'C1', title: 'config', hard: true, pass: true, detail: '' }],
      ready: true,
      runnableGate: { pass: true, detail: '' },
    }),
    '/api/studio/projects/gitweave/repo-status': json({ pending: false, branch: 'forge-studio', uncommitted: [] }),
    '/api/cycles': json({ live: [], recent: [] }),
  };
}

let routes: Record<string, Reply>;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  routes = healthyRoutes();
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    const reply = routes[path] ?? json({ error: `no route ${path}` }, 404);
    if (reply === 'hang') return new Promise<Response>(() => {});
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } });
  }));
  // The live-event socket is not under test; a closed stub keeps jsdom off the network.
  vi.stubGlobal('WebSocket', class { readyState = 3; addEventListener() {} removeEventListener() {} close() {} send() {} });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(): Promise<void> {
  await act(async () => {
    root.render(React.createElement(ProjectBuilderPage, { params: { id: 'gitweave' } }));
  });
  // Let every resolved read's continuation (and the panels it unlocks) land.
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const q = (sel: string) => container.querySelector(sel);

/** None of the page's verdicts may be on screen — they would be read as the project's truth. */
function expectNoVerdicts(): void {
  expect(q('[data-field="project-name"]')).toBeNull();
  expect(q('[data-flow-ready]')).toBeNull();
  expect(q('[data-ready-count]')).toBeNull();
  expect(container.textContent).not.toContain('no runnable flow is installed');
}

test('full contract, every read OK: the page fills and the verdict is ready', async () => {
  await mount();
  expect(q('main[data-page="projects"]')?.getAttribute('data-page-ready')).toBe('true');
  expect((q('[data-field="project-name"]') as HTMLInputElement).value).toBe('gitweave');
  const readiness = q('[data-flow-ready]')!;
  expect(readiness.getAttribute('data-ready-count')).toBe('5');
  expect(readiness.getAttribute('data-preflight-status')).toBe('ok');
  expect(readiness.getAttribute('data-flow-ready')).toBe('true');
  expect(container.textContent).not.toContain('no runnable flow is installed');
});

test('the flows read never settles: the page says it is loading and names that read — no verdicts', async () => {
  routes['/api/studio/flows'] = 'hang';
  await mount();
  expectNoVerdicts();
  const main = q('main[data-page="projects"]')!;
  expect(main.getAttribute('data-page-ready')).toBe('false');
  expect(main.getAttribute('data-fetch-status')).toBe('loading');
  expect(main.getAttribute('data-waiting-on')).toBe('the flows');
  expect(q('[data-component="page-loading"]')?.textContent).toContain('the flows');
});

test('the project roster is still loading: a named loading state, not an empty editor', async () => {
  routes['/api/studio/projects'] = 'hang';
  await mount();
  expectNoVerdicts();
  const main = q('main[data-page="projects"]')!;
  expect(main.getAttribute('data-page-ready')).toBe('false');
  expect(q('[data-component="page-loading"]')?.textContent).toContain('the project roster');
});

test('the flows read FAILS: the page-level error names the flows read — no verdicts', async () => {
  routes['/api/studio/flows'] = json({ error: 'flows exploded' }, 500);
  await mount();
  const main = q('main[data-page="projects"]')!;
  expect(main.getAttribute('data-page-ready')).toBe('true');
  expect(main.getAttribute('data-fetch-status')).toBe('error');
  expect(q('[data-component="page-load-error"]')?.textContent).toContain('the flows');
  expect(q('[data-component="page-load-error"]')?.textContent).toContain('flows exploded');
  expectNoVerdicts();
});

test('project loaded but preflight not yet answered: flow-ready is "pending", never a "false" verdict', async () => {
  routes['/api/studio/projects/gitweave/preflight'] = 'hang';
  await mount();
  const readiness = q('[data-flow-ready]')!;
  expect(readiness.getAttribute('data-ready-count')).toBe('5');
  expect(readiness.getAttribute('data-preflight-status')).toBe('pending');
  expect(readiness.getAttribute('data-flow-ready')).toBe('pending');
});

test('a contract row that fails stays a "false" verdict while preflight is pending — the UI half already decides it', async () => {
  routes['/api/studio/projects'] = json({ projects: [{ ...GITWEAVE, skills: [] }] });
  routes['/api/studio/projects/gitweave/preflight'] = 'hang';
  await mount();
  const readiness = q('[data-flow-ready]')!;
  expect(readiness.getAttribute('data-ready-count')).toBe('4');
  expect(readiness.getAttribute('data-flow-ready')).toBe('false');
});

test('the flows read STALLS past the bridge read deadline: the page-level error names the flows read as timed out, with Retry', async () => {
  const { BRIDGE_READ_TIMEOUT_MS } = await import('@/lib/bridge-client-core');
  // A real fetch honours its abort signal; the planted one never answers otherwise.
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === '/api/studio/flows') {
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    }
    const reply = routes[path] ?? json({ error: `no route ${path}` }, 404);
    if (reply === 'hang') return new Promise<Response>(() => {});
    return Promise.resolve(new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } }));
  }));
  vi.useFakeTimers();
  try {
    await act(async () => {
      root.render(React.createElement(ProjectBuilderPage, { params: { id: 'gitweave' } }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(q('[data-component="page-loading"]')?.textContent).toContain('the flows');
    await act(async () => { await vi.advanceTimersByTimeAsync(BRIDGE_READ_TIMEOUT_MS); });
    const main = q('main[data-page="projects"]')!;
    expect(main.getAttribute('data-page-ready')).toBe('true');
    expect(main.getAttribute('data-fetch-status')).toBe('error');
    const error = q('[data-component="page-load-error"]')!;
    expect(error.textContent).toContain('the flows');
    expect(error.textContent).toContain(`timed out after ${BRIDGE_READ_TIMEOUT_MS / 1000} s`);
    expect(error.querySelector('[data-fetch-timed-out="true"]')).not.toBeNull();
    expect(error.textContent).not.toContain('Could not reach');
    expect(error.querySelector('[data-action="retry-fetch"]')).not.toBeNull();
    expectNoVerdicts();
  } finally {
    vi.useRealTimers();
  }
});
