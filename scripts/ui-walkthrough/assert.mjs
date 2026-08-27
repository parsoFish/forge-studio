// W7-A0 — the walkthrough crawl's ASSERTION MODE, as a pure function over a
// crawl.json (the object `crawl.mjs` writes). No I/O here: `crawl.mjs` loads
// the list files + baseline and calls `assertCrawl`; `crawl.test.ts` drives
// the same function over a fixture. Contract:
//
//   assertCrawl(crawl, { knownOptional404s, liveOnlyRoutes, only, baseline })
//     → { ok, routes, unvisited, failures (NEW), known (baselined), stale
//         (baseline entries nothing matched), allowed (suppressed by the 404
//         allowlist), counts }
//
// Failure kinds (FAILURE_KINDS):
//   nav-error         — page.goto failed or the document itself answered >=400
//   never-ready       — the `[data-page]` root never set data-page-ready="true"
//                       (or there is no `[data-page]` root at all); a declared
//                       live-only route prefix suppresses this one kind
//   eval-error        — the harness could not read the page at all
//                       (page.evaluate threw — context destroyed, page crashed);
//                       W7-A0-9: its own kind, never misfiled as never-ready
//   first-party-4xx   — any request >=400 to a first-party URL (the bridge or
//                       the UI host); `known-optional-404s.txt` may suppress a
//                       404 (never another status) whose URL matches a pattern
//   transport-failure — a first-party request that never got a response at all
//                       (`requestfailed`: net::ERR_CONNECTION_REFUSED / EMPTY_
//                       RESPONSE / …); W7-A0-2 — a bridge that dies mid-crawl
//                       used to leave no trace. Client aborts (net::ERR_ABORTED:
//                       navigation, AbortController) are recorded but not failures
//   page-error        — an uncaught exception in the page (`pageerror`)
//   console-error     — a console `error` message; the browser's own "Failed to
//                       load resource" line is dropped ONLY when a recorded
//                       request on the same row explains it (a 4xx with that
//                       status / a transport failure with that net:: error) —
//                       an unexplained one surfaces (W7-A0-2)
//
// Volatile ids (run/cycle/session/initiative ids) are NORMALIZED before any
// comparison so a baseline survives run churn: `<id>` replaces the id. Both
// the failure and the baseline entry are normalized, so an operator may paste
// raw ids into baseline.json and it still matches.
//
// Coverage (W7-A0-3): the verdict is only as good as what the crawl SAW, so a
// baseline also records `expectedRoutes[<env>]` (env = `ci` under CI, else
// `host`) and `coverageVerdict` turns a crawl that visited fewer than 90% of
// that (or left an unvisited BFS remainder behind because it hit --max) into a
// HARNESS error — no verdict, no baseline written.

export const FAILURE_KINDS = Object.freeze(['nav-error', 'never-ready', 'eval-error', 'first-party-4xx', 'transport-failure', 'page-error', 'console-error']);
export const COVERAGE_TOLERANCE = 0.9;
/** Coverage environment keys — the CI Studio (clean checkout, mdtoc only) is a
 *  strict subset of the operator's host, so each records its own expectation. */
export const COVERAGE_KEYS = Object.freeze(['ci', 'host']);

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

// First-party = the bridge or the UI host. Two layers (W7-A0-1):
//   1. ORIGIN: a URL whose scheme+host+port equals crawl.bridge / crawl.ui is
//      canonicalized to `[bridge]<path>` / `<path>` whatever the host is — a
//      LAN ip or container name in FORGE_UI_URL/FORGE_BRIDGE_URL is first-party
//      too (the loopback-only heuristic silently dropped every such 4xx → PASS).
//   2. LOOPBACK-PORT alias fallback: the browser may reach the bridge as
//      `localhost` while the harness knows it as `127.0.0.1` (the first CI run
//      of the gate did exactly that, and a prefix-only check dropped every
//      bridge 4xx → 0 known / 52 stale / PASS), so a loopback URL on the bridge
//      port → `[bridge]<path>`, on the UI port → `<path>`; a loopback URL on
//      some other port stays as-is but is still first-party.
// isFirstParty is DERIVED from the canonical form so the two cannot diverge.
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0']);
const parseHttpUrl = (s) => {
  try {
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch { return null; }
};
function loopbackPort(url) {
  const u = parseHttpUrl(url);
  if (!u || !LOOPBACK_HOSTS.has(u.hostname)) return null;
  return u.port || (u.protocol === 'https:' ? '443' : '80');
}
const originOf = (base) => (base ? parseHttpUrl(base)?.origin ?? null : null);
const portOf = (base) => (base ? loopbackPort(base) : null);
const isRelative = (s) => s.startsWith('/') && !s.startsWith('//');
export function canonicalUrl(url, crawl) {
  const s = String(url ?? '');
  if (s.startsWith('[bridge]') || isRelative(s)) return s;
  const u = parseHttpUrl(s);
  if (!u) return s;
  const bridgeOrigin = originOf(crawl?.bridge);
  const uiOrigin = originOf(crawl?.ui);
  if (bridgeOrigin && u.origin === bridgeOrigin) return `[bridge]${u.pathname}${u.search}`;
  if (uiOrigin && u.origin === uiOrigin) return `${u.pathname}${u.search}`;
  const port = loopbackPort(s);
  if (port == null) return s;
  const bridgePort = portOf(crawl?.bridge);
  const uiPort = portOf(crawl?.ui);
  if (bridgePort && port === bridgePort) return `[bridge]${u.pathname}${u.search}`;
  if (uiPort && port === uiPort) return `${u.pathname}${u.search}`;
  return s;
}
/** Over a CANONICAL url (see canonicalUrl). */
export const isFirstPartyUrl = (url) => url.startsWith('[bridge]') || isRelative(url) || loopbackPort(url) != null;
// Allowlist patterns match the PATH only (bridge prefix + query string stripped).
const allowlistPath = (url) => url.replace(/^\[bridge\]/, '').replace(/[?#].*$/, '');
const RESOURCE_LOAD_RE = /^Failed to load resource:/;
const RESOURCE_STATUS_RE = /status of (\d{3})\b/;
const RESOURCE_NET_RE = /(net::ERR_[A-Z0-9_]+)/;
/** A client-side cancellation, not a transport failure of the server. */
export const CLIENT_ABORT_ERROR = 'net::ERR_ABORTED';
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

/** The browser's own "Failed to load resource" line duplicates a request the
 *  crawl recorded on the same row — IF one is there. */
function explainedByRecordedRequest(text, r) {
  if (!RESOURCE_LOAD_RE.test(text)) return false;
  const status = RESOURCE_STATUS_RE.exec(text)?.[1];
  if (status) return (r.failed ?? []).some((f) => String(f.status) === status);
  const net = RESOURCE_NET_RE.exec(text)?.[1];
  if (net) return (r.transportFailed ?? []).some((t) => t.error === net);
  return false;
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
    } else if (r.evalError) {
      push(failures, makeFailure('eval-error', route, truncate(r.evalError), 'harness could not read the page (page.evaluate failed)'));
    } else if (r.pageReady !== 'true') {
      const detail = `data-page=${r.dataPage ?? '(none)'} data-page-ready=${r.pageReady ?? 'null'}`;
      const liveOnly = liveOnlyRoutes.some((p) => route.startsWith(p));
      if (!liveOnly) push(failures, makeFailure('never-ready', route, detail, r.dataPage ? 'page never set data-page-ready="true"' : 'no [data-page] root rendered'));
    }

    for (const req of r.failed ?? []) {
      const url = canonicalUrl(req.url, crawl);
      if (!isFirstPartyUrl(url) || !(req.status >= 400)) continue;
      // The main document's own >=400 is already the row's nav-error — don't
      // double-count it as a first-party-4xx (two keys for one defect).
      if (r.status !== 'ok' && url === route) continue;
      const f = makeFailure('first-party-4xx', route, `${req.status} ${url}`, `first-party request answered ${req.status}`);
      const optional = req.status === 404 && knownOptional404s.some((p) => matchesPattern(allowlistPath(url), p));
      push(optional ? allowed : failures, f);
    }

    for (const t of r.transportFailed ?? []) {
      const url = canonicalUrl(t.url, crawl);
      const error = String(t.error ?? 'unknown');
      if (!isFirstPartyUrl(url) || error === CLIENT_ABORT_ERROR) continue;
      // The main document's own transport failure is already the row's
      // nav-error (same rule as the 4xx branch — one key per defect).
      if (r.status !== 'ok' && url === route) continue;
      push(failures, makeFailure('transport-failure', route, `${error} ${url}`, `first-party request got no response (${error})`));
    }

    for (const e of r.pageErrors ?? []) {
      const text = typeof e === 'string' ? e : (e?.text ?? JSON.stringify(e));
      push(failures, makeFailure('page-error', route, truncate(text), 'uncaught exception in page'));
    }

    for (const c of r.consoleErrors ?? []) {
      if (c?.type !== 'error') continue;
      const text = String(c.text ?? '');
      if (explainedByRecordedRequest(text, r)) continue; // duplicates the 4xx / transport-failure class
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
  // Stale = baseline entries nothing matched. Under `only`, judge staleness
  // only inside the crawled prefixes — entries outside them were never tested.
  const only = opts.only ?? [];
  const inScope = (e) => only.length === 0 || only.some((p) => e.route.startsWith(p) || e.route.startsWith(normalizeVolatile(p)));
  const stale = [...bl.entries()].filter(([k, e]) => !matched.has(k) && inScope(e)).map(([, e]) => e);
  const byKind = Object.fromEntries(FAILURE_KINDS.map((k) => [k, fresh.filter((f) => f.kind === k).length]));
  return {
    ok: fresh.length === 0,
    routes,
    unvisited: Array.isArray(crawl?.unvisited) ? crawl.unvisited.length : 0,
    failures: fresh,
    known,
    stale,
    allowed,
    counts: { new: fresh.length, known: known.length, stale: stale.length, allowed: allowed.length, byKind },
  };
}

/**
 * W7-A0-3 — did the crawl SEE the Studio it was meant to gate? Pure; returns
 * `{ harnessError, expected, floor, unvisited, key }`. Order: the absolute
 * `--min-routes` floor first, then an unvisited remainder (the crawl hit --max —
 * a harness error unless the operator passed --max explicitly, in which case the
 * truncation is by design and merely reported), then the baseline's per-
 * environment expectation (routes >= 90% of `expectedRoutes[key]`; a baseline
 * WITHOUT one for this environment fails closed on the ASSERT path; on the WRITE
 * path (`writing`: --write-baseline judging the file it is about to replace) an
 * absent key is the environment's first introduction — recorded, not refused —
 * while an existing key still floors the regeneration; `--only` skips it — a
 * subset by design; `allowDrop` is the explicit override for a legitimately
 * smaller Studio, e.g. a regeneration after routes were retired).
 */
export function coverageVerdict({ routes, unvisited, key, baseline, only, minRoutes, maxExplicit, allowDrop, writing = false }) {
  const onlyMode = Array.isArray(only) && only.length > 0;
  const expected = !onlyMode && baseline ? baseline.expectedRoutes?.[key] : null;
  const floor = Number.isInteger(expected) ? Math.ceil(expected * COVERAGE_TOLERANCE) : null;
  const out = { harnessError: null, expected: Number.isInteger(expected) ? expected : null, floor, unvisited: unvisited ?? 0, key };
  if (routes < minRoutes) {
    out.harnessError = `only ${routes} route(s) crawled (< --min-routes ${minRoutes}) — the crawl did not see the Studio it was meant to gate (bridge seeds empty? --only too narrow?); refusing to report a verdict or write a baseline`;
    return out;
  }
  if ((unvisited ?? 0) > 0 && !maxExplicit) {
    out.harnessError = `crawl truncated: ${unvisited} discovered route(s) were never visited because the crawl hit its --max cap — coverage is incomplete, so no verdict; raise --max (or pass it explicitly to accept a partial crawl by design)`;
    return out;
  }
  if (onlyMode || !baseline || allowDrop) return out;
  if (!Number.isInteger(expected)) {
    if (writing) return out; // first introduction of this environment's expectation
    out.harnessError = `baseline has no expectedRoutes.${key} — a full crawl cannot be judged without knowing how many routes it should have seen; regenerate the baseline (--write-baseline) in this environment`;
    return out;
  }
  if (routes < floor) {
    out.harnessError = `coverage collapsed: ${routes} route(s) crawled < ${floor} (90% of the ${expected} recorded for ${key} in the baseline) — a Studio that lost that many reachable routes is a regression, not a green gate; --allow-coverage-drop only if the shrink is intended`;
  }
  return out;
}

/** Baseline file shape from a report: every failing key (new + known),
 *  normalized, sorted, unique — never the allowlisted ones. `meta.coverage`
 *  = `{ key, routes, unvisited, source? }` records this environment's route
 *  expectation; `meta.previous` (the file being replaced) carries the OTHER
 *  environments' expectations forward AND — given `meta.crawledRoutes` (the
 *  routes this crawl visited) — its entries on routes the crawl did NOT visit:
 *  a regeneration proves only what it saw (the same rule as `unprovenShrinks`),
 *  so a CI-environment regeneration (a strict subset of the host) cannot
 *  silently discard host-only known defects. Entries on visited routes are
 *  the crawl's to keep or drop. */
export function toBaseline(report, meta = {}) {
  const entries = [...report.failures, ...report.known]
    .map((f) => ({ kind: f.kind, route: f.route, detail: f.detail, message: f.message }));
  if (meta.previous && Array.isArray(meta.crawledRoutes)) {
    const carried = unprovenShrinks(meta.previous.entries ?? [], meta.crawledRoutes)
      .map((e) => ({ kind: e.kind, route: normalizeVolatile(e.route), detail: normalizeVolatile(e.detail), message: e.message }));
    entries.push(...carried);
  }
  const uniq = new Map(entries.map((e) => [failureKey(e), e]));
  const expectedRoutes = { ...(meta.previous?.expectedRoutes ?? {}) };
  const expectedRoutesSource = { ...(meta.previous?.expectedRoutesSource ?? {}) };
  if (meta.coverage?.key) {
    expectedRoutes[meta.coverage.key] = meta.coverage.routes;
    expectedRoutesSource[meta.coverage.key] = `${meta.coverage.source ?? meta.source ?? 'unknown'} (${meta.coverage.routes} routes, ${meta.coverage.unvisited ?? 0} unvisited)`;
  }
  return {
    _comment: 'W7-A0 walkthrough baseline: the failures KNOWN on main when this file was generated. '
      + 'Lanes must SHRINK this file (delete the entries their PR fixes) and NEVER grow it — '
      + 'a new failing route/request/error fails `npm run ui:walkthrough -- --assert`, and '
      + 'scripts/ui-walkthrough/check-baseline-shrinks.mjs fails CI if a PR adds an entry '
      + '(growth is accepted only through a stamped `main@<sha>` regeneration: new sha, newer generatedAt, '
      + 'expectedRoutes recorded, AND the sha verified for real — resolves to a commit and is an ancestor '
      + 'of the comparison base; an unresolvable or non-ancestor sha is refused, growth and all). '
      + 'expectedRoutes[ci|host] is the coverage floor: a full crawl in that environment must visit >= 90% of it. '
      + 'Regenerate only from main with `--write-baseline` (ids are normalized to <id>).',
    generatedAt: meta.generatedAt ?? new Date().toISOString(),
    source: meta.source ?? 'unknown',
    expectedRoutes,
    expectedRoutesSource,
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

const SOURCE_STAMP_RE = /^main@([0-9a-f]{7,40})\b/;
/**
 * W7-A0-4 / W8-F5 — the ONE way a baseline may grow: a stamped regeneration
 * from main (`source: "main@<sha> …"` with a NEW sha, a NEWER generatedAt,
 * and a non-empty expectedRoutes recorded — i.e. it came out of
 * `--write-baseline`, not a hand edit).
 *
 * This function alone answers the SHAPE question only: does `next.source`
 * look like a well-formed regeneration stamp, is its sha new versus `prev`,
 * is `generatedAt` newer, is `expectedRoutes` recorded? A sha-shaped string
 * that never resolves to any git object satisfies all of that (W8-F5 —
 * confirmed exploitable: a two-field hand edit forged growth at exit 0).
 *
 * The THIRD argument is where real verification is injected: pass
 * `{ verifyStamp(sha) => boolean }` and it is consulted (with the extracted
 * sha) after every shape check passes — a `false` return makes the whole
 * call return `false`, exactly as if the stamp shape had failed. With no
 * `verifyStamp`, this function still only answers the shape question — it is
 * the CALLER's job to supply a verifier that actually resolves the sha as a
 * git object and confirms it is an ancestor of the comparison base.
 * `check-baseline-shrinks.mjs` is that caller: it resolves the sha
 * (`git cat-file -e <sha>^{commit}`) and checks ancestry
 * (`git merge-base --is-ancestor <sha> <base>`) for real, and refuses
 * (fail-closed) a stamp that does not verify.
 */
export function isRegeneration(prev, next, opts = {}) {
  if (!prev || !next) return false;
  const stamp = SOURCE_STAMP_RE.exec(String(next.source ?? ''));
  if (!stamp) return false;
  const prevStamp = SOURCE_STAMP_RE.exec(String(prev.source ?? ''));
  if (prevStamp && prevStamp[1] === stamp[1]) return false;
  if (!next.expectedRoutes || typeof next.expectedRoutes !== 'object' || Object.keys(next.expectedRoutes).length === 0) return false;
  const nextAt = Date.parse(next.generatedAt ?? '');
  if (Number.isNaN(nextAt)) return false;
  const prevAt = Date.parse(prev.generatedAt ?? '');
  if (!(Number.isNaN(prevAt) || nextAt > prevAt)) return false;
  if (typeof opts.verifyStamp === 'function' && !opts.verifyStamp(stamp[1])) return false;
  return true;
}

/** W7-A0-4 — removed baseline entries whose (normalized) route the crawl never
 *  visited: the crawl gate could not have contradicted the removal, so it is
 *  unproven in this environment. */
export function unprovenShrinks(shrank, crawledRoutes) {
  const seen = new Set((crawledRoutes ?? []).map((r) => normalizeVolatile(r)));
  return (shrank ?? []).filter((e) => !seen.has(normalizeVolatile(e.route)));
}

export function formatReport(report) {
  const lines = [];
  const verdict = report.ok ? 'PASS' : 'FAIL';
  lines.push(`[walkthrough --assert] ${verdict}: ${report.routes} routes · ${report.unvisited ?? 0} unvisited · ${report.counts.new} new failure(s) · ${report.counts.known} known (baseline) · ${report.counts.stale} stale baseline entr${report.counts.stale === 1 ? 'y' : 'ies'} · ${report.counts.allowed} allowed optional 404(s)`);
  if (report.failures.length) {
    lines.push('NEW failures (not in baseline):');
    for (const f of report.failures) lines.push(`  ${f.kind.padEnd(17)} ${f.rawRoute}  →  ${f.rawDetail}`);
  }
  if (report.stale.length) {
    lines.push('Stale baseline entries (no longer failing — remove them from baseline.json):');
    for (const e of report.stale) lines.push(`  ${e.kind.padEnd(17)} ${e.route}  →  ${e.detail}`);
  }
  return lines.join('\n');
}
