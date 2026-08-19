/**
 * capture.test.ts — W7-FIX-A0 pins for the crawl's per-page CAPTURE wiring
 * (`capture.mjs`), the half of the harness that used to live inline in
 * `crawl.mjs` and had no test at all: the browser listeners (W7-A0-2) and the
 * in-page DOM read (W7-A0-5). Both are exercised without chromium — a fake
 * page (EventEmitter) and a fake document — so `npm test` stays browser-free.
 *
 * Which wrong implementations each group kills:
 *   - a listener set with no `requestfailed` handler (a bridge that dies
 *     mid-crawl leaves no trace in crawl.json → PASS) — group 1;
 *   - a page read whose readiness falls back to a document-wide
 *     `[data-page-ready]` lookup (a ready descendant masks an unready root) —
 *     group 2;
 *   - a page read that reports a harness-side evaluate failure as a UI
 *     readiness defect (W7-A0-9) — group 2/3.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { attachCapture, readPageInfo } from './capture.mjs';

// ── fakes ────────────────────────────────────────────────────────────────────

class FakePage extends EventEmitter {}
const response = (url: string, status: number) => ({ url: () => url, status: () => status });
const request = (url: string, errorText: string | null, resourceType = 'fetch') => ({
  url: () => url,
  failure: () => (errorText == null ? null : { errorText }),
  resourceType: () => resourceType,
  method: () => 'GET',
});
const consoleMsg = (type: string, text: string, url?: string) => ({
  type: () => type,
  text: () => text,
  location: () => ({ url: url ?? '', lineNumber: 0, columnNumber: 0 }),
});

type FakeEl = {
  tagName: string; attributes: { name: string; value: string }[]; children: FakeEl[];
  innerText: string; textContent: string; disabled: boolean; type: string; name: string; id: string; placeholder: string;
  getAttribute(n: string): string | null;
};
function el(tag: string, attrs: Record<string, string> = {}, text = '', children: FakeEl[] = []): FakeEl {
  const attributes = Object.entries(attrs).map(([name, value]) => [name, value]).map(([name, value]) => ({ name, value }));
  return {
    tagName: tag.toUpperCase(), attributes, children, innerText: text, textContent: text,
    disabled: 'disabled' in attrs, type: attrs.type ?? '', name: attrs.name ?? '', id: attrs.id ?? '', placeholder: attrs.placeholder ?? '',
    getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
  };
}
const flatten = (nodes: FakeEl[]): FakeEl[] => nodes.flatMap((n) => [n, ...flatten(n.children)]);
// Tiny selector engine for exactly the shapes readPageInfo uses:
// `tag`, `[attr]`, `[attr=value]`, `tag[attr=value]`, comma lists.
function matchesSimple(e: FakeEl, sel: string): boolean {
  const m = /^([a-z0-9]*)((?:\[[^\]]+\])*)$/i.exec(sel.trim());
  if (!m) throw new Error(`fake selector engine: unsupported selector ${sel}`);
  const [, tag, attrPart] = m;
  if (tag && e.tagName !== tag.toUpperCase()) return false;
  for (const a of attrPart.match(/\[[^\]]+\]/g) ?? []) {
    const [name, value] = a.slice(1, -1).split('=');
    const got = e.getAttribute(name);
    if (got == null) return false;
    if (value !== undefined && got !== value.replace(/^["']|["']$/g, '')) return false;
  }
  return true;
}
function fakeDocument(roots: FakeEl[], { title = 't', bodyText = '' } = {}) {
  const all = flatten(roots);
  const querySelectorAll = (sel: string) => all.filter((e) => sel.split(',').some((s) => matchesSimple(e, s)));
  return { title, body: { innerText: bodyText }, querySelectorAll, querySelector: (sel: string) => querySelectorAll(sel)[0] ?? null };
}

// ── group 1: listeners (W7-A0-2) ─────────────────────────────────────────────

test('attachCapture records >=400 responses in `failed` AND requestfailed events in `transportFailed`, both canonicalized against the crawl origins', () => {
  const page = new FakePage();
  const cap = attachCapture(page as never, { ui: 'http://localhost:4124', bridge: 'http://127.0.0.1:4123' });
  page.emit('response', response('http://localhost:4123/api/events/', 404));
  page.emit('response', response('http://localhost:4124/ok', 200));
  page.emit('requestfailed', request('http://localhost:4123/api/studio/projects', 'net::ERR_CONNECTION_REFUSED'));
  page.emit('requestfailed', request('http://localhost:4124/_next/data/x.json', 'net::ERR_ABORTED'));
  page.emit('requestfailed', request('https://fonts.gstatic.com/x.woff2', 'net::ERR_NAME_NOT_RESOLVED', 'font'));
  page.emit('requestfailed', request('http://localhost:4123/api/no-failure-object', null));
  assert.deepEqual(cap.failed, [{ url: '[bridge]/api/events/', status: 404 }]);
  assert.deepEqual(cap.transportFailed, [
    { url: '[bridge]/api/studio/projects', error: 'net::ERR_CONNECTION_REFUSED', resourceType: 'fetch' },
    { url: '/_next/data/x.json', error: 'net::ERR_ABORTED', resourceType: 'fetch' },
    { url: 'https://fonts.gstatic.com/x.woff2', error: 'net::ERR_NAME_NOT_RESOLVED', resourceType: 'font' },
    { url: '[bridge]/api/no-failure-object', error: 'unknown', resourceType: 'fetch' },
  ], 'every requestfailed is RECORDED (assert.mjs decides which ones fail the gate) — nothing is dropped at capture time');
});

test('attachCapture keeps console error/warning lines (with the source url when the browser gives one) and pageerrors', () => {
  const page = new FakePage();
  const cap = attachCapture(page as never, { ui: 'http://localhost:4124', bridge: 'http://localhost:4123' });
  page.emit('console', consoleMsg('error', 'Failed to load resource: net::ERR_CONNECTION_REFUSED', 'http://localhost:4123/api/x'));
  page.emit('console', consoleMsg('warning', 'careful'));
  page.emit('console', consoleMsg('log', 'noise'));
  page.emit('pageerror', new Error('TypeError: boom'));
  assert.equal(cap.consoleErrors.length, 2, 'log lines are not captured; error + warning are');
  assert.equal(cap.consoleErrors[0].type, 'error');
  assert.equal(cap.consoleErrors[0].url, '[bridge]/api/x', 'the console line carries its canonicalized source url so assert.mjs can tie it to a request');
  assert.equal(cap.consoleErrors[1].url, undefined);
  assert.equal(cap.pageErrors.length, 1);
  assert.match(cap.pageErrors[0], /boom/);
});

test('attachCapture flags first-party transport failures that are NOT client aborts via hasFirstPartyTransportFailure() — the crawl re-probes /api/health on it', () => {
  const page = new FakePage();
  const cap = attachCapture(page as never, { ui: 'http://localhost:4124', bridge: 'http://localhost:4123' });
  assert.equal(cap.hasFirstPartyTransportFailure(), false);
  page.emit('requestfailed', request('http://localhost:4124/_next/x', 'net::ERR_ABORTED'));
  page.emit('requestfailed', request('https://cdn.example/x', 'net::ERR_CONNECTION_REFUSED'));
  assert.equal(cap.hasFirstPartyTransportFailure(), false, 'an abort or a third-party failure is not a bridge/UI transport failure');
  page.emit('requestfailed', request('http://localhost:4123/api/health-ish', 'net::ERR_CONNECTION_REFUSED'));
  assert.equal(cap.hasFirstPartyTransportFailure(), true);
});

// ── group 2: the in-page read (W7-A0-5) ──────────────────────────────────────

test('readPageInfo anchors data-page-ready STRICTLY to the [data-page] root — a ready descendant never masks an unready root', () => {
  const doc = fakeDocument([
    el('main', { 'data-page': 'knowledge' }, 'k', [
      el('section', { 'data-page-ready': 'true', 'data-component': 'nested' }, 'inner'),
    ]),
  ]);
  const info = readPageInfo(doc as never);
  assert.equal(info.dataPage, 'knowledge');
  assert.equal(info.pageReady, null, 'root has no data-page-ready → null, regardless of descendants');
  const ready = readPageInfo(fakeDocument([el('main', { 'data-page': 'home', 'data-page-ready': 'true' })]) as never);
  assert.equal(ready.pageReady, 'true');
  const notReady = readPageInfo(fakeDocument([el('main', { 'data-page': 'home', 'data-page-ready': 'false' })]) as never);
  assert.equal(notReady.pageReady, 'false');
  const noRoot = readPageInfo(fakeDocument([el('div', { 'data-page-ready': 'true' })]) as never);
  assert.equal(noRoot.dataPage, null);
  assert.equal(noRoot.pageReady, null, 'no [data-page] root → never-ready, even if some element claims readiness');
});

test('readPageInfo reads the interactive inventory the explorers rely on (buttons, links, inputs, data-* elements, headings, error copy)', () => {
  const doc = fakeDocument([
    el('main', { 'data-page': 'x', 'data-page-ready': 'true' }, 'body', [
      el('h1', {}, 'Heading'),
      el('button', { 'data-action': 'cancel', disabled: '' }, 'Cancel'),
      el('div', { role: 'button' }, 'Fake'),
      el('a', { href: '/flows' }, 'Flows'),
      el('a', {}, 'no href'),
      el('input', { type: 'text', name: 'q' }),
      el('select', { id: 'pick' }),
      el('span', { 'data-status': 'idle' }),
    ]),
  ], { title: 'forge', bodyText: 'all good NaN here' });
  const info = readPageInfo(doc as never);
  assert.equal(info.title, 'forge');
  assert.deepEqual(info.h1, ['Heading']);
  assert.equal(info.buttons.length, 2);
  assert.equal(info.buttons[0].disabled, true);
  assert.deepEqual(info.buttons[0].data, { 'data-action': 'cancel' });
  assert.deepEqual(info.links, [{ text: 'Flows', href: '/flows' }]);
  assert.deepEqual(info.inputs.map((i) => i.tag), ['input', 'select']);
  assert.ok(info.dataEls.some((d) => d.data['data-status'] === 'idle'));
  assert.match(info.hasErrorText, /NaN/);
  assert.equal(info.bodyLen, 'all good NaN here'.length);
});
