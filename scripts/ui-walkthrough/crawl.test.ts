/**
 * crawl.test.ts — W7-A0 acceptance contract for the UI-walkthrough
 * assertion mode (`npm run ui:walkthrough -- --assert`).
 *
 * Immutable-gate, RED-first: pinned before `assert.mjs` existed. The
 * assertion logic is a PURE FUNCTION over a crawl.json — the fixture at
 * `fixtures/crawl.sample.json` is a trimmed slice of the real wave-7 baseline
 * crawl of main (2026-08-18, 160 routes) with the failure fields kept
 * verbatim, so every "this must be reported" case below is a defect the
 * walkthrough register actually carries (flows-07 review-findings.json 404s,
 * home-sessions-17 never-ready flow-run pages, agents-01 `/api/events/`,
 * crosscut-12 gitpulse contract-stages 409, projects-04 `/projects/new`
 * preflight 404, home-sessions-11 `_demo-<sid>` events 404, the trafficGame
 * 400s of the A4 identity cluster).
 *
 * Which wrong implementations each group kills:
 *   - a gate that only counts `pageErrors` (never-ready pages and 4xx would
 *     pass) — groups 1, 2;
 *   - a gate that allowlists by substring (a `demo.json` pattern would also
 *     swallow `review-findings.json`) — group 2 pattern semantics;
 *   - a gate whose baseline is keyed on RAW route strings (every run/session
 *     id churn would silently un-baseline or re-baseline entries) — group 5;
 *   - a baseline that can GROW (a lane adding its own new failure to
 *     baseline.json) — group 6;
 *   - a CLI that reports failures but exits 0 — group 7 (real process,
 *     real exit code).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  FAILURE_KINDS,
  normalizeVolatile,
  parseListFile,
  matchesPattern,
  failureKey,
  collectFailures,
  assertCrawl,
  toBaseline,
  baselineGrowth,
  formatReport,
  canonicalUrl,
  coverageVerdict,
  isRegeneration,
  unprovenShrinks,
  COVERAGE_TOLERANCE,
} from './assert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FORGE_ROOT = resolve(HERE, '..', '..');
const FIXTURE = join(HERE, 'fixtures', 'crawl.sample.json');
// W8-F5 — a real, resolvable commit sha that is an ancestor of HEAD in this
// repository, fetched live (never hardcoded, so it never ages out): drives
// check-baseline-shrinks.mjs's real sha verification tests below. The oldest
// of the last 5 commits, well clear of HEAD itself.
const REAL_ANCESTOR_SHA = (() => {
  const log = spawnSync('git', ['log', '--format=%H', '-5'], { cwd: FORGE_ROOT, encoding: 'utf8' });
  const shas = (log.stdout || '').trim().split('\n').filter(Boolean);
  if (shas.length === 0) throw new Error(`could not read git log in ${FORGE_ROOT}: ${log.stderr}`);
  return shas[shas.length - 1];
})();
const loadFixture = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));

// A minimal crawl.json result row; every field the assertion reads.
function row(over: Record<string, unknown> = {}) {
  return {
    route: '/x', status: 'ok', err: null, ms: 1, consoleErrors: [], pageErrors: [], failed: [],
    dataPage: 'x', pageReady: 'true', ...over,
  };
}
const crawlOf = (...results: unknown[]) => ({ ui: 'http://localhost:4124', at: 'now', visited: results.length, unvisited: [], results });

// ── group 0: primitives ──────────────────────────────────────────────────────

test('FAILURE_KINDS names the seven classes the gate reports (W7-FIX-A0 added transport-failure + eval-error)', () => {
  assert.deepEqual([...FAILURE_KINDS].sort(), ['console-error', 'eval-error', 'first-party-4xx', 'nav-error', 'never-ready', 'page-error', 'transport-failure'].sort());
});

test('normalizeVolatile collapses run/cycle/session/initiative ids and leaves stable ids alone', () => {
  assert.equal(normalizeVolatile('/flows/forge-develop/run/2026-08-03T01-16-00_INIT-2026-08-03-init-coupling-change-coupling-command'), '/flows/forge-develop/run/<id>');
  assert.equal(normalizeVolatile('/sessions/demo/2026-08-14T15-17-37-5d6b6e6d?project=gitpulse'), '/sessions/demo/<id>?project=gitpulse');
  assert.equal(normalizeVolatile('/sessions/architect/2026-01-01T00-20-00-r6-06-ledger-sess?project=mdtoc'), '/sessions/architect/<id>?project=mdtoc');
  assert.equal(normalizeVolatile('[bridge]/api/events/_demo-2026-08-14T15-17-37-5d6b6e6d'), '[bridge]/api/events/_demo-<id>');
  assert.equal(normalizeVolatile('/artifact?cycle=2026-07-11T17-26-34_INIT-2026-07-11-cli-sort-flag&type=plan'), '/artifact?cycle=<id>&type=plan');
  assert.equal(normalizeVolatile('/artifact?initiative=INIT-2026-08-18-add-version-flag'), '/artifact?initiative=INIT-<id>');
  assert.equal(normalizeVolatile('/projects/gitpulse'), '/projects/gitpulse');
  assert.equal(normalizeVolatile('/knowledge?id=trafficGame&tab=health'), '/knowledge?id=trafficGame&tab=health');
  assert.equal(normalizeVolatile('[bridge]/api/studio/projects/trafficgame/contract-stages'), '[bridge]/api/studio/projects/trafficgame/contract-stages');
});

test('parseListFile strips comments, blank lines and whitespace', () => {
  const text = '# header comment\n\n  /api/artifact/*/demo.json   # trailing comment\n/api/foo\n\n#/api/commented-out\n';
  assert.deepEqual(parseListFile(text), ['/api/artifact/*/demo.json', '/api/foo']);
  assert.deepEqual(parseListFile(''), []);
});

test('matchesPattern: `*` is one path segment, `**` spans segments, literals are exact', () => {
  assert.equal(matchesPattern('/api/artifact/2026-01-01T00-00-00_INIT-x/demo.json', '/api/artifact/*/demo.json'), true);
  assert.equal(matchesPattern('/api/artifact/2026-01-01T00-00-00_INIT-x/review-findings.json', '/api/artifact/*/demo.json'), false);
  assert.equal(matchesPattern('/api/artifact/a/b/demo.json', '/api/artifact/*/demo.json'), false);
  assert.equal(matchesPattern('/api/artifact/a/b/demo.json', '/api/artifact/**/demo.json'), true);
  assert.equal(matchesPattern('/api/foo', '/api/foo'), true);
  assert.equal(matchesPattern('/api/foo/bar', '/api/foo'), false);
  assert.equal(matchesPattern('/api/foo.json', '/api/foo?json'), false, 'regex metacharacters in a pattern are literal');
});

// ── group 1: never-ready / nav-error ─────────────────────────────────────────

test('a route whose [data-page] root never sets data-page-ready="true" is a never-ready failure (normalized route)', () => {
  const { failures } = collectFailures(loadFixture(), {});
  const nr = failures.filter((f) => f.kind === 'never-ready');
  assert.deepEqual(nr.map((f) => f.route).sort(), ['/flows/forge-develop/run/<id>', '/flows/unknown/run/<id>']);
  assert.ok(nr.every((f) => f.rawRoute.includes('2026-0')), 'rawRoute keeps the un-normalized route for the operator');
  assert.ok(nr.every((f) => /flow-run/.test(f.detail)), 'detail names the data-page seen');
});

test('a declared live-only route prefix suppresses never-ready for that route only', () => {
  const { failures } = collectFailures(loadFixture(), { liveOnlyRoutes: ['/flows/unknown/run/'] });
  const nr = failures.filter((f) => f.kind === 'never-ready');
  assert.deepEqual(nr.map((f) => f.route), ['/flows/forge-develop/run/<id>']);
});

test('a page with no [data-page] root at all is never-ready too, and a navigation failure is nav-error', () => {
  const crawl = crawlOf(
    row({ route: '/a', dataPage: null, pageReady: null }),
    // What crawl.mjs really records for a 500 document: the response listener
    // sees the main document too, so `failed` carries the route itself.
    row({ route: '/b', status: 'http-500', failed: [{ url: '/b', status: 500 }, { url: '[bridge]/api/x', status: 404 }] }),
    row({ route: '/c', status: 'nav-error', err: 'Timeout' }),
    row({ route: '/d' }),
  );
  const { failures } = collectFailures(crawl, {});
  const byRoute = Object.fromEntries(failures.map((f) => [f.route, f]));
  assert.equal(byRoute['/a'].kind, 'never-ready');
  const b = failures.filter((f) => f.route === '/b');
  assert.deepEqual(b.map((f) => f.kind).sort(), ['first-party-4xx', 'nav-error'], 'the document 500 is ONE nav-error (not also a first-party-4xx); the api 404 is still its own failure');
  assert.match(b.find((f) => f.kind === 'nav-error').detail, /http-500/);
  assert.equal(byRoute['/c'].kind, 'nav-error');
  assert.equal(byRoute['/d'], undefined);
});

// ── group 2: first-party 4xx ─────────────────────────────────────────────────

test('every first-party request >=400 is a first-party-4xx failure, deduped per (route,url,status), third-party ignored', () => {
  const { failures } = collectFailures(loadFixture(), {});
  const fx = failures.filter((f) => f.kind === 'first-party-4xx');
  const gp = fx.filter((f) => f.route === '/projects/gitpulse');
  assert.equal(gp.length, 1, 'two identical 409s on one page collapse to one failure');
  assert.equal(gp[0].detail, '409 [bridge]/api/studio/projects/gitpulse/contract-stages');
  const rf = fx.filter((f) => f.detail.endsWith('/review-findings.json'));
  assert.equal(rf.length, 2, 'the register review-findings.json 404s (flows-07) are DEFECTS, never auto-allowed');
  assert.ok(rf.every((f) => f.detail.startsWith('404 [bridge]/api/artifact/<id>/')), 'url is normalized');
  assert.ok(fx.some((f) => f.detail === '404 [bridge]/api/events/'), 'agents-01 empty-id events 404');
  assert.ok(fx.some((f) => f.detail === '404 [bridge]/api/events/_demo-<id>'), 'home-sessions-11');
  assert.ok(fx.some((f) => f.detail === '404 [bridge]/api/studio/projects/new/preflight'), 'projects-04');
  assert.ok(fx.some((f) => f.detail === '400 [bridge]/api/studio/kbs/trafficGame/drain'), 'A4 identity 400s');

  const third = crawlOf(row({ route: '/t', failed: [{ url: 'https://fonts.gstatic.com/x.woff2', status: 404 }] }));
  assert.equal(collectFailures(third, {}).failures.length, 0, 'third-party hosts are not first-party');
  const uiHost = crawlOf(row({ route: '/u', failed: [{ url: '/api/forge-config', status: 500 }, { url: '/_next/static/chunk.js', status: 404 }] }));
  assert.equal(collectFailures(uiHost, {}).failures.length, 2, 'UI-host relative /api and asset 4xx are first-party');
});

test('first-party detection is host-alias-proof: a browser that reached the bridge as localhost while the harness knew it as 127.0.0.1 still yields `[bridge]` failures (the CI hole that let 52 baseline entries read as stale + PASS)', () => {
  // Real shape from the first CI run of PR #174: forge studio reported
  // bridgeUrl http://127.0.0.1:4123, the page fetched http://localhost:4123,
  // so the crawl's prefix-replace never produced `[bridge]` and the old
  // isFirstParty (prefix-only) dropped EVERY bridge 4xx → 0 known, 52 stale, PASS.
  const crawl = {
    ui: 'http://localhost:4124', bridge: 'http://127.0.0.1:4123', at: 'now', visited: 3, unvisited: [],
    results: [
      row({ route: '/agents/architect', failed: [{ url: 'http://localhost:4123/api/events/', status: 404 }] }),
      row({ route: '/x', failed: [{ url: 'http://127.0.0.1:4124/_next/static/chunk.js', status: 404 }, { url: 'http://[::1]:4123/api/y', status: 500 }] }),
      row({ route: '/t', failed: [{ url: 'https://fonts.gstatic.com/x.woff2', status: 404 }, { url: 'http://example.com:4123/api/z', status: 404 }] }),
    ],
  };
  const { failures } = collectFailures(crawl, {});
  const details = failures.map((f) => `${f.route} ${f.detail}`).sort();
  assert.deepEqual(details, [
    '/agents/architect 404 [bridge]/api/events/',
    '/x 404 /_next/static/chunk.js',
    '/x 500 [bridge]/api/y',
  ]);
  // A crawl.json without a `bridge` field (older capture): loopback URLs are still first-party, kept as-is.
  const legacy = crawlOf(row({ route: '/l', failed: [{ url: 'http://localhost:9999/api/x', status: 404 }] }));
  const lf = collectFailures(legacy, {}).failures;
  assert.equal(lf.length, 1);
  assert.equal(lf[0].detail, '404 http://localhost:9999/api/x');
  // And the baseline matches through the same canonicalization.
  const rep = assertCrawl(crawl, { baseline: { entries: [{ kind: 'first-party-4xx', route: '/agents/architect', detail: '404 [bridge]/api/events/' }] } });
  assert.equal(rep.known.length, 1);
});

test('known-optional-404s allowlist moves ONLY matching 404s into `allowed`; other statuses and other artifacts stay failures', () => {
  const opts = { knownOptional404s: ['/api/artifact/*/demo.json'] };
  const { failures, allowed } = collectFailures(loadFixture(), opts);
  assert.equal(allowed.length, 1);
  assert.equal(allowed[0].route, '/projects/mdtoc/showcase');
  assert.ok(!failures.some((f) => f.detail.endsWith('/demo.json')));
  assert.equal(failures.filter((f) => f.detail.endsWith('/review-findings.json')).length, 2, 'the pattern does not leak onto sibling artifacts');
  // A 500 on an allowlisted path is still a failure — the list is a 404 allowlist.
  const c = crawlOf(row({ route: '/s', failed: [{ url: '[bridge]/api/artifact/x/demo.json', status: 500 }] }));
  assert.equal(collectFailures(c, opts).failures.length, 1);
  // Patterns match the PATH: a cache-busting query on the same artifact is still allowed.
  const q = crawlOf(row({ route: '/s', failed: [{ url: '[bridge]/api/artifact/x/demo.json?t=123', status: 404 }] }));
  const rq = collectFailures(q, opts);
  assert.equal(rq.failures.length, 0);
  assert.equal(rq.allowed.length, 1);
});

// ── group 3/4: page errors + console errors ──────────────────────────────────

test('every pageerror is a page-error failure; console `error` entries are console-error failures except the resource-load duplicates of 4xx', () => {
  const crawl = crawlOf(
    row({ route: '/p', pageErrors: ['TypeError: Cannot read properties of undefined (reading toFixed)'] }),
    row({ route: '/q', failed: [{ url: 'https://cdn.example/x.png', status: 404 }], consoleErrors: [
      { type: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)' },
      { type: 'error', text: 'Warning: Each child in a list should have a unique "key" prop.' },
      { type: 'warning', text: 'something warned' },
    ] }),
  );
  const { failures } = collectFailures(crawl, {});
  const p = failures.filter((f) => f.route === '/p');
  assert.equal(p.length, 1);
  assert.equal(p[0].kind, 'page-error');
  assert.match(p[0].detail, /toFixed/);
  const q = failures.filter((f) => f.route === '/q');
  assert.equal(q.length, 1, 'a resource-load console line EXPLAINED by a recorded request on the same row is a duplicate; warnings are not errors');
  assert.equal(q[0].kind, 'console-error');
  assert.match(q[0].detail, /unique "key"/);
});

// ── group 5: --only, baseline matching, report shape ─────────────────────────

test('`only` prefixes restrict the routes considered (and the count reported); staleness is judged inside the prefixes only', () => {
  const rep = assertCrawl(loadFixture(), { only: ['/flows'] });
  assert.equal(rep.routes, 2);
  assert.ok(rep.failures.every((f) => f.rawRoute.startsWith('/flows')));
  const scoped = assertCrawl(loadFixture(), { only: ['/flows'], baseline: { entries: [
    { kind: 'first-party-4xx', route: '/projects/gitpulse', detail: '409 [bridge]/api/studio/projects/gitpulse/contract-stages' },
    { kind: 'never-ready', route: '/flows/gone/run/<id>', detail: 'data-page=flow-run data-page-ready=null' },
  ] } });
  assert.deepEqual(scoped.stale.map((e) => e.route), ['/flows/gone/run/<id>'], 'an out-of-scope baseline entry is not stale — it was never tested');
  const rep2 = assertCrawl(loadFixture(), { only: ['/flows', '/projects/new'] });
  assert.equal(rep2.routes, 3);
});

test('assertCrawl: baseline entries (raw OR normalized ids) hide known failures, unmatched entries surface as stale, ok iff no NEW failure', () => {
  const crawl = loadFixture();
  const all = assertCrawl(crawl, {});
  assert.equal(all.ok, false);
  assert.ok(all.failures.length >= 10, `expected the fixture to carry >=10 distinct failures, got ${all.failures.length}`);

  // Baseline everything the fixture fails today, but write two of the entries
  // with RAW ids (as an operator copying from a summary would) and add one
  // entry that no longer fails.
  const entries = all.failures.map((f) => ({ kind: f.kind, route: f.route, detail: f.detail }));
  entries[0] = { kind: all.failures[0].kind, route: all.failures[0].rawRoute, detail: all.failures[0].rawDetail };
  entries.push({ kind: 'never-ready', route: '/gone/2026-01-01T00-00-00_INIT-x', detail: 'data-page=gone data-page-ready=null' });
  const rep = assertCrawl(crawl, { baseline: { entries } });
  assert.equal(rep.ok, true, 'every failure is known → ok');
  assert.equal(rep.failures.length, 0);
  assert.equal(rep.known.length, all.failures.length);
  assert.equal(rep.stale.length, 1);
  assert.equal(rep.stale[0].route, '/gone/<id>');

  // Remove one entry → exactly that failure is NEW again.
  const rep3 = assertCrawl(crawl, { baseline: { entries: entries.slice(1) } });
  assert.equal(rep3.ok, false);
  assert.equal(rep3.failures.length, 1);
  assert.equal(failureKey(rep3.failures[0]), failureKey(all.failures[0]));
  assert.equal(typeof rep3.counts.byKind, 'object');
  const txt = formatReport(rep3);
  assert.match(txt, /FAIL/);
  assert.match(txt, /1 new/i);
  assert.match(formatReport(rep), /PASS/);
});

test('failureKey is kind|route|detail over the NORMALIZED fields', () => {
  const f = { kind: 'never-ready', route: '/a/<id>', rawRoute: '/a/2026-01-01T00-00-00-x', detail: 'd', rawDetail: 'd' };
  assert.equal(failureKey(f), 'never-ready|/a/<id>|d');
});

// ── group 6: baseline file shape + only-shrinks ──────────────────────────────

test('toBaseline writes sorted, unique, normalized entries (never the allowed ones) with the shrink-only comment', () => {
  const rep = assertCrawl(loadFixture(), { knownOptional404s: ['/api/artifact/*/demo.json'] });
  const b = toBaseline(rep, { source: 'main@abc1234', generatedAt: '2026-08-19T00:00:00Z' });
  assert.match(b._comment, /shrink/i);
  assert.equal(b.source, 'main@abc1234');
  const keys = b.entries.map((e) => `${e.kind}|${e.route}|${e.detail}`);
  assert.deepEqual(keys, [...new Set(keys)].sort(), 'sorted + unique');
  assert.ok(!keys.some((k) => k.includes('demo.json')), 'allowed entries never enter the baseline');
  assert.ok(keys.every((k) => !/\d{4}-\d{2}-\d{2}T\d{2}/.test(k)), 'entries are normalized');
  assert.ok(b.entries.every((e) => FAILURE_KINDS.includes(e.kind)));
});

test('baselineGrowth: a baseline may only shrink — new keys are growth; a missing previous baseline (first introduction) is not', () => {
  const prev = { entries: [{ kind: 'never-ready', route: '/a', detail: 'x' }, { kind: 'first-party-4xx', route: '/b', detail: '404 /api/y' }] };
  const same = baselineGrowth(prev, prev);
  assert.deepEqual(same.grew, []);
  const shrunk = baselineGrowth(prev, { entries: [prev.entries[0]] });
  assert.deepEqual(shrunk.grew, []);
  assert.equal(shrunk.shrank.length, 1);
  const grown = baselineGrowth(prev, { entries: [...prev.entries, { kind: 'page-error', route: '/c', detail: 'boom' }] });
  assert.equal(grown.grew.length, 1);
  assert.equal(grown.grew[0].route, '/c');
  assert.deepEqual(baselineGrowth(null, prev).grew, []);
  // Raw-id entries compare normalized: not growth if the same normalized key existed.
  const rawNext = { entries: [{ kind: 'never-ready', route: '/a', detail: 'x' }, { kind: 'first-party-4xx', route: '/b', detail: '404 /api/y' }] };
  assert.deepEqual(baselineGrowth(prev, rawNext).grew, []);
});

// ── group 7: the real CLI surfaces (exit codes, files written) ───────────────

const CRAWL = join(HERE, 'crawl.mjs');
const SHRINK = join(HERE, 'check-baseline-shrinks.mjs');
const runNode = (args: string[], cwd: string) => spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 60_000 });

test('crawl.mjs --from <crawl.json> --assert: exits 1 on new failures, writes assert.json; exits 0 when a baseline covers them; --only narrows', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'w7a0-'));
  try {
    const out1 = join(tmp, 'o1');
    const r1 = runNode([CRAWL, '--from', FIXTURE, '--assert', '--out', out1, '--known-optional-404s', join(tmp, 'none.txt'), '--live-only-routes', join(tmp, 'none.txt')], HERE);
    assert.equal(r1.status, 1, `expected exit 1\nstdout:${r1.stdout}\nstderr:${r1.stderr}`);
    assert.ok(existsSync(join(out1, 'assert.json')), 'assert.json summary written');
    const rep = JSON.parse(readFileSync(join(out1, 'assert.json'), 'utf8'));
    assert.equal(rep.ok, false);
    assert.ok(rep.failures.length >= 10);
    assert.match(r1.stdout + r1.stderr, /FAIL/);

    // Write a baseline from that run, then re-assert against it → 0.
    const bl = join(tmp, 'baseline.json');
    const r2 = runNode([CRAWL, '--from', FIXTURE, '--assert', '--out', join(tmp, 'o2'), '--write-baseline', bl, '--known-optional-404s', join(tmp, 'none.txt'), '--live-only-routes', join(tmp, 'none.txt')], HERE);
    assert.ok(existsSync(bl), `--write-baseline wrote the file\n${r2.stdout}\n${r2.stderr}`);
    const r3 = runNode([CRAWL, '--from', FIXTURE, '--assert', '--out', join(tmp, 'o3'), '--baseline', bl, '--known-optional-404s', join(tmp, 'none.txt'), '--live-only-routes', join(tmp, 'none.txt')], HERE);
    assert.equal(r3.status, 0, `expected exit 0 with a covering baseline\nstdout:${r3.stdout}\nstderr:${r3.stderr}`);
    assert.match(r3.stdout + r3.stderr, /PASS/);

    // --only narrows the routes considered (repeatable flag, prefix match).
    const r5 = runNode([CRAWL, '--from', FIXTURE, '--assert', '--out', join(tmp, 'o5'), '--only', '/projects/gitpulse', '--known-optional-404s', join(tmp, 'none.txt'), '--live-only-routes', join(tmp, 'none.txt')], HERE);
    const rep5 = JSON.parse(readFileSync(join(tmp, 'o5', 'assert.json'), 'utf8'));
    assert.equal(rep5.routes, 1);
    assert.equal(rep5.failures.length, 1, 'gitpulse carries exactly the contract-stages 409');
    assert.equal(r5.status, 1);

    // Harness sanity floor: too few routes is a HARNESS error (exit 2), never a verdict.
    const r6 = runNode([CRAWL, '--from', FIXTURE, '--assert', '--out', join(tmp, 'o6'), '--baseline', bl, '--min-routes', '10', '--known-optional-404s', join(tmp, 'none.txt'), '--live-only-routes', join(tmp, 'none.txt')], HERE);
    assert.equal(r6.status, 2, `expected exit 2 (harness error) for 9 routes < 10\nstdout:${r6.stdout}\nstderr:${r6.stderr}`);
    assert.match(r6.stderr, /HARNESS ERROR/);
    assert.doesNotMatch(r6.stdout + r6.stderr, /\bPASS\b/, 'a starved crawl must never print PASS');
    // …and must never WRITE a baseline (a starved --write-baseline would shrink the gate to a handful of entries).
    const bl2 = join(tmp, 'starved-baseline.json');
    const r7 = runNode([CRAWL, '--from', FIXTURE, '--out', join(tmp, 'o7'), '--write-baseline', bl2, '--min-routes', '10', '--known-optional-404s', join(tmp, 'none.txt'), '--live-only-routes', join(tmp, 'none.txt')], HERE);
    assert.equal(r7.status, 2, `starved --write-baseline must be a harness error\n${r7.stdout}\n${r7.stderr}`);
    assert.equal(existsSync(bl2), false, 'no baseline written by a starved crawl');
    // An EMPTY capture is never green even under --from (default floor 1 there).
    const empty = join(tmp, 'empty.json');
    writeFileSync(empty, JSON.stringify({ ui: 'x', results: [] }));
    const r8 = runNode([CRAWL, '--from', empty, '--assert', '--out', join(tmp, 'o8'), '--known-optional-404s', join(tmp, 'none.txt'), '--live-only-routes', join(tmp, 'none.txt')], HERE);
    assert.equal(r8.status, 2, `empty capture must be a harness error\n${r8.stdout}\n${r8.stderr}`);
    assert.doesNotMatch(r8.stdout, /\bPASS\b/);
    const notCrawl = join(tmp, 'notcrawl.json');
    writeFileSync(notCrawl, '{}');
    const r9 = runNode([CRAWL, '--from', notCrawl, '--assert', '--out', join(tmp, 'o9')], HERE);
    assert.equal(r9.status, 2, 'a JSON without results is not a crawl.json');
    // A valued flag followed by another flag is a usage error (exit 2), never a NaN that disables the floor.
    const r10 = runNode([CRAWL, '--from', FIXTURE, '--assert', '--out', join(tmp, 'o10'), '--min-routes', '--boot'], HERE);
    assert.equal(r10.status, 2, `--min-routes without a value must fail\n${r10.stdout}\n${r10.stderr}`);
    assert.match(r10.stderr, /HARNESS ERROR/);
    const r11 = runNode([CRAWL, '--from', FIXTURE, '--assert', '--out', join(tmp, 'o11'), '--min-routes', 'abc'], HERE);
    assert.equal(r11.status, 2, '--min-routes must be a non-negative integer');
    const r12 = runNode([CRAWL, '--from', FIXTURE, '--boot', '--assert', '--out', join(tmp, 'o12')], HERE);
    assert.equal(r12.status, 2, '--from + --boot is rejected, not silently ignored');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('check-baseline-shrinks.mjs: exit 0 when next ⊆ prev (or prev absent), exit 1 naming the grown entries otherwise', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'w7a0s-'));
  try {
    const prev = join(tmp, 'prev.json');
    const next = join(tmp, 'next.json');
    writeFileSync(prev, JSON.stringify({ entries: [{ kind: 'never-ready', route: '/a', detail: 'x' }, { kind: 'page-error', route: '/b', detail: 'y' }] }));
    writeFileSync(next, JSON.stringify({ entries: [{ kind: 'never-ready', route: '/a', detail: 'x' }] }));
    const ok = runNode([SHRINK, '--prev', prev, '--next', next], HERE);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    writeFileSync(next, JSON.stringify({ entries: [{ kind: 'never-ready', route: '/a', detail: 'x' }, { kind: 'console-error', route: '/z', detail: 'new!' }] }));
    const bad = runNode([SHRINK, '--prev', prev, '--next', next], HERE);
    assert.equal(bad.status, 1);
    assert.match(bad.stdout + bad.stderr, /\/z/);
    const first = runNode([SHRINK, '--prev', join(tmp, 'missing.json'), '--next', next], HERE);
    assert.equal(first.status, 2, 'W7-A0-7: an explicitly passed --prev that does not exist is a USAGE error, not a first introduction (only the --against path may report "not at that ref")');
    assert.match(first.stderr, /--prev/);
    // Removing the baseline file outright is NOT a shrink.
    const gone = runNode([SHRINK, '--prev', prev, '--next', join(tmp, 'gone.json')], HERE);
    assert.equal(gone.status, 1, 'a missing next while prev had entries must fail');
    assert.match(gone.stderr, /missing/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── group 8: the committed baseline is well-formed and the real repo files exist ──

test('the committed baseline.json + list files parse, and the baseline carries only normalized entries', () => {
  const b = JSON.parse(readFileSync(join(HERE, 'baseline.json'), 'utf8'));
  assert.ok(Array.isArray(b.entries));
  assert.match(b._comment, /shrink/i);
  for (const e of b.entries) {
    assert.ok(FAILURE_KINDS.includes(e.kind), `unknown kind ${e.kind}`);
    assert.equal(e.route, normalizeVolatile(e.route), `un-normalized route in baseline: ${e.route}`);
    assert.equal(e.detail, normalizeVolatile(e.detail), `un-normalized detail in baseline: ${e.detail}`);
  }
  const keys = b.entries.map((e) => `${e.kind}|${e.route}|${e.detail}`);
  assert.deepEqual(keys, [...new Set(keys)].sort(), 'baseline entries sorted + unique');
  const optional = parseListFile(readFileSync(join(HERE, 'known-optional-404s.txt'), 'utf8'));
  assert.ok(!optional.some((p) => /review-findings/.test(p)), 'review-findings.json 404s are DEFECTS (A3) — never allowlisted');
  assert.ok(!optional.some((p) => /\/api\/events/.test(p)), 'events 404s are DEFECTS (A2/B5) — never allowlisted');
  parseListFile(readFileSync(join(HERE, 'live-only-routes.txt'), 'utf8'));
});

// ═════════════════════════════════════════════════════════════════════════════
// W7-FIX-A0 (2026-08-19) — the review sweep's five confirmed findings + lows.
// Each group below was RED on main ac7e71e0 before the fix landed.
// ═════════════════════════════════════════════════════════════════════════════

// ── group 9: W7-A0-1 origin-based first-party detection ──────────────────────

test('W7-A0-1: first-party detection is ORIGIN-based — a non-loopback FORGE_UI_URL/FORGE_BRIDGE_URL (LAN ip, container name) still yields `[bridge]`/relative failures', () => {
  // The inverse of the host-alias test: same-port-different-host was correctly
  // excluded, but a request whose scheme+host+port EQUALS crawl.bridge/crawl.ui
  // on a non-loopback host was dropped too (loopback-only heuristic) → every
  // first-party 4xx vanished and the run read PASS.
  const crawl = {
    ui: 'http://192.168.1.5:4124', bridge: 'http://192.168.1.5:4123', at: 'now', visited: 3, unvisited: [],
    results: [
      row({ route: '/agents/architect', failed: [{ url: 'http://192.168.1.5:4123/api/events/', status: 404 }] }),
      row({ route: '/x', failed: [{ url: 'http://192.168.1.5:4124/_next/static/chunk.js', status: 404 }, { url: 'http://192.168.1.5:4123/api/y', status: 500 }] }),
      row({ route: '/t', failed: [
        { url: 'https://fonts.gstatic.com/x.woff2', status: 404 },
        { url: 'http://example.com:4123/api/z', status: 404 },      // same port, other host → NOT first-party
        { url: 'https://192.168.1.5:4123/api/tls', status: 404 },   // same host+port, other scheme → other origin → NOT first-party
        { url: 'http://192.168.1.5:9999/api/other', status: 404 },  // same host, other port → NOT first-party (non-loopback)
      ] }),
    ],
  };
  const { failures } = collectFailures(crawl, {});
  const details = failures.map((f) => `${f.route} ${f.detail}`).sort();
  assert.deepEqual(details, [
    '/agents/architect 404 [bridge]/api/events/',
    '/x 404 /_next/static/chunk.js',
    '/x 500 [bridge]/api/y',
  ]);
  const rep = assertCrawl(crawl, { baseline: { entries: [{ kind: 'first-party-4xx', route: '/agents/architect', detail: '404 [bridge]/api/events/' }] } });
  assert.equal(rep.known.length, 1, 'the baseline matches through the same origin canonicalization');
  assert.equal(rep.stale.length, 0);
  // canonicalUrl itself: origin match first, loopback-port alias as the fallback.
  const o = { ui: 'http://192.168.1.5:4124', bridge: 'http://192.168.1.5:4123' };
  assert.equal(canonicalUrl('http://192.168.1.5:4123/api/a?b=1', o), '[bridge]/api/a?b=1');
  assert.equal(canonicalUrl('http://192.168.1.5:4124/p', o), '/p');
  assert.equal(canonicalUrl('http://192.168.1.5:9999/p', o), 'http://192.168.1.5:9999/p');
  const l = { ui: 'http://localhost:4124', bridge: 'http://127.0.0.1:4123' };
  assert.equal(canonicalUrl('http://localhost:4123/api/a', l), '[bridge]/api/a', 'loopback alias still canonicalizes by port');
  assert.equal(canonicalUrl('http://[::1]:4124/p', l), '/p');
  assert.equal(canonicalUrl('http://localhost:9999/p', l), 'http://localhost:9999/p');
});

// ── group 10: W7-A0-2 transport-level failures ───────────────────────────────

test('W7-A0-2: a first-party request that never got a response (requestfailed) is a `transport-failure`; client aborts and third-party failures are not', () => {
  const crawl = {
    ui: 'http://localhost:4124', bridge: 'http://127.0.0.1:4123', at: 'now', visited: 2, unvisited: [],
    results: [
      row({ route: '/projects', transportFailed: [
        { url: 'http://localhost:4123/api/studio/projects', error: 'net::ERR_CONNECTION_REFUSED', resourceType: 'fetch' },
        { url: '/_next/data/x.json', error: 'net::ERR_ABORTED', resourceType: 'fetch' },
        { url: 'https://fonts.gstatic.com/x.woff2', error: 'net::ERR_NAME_NOT_RESOLVED', resourceType: 'font' },
      ] }),
      row({ route: '/flows', transportFailed: [{ url: '[bridge]/api/studio/flows', error: 'net::ERR_EMPTY_RESPONSE', resourceType: 'fetch' }] }),
    ],
  };
  const { failures } = collectFailures(crawl, {});
  const tf = failures.filter((f) => f.kind === 'transport-failure');
  assert.deepEqual(tf.map((f) => `${f.route} ${f.detail}`).sort(), [
    '/flows net::ERR_EMPTY_RESPONSE [bridge]/api/studio/flows',
    '/projects net::ERR_CONNECTION_REFUSED [bridge]/api/studio/projects',
  ]);
  assert.equal(failures.length, 2, 'no other kind is raised for the aborted / third-party entries');
  const rep = assertCrawl(crawl, { baseline: { entries: [{ kind: 'transport-failure', route: '/flows', detail: 'net::ERR_EMPTY_RESPONSE [bridge]/api/studio/flows' }] } });
  assert.equal(rep.known.length, 1);
  assert.equal(rep.failures.length, 1);
  assert.equal(rep.counts.byKind['transport-failure'], 1);
});

test('W7-A0-2: the browser\'s "Failed to load resource" console line is dropped ONLY when a recorded request on the same row explains it — a net::ERR_* line with nothing behind it surfaces as console-error', () => {
  const crawl = crawlOf(
    // explained by a recorded 4xx (any host) → duplicate, dropped
    row({ route: '/a', failed: [{ url: 'https://cdn.example/x', status: 404 }], consoleErrors: [{ type: 'error', text: 'Failed to load resource: the server responded with a status of 404 (Not Found)' }] }),
    // explained by a recorded transport failure → dropped (the transport-failure kind carries it)
    row({ route: '/b', transportFailed: [{ url: '[bridge]/api/x', error: 'net::ERR_CONNECTION_REFUSED', resourceType: 'fetch' }], consoleErrors: [{ type: 'error', text: 'Failed to load resource: net::ERR_CONNECTION_REFUSED' }] }),
    // NOT explained by anything recorded → console-error (the old unconditional drop hid exactly this)
    row({ route: '/c', consoleErrors: [{ type: 'error', text: 'Failed to load resource: net::ERR_CONNECTION_REFUSED' }] }),
    row({ route: '/d', consoleErrors: [{ type: 'error', text: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)' }] }),
    // status form recorded with a DIFFERENT status → not explained
    row({ route: '/e', failed: [{ url: '[bridge]/api/y', status: 404 }], consoleErrors: [{ type: 'error', text: 'Failed to load resource: the server responded with a status of 500 (Internal Server Error)' }] }),
  );
  const { failures } = collectFailures(crawl, {});
  const ce = failures.filter((f) => f.kind === 'console-error').map((f) => f.route).sort();
  assert.deepEqual(ce, ['/c', '/d', '/e']);
  assert.deepEqual(failures.filter((f) => f.route === '/b').map((f) => f.kind), ['transport-failure']);
  assert.equal(failures.filter((f) => f.route === '/a').length, 0);
});

// ── group 11: W7-A0-9 evaluate failures are their own kind ───────────────────

test('W7-A0-9: a row whose page.evaluate failed is an `eval-error` (harness could not read the page), never misreported as never-ready', () => {
  const crawl = crawlOf(row({ route: '/z', dataPage: undefined, pageReady: undefined, evalError: 'Error: Execution context was destroyed, most likely because of a navigation' }));
  const { failures } = collectFailures(crawl, {});
  assert.equal(failures.length, 1);
  assert.equal(failures[0].kind, 'eval-error');
  assert.match(failures[0].detail, /Execution context was destroyed/);
  assert.ok(!failures.some((f) => f.kind === 'never-ready'));
});

// ── group 12: W7-A0-3 coverage tracks the baseline ───────────────────────────

test('W7-A0-3: coverageVerdict — routes below 90% of the baseline\'s expectedRoutes for this environment is a harness error; a missing expectation is too; --only skips the floor', () => {
  assert.equal(COVERAGE_TOLERANCE, 0.9);
  const baseline = { entries: [], expectedRoutes: { ci: 136, host: 245 } };
  const ok = coverageVerdict({ routes: 130, unvisited: 0, key: 'ci', baseline, only: [], minRoutes: 40, maxExplicit: false, allowDrop: false });
  assert.equal(ok.harnessError, null);
  assert.equal(ok.expected, 136);
  assert.equal(ok.floor, Math.ceil(136 * 0.9));
  const low = coverageVerdict({ routes: 100, unvisited: 0, key: 'ci', baseline, only: [], minRoutes: 40, maxExplicit: false, allowDrop: false });
  assert.match(low.harnessError, /coverage/i);
  assert.match(low.harnessError, /100/);
  assert.match(low.harnessError, /136/);
  const hostLow = coverageVerdict({ routes: 130, unvisited: 0, key: 'host', baseline, only: [], minRoutes: 40, maxExplicit: false, allowDrop: false });
  assert.match(hostLow.harnessError, /245/, 'the floor is per environment key — 130 routes is fine for CI, a collapse for the host');
  const missing = coverageVerdict({ routes: 130, unvisited: 0, key: 'ci', baseline: { entries: [] }, only: [], minRoutes: 40, maxExplicit: false, allowDrop: false });
  assert.match(missing.harnessError, /expectedRoutes/, 'a baseline without an expectation for this environment fails closed');
  const noBaseline = coverageVerdict({ routes: 130, unvisited: 0, key: 'ci', baseline: null, only: [], minRoutes: 40, maxExplicit: false, allowDrop: false });
  assert.equal(noBaseline.harnessError, null, 'no baseline at all (ad-hoc --assert) → only --min-routes applies');
  const only = coverageVerdict({ routes: 3, unvisited: 0, key: 'ci', baseline, only: ['/flows'], minRoutes: 1, maxExplicit: false, allowDrop: false });
  assert.equal(only.harnessError, null, '--only crawls a subset by design');
  const drop = coverageVerdict({ routes: 100, unvisited: 0, key: 'ci', baseline, only: [], minRoutes: 40, maxExplicit: false, allowDrop: true });
  assert.equal(drop.harnessError, null, '--allow-coverage-drop is the explicit operator override for a legitimately smaller Studio');
  assert.equal(drop.expected, 136);
  // --min-routes stays the absolute floor and wins first.
  const starved = coverageVerdict({ routes: 9, unvisited: 0, key: 'ci', baseline, only: [], minRoutes: 40, maxExplicit: false, allowDrop: true });
  assert.match(starved.harnessError, /min-routes/);
});

test('W7-A0-3: an unvisited BFS remainder means the crawl was truncated by --max — a harness error unless --max was passed explicitly (then it is reported, by design)', () => {
  const baseline = { entries: [], expectedRoutes: { host: 10 } };
  const truncated = coverageVerdict({ routes: 12, unvisited: 5, key: 'host', baseline, only: [], minRoutes: 1, maxExplicit: false, allowDrop: false });
  assert.match(truncated.harnessError, /unvisited|truncat/i);
  assert.match(truncated.harnessError, /5/);
  const explicit = coverageVerdict({ routes: 12, unvisited: 5, key: 'host', baseline, only: [], minRoutes: 1, maxExplicit: true, allowDrop: false });
  assert.equal(explicit.harnessError, null);
  assert.equal(explicit.unvisited, 5);
  const noBaseline = coverageVerdict({ routes: 12, unvisited: 5, key: 'host', baseline: null, only: [], minRoutes: 1, maxExplicit: false, allowDrop: false });
  assert.match(noBaseline.harnessError, /unvisited|truncat/i, 'truncation is a coverage fact independent of any baseline');
});

test('W7-A0-3: assertCrawl reports `unvisited`, formatReport prints it, toBaseline records expectedRoutes per environment and carries the other environments forward', () => {
  const crawl = { ...loadFixture(), unvisited: ['/never', '/seen'] };
  const rep = assertCrawl(crawl, {});
  assert.equal(rep.unvisited, 2);
  assert.match(formatReport(rep), /2 unvisited/);
  const b = toBaseline(rep, { source: 'main@abc1234', coverage: { key: 'host', routes: rep.routes, unvisited: 2, source: 'operator host' }, previous: { expectedRoutes: { ci: 136, host: 1 }, expectedRoutesSource: { ci: 'CI run 1', host: 'old' } } });
  assert.deepEqual(b.expectedRoutes, { ci: 136, host: rep.routes });
  assert.equal(b.expectedRoutesSource.ci, 'CI run 1', 'the other environment\'s expectation + provenance survive a regeneration');
  assert.match(b.expectedRoutesSource.host, /operator host/);
  const fresh = toBaseline(rep, { source: 'main@abc1234', coverage: { key: 'ci', routes: 136, unvisited: 0 } });
  assert.deepEqual(fresh.expectedRoutes, { ci: 136 });
});

test('W7-A0-3 + W7-A0-6 (CLI): coverage collapse and truncation are exit 2, and assert.json is still written — stamped ok:false + harnessError, never a green report as the CI artifact', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'w7a0c-'));
  try {
    const none = join(tmp, 'none.txt');
    const common = ['--known-optional-404s', none, '--live-only-routes', none];
    // 9-route fixture vs an expectation of 20 for BOTH keys (deterministic whatever CI=… is in the env).
    const bl = join(tmp, 'bl.json');
    writeFileSync(bl, JSON.stringify({ entries: [], expectedRoutes: { host: 20, ci: 20 } }));
    const r1 = runNode([CRAWL, '--from', FIXTURE, '--assert', '--out', join(tmp, 'o1'), '--baseline', bl, ...common], HERE);
    assert.equal(r1.status, 2, `coverage collapse must be a harness error\n${r1.stdout}\n${r1.stderr}`);
    assert.match(r1.stderr, /HARNESS ERROR/);
    assert.match(r1.stderr, /coverage/i);
    assert.doesNotMatch(r1.stdout + r1.stderr, /\bPASS\b/);
    const a1 = JSON.parse(readFileSync(join(tmp, 'o1', 'assert.json'), 'utf8'));
    assert.equal(a1.ok, false, 'assert.json never says ok on a harness error');
    assert.match(a1.harnessError, /coverage/i);
    assert.equal(a1.coverage.expected, 20);
    // --allow-coverage-drop: the explicit override → normal verdict path (fixture has real failures → exit 1).
    const r2 = runNode([CRAWL, '--from', FIXTURE, '--assert', '--out', join(tmp, 'o2'), '--baseline', bl, '--allow-coverage-drop', ...common], HERE);
    assert.equal(r2.status, 1, `with the override the run reaches a verdict\n${r2.stdout}\n${r2.stderr}`);
    // --min-routes starvation ALSO stamps assert.json (W7-A0-6).
    const r3 = runNode([CRAWL, '--from', FIXTURE, '--assert', '--out', join(tmp, 'o3'), '--min-routes', '10', ...common], HERE);
    assert.equal(r3.status, 2);
    const a3 = JSON.parse(readFileSync(join(tmp, 'o3', 'assert.json'), 'utf8'));
    assert.equal(a3.ok, false);
    assert.match(a3.harnessError, /min-routes/);
    // A capture with an unvisited remainder and no explicit --max is a truncated crawl → harness error.
    const trunc = join(tmp, 'trunc.json');
    writeFileSync(trunc, JSON.stringify({ ...loadFixture(), unvisited: ['/never-visited'] }));
    const r4 = runNode([CRAWL, '--from', trunc, '--assert', '--out', join(tmp, 'o4'), ...common], HERE);
    assert.equal(r4.status, 2, `truncated capture must be a harness error\n${r4.stdout}\n${r4.stderr}`);
    assert.match(r4.stderr, /unvisited|truncat/i);
    // …but a capture that says the cap was explicit reports it and reaches a verdict.
    writeFileSync(trunc, JSON.stringify({ ...loadFixture(), unvisited: ['/never-visited'], maxExplicit: true }));
    const r5 = runNode([CRAWL, '--from', trunc, '--assert', '--out', join(tmp, 'o5'), ...common], HERE);
    assert.equal(r5.status, 1, `explicit --max truncation reaches a verdict\n${r5.stdout}\n${r5.stderr}`);
    assert.match(r5.stdout, /1 unvisited/);
    // --write-baseline records the expectation for the capture's environment key (default host).
    const out = join(tmp, 'wb.json');
    const r6 = runNode([CRAWL, '--from', FIXTURE, '--out', join(tmp, 'o6'), '--write-baseline', out, ...common], HERE);
    assert.equal(r6.status, 0, r6.stdout + r6.stderr);
    const wb = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(wb.expectedRoutes.host, 9);
    assert.match(wb.expectedRoutesSource.host, /9 routes/);
    // …and a --write-baseline that would collapse coverage vs the PREVIOUS file is refused without the override.
    writeFileSync(out, JSON.stringify({ ...wb, expectedRoutes: { host: 20 } }));
    const r7 = runNode([CRAWL, '--from', FIXTURE, '--out', join(tmp, 'o7'), '--write-baseline', out, ...common], HERE);
    assert.equal(r7.status, 2, `a regeneration that drops coverage below the previous expectation is refused\n${r7.stdout}\n${r7.stderr}`);
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).expectedRoutes.host, 20, 'the file was not overwritten');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('--write-baseline provenance (CLI): --source is honoured under --from (a replayed CI capture can be stamped where it was measured, marked as a replay); without it a replay is stamped with its file, never `main@`; and --write-baseline refuses --only (a baseline is the FULL failure set)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'w7a0src-'));
  try {
    const none = join(tmp, 'none.txt');
    const common = ['--known-optional-404s', none, '--live-only-routes', none];
    const out = join(tmp, 'wb.json');
    const r1 = runNode([CRAWL, '--from', FIXTURE, '--out', join(tmp, 'o1'), '--write-baseline', out, '--source', 'main@abc1234 CI run 1', ...common], HERE);
    assert.equal(r1.status, 0, r1.stdout + r1.stderr);
    const wb1 = JSON.parse(readFileSync(out, 'utf8'));
    assert.match(wb1.source, /^main@abc1234 CI run 1 — http:\/\/localhost:4124 at .* \(replayed from /);
    assert.match(wb1.expectedRoutesSource.host, /^main@abc1234 CI run 1 .*\(9 routes, 0 unvisited\)/, 'the per-environment expectation names the same provenance');
    const out2 = join(tmp, 'wb2.json');
    const r2 = runNode([CRAWL, '--from', FIXTURE, '--out', join(tmp, 'o2'), '--write-baseline', out2, ...common], HERE);
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    const wb2 = JSON.parse(readFileSync(out2, 'utf8'));
    assert.match(wb2.source, /^crawl\.json /);
    assert.doesNotMatch(wb2.source, /^main@/, 'a replay without --source must not look like a main regeneration');
    // --only + --write-baseline: usage error, and no file written.
    const out3 = join(tmp, 'wb3.json');
    const r3 = runNode([CRAWL, '--from', FIXTURE, '--out', join(tmp, 'o3'), '--only', '/flows', '--write-baseline', out3, ...common], HERE);
    assert.equal(r3.status, 2, `--write-baseline under --only must be a usage error\n${r3.stdout}\n${r3.stderr}`);
    assert.match(r3.stderr, /--write-baseline.*--only/);
    assert.equal(existsSync(out3), false, 'no partial baseline is written');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── group 12b: review-round fixes (FIX-A0 code review) ───────────────────────

test('review R1: coverageVerdict — on the WRITE path an absent expectedRoutes[<env>] is a first introduction (record it), never a fail-closed error that forces --allow-coverage-drop; the floor still applies when a key exists', () => {
  const base = { routes: 200, unvisited: 0, key: 'host', only: [], minRoutes: 40, maxExplicit: false, allowDrop: false };
  // assert path (gate): absent key fails closed
  assert.match(coverageVerdict({ ...base, baseline: { expectedRoutes: { ci: 136 } } }).harnessError ?? '', /no expectedRoutes\.host/);
  // write path: absent key = first introduction → no error
  assert.equal(coverageVerdict({ ...base, baseline: { expectedRoutes: { ci: 136 } }, writing: true }).harnessError, null);
  // write path with an existing key: the floor still guards a starved regeneration
  assert.match(coverageVerdict({ ...base, routes: 100, baseline: { expectedRoutes: { host: 924 } }, writing: true }).harnessError ?? '', /coverage collapsed/);
});

test('review R1 (CLI): a --write-baseline that introduces a NEW environment key over a previous file lacking it succeeds without --allow-coverage-drop, and carries the other key forward', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'w7a0r1-'));
  try {
    const none = join(tmp, 'none.txt');
    const common = ['--known-optional-404s', none, '--live-only-routes', none];
    const out = join(tmp, 'bl.json');
    writeFileSync(out, JSON.stringify({ source: 'main@aaaaaaa', generatedAt: '2026-08-18T00:00:00.000Z', expectedRoutes: { ci: 136 }, expectedRoutesSource: { ci: 'CI run 1' }, entries: [] }));
    const cap = join(tmp, 'cap.json');
    writeFileSync(cap, JSON.stringify({ ...loadFixture(), env: 'host' }));
    const r = runNode([CRAWL, '--from', cap, '--assert', '--baseline', out, '--write-baseline', out, '--source', 'main@bbbbbbb', ...common], HERE);
    assert.equal(r.status, 1, `verdict path reached (fixture has real failures) — no harness error for the missing host key\n${r.stdout}\n${r.stderr}`);
    const wb = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual(wb.expectedRoutes, { ci: 136, host: 9 });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('review R2: toBaseline carries forward previous entries whose route the regeneration crawl did NOT visit — a regeneration proves only what it saw (a CI-env regeneration must not discard host-only known defects)', () => {
  const rep = assertCrawl({ ...crawlOf(row({ route: '/agents/x', failed: [{ url: 'http://localhost:4123/api/events/', status: 404 }] })), bridge: 'http://localhost:4123' }, {});
  const previous = {
    expectedRoutes: { host: 900 },
    entries: [
      { kind: 'first-party-4xx', route: '/agents/x', detail: '404 [bridge]/api/old-thing', message: 'm' }, // route visited → NOT carried (proven gone)
      { kind: 'never-ready', route: '/flows/forge-develop/run/2026-08-03T01-16-00_INIT-x', detail: 'data-page=flow-run data-page-ready=null', message: 'm' }, // route not visited → carried
    ],
  };
  const b = toBaseline(rep, { source: 'main@abc1234', coverage: { key: 'ci', routes: 1, unvisited: 0 }, previous, crawledRoutes: ['/agents/x'] });
  const keys = b.entries.map((e) => failureKey(e));
  assert.ok(keys.includes('first-party-4xx|/agents/x|404 [bridge]/api/events/'), 'the crawl\'s own failure is written');
  assert.ok(!keys.some((k) => k.includes('/api/old-thing')), 'a previous entry on a VISITED route that no longer fails is dropped (proven fixed)');
  assert.ok(keys.includes('never-ready|/flows/forge-develop/run/<id>|data-page=flow-run data-page-ready=null'), 'a previous entry on an UNVISITED route is carried forward (normalized)');
  // Without crawledRoutes (or previous) nothing is carried — the caller must say what it saw.
  const b2 = toBaseline(rep, { source: 'main@abc1234', coverage: { key: 'ci', routes: 1, unvisited: 0 }, previous });
  assert.equal(b2.entries.length, 1);
});

test('review R4 (CLI): a --from capture that records no `env` is a harness error (pre-W7-A0-3 crawl.json) — never silently judged/recorded as host', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'w7a0r4-'));
  try {
    const none = join(tmp, 'none.txt');
    const common = ['--known-optional-404s', none, '--live-only-routes', none];
    const cap = join(tmp, 'noenv.json');
    const { env: _drop, ...noEnv } = loadFixture() as Record<string, unknown> & { env?: string };
    writeFileSync(cap, JSON.stringify(noEnv));
    const r = runNode([CRAWL, '--from', cap, '--assert', '--out', join(tmp, 'o'), ...common], HERE);
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /env/);
    assert.match(readFileSync(FIXTURE, 'utf8'), /"env": "host"/, 'the committed fixture records its environment');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('review R6: a transport failure on the main document itself is already the row\'s nav-error — not double-counted as transport-failure', () => {
  const c = { ...crawlOf(row({ route: '/flows/x', status: 'nav-error', err: 'net::ERR_CONNECTION_REFUSED', pageReady: null, transportFailed: [{ url: 'http://localhost:4124/flows/x', error: 'net::ERR_CONNECTION_REFUSED', resourceType: 'document' }, { url: 'http://localhost:4123/api/studio/flows', error: 'net::ERR_CONNECTION_REFUSED', resourceType: 'fetch' }] })), bridge: 'http://localhost:4123' };
  const kinds = collectFailures(c, {}).failures.map((f) => `${f.kind} ${f.detail}`);
  assert.deepEqual(kinds, ['nav-error nav-error net::ERR_CONNECTION_REFUSED', 'transport-failure net::ERR_CONNECTION_REFUSED [bridge]/api/studio/flows']);
});

test('review R7: a regeneration that LOSES an environment key the previous baseline had is not accepted (isRegeneration requires a non-empty expectedRoutes; check-baseline-shrinks fails a dropped key)', () => {
  const prev = { source: 'main@aaaaaaa', generatedAt: '2026-08-18T00:00:00.000Z', expectedRoutes: { ci: 136, host: 900 }, entries: [] };
  assert.equal(isRegeneration(prev, { source: 'main@bbbbbbb', generatedAt: '2026-08-19T00:00:00.000Z', expectedRoutes: {}, entries: [] }), false, 'empty expectedRoutes is not "recorded"');
  const tmp = mkdtempSync(join(tmpdir(), 'w7a0r7-'));
  try {
    const p = join(tmp, 'prev.json'), n = join(tmp, 'next.json');
    writeFileSync(p, JSON.stringify(prev));
    // W8-F5: the CLI now verifies the stamped sha for real, so this must be a
    // real commit that is an ancestor of HEAD (the default comparison base)
    // for the dropped-expectedRoutes.ci failure to be the one that fires.
    writeFileSync(n, JSON.stringify({ source: `main@${REAL_ANCESTOR_SHA}`, generatedAt: '2026-08-19T00:00:00.000Z', expectedRoutes: { host: 924 }, entries: [] }));
    const r = runNode([SHRINK, '--prev', p, '--next', n], HERE);
    assert.equal(r.status, 1, `a regeneration that drops expectedRoutes.ci must fail\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout + r.stderr, /expectedRoutes\.ci/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── group 13: W7-A0-4 shrink cross-check + stamped regeneration ──────────────

test('W7-A0-4: unprovenShrinks — a removed entry whose (normalized) route was not crawled is unproven', () => {
  const shrank = [
    { kind: 'never-ready', route: '/flows/forge-develop/run/<id>', detail: 'x' },
    { kind: 'first-party-4xx', route: '/projects/new', detail: '404 [bridge]/api/studio/projects/new/preflight' },
    { kind: 'first-party-4xx', route: '/knowledge?id=trafficGame', detail: '400 y' },
  ];
  const crawled = ['/', '/projects/new', '/flows/forge-develop/run/2026-08-03T01-16-00_INIT-2026-08-03-init-x'];
  const un = unprovenShrinks(shrank, crawled);
  assert.deepEqual(un.map((e) => e.route), ['/knowledge?id=trafficGame']);
  assert.deepEqual(unprovenShrinks(shrank, []).length, 3);
  assert.deepEqual(unprovenShrinks([], crawled), []);
});

test('W7-A0-4: isRegeneration — growth is accepted only through a stamped `main@<sha>` regeneration: new sha, newer generatedAt, expectedRoutes present', () => {
  const prev = { source: 'main@aaaaaaa — host', generatedAt: '2026-08-18T21:38:20.187Z', entries: [] };
  const good = { source: 'main@bbbbbbb — host', generatedAt: '2026-08-19T10:00:00.000Z', expectedRoutes: { host: 700 }, entries: [] };
  assert.equal(isRegeneration(prev, good), true);
  assert.equal(isRegeneration(prev, { ...good, source: prev.source }), false, 'same source stamp = a hand edit, not a regeneration');
  assert.equal(isRegeneration(prev, { ...good, generatedAt: '2026-08-01T00:00:00.000Z' }), false, 'older generatedAt');
  assert.equal(isRegeneration(prev, { ...good, expectedRoutes: undefined }), false, 'a regeneration always records coverage');
  assert.equal(isRegeneration(prev, { ...good, source: 'operator laptop' }), false, 'unstamped source');
  assert.equal(isRegeneration(prev, { ...good, source: 'main@zzz' }), false, 'not a sha');
  assert.equal(isRegeneration(null, good), false, 'first introduction is handled separately');
  assert.equal(isRegeneration({ ...prev, generatedAt: undefined }, good), true, 'a previous file without a stamp can be regenerated over');
});

test('W7-A0-4 (CLI): check-baseline-shrinks --crawled flags removals whose route the crawl never visited (UNPROVEN, exit 0; exit 1 with --fail-unproven); a stamped regeneration may grow', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'w7a0x-'));
  try {
    const prev = join(tmp, 'prev.json');
    const next = join(tmp, 'next.json');
    const crawlFile = join(tmp, 'crawl.json');
    const A = { kind: 'never-ready', route: '/flows/forge-develop/run/<id>', detail: 'data-page=flow-run data-page-ready=null' };
    const B = { kind: 'first-party-4xx', route: '/projects/new', detail: '404 [bridge]/api/studio/projects/new/preflight' };
    writeFileSync(prev, JSON.stringify({ source: 'main@aaaaaaa', generatedAt: '2026-08-18T00:00:00.000Z', entries: [A, B] }));
    // Remove A; the crawl only visited /projects/new → A's removal is unproven.
    writeFileSync(next, JSON.stringify({ source: 'main@aaaaaaa', generatedAt: '2026-08-18T00:00:00.000Z', entries: [B] }));
    writeFileSync(crawlFile, JSON.stringify({ results: [{ route: '/' }, { route: '/projects/new' }] }));
    const warn = runNode([SHRINK, '--prev', prev, '--next', next, '--crawled', crawlFile], HERE);
    assert.equal(warn.status, 0, warn.stdout + warn.stderr);
    assert.match(warn.stdout + warn.stderr, /UNPROVEN/);
    assert.match(warn.stdout + warn.stderr, /\/flows\/forge-develop\/run\/<id>/);
    const strict = runNode([SHRINK, '--prev', prev, '--next', next, '--crawled', crawlFile, '--fail-unproven'], HERE);
    assert.equal(strict.status, 1, `--fail-unproven turns an unproven removal into a failure\n${strict.stdout}\n${strict.stderr}`);
    // The crawl DID visit the route (raw id) → the removal is proven by the crawl gate itself; nothing flagged.
    writeFileSync(crawlFile, JSON.stringify({ results: [{ route: '/flows/forge-develop/run/2026-08-03T01-16-00_INIT-2026-08-03-x' }, { route: '/projects/new' }] }));
    const proven = runNode([SHRINK, '--prev', prev, '--next', next, '--crawled', crawlFile, '--fail-unproven'], HERE);
    assert.equal(proven.status, 0, proven.stdout + proven.stderr);
    assert.doesNotMatch(proven.stdout + proven.stderr, /UNPROVEN/);
    // A missing --crawled file is a usage error, never "nothing to check".
    const missing = runNode([SHRINK, '--prev', prev, '--next', next, '--crawled', join(tmp, 'nope.json')], HERE);
    assert.equal(missing.status, 2);
    // Growth via a stamped regeneration from main is accepted (and says so); the same growth unstamped is not.
    // W8-F5: the CLI now verifies the stamp for real, so the "accepted" case
    // needs a real commit that is an ancestor of HEAD (the default comparison base).
    const C = { kind: 'first-party-4xx', route: '/artifact?cycle=<id>', detail: '404 [bridge]/api/artifact/<id>/plan.json' };
    writeFileSync(next, JSON.stringify({ source: `main@${REAL_ANCESTOR_SHA} — regenerated`, generatedAt: '2026-08-19T00:00:00.000Z', expectedRoutes: { host: 700 }, entries: [A, B, C] }));
    const regen = runNode([SHRINK, '--prev', prev, '--next', next], HERE);
    assert.equal(regen.status, 0, `stamped regeneration may grow\n${regen.stdout}\n${regen.stderr}`);
    assert.match(regen.stdout + regen.stderr, /REGENERAT/i);
    writeFileSync(next, JSON.stringify({ source: 'main@aaaaaaa', generatedAt: '2026-08-18T00:00:00.000Z', entries: [A, B, C] }));
    const grow = runNode([SHRINK, '--prev', prev, '--next', next], HERE);
    assert.equal(grow.status, 1, 'unstamped growth still fails');
    // A regeneration whose expectedRoutes DROPPED for a key vs prev is called out loudly (coverage regressions must be justified).
    writeFileSync(prev, JSON.stringify({ source: 'main@aaaaaaa', generatedAt: '2026-08-18T00:00:00.000Z', expectedRoutes: { host: 900 }, entries: [A, B] }));
    writeFileSync(next, JSON.stringify({ source: `main@${REAL_ANCESTOR_SHA}`, generatedAt: '2026-08-19T00:00:00.000Z', expectedRoutes: { host: 700 }, entries: [A, B] }));
    const dropped = runNode([SHRINK, '--prev', prev, '--next', next], HERE);
    assert.equal(dropped.status, 0);
    assert.match(dropped.stdout + dropped.stderr, /expectedRoutes\.host.*900.*700/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── group 13b: W8-F5 — the sha in a `main@<sha>` stamp is VERIFIED FOR REAL ──
//
// Confirmed defect: isRegeneration accepted a `main@<sha>` stamp on shape
// alone — a sha that never resolved to any git object still authorised
// growth. check-baseline-shrinks.mjs must now resolve the sha (`git cat-file
// -e <sha>^{commit}`) and confirm it is an ancestor of the comparison base
// (`git merge-base --is-ancestor <sha> <base>`) before accepting growth
// through it — fail-closed, no bypass.

test('W8-F5: a stamped main@<sha> whose sha does NOT resolve to a git object does not authorise growth — exact repro (a hand-edited source + bumped generatedAt cannot forge growth)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'w8f5-noresolve-'));
  try {
    const prev = join(tmp, 'prev.json');
    const next = join(tmp, 'next.json');
    writeFileSync(prev, JSON.stringify({
      source: 'main@d1a52609 + the W7-D gate fix round', generatedAt: '2026-08-21T13:35:06.073Z',
      expectedRoutes: { ci: 136, host: 715 }, entries: [],
    }));
    writeFileSync(next, JSON.stringify({
      // The verbatim forged stamp from the repro: a sha-shaped string that
      // does not resolve to anything, plus a bumped generatedAt.
      source: 'main@deadbee + totally hand-edited, never ran --write-baseline',
      generatedAt: '2026-08-21T13:35:07.073Z',
      expectedRoutes: { ci: 136, host: 715 },
      entries: [
        { kind: 'console-error', route: '/monitor', detail: 'TypeError: cannot read x of undefined', message: 'boom' },
        { kind: 'http-500', route: '/api/studio/runs', detail: '500' },
      ],
    }));
    const r = runNode([SHRINK, '--prev', prev, '--next', next], HERE);
    assert.equal(r.status, 1, `an unresolvable sha must refuse the growth\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout + r.stderr, /does not resolve to a commit object/);
    assert.match(r.stdout + r.stderr, /deadbee/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('W8-F5: a stamped main@<sha> that RESOLVES but is NOT an ancestor of the comparison base does not authorise growth', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'w8f5-notancestor-'));
  try {
    const prev = join(tmp, 'prev.json');
    const next = join(tmp, 'next.json');
    // OLD_BASE is an ancestor of HEAD; HEAD is therefore NOT an ancestor of
    // OLD_BASE — a real, resolvable sha that fails the ancestry check when
    // OLD_BASE is the comparison base (--against).
    const headSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: FORGE_ROOT, encoding: 'utf8' }).stdout.trim();
    const oldBase = REAL_ANCESTOR_SHA;
    assert.notEqual(headSha, oldBase, 'fixture precondition: HEAD must differ from the older ancestor sha');
    writeFileSync(prev, JSON.stringify({ source: `main@${oldBase}`, generatedAt: '2026-08-21T00:00:00.000Z', expectedRoutes: { ci: 136, host: 715 }, entries: [] }));
    writeFileSync(next, JSON.stringify({
      source: `main@${headSha}`, generatedAt: '2026-08-21T01:00:00.000Z', expectedRoutes: { ci: 136, host: 715 },
      entries: [{ kind: 'http-500', route: '/api/studio/runs', detail: '500' }],
    }));
    const r = runNode([SHRINK, '--prev', prev, '--next', next, '--against', oldBase], HERE);
    assert.equal(r.status, 1, `a sha that resolves but is not an ancestor of the comparison base must refuse the growth\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout + r.stderr, /not an ancestor/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('W8-F5 CONTROL: a stamped main@<sha> naming a REAL commit that IS an ancestor of the comparison base DOES authorise growth — the gate still works for its real purpose', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'w8f5-control-'));
  try {
    const prev = join(tmp, 'prev.json');
    const next = join(tmp, 'next.json');
    writeFileSync(prev, JSON.stringify({
      source: 'main@d1a52609 + the W7-D gate fix round', generatedAt: '2026-08-21T13:35:06.073Z',
      expectedRoutes: { ci: 136, host: 715 }, entries: [],
    }));
    writeFileSync(next, JSON.stringify({
      source: `main@${REAL_ANCESTOR_SHA} — control regeneration`, generatedAt: '2026-08-21T13:35:07.073Z',
      expectedRoutes: { ci: 136, host: 715 },
      entries: [
        { kind: 'console-error', route: '/monitor', detail: 'TypeError: cannot read x of undefined', message: 'boom' },
        { kind: 'http-500', route: '/api/studio/runs', detail: '500' },
      ],
    }));
    const r = runNode([SHRINK, '--prev', prev, '--next', next], HERE);
    assert.equal(r.status, 0, `a real, ancestor sha must authorise growth\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout + r.stderr, /REGENERAT/i);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── group 14: the committed files carry the new contract ─────────────────────

test('the committed baseline.json is a stamped regeneration from main with a coverage expectation for BOTH environments (ci + host)', () => {
  const b = JSON.parse(readFileSync(join(HERE, 'baseline.json'), 'utf8'));
  assert.match(b.source, /^main@[0-9a-f]{7,40}\b/, 'source is stamped main@<sha> so regenerations are distinguishable from hand edits');
  assert.ok(Number.isInteger(b.expectedRoutes?.ci) && b.expectedRoutes.ci > 40, `expectedRoutes.ci must be a measured CI count (got ${b.expectedRoutes?.ci})`);
  assert.ok(Number.isInteger(b.expectedRoutes?.host) && b.expectedRoutes.host > b.expectedRoutes.ci, `expectedRoutes.host must be the (larger) operator-host count (got ${b.expectedRoutes?.host})`);
  assert.ok(typeof b.expectedRoutesSource?.ci === 'string' && typeof b.expectedRoutesSource?.host === 'string', 'each expectation names where it was measured');
});

test('W7-A0-8: ci.yml passes github.base_ref through the environment (no expression interpolated into a run: block) and cross-checks baseline removals against the crawl', () => {
  const yml = readFileSync(join(HERE, '..', '..', '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.doesNotMatch(yml, /origin\/\$\{\{/, 'github.base_ref must not be interpolated into a shell command');
  assert.match(yml, /BASE_REF:\s*\$\{\{\s*github\.base_ref\s*\}\}/);
  assert.match(yml, /--against "origin\/\$BASE_REF"/);
  assert.match(yml, /check-baseline-shrinks\.mjs[^\n]*--crawled _walkthrough\/ci\/crawl\.json/, 'the post-crawl cross-check (W7-A0-4) runs with the CI crawl');
});
