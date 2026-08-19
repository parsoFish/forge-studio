// W7-FIX-A0 — the crawl's per-page CAPTURE wiring, split out of crawl.mjs so it
// can be pinned without chromium (capture.test.ts drives it with a fake page /
// a fake document). Two halves:
//
//   attachCapture(page, { ui, bridge }) — the browser listeners. Records EVERY
//     signal; assert.mjs decides what fails the gate:
//       consoleErrors   console error/warning lines (+ the source url when the
//                       browser gives one, canonicalized)
//       pageErrors      uncaught exceptions
//       failed          responses >= 400 (any host — third-party is filtered at
//                       assertion time, and a recorded third-party 4xx is what
//                       lets its "Failed to load resource" console line be
//                       recognised as a duplicate)
//       transportFailed requests that never got a response (`requestfailed`:
//                       net::ERR_CONNECTION_REFUSED / EMPTY_RESPONSE / ABORTED /
//                       NAME_NOT_RESOLVED …) — W7-A0-2: before this, a bridge
//                       that died mid-crawl left NO trace in crawl.json
//     plus hasFirstPartyTransportFailure(): true once a first-party request
//     failed for a reason other than a client abort — the crawl re-probes
//     /api/health on it (bridge gone = harness error, not a green run).
//
//   readPageInfo(doc = document) — the in-page read (`page.evaluate(readPageInfo)`;
//     self-contained: it must not close over anything in this module).
//     W7-A0-5: `pageReady` is read STRICTLY from the `[data-page]` root — no
//     document-wide `[data-page-ready]` fallback, so a ready descendant can never
//     mask an unready root (README + assert.mjs document the check as being about
//     the root; the code now is too).
import { canonicalUrl, isFirstPartyUrl, CLIENT_ABORT_ERROR } from './assert.mjs';

/**
 * @param {import('playwright-core').Page} page
 * @param {{ ui: string, bridge: string }} origins
 */
export function attachCapture(page, origins) {
  const consoleErrors = [], pageErrors = [], failed = [], transportFailed = [];
  const canon = (u) => canonicalUrl(u, origins);
  page.on('console', (m) => {
    const type = m.type();
    if (type !== 'error' && type !== 'warning') return;
    const entry = { type, text: m.text().slice(0, 300) };
    const url = m.location?.()?.url;
    if (url) entry.url = canon(url);
    consoleErrors.push(entry);
  });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on('response', (r) => { if (r.status() >= 400) failed.push({ url: canon(r.url()), status: r.status() }); });
  page.on('requestfailed', (r) => {
    transportFailed.push({ url: canon(r.url()), error: r.failure()?.errorText ?? 'unknown', resourceType: r.resourceType() });
  });
  return {
    consoleErrors, pageErrors, failed, transportFailed,
    hasFirstPartyTransportFailure: () => transportFailed.some((t) => t.error !== CLIENT_ABORT_ERROR && isFirstPartyUrl(t.url)),
  };
}

/** Runs INSIDE the browser via page.evaluate — plain DOM only, no imports. */
export function readPageInfo(doc = document) {
  const root = doc.querySelector('[data-page]');
  const txt = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  const attrs = (el) => Object.fromEntries([...el.attributes].filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value.slice(0, 60)]));
  const buttons = [...doc.querySelectorAll('button, [role=button], input[type=submit]')].map((b) => ({ text: txt(b), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', data: attrs(b) }));
  const links = [...doc.querySelectorAll('a[href]')].map((a) => ({ text: txt(a), href: a.getAttribute('href') }));
  const inputs = [...doc.querySelectorAll('input, textarea, select')].map((i) => ({ tag: i.tagName.toLowerCase(), type: i.type, name: i.name || i.id || i.placeholder || '', data: attrs(i) }));
  const dataEls = [...doc.querySelectorAll('[data-status],[data-state],[data-empty],[data-error],[data-page-ready],[data-component]')].slice(0, 80).map((e) => ({ tag: e.tagName.toLowerCase(), data: attrs(e) }));
  const bodyText = (doc.body.innerText || '').replace(/\s+/g, ' ');
  return {
    title: doc.title,
    dataPage: root ? root.getAttribute('data-page') : null,
    // STRICTLY the root's own attribute (W7-A0-5) — null when the root omits it
    // or there is no root at all; never a document-wide lookup.
    pageReady: root ? root.getAttribute('data-page-ready') : null,
    h1: [...doc.querySelectorAll('h1,h2')].slice(0, 6).map(txt),
    buttons, links, inputs, dataEls,
    bodyLen: bodyText.length,
    hasErrorText: /error|failed|not found|undefined|NaN|\[object Object\]/i.test(bodyText) ? bodyText.match(/.{0,60}(error|failed|not found|undefined|NaN|\[object Object\]).{0,60}/i)?.[0] : null,
  };
}
