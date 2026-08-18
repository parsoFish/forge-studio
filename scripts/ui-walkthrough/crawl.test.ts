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
import { join, dirname } from 'node:path';
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
} from './assert.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, 'fixtures', 'crawl.sample.json');
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

test('FAILURE_KINDS names the five classes the gate reports', () => {
  assert.deepEqual([...FAILURE_KINDS].sort(), ['console-error', 'first-party-4xx', 'nav-error', 'never-ready', 'page-error'].sort());
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
    row({ route: '/q', consoleErrors: [
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
  assert.equal(q.length, 1, 'resource-load console lines duplicate the 4xx class; warnings are not errors');
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
    assert.equal(first.status, 0, 'no previous baseline = first introduction, allowed');
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
