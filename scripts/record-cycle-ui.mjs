#!/usr/bin/env node
/**
 * Record a playwright video of forge-ui while a real cycle runs.
 *
 * Usage:
 *   node scripts/record-cycle-ui.mjs <initiative-id>
 *
 * Setup:
 *   1. Manifest for <initiative-id> must already be in _queue/pending/.
 *   2. forge watch is NOT running (this script brings it up itself).
 *
 * Output:
 *   forge-ui/.demo-shots/cycle/<initiative-id>/cycle.webm   — recording
 *   forge-ui/.demo-shots/cycle/<initiative-id>/frames/      — checkpoints
 *   forge-ui/.demo-shots/cycle/<initiative-id>/index.html   — view both
 *
 * What it does:
 *   1. Spawns `forge watch --no-open` (UI on 4124, bridge on 4123).
 *   2. Opens playwright at the UI, viewport 1600x2400, recording video.
 *   3. Spawns `forge serve --once` in parallel → claims the pending
 *      manifest, runs the cycle.
 *   4. Polls the bridge's /api/cycles + the page's [data-active-cycle-id]
 *      until the new cycle appears + finishes (pr-open / failed / done).
 *   5. Clicks the new cycle button in the UI so the page focuses on it.
 *   6. Takes screenshot checkpoints when the page's data-* attributes
 *      indicate phase transitions (architect ✓, pm ✓, dev complete, etc.).
 *   7. Once cycle is terminal, waits 5s for last-frame settling, closes
 *      the browser (which finalises the video), tears down forge watch.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const initiativeId = process.argv[2];
if (!initiativeId) {
  console.error('usage: node scripts/record-cycle-ui.mjs <initiative-id>');
  process.exit(1);
}

const OUT_DIR = join(FORGE_ROOT, 'forge-ui/.demo-shots/cycle', initiativeId);
const VIDEO_DIR = join(OUT_DIR, 'video');
const FRAMES_DIR = join(OUT_DIR, 'frames');

function log(msg) { console.log(`[record] ${msg}`); }
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function startWatch() {
  return new Promise((res, rej) => {
    const proc = spawn(
      process.execPath,
      ['--experimental-strip-types', 'orchestrator/cli.ts', 'watch', '--no-open'],
      { cwd: FORGE_ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
    );
    let uiUrl = null, bridgeUrl = null;
    const onData = (chunk) => {
      const t = chunk.toString();
      const m1 = t.match(/http:\/\/localhost:\d+/); if (m1 && !uiUrl) uiUrl = m1[0];
      const m2 = t.match(/bridge at (http:\/\/127\.0\.0\.1:\d+)/); if (m2 && !bridgeUrl) bridgeUrl = m2[1];
      if (t.includes('Ready in') && uiUrl && bridgeUrl) res({ proc, uiUrl, bridgeUrl });
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);
    proc.on('error', rej);
    setTimeout(() => { if (!uiUrl || !bridgeUrl) rej(new Error('forge watch not ready within 30s')); }, 30000);
  });
}

function stopWatch(proc) {
  return new Promise((res) => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; res(); };
    proc.on('exit', done);
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* */ }
    setTimeout(() => { try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* */ } done(); }, 3000);
  });
}

function startServe() {
  return spawn(
    process.execPath,
    ['--experimental-strip-types', 'orchestrator/cli.ts', 'serve', '--once'],
    { cwd: FORGE_ROOT, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
  );
}

async function findCycleIdForInitiative(bridgeUrl, initiativeId, deadlineMs) {
  while (Date.now() < deadlineMs) {
    try {
      const res = await fetch(`${bridgeUrl}/api/cycles`);
      if (res.ok) {
        const body = await res.json();
        const all = [...(body.live ?? []), ...(body.recent ?? [])];
        const match = all.find((c) => c.initiativeId === initiativeId);
        if (match) return match.cycleId;
      }
    } catch { /* */ }
    await sleep(1000);
  }
  return null;
}

async function captureFrame(page, name) {
  const seq = String((captureFrame._n = (captureFrame._n ?? 0) + 1)).padStart(2, '0');
  const path = join(FRAMES_DIR, `${seq}-${name}.png`);
  try {
    await page.screenshot({ path, fullPage: true });
    log(`✓ ${seq}-${name}`);
  } catch (err) {
    log(`✗ ${seq}-${name}: ${err.message}`);
  }
}

async function getPhaseStates(page) {
  return await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-phase][data-phase-status]'));
    const states = {};
    for (const r of rows) {
      const phase = r.getAttribute('data-phase');
      const status = r.getAttribute('data-phase-status');
      if (phase && status && !(phase in states)) states[phase] = status;
    }
    return states;
  });
}

function writeIndexHtml() {
  const frames = readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.png')).sort();
  const rows = frames.map((f) => `<figure><img src="frames/${f}" loading="lazy"/><figcaption><code>${f}</code></figcaption></figure>`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>forge cycle — ${initiativeId}</title>
<style>
  body{background:#0d1117;color:#e6edf3;font:14px ui-sans-serif,system-ui,sans-serif;margin:32px auto;max-width:1640px;padding:0 24px}
  h1,h2{letter-spacing:.4px}
  video{width:100%;max-width:1600px;border:1px solid #30363d;border-radius:8px;background:#000}
  figure{margin:24px 0;padding:0}
  figure img{width:100%;border:1px solid #30363d;border-radius:8px;display:block}
  figure figcaption{color:#8b949e;font-family:ui-monospace,Menlo,monospace;padding-top:6px;font-size:12px}
  code{color:#d2a8ff}
</style></head><body>
<h1>forge — live cycle recording</h1>
<p><code>${initiativeId}</code></p>
<h2>video</h2>
<video src="cycle.webm" controls autoplay muted loop></video>
<h2>frames</h2>
${rows}
</body></html>`;
  writeFileSync(join(OUT_DIR, 'index.html'), html);
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(VIDEO_DIR, { recursive: true });
  mkdirSync(FRAMES_DIR, { recursive: true });

  log('starting forge watch (~15s)…');
  const watch = await startWatch();
  log(`watch ready: ui=${watch.uiUrl} bridge=${watch.bridgeUrl}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 2400 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1600, height: 2400 } },
  });
  const page = await ctx.newPage();
  page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));

  await page.goto(watch.uiUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => document.querySelector('main')?.getAttribute('data-page-ready') === 'true',
    undefined,
    { timeout: 15000 },
  ).catch(() => log('page-ready timed out'));
  await captureFrame(page, 'initial-load');

  log('spawning `forge serve --once` for the cycle…');
  const serve = startServe();
  let serveLog = '';
  serve.stdout.on('data', (d) => { serveLog += d.toString(); process.stdout.write(d); });
  serve.stderr.on('data', (d) => { serveLog += d.toString(); process.stderr.write(d); });

  // Wait for the cycle to appear in the bridge's cycle list (its log dir
  // was created), then click it so the page focuses on it.
  log('waiting for cycle dir to appear…');
  const cycleId = await findCycleIdForInitiative(watch.bridgeUrl, initiativeId, Date.now() + 60_000);
  if (!cycleId) {
    log('cycle never appeared on bridge — capturing fallback frame');
    await captureFrame(page, 'cycle-never-claimed');
  } else {
    log(`cycle id: ${cycleId}`);
    try {
      await page.waitForSelector(`[data-cycle-id="${cycleId}"]`, { timeout: 15000 });
      await page.locator(`[data-cycle-id="${cycleId}"]`).first().click();
      await page.waitForFunction(
        (id) => document.querySelector('main')?.getAttribute('data-active-cycle-id') === id,
        cycleId,
        { timeout: 5000 },
      ).catch(() => { /* */ });
      await captureFrame(page, 'cycle-focused');
    } catch (err) {
      log(`click failed: ${err.message}`);
    }
  }

  // Poll the page's data-* attributes for phase transitions. Capture a
  // frame whenever a phase status flips (pending → active → complete).
  const seen = new Map();
  const cycleEnd = new Promise((res) => serve.on('exit', res));
  const pollEnd = (async () => {
    while (true) {
      if (await Promise.race([cycleEnd, sleep(2000).then(() => false)])) return;
      try {
        const states = await getPhaseStates(page);
        for (const [phase, status] of Object.entries(states)) {
          const prev = seen.get(phase);
          if (prev !== status) {
            seen.set(phase, status);
            await captureFrame(page, `${phase}-${status}`);
          }
        }
      } catch { /* page navigated or closed — ignore */ }
    }
  })();

  await cycleEnd;
  log('cycle process exited — capturing final state in 5s');
  await sleep(5000);
  await captureFrame(page, 'final-state');
  await pollEnd;

  // Capture the video path BEFORE closing (after close it's null).
  let videoSrc = null;
  try { videoSrc = await page.video()?.path(); } catch { /* */ }

  await browser.close();
  await stopWatch(watch.proc);

  if (videoSrc && existsSync(videoSrc)) {
    const dest = join(OUT_DIR, 'cycle.webm');
    try {
      renameSync(videoSrc, dest);
      log(`video → ${dest}`);
    } catch (err) {
      log(`failed to move video: ${err.message}`);
    }
  } else {
    log('no video file produced');
  }

  writeIndexHtml();
  log(`index → ${join(OUT_DIR, 'index.html')}`);
  log('done');
}

main().catch((err) => {
  console.error('[record] fatal');
  console.error(err.stack ?? err.message);
  process.exit(1);
});
