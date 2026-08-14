#!/usr/bin/env node
/**
 * perf-snapshot — a point-in-time performance READING of a running forge
 * studio (W6-P0). Measurement only: it records API + page timings and writes
 * them to disk. It does NOT diagnose, fix, or regress-gate anything — that is
 * a later wave's job once a baseline exists. Siblings:
 *   · scripts/e2e-journey.mjs (`npm run ui:journey`)     — the UI demo/regression harness.
 *   · scripts/verify-cycle.mjs (`npm run verify:cycle`)  — the real-capability gate.
 * perf-snapshot borrows their bridge-identity-probe + FORGE_ROOT conventions
 * but is deliberately read-only: it never starts, stops, or drives a cycle
 * through the bridge, only GETs a handful of existing endpoints/pages.
 *
 * Usage:
 *   forge studio           # start it first — this script NEVER starts/kills it
 *   npm run perf:snapshot -- --label <name>
 *
 * What it measures:
 *   1. API timings — N=3 sequential GETs of /api/runs, /api/studio/kbs,
 *      /api/cycles, /api/studio/projects/attention, /api/studio/catalog, plus
 *      /api/events/<cycle> for whichever _logs/<cycle>/events.jsonl is
 *      largest on disk (the heaviest realistic payload). Each sample records
 *      wall-clock ms (performance.now() around the fetch) + response bytes;
 *      min/median are derived over the 3 samples.
 *   2. Page timings — only if forge-ui answers on :4124 (else skipped with a
 *      note, not a failure): a COLD Playwright context per page (/, /library,
 *      /knowledge, /projects), timing navigation → the first [data-page]
 *      element becoming visible.
 *
 * Output: _wave6/perf/snapshot-<ISO-timestamp>.json (full samples + stats)
 * and a compact markdown table on stdout (name / median ms / bytes).
 *
 * Exit codes: 2 = no forge bridge detected on :4123 (run `forge studio`
 * first); 1 = any other fatal error; 0 = snapshot written.
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright-core';

const FORGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BRIDGE_URL = 'http://127.0.0.1:4123';
const UI_URL = 'http://127.0.0.1:4124';
const API_SAMPLE_COUNT = 3;
const API_PATHS = [
  '/api/runs',
  '/api/studio/kbs',
  '/api/cycles',
  '/api/studio/projects/attention',
  '/api/studio/catalog',
];
const UI_ROUTES = ['/', '/library', '/knowledge', '/projects'];

function log(msg) {
  console.log(`[perf-snapshot] ${msg}`);
}

// =============================================================================
// Pure helpers (unit-tested in scripts/perf-snapshot.test.ts)
// =============================================================================

/** Parse CLI args. Only --label <name> is currently recognised; unknown args
 *  are ignored (forward-compatible, mirrors verify-cycle.mjs's flag()). */
export function parseArgs(argv) {
  const i = argv.indexOf('--label');
  const label = i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  return { label };
}

/** min/median over a list of millisecond samples. Empty input yields nulls
 *  rather than throwing — a defensive default, never expected in practice
 *  (every measured endpoint always contributes API_SAMPLE_COUNT samples). */
export function computeStats(samples) {
  if (!samples || samples.length === 0) return { minMs: null, medianMs: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const minMs = sorted[0];
  const mid = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return { minMs, medianMs };
}

/** Find the largest events.jsonl one level under `logsRoot` (the
 *  `_logs/<cycleId>/events.jsonl` shape) — the heaviest realistic
 *  /api/events/<cycle> payload on disk. Returns null when `logsRoot` doesn't
 *  exist or holds no cycle dir with an events.jsonl. Pure filesystem read,
 *  no process.argv/FORGE_ROOT coupling, so it's fixture-testable via a
 *  mkdtempSync temp dir. */
export function findLargestEventsLog(logsRoot) {
  if (!existsSync(logsRoot)) return null;
  let best = null;
  for (const entry of readdirSync(logsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const eventsPath = join(logsRoot, entry.name, 'events.jsonl');
    if (!existsSync(eventsPath)) continue;
    let bytes;
    try {
      bytes = statSync(eventsPath).size;
    } catch {
      continue; // e.g. a race with a concurrent cleanup — skip, don't crash the snapshot
    }
    if (!best || bytes > best.bytes) {
      best = { cycleId: entry.name, path: eventsPath, bytes };
    }
  }
  return best;
}

/** ISO timestamp with `:`/`.` replaced so it's safe as a filename segment
 *  (mirrors the `2026-05-31T10-57-52` style already used under _logs/). */
export function isoTimestampForFilename(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/** Render a compact `name | median ms | bytes` markdown table. `bytes` is
 *  optional per-row (page timings have none) and renders as `-`. */
export function formatMarkdownTable(rows) {
  const header = '| endpoint/page | median ms | bytes |';
  const divider = '| --- | --- | --- |';
  const lines = rows.map((r) => {
    const median = typeof r.medianMs === 'number' ? r.medianMs.toFixed(2) : '-';
    const bytes = typeof r.bytes === 'number' ? String(r.bytes) : '-';
    return `| ${r.name} | ${median} | ${bytes} |`;
  });
  return [header, divider, ...lines].join('\n');
}

// =============================================================================
// Impure I/O — fetch, playwright, fs writes
// =============================================================================

/** Probe the forge-bridge identity at GET <bridgeUrl>/api/health. Returns
 *  the identity body when a healthy forge bridge answers, else null (port
 *  free, non-2xx, malformed JSON, or a foreign service on the port) — this
 *  script never starts/kills the bridge, only detects it. */
async function probeHealth(bridgeUrl) {
  try {
    const res = await fetch(`${bridgeUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const body = await res.json();
    if (body && typeof body === 'object' && body.service === 'forge-bridge') return body;
    return null;
  } catch {
    return null;
  }
}

/** Whether forge-ui answers at all on <uiUrl> — page timings are skipped
 *  (not failed) when it doesn't. */
async function probeUi(uiUrl) {
  try {
    const res = await fetch(uiUrl, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Time a single GET: wall-clock ms via performance.now() around the fetch
 *  (through to the body being fully read, so it reflects real payload
 *  transfer, not just headers), plus the response's byte length. */
async function timeFetch(url) {
  const t0 = performance.now();
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const buf = await res.arrayBuffer();
  const t1 = performance.now();
  return { ms: t1 - t0, bytes: buf.byteLength, status: res.status, ok: res.ok };
}

/** N=API_SAMPLE_COUNT sequential GETs of one API path; returns the raw
 *  samples plus derived min/median and the last response's byte size. */
async function measureApiEndpoint(bridgeUrl, path, n = API_SAMPLE_COUNT) {
  const samples = [];
  let bytes = null;
  let lastStatus = null;
  for (let i = 0; i < n; i++) {
    const r = await timeFetch(`${bridgeUrl}${path}`);
    samples.push(r.ms);
    bytes = r.bytes;
    lastStatus = r.status;
  }
  const { minMs, medianMs } = computeStats(samples);
  return { name: path, samples, minMs, medianMs, bytes, status: lastStatus };
}

/** One COLD page load: a fresh Playwright context (no shared cache/session
 *  with any other page), navigation → the first visible [data-page]
 *  element. */
async function measurePage(browser, uiUrl, route) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const t0 = performance.now();
    await page.goto(`${uiUrl}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page]', { state: 'visible', timeout: 15000 });
    const t1 = performance.now();
    return { name: `${route} (page)`, medianMs: t1 - t0, bytes: null };
  } finally {
    await ctx.close();
  }
}

async function main() {
  const { label } = parseArgs(process.argv.slice(2));

  const identity = await probeHealth(BRIDGE_URL);
  if (!identity) {
    console.error(
      `[perf-snapshot] no forge bridge detected at ${BRIDGE_URL}/api/health — run \`forge studio\` first, then re-run \`npm run perf:snapshot\`.`,
    );
    process.exit(2);
  }
  log(`bridge OK (pid ${identity.pid}, started ${identity.startedAt})`);

  const logsRoot = join(FORGE_ROOT, '_logs');
  const largestLog = findLargestEventsLog(logsRoot);
  const apiPaths = [...API_PATHS];
  let eventsNote = null;
  if (largestLog) {
    apiPaths.push(`/api/events/${encodeURIComponent(largestLog.cycleId)}`);
    log(`largest events.jsonl: ${largestLog.cycleId} (${largestLog.bytes} bytes)`);
  } else {
    eventsNote = `no _logs/*/events.jsonl found under ${logsRoot} — /api/events/<cycle> skipped`;
    log(eventsNote);
  }

  log(`timing ${apiPaths.length} API endpoint(s), N=${API_SAMPLE_COUNT} each…`);
  const apiResults = [];
  for (const path of apiPaths) {
    apiResults.push(await measureApiEndpoint(BRIDGE_URL, path));
  }

  const uiUp = await probeUi(UI_URL);
  const pageResults = [];
  let pagesNote = null;
  if (uiUp) {
    log(`forge-ui OK on ${UI_URL} — timing ${UI_ROUTES.length} page(s), cold each…`);
    const browser = await chromium.launch();
    try {
      for (const route of UI_ROUTES) {
        pageResults.push(await measurePage(browser, UI_URL, route));
      }
    } finally {
      await browser.close();
    }
  } else {
    pagesNote = `forge-ui did not answer on ${UI_URL} — page timings skipped`;
    log(pagesNote);
  }

  const timestamp = isoTimestampForFilename();
  const snapshot = {
    timestamp: new Date().toISOString(),
    label,
    bridge: { pid: identity.pid, startedAt: identity.startedAt },
    api: apiResults,
    apiNote: eventsNote,
    pages: pageResults,
    pagesNote,
  };

  const outDir = join(FORGE_ROOT, '_wave6', 'perf');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `snapshot-${timestamp}.json`);
  writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  log(`written: ${outPath}`);

  const tableRows = [
    ...apiResults.map((r) => ({ name: r.name, medianMs: r.medianMs, bytes: r.bytes })),
    ...pageResults.map((r) => ({ name: r.name, medianMs: r.medianMs, bytes: r.bytes })),
  ];
  console.log(`\n${formatMarkdownTable(tableRows)}`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(`[perf-snapshot] fatal: ${err?.stack ?? err}`);
    process.exit(1);
  });
}
