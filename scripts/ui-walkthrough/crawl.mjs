#!/usr/bin/env node
// Wave-7 baseline UI crawl: visit every reachable Studio route, record page
// readiness, console errors, failed requests, interactive inventory, screenshot.
// Usage: node scripts/ui-walkthrough/crawl.mjs [--max 200] [--out _walkthrough/explore]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const UI = process.env.FORGE_UI_URL || 'http://localhost:4124';
const BRIDGE = process.env.FORGE_BRIDGE_URL || 'http://localhost:4123';
const args = process.argv.slice(2);
const MAX = Number(args[args.indexOf('--max') + 1] || 200);
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : '_walkthrough/explore';
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

async function j(p) {
  try { const r = await fetch(BRIDGE + p); if (!r.ok) return null; return await r.json(); } catch { return null; }
}

// Seed routes: static + one representative per dynamic kind (from bridge APIs).
async function seeds() {
  const s = new Set(['/', '/projects', '/flows', '/agents', '/library', '/knowledge', '/knowledge/new', '/sessions',
    '/community', '/connections', '/hooks', '/hooks/new', '/skills', '/skills/new', '/templates', '/architect/new', '/artifact']);
  const projects = (await j('/api/studio/projects'))?.projects ?? [];
  for (const p of projects) { s.add(`/projects/${p.id}`); s.add(`/projects/${p.id}/showcase`); }
  const flows = (await j('/api/studio/flows'))?.flows ?? [];
  for (const f of flows) s.add(`/flows/${f.id}`);
  const runs = (await j('/api/runs'))?.runs ?? [];
  const seenFlow = new Set();
  for (const r of runs) { if (!seenFlow.has(r.flowId)) { seenFlow.add(r.flowId); s.add(`/flows/${r.flowId}/run/${r.id}`); } }
  const agents = (await j('/api/studio/agents'))?.agents ?? [];
  for (const a of agents) s.add(`/agents/${a.slug}`);
  const kbs = (await j('/api/studio/kbs'))?.kbs ?? [];
  for (const k of kbs) s.add(`/knowledge?kb=${encodeURIComponent(k.id)}`);
  const skills = (await j('/api/studio/skills'))?.skills ?? [];
  for (const k of skills.slice(0, 6)) s.add(`/skills/${k.id}`);
  const hooks = (await j('/api/studio/hooks'))?.hooks ?? [];
  for (const k of hooks.slice(0, 4)) s.add(`/hooks/${k.id}`);
  const conns = (await j('/api/studio/connections'))?.connections ?? [];
  for (const k of conns.slice(0, 4)) s.add(`/connections/${k.id}`);
  const tpls = (await j('/api/studio/templates'))?.templates ?? [];
  for (const k of tpls.slice(0, 4)) s.add(`/templates/${k.id}`);
  const sessions = (await j('/api/studio/sessions'))?.sessions ?? [];
  const seenKind = new Map();
  for (const x of sessions) { const n = seenKind.get(x.kind) ?? 0; if (n < 2) { seenKind.set(x.kind, n + 1); s.add(x.href); } }
  for (const kind of ['architect', 'demo', 'instructions', 'kb-cleanup', 'community-refresh', 'project-brain', 'authoring', 'onboarding']) s.add(`/sessions/${kind}/new`);
  const cycles = (await j('/api/cycles'))?.recent ?? [];
  for (const c of cycles.slice(0, 3)) s.add(`/artifact?cycle=${encodeURIComponent(c.cycleId)}`);
  const community = await j('/api/studio/community');
  const items = community?.items ?? community?.entries ?? [];
  for (const it of items.slice(0, 5)) if (it.kind && it.id) s.add(`/community/${it.kind}/${it.id}`);
  return [...s];
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const results = [];
const queue = await seeds();
const visited = new Set();
let n = 0;
while (queue.length && n < MAX) {
  const route = queue.shift();
  const key = route.split('#')[0];
  if (visited.has(key)) continue;
  visited.add(key); n++;
  const page = await ctx.newPage();
  const consoleErrors = [], failed = [], pageErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push({ type: m.type(), text: m.text().slice(0, 300) }); });
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  page.on('response', (r) => { if (r.status() >= 400) failed.push({ url: r.url().replace(UI, '').replace(BRIDGE, '[bridge]'), status: r.status() }); });
  const t0 = Date.now();
  let status = 'ok', err = null;
  try {
    const resp = await page.goto(UI + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (resp && resp.status() >= 400) status = `http-${resp.status()}`;
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(800);
  } catch (e) { status = 'nav-error'; err = String(e).slice(0, 200); }
  const info = await page.evaluate(() => {
    const root = document.querySelector('[data-page]');
    const txt = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    const attrs = (el) => Object.fromEntries([...el.attributes].filter(a => a.name.startsWith('data-')).map(a => [a.name, a.value.slice(0, 60)]));
    const buttons = [...document.querySelectorAll('button, [role=button], input[type=submit]')].map(b => ({ text: txt(b), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true', data: attrs(b) }));
    const links = [...document.querySelectorAll('a[href]')].map(a => ({ text: txt(a), href: a.getAttribute('href') }));
    const inputs = [...document.querySelectorAll('input, textarea, select')].map(i => ({ tag: i.tagName.toLowerCase(), type: i.type, name: i.name || i.id || i.placeholder || '', data: attrs(i) }));
    const dataEls = [...document.querySelectorAll('[data-status],[data-state],[data-empty],[data-error],[data-page-ready],[data-component]')].slice(0, 80).map(e => ({ tag: e.tagName.toLowerCase(), data: attrs(e) }));
    const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ');
    return {
      title: document.title,
      dataPage: root?.getAttribute('data-page') ?? null,
      pageReady: root?.getAttribute('data-page-ready') ?? document.querySelector('[data-page-ready]')?.getAttribute('data-page-ready') ?? null,
      h1: [...document.querySelectorAll('h1,h2')].slice(0, 6).map(txt),
      buttons, links, inputs, dataEls,
      bodyLen: bodyText.length,
      hasErrorText: /error|failed|not found|undefined|NaN|\[object Object\]/i.test(bodyText) ? bodyText.match(/.{0,60}(error|failed|not found|undefined|NaN|\[object Object\]).{0,60}/i)?.[0] : null,
    };
  }).catch((e) => ({ evalError: String(e).slice(0, 200) }));
  const shot = path.join(OUT, 'shots', route.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'root') + '.png';
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  results.push({ route, status, err, ms: Date.now() - t0, consoleErrors, pageErrors, failed, shot, ...info });
  // BFS internal links
  for (const l of info.links ?? []) {
    if (!l.href || !l.href.startsWith('/') || l.href.startsWith('//')) continue;
    const k = l.href.split('#')[0];
    if (!visited.has(k) && !queue.includes(k)) queue.push(k);
  }
  await page.close();
  process.stderr.write(`[${n}] ${status} ${route} (${Date.now() - t0}ms) btn=${info.buttons?.length ?? '?'} err=${consoleErrors.length}/${pageErrors.length}/${failed.length}\n`);
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'crawl.json'), JSON.stringify({ ui: UI, at: new Date().toISOString(), visited: results.length, unvisited: queue, results }, null, 1));
// summary
const lines = results.map(r => `${r.status.padEnd(8)} ready=${String(r.pageReady).padEnd(5)} page=${String(r.dataPage).padEnd(18)} btn=${String(r.buttons?.length ?? 0).padStart(3)} cerr=${r.consoleErrors.length} perr=${r.pageErrors.length} f=${r.failed.length} ${r.route}${r.hasErrorText ? '  ⚠ ' + r.hasErrorText : ''}`);
fs.writeFileSync(path.join(OUT, 'crawl-summary.txt'), lines.join('\n') + `\n\nunvisited(${queue.length}): ${queue.join(' ')}\n`);
console.log(lines.join('\n'));
console.log(`\nvisited ${results.length}, unvisited ${queue.length}`);
