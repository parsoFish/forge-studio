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
  // `/` served the interim `/library` redirect from R6-03-F3 until R6-07
  // landed the real Home dashboard (forge-ui/app/page.tsx) — the redirect is
  // now deliberately retired (scripts/redirect-preservation.test.ts pins its
  // absence). The crawler still just asserts a real [data-page] renders here.
  { path: '/', name: 'home dashboard (R6-07)' },
  { path: '/library', name: 'library (moved off /)' },
  { path: '/agents/new', name: 'agent-builder (new)' },
  { path: '/agents/developer-ralph', name: 'agent detail (real shipped agent)' },
  // R6-04 WI-4: an UNKNOWN runId (never dispatched) — proves the honest
  // 404/not-found degradation (RunView.tsx's `found:false` branch), not a
  // happy path that would need a live, just-dispatched run this read-only
  // sweep never creates.
  { path: '/agents/developer-ralph/run/nonexistent-run-e2e-deadpath', name: 'agent run view (unknown runId — 404/not-found)' },
  { path: '/projects', name: 'projects index' },
  { path: '/projects/new', name: 'project onboarding' },
  { path: '/flows/forge-develop', name: 'flow monitor (seed)' },
  // R6-01 WI-2 (F4): the flow-run analogue of the agent-run entry above — an
  // UNKNOWN runId on a REAL seed flow (forge-develop) must render the honest
  // not-found surface (FlowRunDetail's `found:false` branch), not a Next 404
  // and not a fabricated all-pending timeline. RED until F4 lands the route
  // (app/flows/[id]/run/[runId] does not exist on disk yet) — correct AT-first
  // ordering, mirroring how the agent-run entry above was added ahead of its
  // own route (R6-04).
  { path: '/flows/forge-develop/run/nonexistent-run-e2e-deadpath', name: 'flow run detail (unknown runId — 404/not-found)' },
  { path: '/flows/new', name: 'flow builder (new)' },
  { path: '/knowledge', name: 'knowledge' },
  { path: '/knowledge/new', name: 'knowledge base (new)' },
  { path: '/skills', name: 'skill library' },
  { path: '/skills/new', name: 'skill builder (new)' },
  { path: '/skills/brain-query', name: 'skill detail (real shipped skill)' },
  { path: '/hooks', name: 'hook library' },
  { path: '/hooks/new', name: 'hook builder (new)' },
  { path: '/hooks/pre-pr-security-review', name: 'hook detail (real shipped hook)' },
  { path: '/connections', name: 'connections library' },
  // No `/connections/new` — there is no create/edit surface for this
  // category anywhere (R3-04 D1, the structural negative AC); adding that
  // route here would assert the opposite of this initiative's own AC.
  { path: '/connections/git', name: 'connection detail (real shipped tool)' },
  { path: '/community', name: 'community browser (R3-07 — cross-kind: skill/hook/mcp/tool)' },
  // No `/community/new`, `/community/edit`, or `/community/approve` — this
  // surface owns ZERO trust decisions (D2): install ROUTES to whichever
  // pipeline owns the kind (R3-01/R3-03/R3-04), it never approves, overrides,
  // or authors anything itself. One real detail route per kind that exists
  // on disk today, mirroring the "no create/edit surface" negative AC above:
  { path: '/community/skill/dependency-diff-review', name: 'community detail (vendored skill)' },
  { path: '/community/hook/block-protected-branch-push', name: 'community detail (vendored hook)' },
  { path: '/community/mcp/memory', name: 'community detail (catalog MCP)' },
  { path: '/community/tool/git', name: 'community detail (catalog tool)' },
  { path: '/templates', name: 'templates library' },
  { path: '/templates/plan', name: 'template detail (real planning template)' },
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
    // W6-P3 review finding #4: `forge studio` now serves a PRODUCTION build
    // by default (no --dev here, deliberately — this harness exercises what
    // the operator actually runs), so readiness now includes a one-time
    // `next build` before `next start` can bind. Budget = the pre-existing
    // 90s (bridge start + port takeover + `next start` bind + first-request
    // probe — unchanged from the old next-dev budget) PLUS a build-specific
    // allowance measured directly: a cold `npm run build --workspace
    // forge-ui` on the machine this was authored on took 18.06s wall-clock
    // (`/usr/bin/time -v`, 200% CPU); +50% margin rounds to 30s. First run
    // (or any run after forge-ui source changes) pays this; a warm/fresh
    // `.next/` skips the build entirely and is fast.
    setTimeout(() => { if (!settled) rej(new Error('forge studio not ready in 120s')); }, 120000);
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
  // W6-P3: forge studio serves a production build by default now — the FIRST
  // cold run (or any run after forge-ui source changed) pays a one-time
  // `next build` (measured ~18s on the authoring machine) before `next
  // start` binds; a fresh `.next/` skips straight to `next start`.
  console.log('[deadpaths] booting forge studio (cold run pays a one-time production build, ~20-40s; warm re-runs skip it)…');
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
