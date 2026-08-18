// Shared helper for wave-7 UI explorers. Import from node scripts run at repo root:
//   import { openStudio, inventory, clickAndCapture, note } from './scripts/ui-walkthrough/lib.mjs';
// Studio must already be running (bridge :4123, ui :4124). NEVER run ui:journey / --force-takeover.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

export const UI = process.env.FORGE_UI_URL || 'http://localhost:4124';
export const BRIDGE = process.env.FORGE_BRIDGE_URL || 'http://localhost:4123';

export async function openStudio(opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const log = { console: [], failed: [], pageErrors: [], requests: [] };
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) log.console.push({ t: Date.now(), type: m.type(), text: m.text().slice(0, 400) }); });
  page.on('pageerror', (e) => log.pageErrors.push({ t: Date.now(), text: String(e).slice(0, 400) }));
  page.on('response', (r) => {
    const u = r.url();
    if (u.startsWith(BRIDGE)) log.requests.push({ t: Date.now(), m: r.request().method(), url: u.replace(BRIDGE, ''), status: r.status() });
    if (r.status() >= 400) log.failed.push({ t: Date.now(), m: r.request().method(), url: u.replace(UI, '').replace(BRIDGE, '[bridge]'), status: r.status() });
  });
  page.setDefaultTimeout(opts.timeout ?? 15000);
  return { browser, ctx, page, log, close: () => browser.close() };
}

export async function goto(page, route, { settle = 800 } = {}) {
  await page.goto(UI + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(settle);
}

// Structured inventory of the current DOM: buttons, links, inputs, data-* state.
export async function inventory(page) {
  return page.evaluate(() => {
    const txt = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    const attrs = (el) => Object.fromEntries([...el.attributes].filter(a => a.name.startsWith('data-') || a.name === 'aria-label' || a.name === 'title').map(a => [a.name, a.value.slice(0, 80)]));
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    return {
      url: location.pathname + location.search,
      dataPage: document.querySelector('[data-page]')?.getAttribute('data-page') ?? null,
      pageReady: document.querySelector('[data-page-ready]')?.getAttribute('data-page-ready') ?? null,
      headings: [...document.querySelectorAll('h1,h2,h3')].slice(0, 20).map(txt),
      buttons: [...document.querySelectorAll('button,[role=button],input[type=submit]')].map((b, i) => ({ i, text: txt(b), disabled: !!(b.disabled || b.getAttribute('aria-disabled') === 'true'), visible: vis(b), attrs: attrs(b) })),
      links: [...document.querySelectorAll('a[href]')].map(a => ({ text: txt(a), href: a.getAttribute('href'), attrs: attrs(a) })),
      inputs: [...document.querySelectorAll('input,textarea,select')].map(i => ({ tag: i.tagName.toLowerCase(), type: i.type, name: i.name || i.id || '', placeholder: i.placeholder || '', value: String(i.value).slice(0, 60), attrs: attrs(i) })),
      stateEls: [...document.querySelectorAll('[data-status],[data-state],[data-empty],[data-error],[data-phase],[data-verdict],[data-awaits],[data-kind],[data-tab],[data-panel]')].slice(0, 150).map(e => ({ tag: e.tagName.toLowerCase(), text: txt(e).slice(0, 60), attrs: attrs(e) })),
      bodyText: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 6000),
    };
  });
}

// Click a locator, wait for settle, screenshot, and return what changed (url, new failed requests, toasts/dialogs, body diff length).
export async function clickAndCapture(page, log, locator, label, dir) {
  const before = { url: page.url(), failed: log.failed.length, console: log.console.length, req: log.requests.length };
  const bodyBefore = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  let err = null;
  try { await locator.click({ timeout: 8000 }); } catch (e) { err = String(e).slice(0, 200); }
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(700);
  const bodyAfter = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  const shot = dir ? path.join(dir, `${label.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 80)}.png`) : null;
  if (shot) { fs.mkdirSync(dir, { recursive: true }); await page.screenshot({ path: shot, fullPage: true }).catch(() => {}); }
  const dialogs = await page.evaluate(() => [...document.querySelectorAll('[role=dialog],[role=alert],[role=status],[data-toast],.toast')].map(e => (e.innerText || '').replace(/\s+/g, ' ').slice(0, 200)));
  return {
    label, err,
    urlBefore: before.url.replace(UI, ''), urlAfter: page.url().replace(UI, ''),
    newRequests: log.requests.slice(before.req),
    newFailed: log.failed.slice(before.failed),
    newConsole: log.console.slice(before.console),
    bodyChanged: bodyBefore !== bodyAfter,
    bodyDelta: bodyAfter.length - bodyBefore.length,
    dialogs, shot,
  };
}

// Append a finding to a JSONL file. Schema below is the campaign contract — keep it.
// {id, cluster, route, severity: S1|S2|S3, class, title, repro, expected, actual, evidence:[paths/urls], suspectedRoot, source:[file:line], relatesToOperatorNote}
export function note(file, finding) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...finding }) + '\n');
}

export async function bridge(p, init) {
  const r = await fetch(BRIDGE + p, init);
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text: text.slice(0, 2000) };
}
