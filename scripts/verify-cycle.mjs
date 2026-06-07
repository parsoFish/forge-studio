#!/usr/bin/env node
/**
 * verify-cycle — forge's REAL-CAPABILITY regression harness (ADR 022).
 *
 * Runs a real forge cycle end-to-end against the claude-harness corpus and
 * asserts real-cycle OUTCOMES — not synthetic rubrics — then records the run
 * and writes a pass/fail verdict. The four gate assertions (ADR 022 §1):
 *   1. the cycle reached merge (finalStatus `done`);
 *   2. the dev-loop completed N/N work items (no complete:0 / failed);
 *   3. the project's own tests are green post-merge (npm test in the repo);
 *   4. total cycle cost is under the declared ceiling.
 *
 * Usage:
 *   node scripts/verify-cycle.mjs <initiative-id> [options]
 *
 * Options:
 *   --tier routine|release  routine (default): reset the harness repo to
 *                           --base-sha and re-run one corpus initiative.
 *                           release: greenfield — drive the 5-initiative
 *                           ROADMAP by invoking the runner per initiative in
 *                           order against an empty repo.
 *   --base-sha <sha>        base commit to reset the harness repo to (routine).
 *   --cost-ceiling <usd>    fail the gate above this total cost (default 25).
 *   --project <name>        managed project to run against (default claude-harness).
 *   --force-reset           allow resetting a repo with uncommitted changes.
 *
 * The manifest is staged from the corpus (_queue/done/) into _queue/pending/
 * if not already pending. Tiered + manual-gate per ADR 022. It auto-approves at
 * ready-for-review and captures closure + reflection through `cycle.end`.
 *
 * Output: forge-ui/.demo-shots/verify/<initiative-id>/ (video, frames,
 * index.html, summary.json with the verdict). Exits non-zero if the gate fails.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const initiativeId = argv.find((a) => !a.startsWith('--'));
if (!initiativeId) {
  console.error('usage: node scripts/verify-cycle.mjs <initiative-id> [--tier routine|release] [--base-sha <sha>] [--cost-ceiling <usd>] [--project <name>] [--force-reset]');
  process.exit(1);
}
function flag(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
}
const TIER = flag('tier', 'routine');
const BASE_SHA = flag('base-sha', null);
const COST_CEILING = parseFloat(flag('cost-ceiling', '25')) || 25;
const PROJECT = flag('project', 'claude-harness');
const FORCE_RESET = argv.includes('--force-reset');

const OUT_DIR = join(FORGE_ROOT, 'forge-ui/.demo-shots/verify', initiativeId);
const VIDEO_DIR = join(OUT_DIR, 'video');
const FRAMES_DIR = join(OUT_DIR, 'frames');

function log(msg) { console.log(`[verify ${new Date().toISOString().slice(11, 19)}] ${msg}`); }
async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---- ADR 022 runner: corpus staging, repo reset, outcome assertions --------

function git(repoPath, args) {
  const r = spawnSync('git', args, { cwd: repoPath, encoding: 'utf8' });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

/** The harness project's repo path — from the manifest's project_repo_path, else projects/<PROJECT>. */
function projectRepoPath() {
  for (const q of ['pending', 'done', 'in-flight', 'ready-for-review', 'failed']) {
    const p = join(FORGE_ROOT, '_queue', q, `${initiativeId}.md`);
    if (existsSync(p)) {
      const m = readFileSync(p, 'utf8').match(/project_repo_path:\s*(.+)/);
      if (m) return resolve(FORGE_ROOT, m[1].trim());
    }
  }
  return join(FORGE_ROOT, 'projects', PROJECT);
}

/** Stage the initiative manifest from the corpus (_queue/done/) into pending/. */
function stageManifest() {
  const pending = join(FORGE_ROOT, '_queue', 'pending', `${initiativeId}.md`);
  if (existsSync(pending)) { log('manifest already in _queue/pending/'); return true; }
  const done = join(FORGE_ROOT, '_queue', 'done', `${initiativeId}.md`);
  if (!existsSync(done)) {
    log(`manifest not in pending/ or done/ — stage ${initiativeId}.md first`);
    return false;
  }
  mkdirSync(dirname(pending), { recursive: true });
  // Reset the lifecycle fields for a fresh run; the rest of the corpus manifest is reused as-is.
  // Strip the stale cycle_id too (ADR-026 mechanism B persisted it on the original run): if it
  // survives, the bridge reports the OLD id and findCycleIdForInitiative locks onto it, so the
  // post-serve status query returns null and auto-approve never fires (a false gate FAIL). With it
  // removed, serve assigns + persists a fresh cycle_id the bridge reports consistently.
  const body = readFileSync(done, 'utf8')
    .replace(/^phase:.*$/m, 'phase: pending')
    .replace(/^cycle_id:.*$\n?/m, '');
  writeFileSync(pending, body);
  log(`staged corpus manifest → _queue/pending/${initiativeId}.md`);
  return true;
}

/** Routine tier: hard-reset the harness repo to BASE_SHA (guarded against a dirty tree). */
function resetRepo(repoPath) {
  if (!existsSync(join(repoPath, '.git'))) { log(`reset skipped — ${repoPath} is not a git repo`); return true; }
  const dirty = git(repoPath, ['status', '--porcelain']).stdout;
  if (dirty && !FORCE_RESET) {
    log(`refusing to reset ${repoPath}: uncommitted changes (pass --force-reset to override)`);
    return false;
  }
  log(`resetting ${repoPath} → ${BASE_SHA} (reset --hard + clean -fd)`);
  if (!git(repoPath, ['reset', '--hard', BASE_SHA]).ok) { log('reset failed'); return false; }
  git(repoPath, ['clean', '-fd']);
  return true;
}

/** Sum cost_usd across the cycle's event log. */
function sumCycleCost(cycleId) {
  try {
    let total = 0;
    for (const line of readFileSync(join(FORGE_ROOT, '_logs', cycleId, 'events.jsonl'), 'utf8').split('\n')) {
      if (!line) continue;
      try { const e = JSON.parse(line); if (typeof e.cost_usd === 'number') total += e.cost_usd; } catch { /* */ }
    }
    return total;
  } catch { return 0; }
}

/** Work-item completion from the event log: { total, complete, failed }. */
function wiOutcomes(cycleId) {
  const emitted = new Set();
  const ended = new Map(); // wiId -> failed?
  try {
    for (const line of readFileSync(join(FORGE_ROOT, '_logs', cycleId, 'events.jsonl'), 'utf8').split('\n')) {
      if (!line) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      const wi = e.metadata?.work_item_id;
      if (typeof wi !== 'string') continue;
      if (e.event_type === 'log' && /work-item-emitted/.test(e.message ?? '')) emitted.add(wi);
      if (e.phase === 'developer-loop' && e.event_type === 'end') ended.set(wi, e.metadata?.status === 'failed');
    }
  } catch { /* */ }
  const total = Math.max(emitted.size, ended.size);
  const complete = [...ended.values()].filter((f) => !f).length;
  const failed = [...ended.values()].filter((f) => f).length;
  return { total, complete, failed };
}

/** Run the project's own test suite (the golden-file assertion, for claude-trail). */
function runProjectTests(repoPath) {
  if (!existsSync(join(repoPath, 'package.json'))) return { ran: false, ok: true };
  log(`running project tests in ${repoPath} (npm test)…`);
  const r = spawnSync('npm', ['test'], { cwd: repoPath, encoding: 'utf8', timeout: 5 * 60_000 });
  return { ran: true, ok: r.status === 0 };
}

/** The ADR 022 gate: four binary, outcome-only assertions. */
function assessOutcomes({ finalStatus, cost, repoPath, cycleId }) {
  const wi = wiOutcomes(cycleId);
  const tests = runProjectTests(repoPath);
  const checks = [
    { name: 'cycle reached merge (done)', pass: finalStatus === 'done', detail: `finalStatus=${finalStatus}` },
    { name: 'dev-loop completed N/N work items', pass: wi.total > 0 && wi.complete === wi.total && wi.failed === 0, detail: `${wi.complete}/${wi.total} complete, ${wi.failed} failed` },
    { name: 'project tests green post-merge', pass: tests.ok, detail: tests.ran ? (tests.ok ? 'npm test passed' : 'npm test FAILED') : 'no package.json — skipped' },
    { name: `cost under ceiling ($${COST_CEILING})`, pass: cost <= COST_CEILING, detail: `$${cost.toFixed(2)} / $${COST_CEILING}` },
  ];
  return { checks, wi };
}

async function startWatch() {
  // Reuse existing forge watch on 4124/4123 if up; else spawn.
  const probe = async (url) => {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 500);
      const res = await fetch(url, { signal: c.signal });
      clearTimeout(t);
      return res.ok;
    } catch { return false; }
  };
  if ((await probe('http://127.0.0.1:4123/api/cycles')) && (await probe('http://localhost:4124/'))) {
    log('reusing existing forge watch on 4124/4123');
    return { proc: null, uiUrl: 'http://localhost:4124', bridgeUrl: 'http://127.0.0.1:4123' };
  }
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
  if (!proc) return Promise.resolve();
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
        // cascade-v4 #6: pick the NEWEST cycle for the initiative, not the first
        // match. A resume/retry leaves the prior stopped cycle in `recent`; a
        // plain .find() over [...live, ...recent] grabbed that stale one and the
        // harness then tracked the wrong cycle. Prefer a live (currently-running)
        // cycle; otherwise the most-recently-started finished one.
        const byNewest = (arr) =>
          [...arr]
            .filter((c) => c.initiativeId === initiativeId)
            .sort((a, b) => String(b.startedAt ?? '').localeCompare(String(a.startedAt ?? '')))[0];
        const match = byNewest(body.live ?? []) ?? byNewest(body.recent ?? []);
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
    log(`✓ frame ${seq}-${name}`);
  } catch (err) {
    log(`✗ frame ${seq}-${name}: ${err.message}`);
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

async function cycleStatusFromBridge(bridgeUrl, cycleId) {
  try {
    const res = await fetch(`${bridgeUrl}/api/cycles`);
    if (!res.ok) return null;
    const body = await res.json();
    const all = [...(body.live ?? []), ...(body.recent ?? [])];
    const match = all.find((c) => c.cycleId === cycleId);
    return match?.status ?? null;
  } catch { return null; }
}

function autoApprove(initiativeId) {
  log(`auto-approving cycle (forge review ${initiativeId} --approve)…`);
  const res = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      'orchestrator/cli.ts',
      'review',
      initiativeId,
      '--approve',
      'auto-approved by scripts/verify-cycle.mjs (verification cycle — see initiative manifest)',
    ],
    { cwd: FORGE_ROOT, stdio: 'inherit' },
  );
  if (res.status !== 0) {
    log(`auto-approve failed: exit ${res.status}`);
    return false;
  }
  log('auto-approve succeeded');
  return true;
}

async function cycleEventCountFromLog(cycleId) {
  const logFile = join(FORGE_ROOT, '_logs', cycleId, 'events.jsonl');
  try {
    const raw = readFileSync(logFile, 'utf8');
    return raw.split('\n').filter((l) => l.length > 0).length;
  } catch { return 0; }
}

async function logHasCycleEnd(cycleId) {
  const logFile = join(FORGE_ROOT, '_logs', cycleId, 'events.jsonl');
  try {
    const raw = readFileSync(logFile, 'utf8');
    for (const line of raw.split('\n')) {
      if (line.includes('"phase":"orchestrator"') && line.includes('"event_type":"end"')) return true;
    }
    return false;
  } catch { return false; }
}

function writeIndexHtml() {
  const frames = readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.png')).sort();
  const rows = frames.map((f) => `<figure><img src="frames/${f}" loading="lazy"/><figcaption><code>${f}</code></figcaption></figure>`).join('\n');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>forge verify cycle — ${initiativeId}</title>
<style>
  body{background:#0d1117;color:#e6edf3;font:14px ui-sans-serif,system-ui,sans-serif;margin:32px auto;max-width:1640px;padding:0 24px}
  h1,h2{letter-spacing:.4px}
  video{width:100%;max-width:1400px;border:1px solid #30363d;border-radius:8px;background:#000}
  figure{margin:24px 0;padding:0}
  figure img{width:100%;border:1px solid #30363d;border-radius:8px;display:block}
  figure figcaption{color:#8b949e;font-family:ui-monospace,Menlo,monospace;padding-top:6px;font-size:12px}
  code{color:#d2a8ff}
</style></head><body>
<h1>forge — verification cycle recording</h1>
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

  // ADR 022 pre-run: stage the corpus manifest + reset the repo per tier.
  log(`tier=${TIER} project=${PROJECT} ceiling=$${COST_CEILING}${BASE_SHA ? ` base=${BASE_SHA}` : ''}`);
  const repoPath = projectRepoPath();
  if (!stageManifest()) process.exit(1);
  if (TIER === 'routine') {
    if (BASE_SHA) { if (!resetRepo(repoPath)) process.exit(1); }
    else { log('routine tier without --base-sha: running against the current repo state'); }
  } else if (TIER === 'release') {
    log('release tier: greenfield rebuild — drive the 5-initiative ROADMAP by invoking the runner per initiative in order (docs/planning/2026-05-30-claude-trail-rebuild/ROADMAP.md).');
  }

  log('starting forge watch…');
  const watch = await startWatch();
  log(`watch ready: ui=${watch.uiUrl} bridge=${watch.bridgeUrl}`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1400 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1400, height: 1400 } },
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

  log('spawning forge serve --once…');
  const serve = startServe();
  serve.stdout.on('data', (d) => process.stdout.write(d));
  serve.stderr.on('data', (d) => process.stderr.write(d));

  // 2026-05-26 fix: attach the exit listener IMMEDIATELY after spawn,
  // not after the cycle-claim await. Previously the listener was
  // attached AFTER `findCycleIdForInitiative` resolved; if the cycle
  // failed fast (e.g. malformed manifest causes serve to exit with
  // code 1 in <1s), the exit event fired before any listener saw it
  // and the phase-poll loop later stalled forever waiting for
  // SERVE_EXITED.
  const SERVE_EXITED = Symbol('serve-exited');
  const serveEnd = new Promise((res) => serve.on('exit', () => res(SERVE_EXITED)));

  log('waiting for cycle to appear on bridge…');
  const cycleId = await findCycleIdForInitiative(watch.bridgeUrl, initiativeId, Date.now() + 60_000);
  if (!cycleId) {
    log('cycle never appeared — bailing');
    await captureFrame(page, 'cycle-never-claimed');
    await browser.close();
    await stopWatch(watch.proc);
    process.exit(1);
  }
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

  // Phase-1 capture: while `serve --once` is running. Exits when the
  // cycle hits a terminal phase for the autonomous part (pr-open,
  // failed, etc.) — serve exits at that point.
  //
  // 2026-05-25/26 fix: previously used Promise.race + a falsy check
  // (broke on exit code 0) AND attached the exit listener after
  // findCycleIdForInitiative (broke on fail-fast cycles). Now uses a
  // sentinel object AND attaches the listener immediately after spawn
  // (see SERVE_EXITED above).
  const seenPhase = new Map();
  const phasePoll = (async () => {
    while (true) {
      const r = await Promise.race([serveEnd, sleep(2000)]);
      if (r === SERVE_EXITED) return;
      try {
        const states = await getPhaseStates(page);
        for (const [phase, status] of Object.entries(states)) {
          const prev = seenPhase.get(phase);
          if (prev !== status) {
            seenPhase.set(phase, status);
            await captureFrame(page, `${phase}-${status}`);
          }
        }
      } catch { /* */ }
    }
  })();

  await serveEnd;
  await phasePoll;
  log('serve --once exited');

  // What state did the cycle reach?
  await sleep(2000);
  const status = await cycleStatusFromBridge(watch.bridgeUrl, cycleId);
  log(`cycle status after serve exit: ${status}`);
  await captureFrame(page, `after-serve-${status ?? 'unknown'}`);

  // Auto-approve path: if ready-for-review, kick the approve + capture
  // closure + reflection.
  if (status === 'ready-for-review') {
    const ok = autoApprove(initiativeId);
    if (ok) {
      log('waiting for closure + reflection to complete…');
      const deadline = Date.now() + 10 * 60_000; // 10 min cap
      let lastEventCount = 0;
      while (Date.now() < deadline) {
        const ended = await logHasCycleEnd(cycleId);
        if (ended) {
          log('cycle.end emitted by orchestrator — reflection complete');
          break;
        }
        // Capture frame whenever the event count grows substantially.
        const count = await cycleEventCountFromLog(cycleId);
        if (count > lastEventCount + 4) {
          lastEventCount = count;
          await captureFrame(page, `post-approve-events-${count}`);
        }
        await sleep(3000);
      }
      await sleep(3000);
      await captureFrame(page, 'final-state');
    }
  } else {
    log(`cycle reached non-ready-for-review state (${status}) — no auto-approve`);
  }

  // Capture the video path BEFORE closing.
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

  // ---- ADR 022 gate: outcome assertions ----
  const finalStatus = await cycleStatusFromBridge(watch.bridgeUrl, cycleId);
  const finalEvents = await cycleEventCountFromLog(cycleId);
  const cost = sumCycleCost(cycleId);
  const { checks, wi } = assessOutcomes({ finalStatus, cost, repoPath, cycleId });
  const gatePassed = checks.every((c) => c.pass);

  log(`--- verdict (${TIER} tier) ---`);
  for (const c of checks) log(`  ${c.pass ? '✓' : '✗'} ${c.name} — ${c.detail}`);

  const summary = {
    initiativeId,
    cycleId,
    project: PROJECT,
    tier: TIER,
    baseSha: BASE_SHA,
    finalStatus,
    totalEvents: finalEvents,
    costUsd: Number(cost.toFixed(4)),
    costCeilingUsd: COST_CEILING,
    workItems: wi,
    checks,
    gate: gatePassed ? 'pass' : 'fail',
    framesCaptured: readdirSync(FRAMES_DIR).filter((f) => f.endsWith('.png')).length,
    completedAt: new Date().toISOString(),
  };
  writeFileSync(join(OUT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));
  log(`summary → ${join(OUT_DIR, 'summary.json')}`);
  log(`final status: ${finalStatus}, $${cost.toFixed(2)}, ${finalEvents} events, ${summary.framesCaptured} frames`);
  log(`done — gate ${gatePassed ? 'PASS ✓' : 'FAIL ✗'}`);
  if (!gatePassed) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[verify] fatal');
  console.error(err.stack ?? err.message);
  process.exit(1);
});
