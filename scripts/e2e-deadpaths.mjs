#!/usr/bin/env node
/**
 * Dead-path crawler (ADR-033 / J6) — sibling to e2e-journey.mjs.
 *
 * Boots `forge studio`, then sweeps every Studio route and asserts:
 *   - the page renders (a [data-page] element, not a Next 404),
 *   - NO dead "coming in milestone M*" placeholder CTAs survive
 *     (the `disabled title="M2|M3|M5"` signature), and
 *   - every nav link ([data-nav]) resolves to a real route.
 *
 * Runs the sweep TWICE and only passes if BOTH passes are clean (loop-until-dry).
 * Non-zero exit flags any dead path. Read-only: it navigates + inspects, it does
 * NOT click action buttons (those have side effects — the journey covers them).
 */

import { spawn, execSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { createAssertions } from './lib/journey-assertions.mjs';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Every Studio route a user can reach. Each must render a [data-page].
const ROUTES = [
  { path: '/', name: 'library' },
  { path: '/agents/new', name: 'agent-builder (new)' },
  { path: '/projects', name: 'projects index' },
  { path: '/projects/new', name: 'project onboarding' },
  { path: '/flows/forge-develop', name: 'flow monitor (seed)' },
  { path: '/flows/new', name: 'flow builder (new)' },
  { path: '/knowledge', name: 'knowledge' },
  { path: '/knowledge/new', name: 'knowledge base (new)' },
  { path: '/skills/new', name: 'skill builder (new)' },
  { path: '/architect/new', name: 'architect launcher' },
  { path: '/recovery', name: 'recovery (DEC-6 operator surface)' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startWatch() {
  return new Promise((res, rej) => {
    const proc = spawn(process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', 'studio', '--no-open'],
      { cwd: FORGE_ROOT, env: { ...process.env, FORGE_ARCHITECT_NO_SPAWN: '1' },
        stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    let buf = '';
    let settled = false;
    const onData = (chunk) => {
      if (settled) return;
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const m = line.match(/^forge-studio-ready (.+)$/);
        if (!m) continue;
        try {
          const { bridgeUrl, uiUrl } = JSON.parse(m[1]);
          if (bridgeUrl && uiUrl) { settled = true; res({ proc, uiUrl, bridgeUrl }); return; }
        } catch { /* not the signal line */ }
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', rej);
    setTimeout(() => { if (!settled) rej(new Error('forge studio not ready in 90s')); }, 90000);
  });
}

/** Visit every route once and assert it is dead-path-free. */
async function sweepOnce(page, baseUrl, check, pass) {
  for (const route of ROUTES) {
    await page.goto(baseUrl + route.path, { waitUntil: 'domcontentloaded' }).catch(() => {});
    // A real Studio page always renders a [data-page]; a 404/crash does not.
    const rendered = await page
      .waitForSelector('[data-page]', { timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    check(rendered, `[pass ${pass}] route ${route.path} (${route.name}) renders a [data-page] (no 404/crash)`);
    if (!rendered) continue;

    // No dead "coming in milestone" placeholder CTAs.
    const deadCtas = await page.evaluate(() => {
      const sel = '[title="M2"],[title="M3"],[title="M5"]';
      return Array.from(document.querySelectorAll(sel))
        .filter((el) => el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true')
        .map((el) => (el.textContent ?? '').trim().slice(0, 40));
    });
    check(deadCtas.length === 0, `[pass ${pass}] route ${route.path}: no dead milestone-placeholder CTAs (${deadCtas.join(' | ') || 'none'})`);

    // Every nav link resolves to a known route.
    const navHrefs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-nav]')).map((el) => el.getAttribute('href')));
    const known = ['/', '/flows/', '/agents/', '/projects', '/knowledge'];
    for (const href of navHrefs) {
      const ok = typeof href === 'string' && known.some((k) => href === k || href.startsWith(k));
      check(ok, `[pass ${pass}] route ${route.path}: nav link "${href}" targets a real route`);
    }
  }

  // Follow each nav link from the library and assert it lands on a [data-page].
  await page.goto(baseUrl + '/', { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForSelector('[data-nav]', { timeout: 15000 }).catch(() => {});
  const navTargets = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-nav]')).map((el) => ({ id: el.getAttribute('data-nav'), href: el.getAttribute('href') })));
  for (const { id, href } of navTargets) {
    if (!href) continue;
    await page.goto(baseUrl + href, { waitUntil: 'domcontentloaded' }).catch(() => {});
    const landed = await page.waitForSelector('[data-page]', { timeout: 15000 }).then(() => true).catch(() => false);
    check(landed, `[pass ${pass}] nav "${id}" → ${href} lands on a real page`);
  }
}

async function main() {
  console.log('[deadpaths] booting forge studio (cold compile ~20-40s)…');
  const watch = await startWatch();
  console.log(`[deadpaths] ready: ${watch.uiUrl}`);
  try { execSync(`curl -s -m 60 ${watch.uiUrl}/ -o /dev/null`); } catch { /* warm */ }

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  page.on('pageerror', (e) => console.error(`[pageerror] ${e.message}`));

  const { failures, check } = createAssertions();

  try {
    // Loop-until-dry: two consecutive clean passes.
    await sweepOnce(page, watch.uiUrl, check, 1);
    const afterFirst = failures.length;
    await sweepOnce(page, watch.uiUrl, check, 2);
    const secondPassFailures = failures.length - afterFirst;

    console.log('');
    if (failures.length === 0) {
      console.log(`[deadpaths] both passes clean — no dead paths across ${ROUTES.length} routes ✓`);
    } else {
      console.log(`[deadpaths] ${failures.length} finding(s); second pass added ${secondPassFailures}`);
    }
  } finally {
    await browser.close().catch(() => {});
    try { process.kill(-watch.proc.pid, 'SIGTERM'); } catch { /* */ }
    await sleep(300);
    try { process.kill(-watch.proc.pid, 'SIGKILL'); } catch { /* */ }
  }

  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
