#!/usr/bin/env node
// Wave-7 UI crawl: visit every reachable Studio route, record page readiness,
// console errors, failed requests, interactive inventory, screenshot — and
// (W7-A0) ASSERT on the result so it can gate.
//
// Usage: node scripts/ui-walkthrough/crawl.mjs
//          [--max 1000] [--out _walkthrough/explore] [--only <route-prefix>]…
//          [--assert] [--baseline scripts/ui-walkthrough/baseline.json]
//          [--known-optional-404s <file>] [--live-only-routes <file>]
//          [--write-baseline <file>] [--from <crawl.json>] [--boot]
//          [--allow-coverage-drop] [--source <label>]
//
//   --assert          fail (exit 1) on any NEW never-ready page / first-party
//                     >=400 / pageerror / console.error (see assert.mjs);
//                     writes <out>/assert.json alongside crawl.json
//   --baseline <f>    known failures (normalized ids) that do NOT fail the gate;
//                     lanes shrink it, never grow it (check-baseline-shrinks.mjs)
//   --only <prefix>   crawl/assert only routes starting with <prefix> (repeatable)
//   --write-baseline  write the run's full failure set as a baseline file
//   --from <json>     skip the browser; re-assert an existing crawl.json
//   --boot            CI / idle host: spawn `forge studio` (dry-bridge +
//                     no-spawn seams) on the fixed ports, crawl, tear it down.
//                     Refuses if a healthy bridge is already there.
//   --min-routes <n>  harness sanity floor: a crawl that visits fewer routes
//                     than this is a HARNESS failure (exit 2) — no verdict, no
//                     baseline written. Default 40 (1 under --only or --from —
//                     an empty capture is never green). With the health precheck this
//                     stops "the bridge was down so every page rendered its
//                     empty state" from reading green (or from being written
//                     into a baseline).
//   coverage (W7-A0-3) — beyond the absolute floor, a full crawl must visit
//                     >= 90% of the baseline's `expectedRoutes[<env>]` (env =
//                     `ci` when CI is set, else `host`; both are recorded in
//                     baseline.json by --write-baseline in that environment),
//                     and must not leave an unvisited BFS remainder behind
//                     (= it hit --max: raise it; an EXPLICIT --max makes the
//                     truncation by-design and merely reported). Either is a
//                     HARNESS error (exit 2), and assert.json is still written
//                     with `ok:false` + `harnessError` (W7-A0-6).
//   --allow-coverage-drop  the explicit override when the Studio legitimately
//                     has fewer routes than the baseline expects (routes retired)
//   --source <label>  provenance stamp for --write-baseline (default
//                     `<branch>@<sha>` of this checkout; under --from, the
//                     replayed file's path). Only a `main@<sha>` stamp lets a
//                     regenerated baseline GROW past the previous one in
//                     check-baseline-shrinks.mjs (W7-A0-4). --write-baseline
//                     refuses --only (a baseline is the FULL failure set).
//
// Without --boot the crawl targets the ALREADY-RUNNING Studio (bridge :4123,
// UI :4124 — override with FORGE_BRIDGE_URL / FORGE_UI_URL). It never starts,
// stops or takes over a Studio.
import fs from 'node:fs';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { assertCrawl, coverageVerdict, formatReport, parseListFile, toBaseline } from './assert.mjs';
import { attachCapture, readPageInfo } from './capture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
class HarnessError extends Error {}
// Usage/harness errors (including ones thrown while parsing argv below) exit 2:
// distinct from a verdict (0/1), never a silent default.
process.on('uncaughtException', (err) => { console.error(err instanceof HarnessError ? `[walkthrough] HARNESS ERROR: ${err.message}` : err); process.exit(2); });
const flag = (name) => args.includes(name);
// A valued flag must be followed by a real value — `--min-routes --boot` is a
// usage error, never a silent NaN/undefined that disables the check it feeds.
const valueAt = (name, i) => {
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) throw new HarnessError(`${name} needs a value (got ${v ?? 'nothing'})`);
  return v;
};
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? valueAt(name, i) : dflt; };
const optAll = (name) => args.flatMap((a, i) => (a === name ? [valueAt(name, i)] : []));
const optInt = (name, dflt) => {
  const raw = opt(name, null);
  if (raw === null) return dflt;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new HarnessError(`${name} must be a non-negative integer (got ${JSON.stringify(raw)})`);
  return n;
};

const MAX = optInt('--max', 1000);
const MAX_EXPLICIT = args.includes('--max');
const OUT = opt('--out', '_walkthrough/explore');
const ONLY = optAll('--only');
const ASSERT = flag('--assert');
const BOOT = flag('--boot');
const FROM = opt('--from', null);
const BASELINE_FILE = opt('--baseline', null);
const WRITE_BASELINE = opt('--write-baseline', null);
const ALLOW_COVERAGE_DROP = flag('--allow-coverage-drop');
const SOURCE = opt('--source', null);
// Coverage environment: CI's Studio (clean checkout) is a strict subset of the
// operator's host, so each environment records + is judged by its own count.
const COVERAGE_KEY = process.env.CI ? 'ci' : 'host';
// Harness floor default: 40 for a live full crawl; 1 under --only or --from (a
// pillar / a replayed capture can be small — the floor then only guards "saw
// nothing": an empty or truncated crawl.json is never a PASS).
const MIN_ROUTES = optInt('--min-routes', FROM || ONLY.length ? 1 : 40);
if (FROM && BOOT) throw new HarnessError('--from replays an existing crawl.json; it cannot be combined with --boot');
// A baseline is the FULL known-failure set + the full-crawl coverage expectation:
// written from a prefix-scoped crawl it would drop every entry outside the prefix
// (the next full crawl reads them all as NEW) and record a partial route count as
// the floor. Usage error, never a silently partial file.
if (WRITE_BASELINE && ONLY.length) throw new HarnessError('--write-baseline needs a full crawl; it cannot be combined with --only');
const KNOWN_404S_FILE = opt('--known-optional-404s', resolve(HERE, 'known-optional-404s.txt'));
const LIVE_ONLY_FILE = opt('--live-only-routes', resolve(HERE, 'live-only-routes.txt'));

let UI = process.env.FORGE_UI_URL || 'http://localhost:4124';
let BRIDGE = process.env.FORGE_BRIDGE_URL || 'http://localhost:4123';

const readList = (file) => (fs.existsSync(file) ? parseListFile(fs.readFileSync(file, 'utf8')) : []);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

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

const inScope = (route) => ONLY.length === 0 || ONLY.some((p) => route.startsWith(p));

async function requireHealthyBridge(when = 'before the crawl') {
  let body = null;
  try {
    const r = await fetch(`${BRIDGE}/api/health`, { signal: AbortSignal.timeout(3000) });
    body = r.ok ? await r.json() : null;
  } catch { body = null; }
  if (body?.service !== 'forge-bridge') {
    throw new HarnessError(`no healthy forge bridge at ${BRIDGE}/api/health (${when}) — a crawl against a bridge-less UI reads every page as its empty state and would pass for the wrong reason; refusing to gate`);
  }
}

function sourceStamp() {
  if (SOURCE) return SOURCE;
  try {
    const git = (a) => execFileSync('git', a, { cwd: HERE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return `${git(['rev-parse', '--abbrev-ref', 'HEAD'])}@${git(['rev-parse', '--short', 'HEAD'])}`;
  } catch { return 'unknown'; }
}

async function crawl() {
  const { chromium } = await import('playwright-core');
  await requireHealthyBridge();
  fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const results = [];
  const queue = (await seeds()).filter(inScope);
  const visited = new Set();
  let n = 0;
  while (queue.length && n < MAX) {
    const route = queue.shift();
    const key = route.split('#')[0];
    if (visited.has(key)) continue;
    visited.add(key); n++;
    const page = await ctx.newPage();
    // Listeners + canonicalization live in capture.mjs (pinned without a browser).
    const cap = attachCapture(page, { ui: UI, bridge: BRIDGE });
    const { consoleErrors, pageErrors, failed, transportFailed } = cap;
    const t0 = Date.now();
    let status = 'ok', err = null;
    try {
      const resp = await page.goto(UI + route, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (resp && resp.status() >= 400) status = `http-${resp.status()}`;
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
    } catch (e) { status = 'nav-error'; err = String(e).slice(0, 200); }
    // The in-page read is capture.mjs's readPageInfo (root-anchored readiness,
    // W7-A0-5); an evaluate failure is recorded as its own signal (W7-A0-9).
    const info = await page.evaluate(readPageInfo).catch((e) => ({ evalError: String(e).slice(0, 200) }));
    const shot = path.join(OUT, 'shots', route.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'root') + '.png';
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    results.push({ route, status, err, ms: Date.now() - t0, consoleErrors, pageErrors, failed, transportFailed, shot, ...info });
    // W7-A0-2: a first-party request that never got a response — is the bridge
    // still there? A bridge that died mid-crawl is a harness error (exit 2), not
    // N pages of honest error states reading green. If it IS healthy, the
    // transport failure stands and is asserted as its own kind.
    if (cap.hasFirstPartyTransportFailure()) await requireHealthyBridge(`re-probed after a first-party transport failure on ${route}`);
    // BFS internal links
    for (const l of info.links ?? []) {
      if (!l.href || !l.href.startsWith('/') || l.href.startsWith('//')) continue;
      const k = l.href.split('#')[0];
      if (!inScope(k)) continue;
      if (!visited.has(k) && !queue.includes(k)) queue.push(k);
    }
    await page.close();
    process.stderr.write(`[${n}] ${status} ${route} (${Date.now() - t0}ms) btn=${info.buttons?.length ?? '?'} err=${consoleErrors.length}/${pageErrors.length}/${failed.length}/${transportFailed.length}\n`);
  }
  await browser.close();
  // The BFS remainder: discovered, in scope, never visited (only ever non-empty
  // when the crawl hit --max). Deduped and minus anything visited on the way.
  const unvisited = [...new Set(queue.map((r) => r.split('#')[0]))].filter((k) => !visited.has(k));
  return { ui: UI, bridge: BRIDGE, at: new Date().toISOString(), env: COVERAGE_KEY, max: MAX, maxExplicit: MAX_EXPLICIT, visited: results.length, unvisited, results };
}

function writeCrawlOutputs(crawlJson) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'crawl.json'), JSON.stringify(crawlJson, null, 1));
  const lines = crawlJson.results.map(r => `${r.status.padEnd(8)} ready=${String(r.pageReady).padEnd(5)} page=${String(r.dataPage).padEnd(18)} btn=${String(r.buttons?.length ?? 0).padStart(3)} cerr=${r.consoleErrors.length} perr=${r.pageErrors.length} f=${r.failed.length} t=${r.transportFailed?.length ?? 0} ${r.route}${r.evalError ? '  ⚠ evalError: ' + r.evalError : ''}${r.hasErrorText ? '  ⚠ ' + r.hasErrorText : ''}`);
  fs.writeFileSync(path.join(OUT, 'crawl-summary.txt'), lines.join('\n') + `\n\nunvisited(${crawlJson.unvisited.length}): ${crawlJson.unvisited.join(' ')}\n`);
  console.log(lines.join('\n'));
  console.log(`\nvisited ${crawlJson.results.length}, unvisited ${crawlJson.unvisited.length}`);
}

function runAssertion(crawlJson) {
  const baseline = BASELINE_FILE ? readJson(BASELINE_FILE) : null;
  const report = assertCrawl(crawlJson, {
    knownOptional404s: readList(KNOWN_404S_FILE),
    liveOnlyRoutes: readList(LIVE_ONLY_FILE),
    only: ONLY,
    baseline,
  });
  // W7-A0-3: did the crawl see the Studio it was meant to gate? Judged against
  // the baseline being asserted AND (for --write-baseline) the file about to be
  // replaced — a starved or collapsed crawl must never overwrite baseline.json
  // with a handful of entries or a shrunken expectation.
  const key = crawlJson.env ?? 'host';
  const covArgs = { routes: report.routes, unvisited: report.unvisited, key, only: ONLY, minRoutes: MIN_ROUTES, maxExplicit: Boolean(crawlJson.maxExplicit), allowDrop: ALLOW_COVERAGE_DROP };
  const coverage = coverageVerdict({ ...covArgs, baseline });
  let harnessError = coverage.harnessError;
  const previous = WRITE_BASELINE && fs.existsSync(WRITE_BASELINE) ? readJson(WRITE_BASELINE) : null;
  if (!harnessError && previous) harnessError = coverageVerdict({ ...covArgs, baseline: previous }).harnessError;
  fs.mkdirSync(OUT, { recursive: true });
  // W7-A0-6: assert.json is the CI artifact — on a harness error it says so
  // (ok:false + harnessError), never a green report for a starved run.
  fs.writeFileSync(path.join(OUT, 'assert.json'), JSON.stringify({ at: new Date().toISOString(), ui: crawlJson.ui, baseline: BASELINE_FILE, only: ONLY, ...report, ok: harnessError ? false : report.ok, coverage, harnessError }, null, 1));
  if (harnessError) throw new HarnessError(harnessError);
  if (WRITE_BASELINE) {
    // Provenance: `--source` is honoured for a replay too (a CI capture replayed
    // on the host still names where it was measured); without it a replay is
    // stamped with the file it came from, never as `main@…`.
    const source = FROM
      ? (SOURCE ? `${SOURCE} — ${crawlJson.ui} at ${crawlJson.at} (replayed from ${FROM})` : `crawl.json ${FROM}`)
      : `${sourceStamp()} — ${crawlJson.ui} at ${crawlJson.at}`;
    const written = toBaseline(report, { source, coverage: { key, routes: report.routes, unvisited: report.unvisited, source }, previous });
    fs.writeFileSync(WRITE_BASELINE, JSON.stringify(written, null, 1) + '\n');
    console.log(`[walkthrough --assert] baseline written: ${WRITE_BASELINE} (${report.failures.length + report.known.length} entries; expectedRoutes.${key} = ${report.routes})`);
  }
  console.log('\n' + formatReport(report));
  const floorNote = coverage.expected != null ? ` (floor ${coverage.floor} = 90% of ${coverage.expected} expected for ${key})` : ` (no baseline expectation for ${key} — only --min-routes ${MIN_ROUTES} applied)`;
  console.log(`[walkthrough --assert] coverage: ${report.routes} routes${floorNote}${report.unvisited ? ` · ${report.unvisited} unvisited (explicit --max ${crawlJson.max ?? '?'} — partial by design)` : ''}`);
  return report;
}

async function main() {
  let crawlJson;
  if (FROM) {
    crawlJson = readJson(FROM);
    if (!Array.isArray(crawlJson?.results)) throw new HarnessError(`${FROM} is not a crawl.json (no results array)`);
    if (ONLY.length) crawlJson = { ...crawlJson, results: crawlJson.results.filter((r) => inScope(r.route)) };
    fs.mkdirSync(OUT, { recursive: true });
  } else {
    let studio = null;
    if (BOOT) {
      const { bootStudio } = await import('./boot-studio.mjs');
      studio = await bootStudio({ bridgeUrl: BRIDGE, log: (s) => process.stderr.write(s + '\n') });
      UI = studio.uiUrl; BRIDGE = studio.bridgeUrl;
      process.stderr.write(`[walkthrough --boot] ready: ui=${UI} bridge=${BRIDGE}\n`);
    }
    try {
      crawlJson = await crawl();
    } finally {
      if (studio) await studio.stop();
    }
    writeCrawlOutputs(crawlJson);
  }
  if (!ASSERT && !WRITE_BASELINE) return 0;
  const report = runAssertion(crawlJson);
  return report.ok || !ASSERT ? 0 : 1;
}

main().then(
  (code) => {
    // Let stdout drain (the per-route summary can exceed the pipe buffer) and
    // exit naturally; force the exit only if something lingers.
    process.exitCode = code;
    setTimeout(() => process.exit(code), 3000).unref();
  },
  (err) => { console.error(err instanceof HarnessError ? `[walkthrough] HARNESS ERROR: ${err.message}` : err); process.exit(2); },
);
