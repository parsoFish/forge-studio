// W7-A0 — the walkthrough crawl's ASSERTION MODE, as a pure function over a
// crawl.json (the object `crawl.mjs` writes). No I/O here: `crawl.mjs` loads
// the list files + baseline and calls `assertCrawl`; `crawl.test.ts` drives
// the same function over a fixture. Contract:
//
//   assertCrawl(crawl, { knownOptional404s, liveOnlyRoutes, only, baseline })
//     → { ok, routes, failures (NEW), known (baselined), stale (baseline
//         entries nothing matched), allowed (suppressed by the 404 allowlist),
//         counts }
//
// Failure kinds (FAILURE_KINDS):
//   nav-error        — page.goto failed or the document itself answered >=400
//   never-ready      — the `[data-page]` root never set data-page-ready="true"
//                      (or there is no `[data-page]` root at all); a declared
//                      live-only route prefix suppresses this one kind
//   first-party-4xx  — any request >=400 to a first-party URL (the bridge or
//                      the UI host); `known-optional-404s.txt` may suppress a
//                      404 (never another status) whose URL matches a pattern
//   page-error       — an uncaught exception in the page (`pageerror`)
//   console-error    — a console `error` message that is not the browser's own
//                      "Failed to load resource" line (that duplicates the 4xx)
//
// Volatile ids (run/cycle/session/initiative ids) are NORMALIZED before any
// comparison so a baseline survives run churn: `<id>` replaces the id. Both
// the failure and the baseline entry are normalized, so an operator may paste
// raw ids into baseline.json and it still matches.

export const FAILURE_KINDS = Object.freeze(['nav-error', 'never-ready', 'first-party-4xx', 'page-error', 'console-error']);

const ID_CHARS = 'A-Za-z0-9._-';
// A run/cycle/session id always starts with a `YYYY-MM-DDTHH-MM-SS` stamp
// (`2026-08-03T01-16-00_INIT-…`, `2026-08-14T15-17-37-5d6b6e6d`,
// `2026-01-01T00-20-00-r6-06-ledger-sess`) and runs to the end of its
// path/query segment. Initiative ids are `INIT-…`.
const TIMESTAMP_ID_RE = new RegExp(`\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}[${ID_CHARS}]*`, 'g');
const INIT_ID_RE = new RegExp(`INIT-[${ID_CHARS}]+`, 'g');

export function normalizeVolatile(s) {
  return String(s ?? '').replace(TIMESTAMP_ID_RE, '<id>').replace(INIT_ID_RE, 'INIT-<id>');
}

/** `#`-comment + blank-line tolerant list file (one entry per line). */
export function parseListFile(text) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/\s+#.*$/, '').trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** Glob-ish match: `*` = one path segment (no `/`), `**` = anything, all
 *  other characters literal (regex metacharacters escaped). Anchored. */
export function matchesPattern(value, pattern) {
  const re = pattern
    .split('**')
    .map((part) => part.split('*').map((lit) => lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${re}$`).test(value);
}

export function failureKey(f) {
  return `${f.kind}|${f.route}|${f.detail}`;
}

const isFirstParty = (url) => url.startsWith('[bridge]') || (url.startsWith('/') && !url.startsWith('//'));
const stripBridge = (url) => url.replace(/^\[bridge\]/, '');
const RESOURCE_LOAD_RE = /^Failed to load resource:/;
const truncate = (s, n = 200) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

function makeFailure(kind, rawRoute, rawDetail, message) {
  return {
    kind,
    route: normalizeVolatile(rawRoute),
    rawRoute,
    detail: normalizeVolatile(rawDetail),
    rawDetail,
    message,
  };
}

/** Walk every result row and produce the raw failure list (before baseline). */
export function collectFailures(crawl, opts = {}) {
  const knownOptional404s = opts.knownOptional404s ?? [];
  const liveOnlyRoutes = opts.liveOnlyRoutes ?? [];
  const only = opts.only ?? [];
  const results = (crawl?.results ?? []).filter((r) => only.length === 0 || only.some((p) => String(r.route).startsWith(p)));

  const failures = [];
  const allowed = [];
  const seen = new Set();
  const push = (list, f) => {
    const k = failureKey(f);
    if (seen.has(k)) return;
    seen.add(k);
    list.push(f);
  };

  for (const r of results) {
    const route = String(r.route);
    if (r.status !== 'ok') {
      push(failures, makeFailure('nav-error', route, `${r.status}${r.err ? ` ${truncate(r.err, 120)}` : ''}`, `navigation failed (${r.status})`));
    } else if (r.pageReady !== 'true') {
      const detail = `data-page=${r.dataPage ?? '(none)'} data-page-ready=${r.pageReady ?? 'null'}`;
      const liveOnly = liveOnlyRoutes.some((p) => route.startsWith(p));
      if (!liveOnly) push(failures, makeFailure('never-ready', route, detail, r.dataPage ? 'page never set data-page-ready="true"' : 'no [data-page] root rendered'));
    }

    for (const req of r.failed ?? []) {
      const url = String(req.url ?? '');
      if (!isFirstParty(url) || !(req.status >= 400)) continue;
      const f = makeFailure('first-party-4xx', route, `${req.status} ${url}`, `first-party request answered ${req.status}`);
      const optional = req.status === 404 && knownOptional404s.some((p) => matchesPattern(stripBridge(url), p));
      push(optional ? allowed : failures, f);
    }

    for (const e of r.pageErrors ?? []) {
      const text = typeof e === 'string' ? e : (e?.text ?? JSON.stringify(e));
      push(failures, makeFailure('page-error', route, truncate(text), 'uncaught exception in page'));
    }

    for (const c of r.consoleErrors ?? []) {
      if (c?.type !== 'error') continue;
      const text = String(c.text ?? '');
      if (RESOURCE_LOAD_RE.test(text)) continue; // duplicates the first-party-4xx class
      push(failures, makeFailure('console-error', route, truncate(text), 'console.error in page'));
    }
  }

  return { failures, allowed, routes: results.length };
}

function baselineKeys(baseline) {
  const map = new Map();
  for (const e of baseline?.entries ?? []) {
    const norm = { kind: e.kind, route: normalizeVolatile(e.route), detail: normalizeVolatile(e.detail) };
    map.set(failureKey(norm), norm);
  }
  return map;
}

/** The gate: NEW failures (not in the baseline) fail it. */
export function assertCrawl(crawl, opts = {}) {
  const { failures: all, allowed, routes } = collectFailures(crawl, opts);
  const known = [];
  const fresh = [];
  const matched = new Set();
  const bl = baselineKeys(opts.baseline);
  for (const f of all) {
    const k = failureKey(f);
    if (bl.has(k)) { known.push(f); matched.add(k); } else fresh.push(f);
  }
  const stale = [...bl.entries()].filter(([k]) => !matched.has(k)).map(([, e]) => e);
  const byKind = Object.fromEntries(FAILURE_KINDS.map((k) => [k, fresh.filter((f) => f.kind === k).length]));
  return {
    ok: fresh.length === 0,
    routes,
    failures: fresh,
    known,
    stale,
    allowed,
    counts: { new: fresh.length, known: known.length, stale: stale.length, allowed: allowed.length, byKind },
  };
}

/** Baseline file shape from a report: every failing key (new + known),
 *  normalized, sorted, unique — never the allowlisted ones. */
export function toBaseline(report, meta = {}) {
  const entries = [...report.failures, ...report.known]
    .map((f) => ({ kind: f.kind, route: f.route, detail: f.detail, message: f.message }));
  const uniq = new Map(entries.map((e) => [failureKey(e), e]));
  return {
    _comment: 'W7-A0 walkthrough baseline: the failures KNOWN on main when this file was generated. '
      + 'Lanes must SHRINK this file (delete the entries their PR fixes) and NEVER grow it — '
      + 'a new failing route/request/error fails `npm run ui:walkthrough -- --assert`, and '
      + 'scripts/ui-walkthrough/check-baseline-shrinks.mjs fails CI if a PR adds an entry. '
      + 'Regenerate only from main with `--write-baseline` (ids are normalized to <id>).',
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    source: meta.source ?? 'unknown',
    // Code-unit order (not localeCompare): deterministic across hosts/locales.
    entries: [...uniq.values()].sort((a, b) => (failureKey(a) < failureKey(b) ? -1 : failureKey(a) > failureKey(b) ? 1 : 0)),
  };
}

/** Only-shrinks check: keys in `next` that were not in `prev` are growth.
 *  A missing `prev` (first introduction of the file) is never growth. */
export function baselineGrowth(prev, next) {
  const p = baselineKeys(prev);
  const n = baselineKeys(next);
  if (!prev) return { grew: [], shrank: [] };
  return {
    grew: [...n.entries()].filter(([k]) => !p.has(k)).map(([, e]) => e),
    shrank: [...p.entries()].filter(([k]) => !n.has(k)).map(([, e]) => e),
  };
}

export function formatReport(report) {
  const lines = [];
  const verdict = report.ok ? 'PASS' : 'FAIL';
  lines.push(`[walkthrough --assert] ${verdict}: ${report.routes} routes · ${report.counts.new} new failure(s) · ${report.counts.known} known (baseline) · ${report.counts.stale} stale baseline entr${report.counts.stale === 1 ? 'y' : 'ies'} · ${report.counts.allowed} allowed optional 404(s)`);
  if (report.failures.length) {
    lines.push('NEW failures (not in baseline):');
    for (const f of report.failures) lines.push(`  ${f.kind.padEnd(16)} ${f.rawRoute}  →  ${f.rawDetail}`);
  }
  if (report.stale.length) {
    lines.push('Stale baseline entries (no longer failing — remove them from baseline.json):');
    for (const e of report.stale) lines.push(`  ${e.kind.padEnd(16)} ${e.route}  →  ${e.detail}`);
  }
  return lines.join('\n');
}
