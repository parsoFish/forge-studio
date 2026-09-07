// @vitest-environment jsdom
/**
 * The authoring launcher MINTS and STAYS — rulings 396 / 406 / 409 (T1 M6),
 * the shape lane M6-A landed on the generic kickoff (#531 `937d84ea`) and
 * this file mirrors on the library's own launcher, which S7 beat 3 drives at
 * `/skills/new`.
 *
 * WHAT WAS MEASURED. S7 beat 3, `_1.0/reports/m6-d-S7-1.log`:
 *
 *     ✗ 3. Describe the skill to the creation agent instead of writing the
 *          package by hand
 *          route "/sessions/authoring/<authoringSessionId>" needs
 *          <authoringSessionId>, which no earlier beat bound.
 *
 * The route half was already done (`POST /api/studio/authoring/start` returns
 * `sessionId`); nothing published it, and the press navigated away by itself,
 * so no beat could bind the segment and no beat could declare the launcher's
 * own route either.
 *
 * THE THREE FACTS OF 396 ARE SEPARABLE IN THE PRODUCT, so this file asserts
 * them separately — publish · anchor · do-not-navigate. That separation is
 * the point: a test that cannot tell them apart cannot tell ruling 396 from
 * the behaviour it replaced, and would go green on a page that still pushed.
 *
 * THE HREF CARRIES NO QUERY STRING, and that is load-bearing rather than
 * tidiness. The runner selects a link by an EXACT `[href="<target>"]` match
 * (`scripts/stories/beats.mjs:378-379`) while reading the observed URL
 * query-BLIND (`beats-page.mjs:203`) — so `?project=…` renders an anchor a
 * human can click and no beat can find. Bead `forge-8vfn.7.5.3`; lane M6-A
 * paid for it on S9 run 2. Nothing is lost: the shell route resolves the
 * project itself (`findSessionProject`) and echoes it on the payload, so a
 * bare `/sessions/<kind>/<sid>` is a working address for every kind,
 * authoring included — the session page says so in its own comment. This
 * component's old prop comment claimed the caller had to carry `project` in
 * the URL; that was outdated by the shell change, and this file is where the
 * correction is recorded.
 *
 * `''` FROM FIRST PAINT, never an absent attribute: "no session yet" and
 * "the attribute is missing" must be different DOM, and `answers()`
 * (`beats-page.mjs:29`) reads an empty value as not-yet for a `<name>`
 * binding, so an observer is never answered by a value naming no session.
 */
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { AuthoringLauncher } from './AuthoringLauncher';

const MINTED = '2026-09-08T04-11-02-9f3ac711';
const push = vi.fn();
const startAuthoring = vi.fn(async () => ({ ok: true, sessionId: MINTED }) as { ok: boolean; sessionId?: string; error?: string });

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/skills/new',
}));

// The rest-spread is load-bearing: the real `next/link` FORWARDS extra props
// onto the anchor it renders, so a mock keeping only `href`/`children` drops
// `data-action` and a handle assertion fails against correct product code.
// Lane M6-A paid for exactly that with a red run on 2026-09-07.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement('a', { href, ...rest }, children),
}));

vi.mock('@/lib/bridge-client', () => ({
  startAuthoring: (...args: unknown[]) => startAuthoring(...(args as [])),
}));

vi.mock('@/lib/studio-client', () => ({
  fetchAgentCapability: vi.fn(async () => ({ allowedTiers: [], strategy: 'fixed' })),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  push.mockClear();
  startAuthoring.mockClear();
  startAuthoring.mockImplementation(async () => ({ ok: true, sessionId: MINTED }));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Set a React-controlled input the way a user would. */
function setControlled(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

async function mountAndStart(): Promise<void> {
  await act(async () => { root.render(React.createElement(AuthoringLauncher, { knownProjects: ['mdtoc'] })); });
  await act(async () => { await Promise.resolve(); });

  setControlled(container.querySelector('[data-field="authoring-launcher-project"]') as HTMLInputElement, 'mdtoc');
  setControlled(container.querySelector('[data-field="authoring-launcher-prompt"]') as HTMLTextAreaElement, 'A skill that tidies markdown.');
  await act(async () => { await Promise.resolve(); });

  await act(async () => { (container.querySelector('[data-action="start-authoring"]') as HTMLButtonElement).click(); });
  await act(async () => { await Promise.resolve(); });
}

const section = (): HTMLElement => container.querySelector('[data-section="authoring-launcher"]') as HTMLElement;

test('396: the id attribute is PRESENT and empty from first paint — "not started yet" and "attribute missing" are different DOM', async () => {
  await act(async () => { root.render(React.createElement(AuthoringLauncher, { knownProjects: ['mdtoc'] })); });
  await act(async () => { await Promise.resolve(); });

  expect(section().hasAttribute('data-minted-session-id')).toBe(true);
  expect(section().getAttribute('data-minted-session-id')).toBe('');
  expect(container.querySelector('[data-action="open-minted-session"]'), 'no session exists, so nothing may claim one').toBeNull();
});

test('396: the press publishes the minted id on the page it acted on', async () => {
  await mountAndStart();
  expect(startAuthoring).toHaveBeenCalledTimes(1);
  expect(section().getAttribute('data-minted-session-id')).toBe(MINTED);
});

test('409: the destination is a REAL anchor carrying data-action, and its href has NO query string', async () => {
  await mountAndStart();
  const link = container.querySelector('[data-action="open-minted-session"]');
  expect(link, 'the mint must render a way to reach what it minted').not.toBeNull();
  expect(link!.tagName, 'a button is invisible to a nav resolution that reads [href]').toBe('A');
  expect(link!.getAttribute('href')).toBe(`/sessions/authoring/${MINTED}`);
  expect(link!.getAttribute('href'), 'an exact-href match cannot find a link carrying a query').not.toContain('?');
});

test('396: the press does NOT navigate — the operator stays on the launcher', async () => {
  await mountAndStart();
  expect(push, 'a router.push here is the behaviour 396 replaced').not.toHaveBeenCalled();
});

test('396: a REFUSED start publishes nothing and offers no link — no id, no claim', async () => {
  startAuthoring.mockImplementation(async () => ({ ok: false, error: 'no such project' }));
  await mountAndStart();
  expect(section().getAttribute('data-minted-session-id')).toBe('');
  expect(container.querySelector('[data-action="open-minted-session"]')).toBeNull();
});
