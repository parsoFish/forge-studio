#!/usr/bin/env node
/**
 * forge-ui-demo — drive a headless chromium through every UI state and
 * save full-page screenshots so the operator can see what `forge watch`
 * looks like without launching a real browser themselves.
 *
 * Output: forge-ui/.demo-shots/{NN-name}.png + index.html.
 *
 * States captured (best-effort — skipped if their preconditions can't
 * be set up):
 *   01-initial-load   The page on first load (banner, cycles tab,
 *                     state-machine, sidebar, WI graph, event tail).
 *   02-cycle-selected A historical cycle with events → event tail
 *                     populated, sidebar shows per-phase activity.
 *   03-wi-graph       A cycle that has _logs/<id>/work-items-snapshot/
 *                     _graph.md → WI graph panel populated.
 *   04-verdict-form   A synthetic in-flight manifest moved to
 *                     ready-for-review/ → the VerdictForm renders. The
 *                     synthetic manifest is removed at the end.
 *
 * Usage:
 *   npm run forge-ui:demo
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const __filename = fileURLToPath(import.meta.url);
const FORGE_ROOT = resolve(dirname(__filename), '..');
const SHOTS_DIR = resolve(FORGE_ROOT, 'forge-ui/.demo-shots');
const FAKE_INIT_ID = 'INIT-2026-05-24-ui-demo';

function log(msg) { console.log(`[forge-ui:demo] ${msg}`); }

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Pick a cycle ID from the bridge's actually-rendered list (so the
 * cycle button is on screen for playwright to click). Filters by
 * predicate against the local _logs/<cycleId>/ contents.
 */
async function pickCycleFromBridge(bridgeUrl, predicate) {
  try {
    const res = await fetch(`${bridgeUrl}/api/cycles`);
    if (!res.ok) return null;
    const body = await res.json();
    const all = [...(body.live ?? []), ...(body.recent ?? [])];
    for (const c of all) {
      if (c.initiativeId === FAKE_INIT_ID) continue;
      if (predicate(c.cycleId)) return c.cycleId;
    }
  } catch {
    /* bridge unreachable */
  }
  return null;
}

function cycleHasEvents(cycleId) {
  return existsSync(join(FORGE_ROOT, '_logs', cycleId, 'events.jsonl'));
}

function cycleHasGraph(cycleId) {
  return existsSync(join(FORGE_ROOT, '_logs', cycleId, 'work-items-snapshot', '_graph.md'));
}

async function startWatch() {
  return new Promise((resolveStart, rejectStart) => {
    // Spawn in its own process group so we can kill the whole tree on
    // shutdown — `forge watch` spawns `npm run dev` which spawns
    // `next dev`; SIGINT to the parent doesn't reliably propagate.
    const proc = spawn(
      process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', 'watch', '--no-open'],
      { cwd: FORGE_ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
    let uiUrl = null;
    let bridgeUrl = null;
    const onData = (chunk) => {
      const text = chunk.toString();
      const uiMatch = text.match(/http:\/\/localhost:\d+/);
      const bridgeMatch = text.match(/bridge at (http:\/\/127\.0\.0\.1:\d+)/);
      if (bridgeMatch && !bridgeUrl) bridgeUrl = bridgeMatch[1];
      if (uiMatch && !uiUrl) uiUrl = uiMatch[0];
      if (text.includes('Ready in')) resolveStart({ proc, uiUrl, bridgeUrl });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', rejectStart);
    setTimeout(() => {
      if (!uiUrl) rejectStart(new Error('forge watch did not become ready within 30s'));
    }, 30000);
  });
}

function stopWatch(proc) {
  return new Promise((resolveStop) => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; resolveStop(); };
    proc.on('exit', done);
    // Kill the whole process group (negative PID).
    try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
    setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch {} done(); }, 3000);
  });
}

function ensureFakeReadyForReview() {
  const rfr = resolve(FORGE_ROOT, '_queue/ready-for-review');
  mkdirSync(rfr, { recursive: true });
  const manifestPath = join(rfr, `${FAKE_INIT_ID}.md`);
  // Use tmp+rename so the bridge's fs.watch fires on a complete file.
  const tmpPath = manifestPath + '.tmp';
  writeFileSync(
    tmpPath,
    `---\ntype: implementation\ninitiative_id: ${FAKE_INIT_ID}\nproject: ui-demo\nfeatures:\n  - id: FEAT-1\n    name: ui-demo seed\n---\n\n# UI demo seed\n\nSynthetic manifest used only by scripts/forge-ui-demo.mjs to render the verdict form.\n`,
  );
  renameSync(tmpPath, manifestPath);
  // The bridge maps initiative_id → most-recent matching _logs/ dir to
  // get the cycle_id (which the verdict form needs). Seed one.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + 'Z';
  const cycleId = `${stamp}_${FAKE_INIT_ID}`;
  const logDir = resolve(FORGE_ROOT, '_logs', cycleId);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(
    join(logDir, 'events.jsonl'),
    JSON.stringify({
      event_id: 'EV_demo',
      cycle_id: cycleId,
      initiative_id: FAKE_INIT_ID,
      started_at: new Date().toISOString(),
      phase: 'review-loop',
      skill: 'developer-unifier',
      event_type: 'log',
      input_refs: [],
      output_refs: [],
      message: 'ui-demo seed event',
      metadata: {},
    }) + '\n',
  );
  return { manifestPath, logDir, cycleId };
}

function cleanupFakes(fakes) {
  for (const fake of fakes) {
    try { rmSync(fake.manifestPath, { force: true }); } catch {}
    try { rmSync(fake.logDir, { recursive: true, force: true }); } catch {}
  }
}

async function shot(page, name, caption) {
  const path = join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  log(`captured ${name} — ${caption}`);
  return { name, caption };
}

async function clickCycle(page, cycleId) {
  const btn = page.locator(`[data-cycle-id="${cycleId}"]`);
  if ((await btn.count()) === 0) return false;
  await btn.first().click();
  // The page sets data-active-cycle-id on the root <main> when the
  // selection actually takes effect — wait on the data-attr rather
  // than guess with a timeout.
  await page.waitForFunction(
    (id) => document.querySelector('main')?.getAttribute('data-active-cycle-id') === id,
    cycleId,
    { timeout: 5000 },
  ).catch(() => { /* fall through; shot will reveal the miss */ });
  return true;
}

async function waitForCycleButton(page, cycleId, timeoutMs = 5000) {
  try {
    await page.locator(`[data-cycle-id="${cycleId}"]`).first().waitFor({ state: 'attached', timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function waitForPageReady(page, timeoutMs = 15000) {
  // Set once the WS reports 'open' (or 'no-bridge' if bridge is down).
  try {
    await page.waitForFunction(
      () => document.querySelector('main')?.getAttribute('data-page-ready') === 'true',
      undefined,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

async function waitForEventsLoaded(page, cycleId, timeoutMs = 5000) {
  // After clicking a cycle, the page calls fetchEvents and pushes the
  // count into data-active-cycle-events. Wait until it's > 0 OR until
  // the activeCycleId matches (a cycle with 0 events is still "ready").
  try {
    await page.waitForFunction(
      (id) => {
        const main = document.querySelector('main');
        if (!main) return false;
        return main.getAttribute('data-active-cycle-id') === id;
      },
      cycleId,
      { timeout: timeoutMs },
    );
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (existsSync(SHOTS_DIR)) rmSync(SHOTS_DIR, { recursive: true, force: true });
  mkdirSync(SHOTS_DIR, { recursive: true });

  log('starting forge watch (this takes ~15s)…');
  const watch = await startWatch();
  log(`watch ready: ui=${watch.uiUrl} bridge=${watch.bridgeUrl}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => log(`pageerror: ${err.message}`));

  const captions = [];

  // 01 — initial load. No synthetic seeded yet → no verdict form, page
  // defaults to the most recent live cycle (or the most recent recent
  // if no live ones), so the operator sees a realistic first-load.
  log('navigating…');
  await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' });
  await waitForPageReady(page);
  captions.push(await shot(page, '01-initial-load', 'First load — scheduler banner, cycles tab, default-selected cycle'));

  // 02 — explicitly select a historical cycle that has events.
  const cycleEvents = await pickCycleFromBridge(watch.bridgeUrl, cycleHasEvents);
  if (cycleEvents) {
    log(`02 — selecting cycle with events: ${cycleEvents}`);
    if (await clickCycle(page, cycleEvents)) {
      await waitForEventsLoaded(page, cycleEvents);
      const initId = (cycleEvents.match(/_(INIT-.+)$/) || [])[1] ?? cycleEvents;
      captions.push(await shot(page, '02-cycle-selected', `Cycle "${initId}" — state machine, activity sidebar, event tail streaming`));
    } else {
      log(`02 — cycle button not found for ${cycleEvents}; skipping`);
    }
  } else {
    log('02 — no cycle with events found via bridge; skipping');
  }

  // 03 — select a cycle that has the mermaid graph.
  const cycleGraph = await pickCycleFromBridge(watch.bridgeUrl, cycleHasGraph);
  if (cycleGraph) {
    log(`03 — selecting cycle with WI graph: ${cycleGraph}`);
    if (await clickCycle(page, cycleGraph)) {
      // Wait for the WI graph panel to leave its 'loading' state.
      await page
        .waitForFunction(
          () => {
            const el = document.querySelector('[data-section="wi-graph"]');
            return el && el.getAttribute('data-state') === 'ready';
          },
          undefined,
          { timeout: 5000 },
        )
        .catch(() => log('03 — wi-graph never reached state=ready; shot may show loading/empty state'));
      const initId = (cycleGraph.match(/_(INIT-.+)$/) || [])[1] ?? cycleGraph;
      captions.push(await shot(page, '03-wi-graph', `Cycle "${initId}" — WI dependency graph parsed from PM's mermaid`));
    } else {
      log(`03 — cycle button not found for ${cycleGraph}; skipping`);
    }
  } else {
    log('03 — no rendered cycle has a _graph.md; skipping (PM probably never ran for any visible cycle)');
  }

  // 04+05 — verdict form. Seed the synthetic ready-for-review now.
  log('seeding synthetic ready-for-review manifest for verdict-form shots…');
  const fake = ensureFakeReadyForReview();
  const appeared = await waitForCycleButton(page, fake.cycleId, 7000);
  if (appeared) {
    log(`04 — clicking synthetic ${fake.cycleId}`);
    if (await clickCycle(page, fake.cycleId)) {
      // Wait for the verdict form to render.
      await page
        .waitForSelector('[data-component="verdict-form"]', { timeout: 3000 })
        .catch(() => log('04 — verdict-form did not appear; ready-for-review state may not have propagated'));
      captions.push(await shot(page, '04-verdict-form-approve', 'Verdict form — approve mode (default)'));
      const sendBackRadio = page.locator('input[type="radio"][value="send-back"]');
      if ((await sendBackRadio.count()) > 0) {
        await sendBackRadio.first().click();
        await page
          .waitForFunction(
            () => document.querySelector('[data-component="verdict-form"]')?.getAttribute('data-form-kind') === 'send-back',
            undefined,
            { timeout: 2000 },
          )
          .catch(() => { /* still take the shot */ });
        captions.push(await shot(page, '05-verdict-form-send-back', 'Verdict form — send-back mode with acceptance criteria editor'));
      }
    }
  } else {
    log('synthetic cycle button did not appear within 7s — bridge may not have picked it up; skipping 04-05');
  }

  const indexHtml = renderIndex(captions, { uiUrl: watch.uiUrl, bridgeUrl: watch.bridgeUrl });
  writeFileSync(join(SHOTS_DIR, 'index.html'), indexHtml);
  log(`wrote ${SHOTS_DIR}/index.html`);

  await browser.close();
  log('stopping forge watch…');
  await stopWatch(watch.proc);
  cleanupFakes([fake]);

  // 7. Summarise.
  console.log('');
  console.log(`Demo screenshots saved to: ${SHOTS_DIR}/`);
  console.log(`Open index.html to view all captures with captions:`);
  console.log(`  xdg-open ${SHOTS_DIR}/index.html  # Linux`);
  console.log(`  (or open the folder from your file manager)`);
  console.log('');
  console.log('Captured states:');
  for (const c of captions) console.log(`  ${c.name}.png — ${c.caption}`);
}

function renderIndex(captions, meta) {
  const cards = captions
    .map(
      (c) => `<figure>
  <a href="${c.name}.png" target="_blank"><img src="${c.name}.png" alt="${c.name}"></a>
  <figcaption><strong>${c.name}</strong> — ${escapeHtml(c.caption)}</figcaption>
</figure>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>forge-ui demo shots</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0c1115; color: #e6edf3; margin: 24px; }
  h1 { font-size: 18px; letter-spacing: 0.4px; }
  .meta { color: #8b949e; font-size: 12px; margin-bottom: 24px; }
  figure { margin: 0 0 32px; }
  figure img { width: 100%; max-width: 1440px; border: 1px solid #30363d; border-radius: 8px; }
  figcaption { font-size: 13px; color: #8b949e; margin-top: 6px; }
</style>
</head>
<body>
<h1>forge-ui demo</h1>
<div class="meta">Captured against ui=${escapeHtml(meta.uiUrl)}, bridge=${escapeHtml(meta.bridgeUrl)}.</div>
${cards}
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

main().catch((err) => {
  console.error(`[forge-ui:demo] fatal: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
