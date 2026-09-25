/**
 * forge-8vfn.7.6.16 — `refreshCommunityRegistry` used to fetch its distinct
 * SOURCES one at a time (`for...of` with `await` in the loop body), so N
 * sources cost N x `DEFAULT_REFRESH_TIMEOUT_MS` worst case. These tests pin
 * the things the bead named a fix must decide WITHOUT relaxing them:
 *
 *   1. per-source failure semantics survive concurrency — a failed source's
 *      row stays byte-identical, and its siblings still refresh;
 *   2. errors are reported in SOURCE order, never completion order — the
 *      pool's whole point is that which fetch lands first cannot be observed;
 *   3. a DECLARED concurrency bound is honoured, not an unbounded fan-out;
 *   4. the SAME bound and order-independence apply to `community-refresh-run.ts`'s
 *      hub-discovery pass (folded into this bead per the no-deferral rule) —
 *      hub reads overlap in time, and which id wins is HUB DECLARATION ORDER,
 *      never which hub's read happened to finish first.
 *
 * No network: every case drives an injected `FetchLike` that resolves after a
 * short real delay, so wall-clock timing is genuine rather than mocked.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  refreshCommunityRegistry,
  MAX_CONCURRENT_SOURCE_FETCHES,
  type FetchLike,
} from '../../studio/community-refresh-api.ts';
import { runCommunityRefresh } from '../../community-refresh-run.ts';
import type { CommunityRegistry, CommunityRegistrySource } from '@forge/contracts';

const NOW = new Date('2026-09-19T12:00:00.000Z');
const TOKEN = 'ghp_TEST_TOKEN_NOT_REAL';
/** Real (short) delay per fake fetch — long enough that a serial pass over
 *  several sources is clearly slower than a concurrent one, short enough that
 *  the suite stays fast. */
const DELAY_MS = 150;

/** One item per distinct repo, each seeded with a "seed" source row so a
 *  refresh has something to compare against for the refreshed/unchanged
 *  verdict and for the byte-identical-on-failure assertion. */
function registryWithRepos(repos: readonly string[]): CommunityRegistry {
  const seedSource = (): CommunityRegistrySource => ({
    stars: 1,
    starsDisplay: '1',
    upstreamUpdatedAt: null,
    fetchedAt: null,
    fetchedBy: 'seed',
  });
  return {
    schemaVersion: 2,
    lastRefresh: null,
    hubs: [],
    sources: Object.fromEntries(repos.map((r) => [`github:${r.toLowerCase()}`, seedSource()])),
    items: repos.map((r, i) => ({
      id: `item-${i}`,
      kind: 'skill' as const,
      name: r,
      category: 'testing',
      sourceUrl: `https://github.com/${r}`,
      provenance: r,
      signals: { attributedTo: r },
    })),
    leadingComments: '# test\n',
    itemsCommentLines: [],
    path: '/tmp/registry.yaml',
  };
}

function githubBody(repo: string): unknown {
  return {
    full_name: repo,
    stargazers_count: 999,
    pushed_at: '2026-09-01T00:00:00Z',
    html_url: `https://github.com/${repo}`,
    archived: false,
    topics: ['x'],
  };
}

/** A fetch stub that: (a) actually waits `DELAY_MS` real milliseconds before
 *  answering, so concurrent vs serial is a genuine wall-clock difference, and
 *  (b) tracks how many calls are in flight AT ONCE, so a test can assert the
 *  pool never exceeds its declared bound. */
function trackingFetch(opts: { failRepos?: ReadonlySet<string> } = {}): {
  fetchImpl: FetchLike;
  maxConcurrent: () => number;
  callCount: () => number;
} {
  const fail = opts.failRepos ?? new Set<string>();
  let active = 0;
  let max = 0;
  let calls = 0;
  const fetchImpl: FetchLike = async (url) => {
    calls += 1;
    active += 1;
    max = Math.max(max, active);
    try {
      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(String(url));
      const repo = m !== null ? `${m[1]}/${m[2]}` : '';
      if (fail.has(repo)) {
        return new Response(JSON.stringify({ message: 'boom' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(githubBody(repo)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    } finally {
      active -= 1;
    }
  };
  return { fetchImpl, maxConcurrent: () => max, callCount: () => calls };
}

const FOUR_REPOS = ['obra/superpowers', 'anthropics/skills', 'travisvn/awesome-claude-skills', 'vercel-labs/agent-browser'];

/** A fetch stub that logs each call's start and end IN THE ORDER THEY OCCUR —
 *  never by wall-clock duration. Every worker's async function body runs
 *  synchronously up to its first `await`, so a concurrent pool records ALL of
 *  its "start" events before the event loop can deliver a single "end",
 *  regardless of how CPU-starved the host is. A serial pass, by construction,
 *  cannot do this: its second fetch cannot start until the first one's
 *  callback has actually run, so an "end" always lands before the next
 *  "start". This makes the concurrency proof timing-independent. */
function orderedEventFetch(): {
  fetchImpl: FetchLike;
  events: () => ReadonlyArray<{ kind: 'start' | 'end'; repo: string }>;
} {
  const events: Array<{ kind: 'start' | 'end'; repo: string }> = [];
  const fetchImpl: FetchLike = async (url) => {
    const m = /\/repos\/([^/]+)\/([^/]+)$/.exec(String(url));
    const repo = m !== null ? `${m[1]}/${m[2]}` : String(url);
    events.push({ kind: 'start', repo });
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    events.push({ kind: 'end', repo });
    return new Response(JSON.stringify(githubBody(repo)), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { fetchImpl, events: () => events };
}

test('4 sources fetch CONCURRENTLY: all four starts happen before any end (overlap), proven by event order not wall-clock', async () => {
  const { fetchImpl, events } = orderedEventFetch();
  await refreshCommunityRegistry({ registry: registryWithRepos(FOUR_REPOS), fetchImpl, token: TOKEN, now: NOW });
  const log = events();
  const firstEndIndex = log.findIndex((e) => e.kind === 'end');
  assert.notEqual(firstEndIndex, -1, 'expected at least one fetch to complete');
  const startsBeforeFirstEnd = log.slice(0, firstEndIndex).filter((e) => e.kind === 'start').length;
  assert.equal(
    startsBeforeFirstEnd,
    FOUR_REPOS.length,
    `only ${startsBeforeFirstEnd} of ${FOUR_REPOS.length} fetches had STARTED before the first one finished — a ` +
      `concurrent pool starts every fetch before any of them can complete, which proves overlap independent of ` +
      `wall-clock timing. log=${JSON.stringify(log)}`,
  );
});

test('a FAILING source among four leaves its row byte-identical while its three siblings still refresh', async () => {
  const before = registryWithRepos(FOUR_REPOS);
  const failingKey = 'github:vercel-labs/agent-browser';
  const beforeFailingRow = before.sources[failingKey];
  const { fetchImpl } = trackingFetch({ failRepos: new Set(['vercel-labs/agent-browser']) });

  const res = await refreshCommunityRegistry({ registry: before, fetchImpl, token: TOKEN, now: NOW });

  assert.equal(res.errors.length, 1, JSON.stringify(res.errors));
  assert.equal(res.errors[0].source, failingKey);
  assert.deepEqual(
    res.nextRegistry.sources[failingKey],
    beforeFailingRow,
    'a failed fetch under concurrency must still leave its row byte-identical',
  );
  for (const r of ['obra/superpowers', 'anthropics/skills', 'travisvn/awesome-claude-skills']) {
    const outcome = res.outcomes.find((o) => o.source === `github:${r.toLowerCase()}`);
    assert.ok(outcome !== undefined, `no outcome recorded for ${r}`);
    assert.equal(outcome!.status, 'refreshed', `${r} should have refreshed even though a sibling source failed`);
  }
});

test(`concurrency is BOUNDED: with more sources than MAX_CONCURRENT_SOURCE_FETCHES, never more than the bound is in flight at once`, async () => {
  const repos = Array.from({ length: MAX_CONCURRENT_SOURCE_FETCHES + 3 }, (_, i) => `owner${i}/repo${i}`);
  const { fetchImpl, maxConcurrent } = trackingFetch();

  await refreshCommunityRegistry({ registry: registryWithRepos(repos), fetchImpl, token: TOKEN, now: NOW });

  assert.ok(
    maxConcurrent() <= MAX_CONCURRENT_SOURCE_FETCHES,
    `saw ${maxConcurrent()} concurrent fetches in flight — the declared bound of ${MAX_CONCURRENT_SOURCE_FETCHES} was not honoured`,
  );
  assert.ok(maxConcurrent() > 1, 'the pool never ran more than one fetch at a time — this is still effectively serial');
});

test('errors are reported in SOURCE order, never completion order (a fast failure must not jump ahead of a slow one)', async () => {
  // "first"/"second" name their position in registry.items — the source order
  // this must be reported in. Their FETCH order is the reverse: "first" is
  // slow, "second" is fast, so completion order and source order disagree.
  const repos = ['aaa-owner/first', 'bbb-owner/second'];
  const fetchImpl: FetchLike = async (url) => {
    const isFirst = String(url).includes('aaa-owner/first');
    await new Promise((resolve) => setTimeout(resolve, isFirst ? DELAY_MS : 5));
    return new Response(JSON.stringify({ message: 'boom' }), { status: 500, headers: { 'content-type': 'application/json' } });
  };

  const res = await refreshCommunityRegistry({ registry: registryWithRepos(repos), fetchImpl, token: TOKEN, now: NOW });

  assert.deepEqual(
    res.errors.map((e) => e.source),
    ['github:aaa-owner/first', 'github:bbb-owner/second'],
    'errors must be ordered by SOURCE (registry order), not by which fetch settled first',
  );
});

// ---------------------------------------------------------------------------
// community-refresh-run.ts's hub-discovery pass — folded into this bead
// (its own comment named 7.6.16; the no-deferral rule keeps it here rather
// than a second bead). Drives the real `runCommunityRefresh` orchestrator
// against a temp forgeRoot with two declared GitHub hubs.
// ---------------------------------------------------------------------------

function tempForgeRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'community-refresh-hubs-'));
  mkdirSync(join(d, 'studio', 'community'), { recursive: true });
  writeFileSync(join(d, 'studio', 'community', 'registry.yaml'), 'meta:\n  schemaVersion: 2\n  lastRefresh: null\n\nsources: {}\n\nitems: []\n', 'utf8');
  return d;
}

test('hub reads run CONCURRENTLY and a shared id is attributed by HUB DECLARATION ORDER, never by which read finished first', async () => {
  const HUB1_REPO = 'hub-owner-one/hub-repo-one';
  const HUB2_REPO = 'hub-owner-two/hub-repo-two';
  const forgeRoot = tempForgeRoot();
  writeFileSync(
    join(forgeRoot, 'studio', 'community', 'hubs.yaml'),
    `hubs:\n  - id: hub-one\n    name: hub one\n    url: https://github.com/${HUB1_REPO}\n    kinds: skills\n` +
      `  - id: hub-two\n    name: hub two\n    url: https://github.com/${HUB2_REPO}\n    kinds: skills\n`,
    'utf8',
  );

  // hub-one (declared FIRST) and hub-two (declared SECOND) both publish the
  // same id. `events` logs each fetch's start/end IN THE ORDER THEY OCCUR (not
  // by wall-clock duration) — the same construction as the FOUR_REPOS test
  // above: both hubs' reads are dispatched in the same synchronous batch
  // (`mapInBatches`), so hub-two's first start is guaranteed to be logged
  // before hub-one's last end REGARDLESS of how CPU-starved the host is. This
  // proves the two reads overlap rather than one running only after the other
  // finishes, without comparing any timestamps.
  const events: Array<{ kind: 'start' | 'end'; which: 'hub1' | 'hub2' }> = [];
  const fetchImpl: FetchLike = async (url) => {
    const u = String(url);
    const which: 'hub1' | 'hub2' = u.includes(HUB1_REPO) ? 'hub1' : 'hub2';
    events.push({ kind: 'start', which });
    await new Promise((resolve) => setTimeout(resolve, which === 'hub1' ? DELAY_MS : 5));
    events.push({ kind: 'end', which });
    if (/\/git\/trees\//.test(u)) {
      return new Response(
        JSON.stringify({ sha: 'treesha', truncated: false, tree: [{ path: 'skills/shared-thing/SKILL.md', type: 'blob', mode: '100644', sha: 'x', size: 10 }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const r = await runCommunityRefresh({ forgeRoot, fetchImpl, token: TOKEN });
    if (!r.ok) assert.fail(`expected an ok refresh, got: ${JSON.stringify(r)}`);

    assert.deepEqual(
      r.discovered.map((d) => d.id),
      ['shared-thing'],
      'both hubs publish the same id — it must be discovered exactly once',
    );
    assert.equal(
      r.discovered[0]!.sourceUrl,
      `https://github.com/${HUB1_REPO}`,
      'a shared id must be attributed to the FIRST-DECLARED hub — never the one whose read happened to finish first',
    );
    const hub2FirstStart = events.findIndex((e) => e.kind === 'start' && e.which === 'hub2');
    const hub1LastEnd = events.map((e, i) => (e.kind === 'end' && e.which === 'hub1' ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    assert.notEqual(hub2FirstStart, -1, 'expected hub-two to have been read at least once');
    assert.notEqual(hub1LastEnd, -1, 'expected hub-one to have finished reading');
    assert.ok(
      hub2FirstStart < hub1LastEnd,
      `hub reads did not overlap: hub-two's first start was event #${hub2FirstStart}, hub-one's last end was event ` +
        `#${hub1LastEnd} — a concurrent pool starts hub-two before hub-one's read is done. log=${JSON.stringify(events)}`,
    );
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
