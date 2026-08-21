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

import { execSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { createAssertions } from './lib/journey-assertions.mjs';
import { spawnStudioReady } from './lib/boot-studio.mjs';

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
  // W6-IA-2: the flows pillar's own browse index (card grid, reuses
  // FlowCard) — new alongside the pre-existing /flows/[id] monitor+build and
  // /flows/new routes below. W6-IA-5 repointed `StudioNav`'s Flows nav item
  // straight at this index (was a direct deep-link to /flows/forge-develop);
  // it renders a real [data-page] and must not read as a dead path.
  { path: '/flows', name: 'flows index (W6-IA-2)' },
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
  // W6-B10: the demo-builder's own entrypoint repair — a static, no-id
  // kickoff surface (mirrors `/architect/new` above), the same generic
  // `/sessions/[kind]/new` screen instructions/kb-cleanup/authoring/
  // project-brain also share.
  { path: '/sessions/demo/new', name: 'demo-builder kickoff (dedicated session screen, W6-B10)' },
  // W6-IA-8: `/recovery` is now a wire redirect (next.config.mjs) to
  // `/library`, not a client-shim page — `page.goto` follows the 308 at the
  // network level before this crawler ever inspects the DOM, so this row's
  // [data-page]/dead-CTA/nav-link assertions land on `/library` and are the
  // honest post-redirect check, unchanged from when it was a client shim.
  { path: '/recovery', name: 'recovery (DEC-6 operator surface, now a wire redirect -> /library)' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

    // W7-C3 a11y basics — the chrome no single page owns, checked on EVERY
    // route (the crosscut journey beat proves the same contract in depth on a
    // cross-section; this is the breadth half). Deliberately three cheap
    // structural facts, not an axe run:
    //   · the [data-page] root IS the <main> landmark (all 27+ routes render
    //     their page root as <main> — the shells and every bespoke detail
    //     page alike), so screen-reader landmark navigation lands on content;
    //   · the skip link's fragment resolves to that same landmark — a skip
    //     link naming a fragment the document does not contain reads as
    //     provided and skips nowhere (crosscut-18);
    //   · the tab title is the route's own, not the bare product name that
    //     every route shared before W7-C3 (crosscut-06).
    const a11y = await page.evaluate(() => {
      const root = document.querySelector('[data-page]');
      const skip = document.querySelector('[data-component="skip-link"]');
      const frag = (skip?.getAttribute('href') ?? '').replace(/^#/, '');
      return {
        rootTag: root?.tagName ?? null,
        skipTargetIsRoot: !!frag && document.getElementById(frag) === root,
        title: document.title,
      };
    });
    check(a11y.rootTag === 'MAIN',
      `[pass ${pass}] route ${route.path}: the [data-page] root is a <main> landmark (got <${(a11y.rootTag ?? 'none').toLowerCase()}>)`);
    check(a11y.skipTargetIsRoot,
      `[pass ${pass}] route ${route.path}: the skip link's fragment resolves to that <main> (crosscut-18)`);
    check(/ · forge$/.test(a11y.title) && a11y.title !== 'forge',
      `[pass ${pass}] route ${route.path}: sets its OWN tab title, not the bare product name (got "${a11y.title}")`);

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
    // W6-IA-5: Flows/Agents now point at their own index (/flows, /agents),
    // not a deep-link into a specific flow/agent — kept in sync with
    // StudioNav's NAV_ITEMS hrefs.
    // Exact membership, not startsWith — '/' as a prefix made the old check a
    // no-op (every absolute href passed). Nav hrefs are a closed set.
    const known = ['/', '/projects', '/flows', '/agents', '/library', '/knowledge'];
    for (const href of navHrefs) {
      const ok = typeof href === 'string' && known.includes(href);
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
  // W7-C3: the studio boot is the shared scripts/lib/boot-studio.mjs core
  // (one ready-line parser + group-kill timeout for all three harnesses).
  // Budget: 120s — the pre-existing 90s bridge/bind budget + the ~30s cold
  // `next build` allowance (W6-P3 review finding #4, measured 18.06s + 50%).
  const watch = await spawnStudioReady({ env: { FORGE_ARCHITECT_NO_SPAWN: '1' }, timeoutMs: 120_000 });
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
