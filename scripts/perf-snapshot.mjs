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
 *      wall-clock ms (performance.now() around the fetch) + response bytes +
 *      HTTP status; non-2xx/thrown samples are EXCLUDED from min/median (a
 *      500 isn't a latency data point) and counted in that endpoint's
 *      `errors` field so a failing endpoint reads as failing, not fast.
 *   2. Page timings — only if forge-ui answers on :4124 (else skipped with a
 *      note, not a failure): a COLD Playwright context per page (/, /library,
 *      /knowledge, /projects). Two timestamps per page, per the repo's own
 *      data-* harness convention (docs/forge-ui-dom-and-harness.md,
 *      scripts/e2e-journey.mjs's `data-page-ready="true"` readySel): `mountMs`
 *      (navigation → the first [data-page] element visible — DOM mount, not
 *      load) and `readyMs` (navigation → [data-page-ready="true"] — the
 *      page's first fetch actually settling, forge-ui's definition of
 *      "loaded"). A page whose readiness attribute never appears keeps its
 *      mountMs and records a `readyError` instead of losing the whole row.
 *
 * A single failing sample/page/endpoint never discards results already
 * collected elsewhere — the JSON is always written with whatever succeeded,
 * partial rows included.
 *
 * Output: _wave6/perf/snapshot-<ISO-timestamp>.json (full samples + stats)
 * and a compact markdown table on stdout (name / median ms / bytes; API rows
 * use readyMs for pages, the "loaded" number that's comparable across runs).
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

// Named per-purpose (not one shared constant): each guards a different kind
// of wait with a different expected shape, so a future tune of one must not
// silently drag the others with it.
/** GET /api/health probe — short: a healthy bridge answers near-instantly,
 *  and this only detects PRESENCE, so a slow value here should read as
 *  "absent", not "still warming up". */
const HEALTH_PROBE_TIMEOUT_MS = 2000;
/** GET / probe on the UI port — longer than the health probe because
 *  forge-ui may still be mid dev-compile moments after `forge studio`
 *  starts; this only gates whether page timings run at all. */
const UI_PROBE_TIMEOUT_MS = 3000;
/** Per-sample API fetch bound — generous because some endpoints (notably
 *  /api/events/<cycle> for a large events.jsonl) legitimately do real work;
 *  this is a hang guard, not a performance assertion. */
const API_FETCH_TIMEOUT_MS = 15000;
/** Time to the first [data-page] element mounting — should be fast, it's
 *  just the initial React render before any data has loaded. */
const PAGE_MOUNT_TIMEOUT_MS = 15000;
/** Time to [data-page-ready="true"] — the page's first fetch settling.
 *  Kept generous (equal to the API bound) since it includes a bridge
 *  round-trip on top of the mount. */
const PAGE_READY_TIMEOUT_MS = 15000;

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
  let entries;
  try {
    entries = readdirSync(logsRoot, { withFileTypes: true });
  } catch {
    return null; // e.g. ENOTDIR (logsRoot exists but isn't a directory) — skip, don't crash the snapshot
  }
  let best = null;
  for (const entry of entries) {
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
    const res = await fetch(`${bridgeUrl}/api/health`, { signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS) });
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
    const res = await fetch(uiUrl, { signal: AbortSignal.timeout(UI_PROBE_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Time a single GET: wall-clock ms via performance.now() around the fetch
 *  (through to the body being fully read, so it reflects real payload
 *  transfer, not just headers), plus the response's byte length + status.
 *  `fetchImpl` is injectable (mirrors apps/forge/forge-watch.ts's
 *  probeBridgeIdentity) so tests can stub non-2xx/rejecting responses
 *  without a live server. Never throws on an HTTP error — a non-2xx is a
 *  valid sample (ok:false); it only throws on a network-level failure
 *  (rejects, abort-timeout), which the caller is responsible for catching. */
export async function timeFetch(url, fetchImpl = fetch) {
  const t0 = performance.now();
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(API_FETCH_TIMEOUT_MS) });
  const buf = await res.arrayBuffer();
  const t1 = performance.now();
  return { ms: t1 - t0, bytes: buf.byteLength, status: res.status, ok: res.ok };
}

/** N=API_SAMPLE_COUNT sequential GETs of one API path. A non-2xx response OR
 *  a thrown fetch (network failure, abort-timeout) both count as an error
 *  sample — recorded (status/error visible in the JSON) but EXCLUDED from
 *  min/median, so one flaky/erroring sample can't masquerade as a fast
 *  latency reading. `errors` surfaces the count; `bytes` is the last
 *  successful response's size (or the last error response's, if every
 *  sample failed — still a useful diagnostic). Never throws: a per-sample
 *  failure is recorded, not propagated, so one bad sample can't cost the
 *  other (n-1) already-collected ones. */
export async function measureApiEndpoint(bridgeUrl, path, n = API_SAMPLE_COUNT, fetchImpl = fetch) {
  const all = [];
  for (let i = 0; i < n; i++) {
    try {
      all.push(await timeFetch(`${bridgeUrl}${path}`, fetchImpl));
    } catch (err) {
      all.push({ ms: null, bytes: null, status: null, ok: false, error: String(err?.message ?? err) });
    }
  }
  const ok = all.filter((s) => s.ok && typeof s.ms === 'number');
  const errors = all.length - ok.length;
  const { minMs, medianMs } = computeStats(ok.map((s) => s.ms));
  const last = ok.at(-1) ?? all.at(-1) ?? null;
  return {
    name: path,
    samples: all.map((s) => s.ms),
    statuses: all.map((s) => s.status),
    minMs,
    medianMs,
    bytes: last?.bytes ?? null,
    errors,
  };
}

/** One COLD page load: a fresh Playwright context (no shared cache/session
 *  with any other page). Two timestamps, matching the repo's own DOM-as-
 *  metrics harness convention (scripts/e2e-journey.mjs's `readySel =
 *  '[data-page-ready="true"]'`, docs/forge-ui-dom-and-harness.md): `mountMs`
 *  (navigation → the first visible [data-page] — DOM mount, NOT load) and
 *  `readyMs` (navigation → [data-page-ready="true"] — the page's first fetch
 *  actually settling). If the readiness attribute never appears (a route
 *  that doesn't set it, or a slow bridge round-trip past the timeout),
 *  mountMs is still returned — readyMs is null with a readyError, not a lost
 *  row. */
async function measurePage(browser, uiUrl, route) {
  const ctx = await browser.newContext();
  try {
    const page = await ctx.newPage();
    const t0 = performance.now();
    await page.goto(`${uiUrl}${route}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page]', { state: 'visible', timeout: PAGE_MOUNT_TIMEOUT_MS });
    const mountMs = performance.now() - t0;

    let readyMs = null;
    let readyError = null;
    try {
      await page.waitForSelector('[data-page-ready="true"]', { state: 'visible', timeout: PAGE_READY_TIMEOUT_MS });
      readyMs = performance.now() - t0;
    } catch (err) {
      readyError = `[data-page-ready="true"] not observed within ${PAGE_READY_TIMEOUT_MS}ms: ${err?.message ?? err}`;
    }

    return { name: `${route} (page)`, mountMs, readyMs, readyError, bytes: null };
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
    // measureApiEndpoint already swallows per-sample failures; this catch is
    // a second line of defense (e.g. computeStats/URL-construction blowing
    // up) so one endpoint can never cost the others' already-collected rows.
    try {
      const result = await measureApiEndpoint(BRIDGE_URL, path);
      if (result.errors > 0) log(`${path}: ${result.errors}/${API_SAMPLE_COUNT} sample(s) were non-2xx or failed — excluded from min/median`);
      apiResults.push(result);
    } catch (err) {
      log(`API timing failed for ${path}: ${err?.message ?? err}`);
      apiResults.push({ name: path, samples: [], statuses: [], minMs: null, medianMs: null, bytes: null, errors: API_SAMPLE_COUNT, fatalError: String(err?.message ?? err) });
    }
  }

  const uiUp = await probeUi(UI_URL);
  const pageResults = [];
  let pagesNote = null;
  if (uiUp) {
    log(`forge-ui OK on ${UI_URL} — timing ${UI_ROUTES.length} page(s), cold each…`);
    let browser = null;
    try {
      browser = await chromium.launch();
      for (const route of UI_ROUTES) {
        // One page's goto()/mount failure must not discard the other pages'
        // results (or the API results already collected above) — record an
        // error row for that page and keep going.
        try {
          pageResults.push(await measurePage(browser, UI_URL, route));
        } catch (err) {
          log(`page timing failed for ${route}: ${err?.message ?? err}`);
          pageResults.push({ name: `${route} (page)`, mountMs: null, readyMs: null, bytes: null, error: String(err?.message ?? err) });
        }
      }
    } catch (err) {
      // e.g. chromium.launch() itself failing — page timings are lost, but
      // the API results collected above are not.
      pagesNote = `page timings aborted: ${err?.message ?? err}`;
      log(pagesNote);
    } finally {
      if (browser) await browser.close();
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
    // The table's "median ms" column shows readyMs for pages (the "loaded"
    // number, comparable across runs); mountMs is still in the JSON. Falls
    // back to mountMs only when readyMs never arrived (readyError set).
    ...pageResults.map((r) => ({ name: r.name, medianMs: r.readyMs ?? r.mountMs ?? null, bytes: r.bytes ?? null })),
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
