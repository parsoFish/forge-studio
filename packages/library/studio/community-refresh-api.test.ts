/**
 * W8-B5 WI-1 — the DETERMINISTIC community refresh (exit rows E1/E2/E3).
 *
 * No LLM anywhere in this path and NO NETWORK in any test: `refreshCommunityRegistry`
 * takes an injected `FetchLike`, so every case below is driven by a stub.
 *
 * The contract under test, in one line: FAIL LOUD, NEVER SERVE STALE. A row
 * whose fetch could not be verified stays byte-identical and is reported — a
 * refresh never stamps a row fresh on a failure. That inherits
 * `commitRegistryDraft`'s evidence discipline
 * (orchestrator/interactive-finalizers.ts:606) and makes it deterministic.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  refreshCommunityRegistry,
  CommunityRefreshError,
  GH_TOKEN_ENV,
  fetchNpmPackage,
  fetchMcpServer,
  fetchAllowedApiUrl,
  type FetchLike,
} from './community-refresh-api.ts';
import { serializeCommunityRegistry } from '../../../orchestrator/studio/registry.ts';
import type { CommunityRegistry } from '@forge/contracts/studio/types.ts';

const NOW = new Date('2026-08-23T12:00:00.000Z');
const TOKEN = 'ghp_TOTALLY_SECRET_VALUE_do_not_leak';

function registry(over: Partial<CommunityRegistry> = {}): CommunityRegistry {
  return {
    schemaVersion: 2,
    lastRefresh: null,
    sources: {
      'github:obra/superpowers': {
        stars: 228000,
        starsDisplay: '228k',
        upstreamUpdatedAt: null,
        fetchedAt: null,
        fetchedBy: 'seed',
      },
    },
    items: [
      {
        id: 'superpowers-tdd',
        kind: 'skill',
        name: 'TDD',
        category: 'testing',
        sourceUrl: 'https://github.com/obra/superpowers',
        provenance: 'obra/superpowers',
        signals: { attributedTo: 'obra/superpowers' },
      },
      {
        id: 'systematic-debugging',
        kind: 'skill',
        name: 'Systematic Debugging',
        category: 'debugging',
        sourceUrl: 'https://github.com/obra/superpowers',
        provenance: 'obra/superpowers',
        signals: { attributedTo: 'obra/superpowers' },
      },
      {
        id: 'pre-impl-interview',
        kind: 'skill',
        name: 'Pre-implementation Interview',
        category: 'planning',
        sourceUrl: 'https://www.firecrawl.dev/blog/best-claude-code-skills',
        provenance: 'Matt Pocock',
        signals: { attributedTo: 'Matt Pocock' },
      },
    ],
    leadingComments: '# curated\n',
    itemsCommentLines: [],
    path: '/tmp/registry.yaml',
    ...over,
  };
}

const GH_OK = {
  full_name: 'obra/superpowers',
  stargazers_count: 276412,
  pushed_at: '2026-08-19T17:33:23Z',
  html_url: 'https://github.com/obra/superpowers',
  archived: false,
  topics: ['ai', 'skills'],
};

type Call = { url: string; init: RequestInit | undefined };

function stub(handler: (url: string) => Response | Promise<Response> | never): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return handler(url);
  };
  return { fetchImpl, calls };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

// ---------------------------------------------------------------------------
// E1 — the credential
// ---------------------------------------------------------------------------

test('token ABSENT: throws a named missing-token error, names GH_TOKEN, and makes ZERO fetches (nothing is written)', async () => {
  const { fetchImpl, calls } = stub(() => json(GH_OK));
  await assert.rejects(
    () => refreshCommunityRegistry({ registry: registry(), fetchImpl, token: undefined, now: NOW }),
    (err: CommunityRefreshError) => {
      assert.ok(err instanceof CommunityRefreshError);
      assert.equal(err.kind, 'missing-token');
      assert.match(err.message, new RegExp(GH_TOKEN_ENV));
      return true;
    },
  );
  assert.equal(calls.length, 0, 'a missing credential must be detected BEFORE any request');
});

test('token ABSENT but no GitHub source at all: no throw — the credential is only required by the arm that needs it', async () => {
  const { fetchImpl, calls } = stub(() => json({ 'dist-tags': { latest: '1.2.3' }, time: { modified: '2026-01-01T00:00:00Z' } }));
  const reg = registry({
    sources: {},
    items: [
      {
        id: 'x',
        kind: 'skill',
        name: 'X',
        category: 'meta',
        sourceUrl: 'https://www.npmjs.com/package/js-yaml',
        provenance: 'npm',
        signals: { attributedTo: 'npm' },
      },
    ],
  });
  const res = await refreshCommunityRegistry({ registry: reg, fetchImpl, token: undefined, now: NOW });
  assert.equal(res.outcomes[0].status, 'refreshed');
  assert.equal(calls.length, 1);
});

test('token INVALID (401): throws a named invalid-token error and aborts the whole pass', async () => {
  const { fetchImpl } = stub(() => json({ message: 'Bad credentials' }, 401));
  await assert.rejects(
    () => refreshCommunityRegistry({ registry: registry(), fetchImpl, token: TOKEN, now: NOW }),
    (err: CommunityRefreshError) => {
      assert.equal(err.kind, 'invalid-token');
      assert.match(err.message, new RegExp(GH_TOKEN_ENV));
      return true;
    },
  );
});

test('RATE LIMITED (403 + x-ratelimit-remaining: 0): a distinct named error that surfaces the reset as a human time', async () => {
  const reset = Math.floor(Date.parse('2026-08-23T13:00:00.000Z') / 1000);
  const { fetchImpl } = stub(() =>
    json({ message: 'API rate limit exceeded' }, 403, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(reset),
    }),
  );
  await assert.rejects(
    () => refreshCommunityRegistry({ registry: registry(), fetchImpl, token: TOKEN, now: NOW }),
    (err: CommunityRefreshError) => {
      assert.equal(err.kind, 'rate-limited');
      assert.match(err.message, /2026-08-23T13:00:00/, `reset must be rendered as a human time: ${err.message}`);
      return true;
    },
  );
});

test('403 WITHOUT remaining:0 is NOT reported as a rate limit (kills: treating every 403 as throttling)', async () => {
  const { fetchImpl } = stub(() => json({ message: 'Forbidden' }, 403, { 'x-ratelimit-remaining': '4999' }));
  const res = await refreshCommunityRegistry({ registry: registry(), fetchImpl, token: TOKEN, now: NOW });
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].kind, 'http-error');
});

test('the token value NEVER appears in any error, outcome, or serialized registry', async () => {
  for (const handler of [
    () => json({ message: 'Bad credentials' }, 401),
    () => json({ message: 'nope' }, 500),
    () => json(GH_OK),
  ]) {
    const { fetchImpl } = stub(handler);
    let blob: string;
    try {
      const res = await refreshCommunityRegistry({ registry: registry(), fetchImpl, token: TOKEN, now: NOW });
      blob = JSON.stringify(res) + serializeCommunityRegistry(res.nextRegistry);
    } catch (err) {
      blob = `${(err as Error).message}\n${(err as Error).stack ?? ''}`;
    }
    assert.ok(!blob.includes(TOKEN), 'the credential leaked into output');
    assert.ok(!blob.includes('ghp_'), 'a credential-shaped string leaked into output');
  }
});

// ---------------------------------------------------------------------------
// E2 — verified writes only; a failed row stays byte-identical
// ---------------------------------------------------------------------------

test('a successful GitHub refresh stamps fetchedBy: api:github, a real fetchedAt, and derived star facts', async () => {
  const { fetchImpl, calls } = stub(() => json(GH_OK));
  const res = await refreshCommunityRegistry({ registry: registry(), fetchImpl, token: TOKEN, now: NOW });
  const src = res.nextRegistry.sources['github:obra/superpowers'];
  assert.equal(src.fetchedBy, 'api:github');
  assert.equal(src.fetchedAt, NOW.toISOString());
  assert.equal(src.stars, 276412);
  assert.equal(src.starsDisplay, '276k');
  assert.equal(src.upstreamUpdatedAt, '2026-08-19T17:33:23Z');
  assert.equal(src.archived, false);
  assert.deepEqual(src.topics, ['ai', 'skills']);
  assert.equal(res.nextRegistry.lastRefresh, NOW.toISOString());
  assert.equal(calls.length, 1, 'two items sharing a repo must cost ONE request');
});

test('the outbound request is built against the API origin with the documented GitHub headers', async () => {
  const { fetchImpl, calls } = stub(() => json(GH_OK));
  await refreshCommunityRegistry({ registry: registry(), fetchImpl, token: TOKEN, now: NOW });
  assert.equal(calls[0].url, 'https://api.github.com/repos/obra/superpowers');
  const h = new Headers(calls[0].init?.headers);
  assert.equal(h.get('authorization'), `Bearer ${TOKEN}`);
  assert.equal(h.get('accept'), 'application/vnd.github+json');
  assert.equal(h.get('x-github-api-version'), '2022-11-28');
  assert.equal(h.get('user-agent'), 'forge-community-refresh');
  assert.equal(calls[0].init?.redirect, 'manual', 'redirects must never be followed implicitly');
});

for (const [label, handler, kind] of [
  ['404 (gone upstream)', () => json({ message: 'Not Found' }, 404), 'not-found'],
  ['500 (upstream error)', () => json({ message: 'boom' }, 500), 'http-error'],
  [
    'a network throw',
    () => {
      throw new TypeError('fetch failed');
    },
    'network-error',
  ],
  [
    'a timeout',
    () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    },
    'timeout',
  ],
  ['a malformed body (no stargazers_count)', () => json({ full_name: 'obra/superpowers' }), 'malformed-response'],
  ['a non-JSON body', () => new Response('<html>nope</html>', { status: 200 }), 'malformed-response'],
] as const) {
  test(`FAILED FETCH — ${label} — leaves the source row BYTE-IDENTICAL and reports kind "${kind}"`, async () => {
    const before = registry();
    const beforeBytes = serializeCommunityRegistry(before);
    const { fetchImpl } = stub(handler as () => Response);
    const res = await refreshCommunityRegistry({ registry: before, fetchImpl, token: TOKEN, now: NOW });

    assert.equal(res.errors.length, 1, JSON.stringify(res.errors));
    assert.equal(res.errors[0].kind, kind);
    assert.equal(res.errors[0].source, 'github:obra/superpowers');

    // The bytes, not a field: the only assertion a "we stamped it anyway" bug
    // cannot slip past.
    assert.equal(
      serializeCommunityRegistry(res.nextRegistry),
      beforeBytes,
      'a failed fetch must never change the file',
    );
    for (const id of ['superpowers-tdd', 'systematic-debugging']) {
      const o = res.outcomes.find((x) => x.id === id)!;
      assert.equal(o.status, 'failed');
    }
  });
}

test('meta.lastRefresh is NOT stamped when every source failed (a pass that verified nothing did not refresh anything)', async () => {
  const { fetchImpl } = stub(() => json({ message: 'Not Found' }, 404));
  const res = await refreshCommunityRegistry({ registry: registry(), fetchImpl, token: TOKEN, now: NOW });
  assert.equal(res.nextRegistry.lastRefresh, null);
});

test('a verified-but-identical source is reported "unchanged" and still gets a fresh fetchedAt (it WAS verified)', async () => {
  const { fetchImpl } = stub(() => json({ ...GH_OK, stargazers_count: 228000, pushed_at: null, topics: [], archived: false }));
  const reg = registry({
    sources: {
      'github:obra/superpowers': {
        stars: 228000,
        starsDisplay: '228k',
        upstreamUpdatedAt: null,
        fetchedAt: null,
        fetchedBy: 'seed',
        archived: false,
        topics: [],
      },
    },
  });
  const res = await refreshCommunityRegistry({ registry: reg, fetchImpl, token: TOKEN, now: NOW });
  assert.equal(res.outcomes.find((o) => o.id === 'superpowers-tdd')!.status, 'unchanged');
  assert.equal(res.nextRegistry.sources['github:obra/superpowers'].fetchedAt, NOW.toISOString());
});

// ---------------------------------------------------------------------------
// W8-B5 adversarial review, FINDING 2 — `archived` / `topics` / `version` are
// NOT surfaced anywhere in the UI, but they are NOT dead data either: they are
// change-detection inputs read by `sameFacts`. A repo that flipped to
// archived, retitled its topics, or shipped a new version IS a changed source
// and must read `refreshed`, not `unchanged`.
//
// These tests convert that doc claim into an enforced one — the actual cure
// for `declared-data-fails-open`. Each holds EVERY other fact identical, so
// only the named field can be what flips the status. Delete the matching
// comparison from `sameFacts` and the corresponding test goes red.
// ---------------------------------------------------------------------------

/** A registry whose single GitHub source already carries the exact facts the
 *  stub is about to return, so the pass is `unchanged` by default and any
 *  reported `refreshed` is attributable to the ONE field under test. */
function identicalGithubRegistry(over: Record<string, unknown> = {}) {
  return registry({
    sources: {
      'github:obra/superpowers': {
        stars: 276412,
        starsDisplay: '276k',
        upstreamUpdatedAt: '2026-08-19T17:33:23Z',
        fetchedAt: '2026-01-01T00:00:00.000Z',
        fetchedBy: 'api:github',
        archived: false,
        topics: ['ai', 'skills'],
        ...over,
      },
    },
  });
}

function githubStatus(reg: CommunityRegistry, body: Record<string, unknown>): Promise<string> {
  const { fetchImpl } = stub(() => json(body));
  return refreshCommunityRegistry({ registry: reg, fetchImpl, token: TOKEN, now: NOW }).then(
    (res) => res.outcomes.find((o) => o.id === 'superpowers-tdd')!.status,
  );
}

test('CONTROL: with every fetched fact identical the source reads "unchanged" (so the three tests below isolate one field each)', async () => {
  assert.equal(await githubStatus(identicalGithubRegistry(), GH_OK), 'unchanged');
});

test('a source that flipped to ARCHIVED reads "refreshed", not "unchanged" — archived is a change-detection input', async () => {
  assert.equal(await githubStatus(identicalGithubRegistry(), { ...GH_OK, archived: true }), 'refreshed');
});

test('a source whose TOPICS changed reads "refreshed", not "unchanged" — topics is a change-detection input', async () => {
  assert.equal(await githubStatus(identicalGithubRegistry(), { ...GH_OK, topics: ['ai', 'skills', 'agents'] }), 'refreshed');
});

test('a source whose VERSION changed reads "refreshed", not "unchanged" — version is a change-detection input', async () => {
  const reg = registry({
    sources: {
      'npm:js-yaml': {
        stars: null,
        starsDisplay: null,
        upstreamUpdatedAt: '2026-01-01T00:00:00Z',
        fetchedAt: '2026-01-01T00:00:00.000Z',
        fetchedBy: 'api:npm',
        version: '1.0.0',
      },
    },
    items: [
      {
        id: 'superpowers-tdd',
        kind: 'skill',
        name: 'TDD',
        category: 'testing',
        sourceUrl: 'https://www.npmjs.com/package/js-yaml',
        provenance: 'npm',
        signals: { attributedTo: 'npm' },
      },
    ],
  });
  const npmBody = { 'dist-tags': { latest: '1.0.0' }, time: { modified: '2026-01-01T00:00:00Z' } };
  assert.equal(await githubStatus(reg, npmBody), 'unchanged', 'control: an identical npm answer must read unchanged');
  assert.equal(
    await githubStatus(reg, { ...npmBody, 'dist-tags': { latest: '2.0.0' } }),
    'refreshed',
    'a new published version is a real change',
  );
});

test('the input registry is NEVER mutated (immutability: return a new object)', async () => {
  const before = registry();
  const snapshot = structuredClone(before);
  const { fetchImpl } = stub(() => json(GH_OK));
  const res = await refreshCommunityRegistry({ registry: before, fetchImpl, token: TOKEN, now: NOW });
  assert.deepEqual(before, snapshot, 'the caller-supplied registry was mutated');
  assert.notEqual(res.nextRegistry, before);
});

test('the caller owns the write: the refresh touches no filesystem, it only RETURNS a next registry', async () => {
  const { fetchImpl } = stub(() => json(GH_OK));
  const res = await refreshCommunityRegistry({ registry: registry(), fetchImpl, token: TOKEN, now: NOW });
  assert.ok('nextRegistry' in res && 'outcomes' in res && 'errors' in res);
  assert.equal(res.nextRegistry.path, registry().path, 'the target path threads through untouched');
});

// ---------------------------------------------------------------------------
// E3 — SSRF containment at the request seam
// ---------------------------------------------------------------------------

for (const evil of [
  'http://169.254.169.254/latest/meta-data/',
  'https://github.com.evil.com/a/b',
  'https://user@github.com/a/b',
  'https://github.com/onlyowner',
  'file:///etc/passwd',
  'https://raw.githubusercontent.com/o/r/main/x',
]) {
  test(`SSRF — a row whose sourceUrl is "${evil}" makes ZERO requests and is reported no-upstream (never fetched, never an error)`, async () => {
    const { fetchImpl, calls } = stub(() => json(GH_OK));
    const reg = registry({
      sources: {},
      items: [
        {
          id: 'evil',
          kind: 'skill',
          name: 'Evil',
          category: 'meta',
          sourceUrl: evil,
          provenance: 'operator',
          signals: { attributedTo: null },
        },
      ],
    });
    const res = await refreshCommunityRegistry({ registry: reg, fetchImpl, token: TOKEN, now: NOW });
    assert.equal(calls.length, 0, `a request was made for ${evil}`);
    assert.equal(res.outcomes[0].status, 'no-upstream');
    assert.deepEqual(res.errors, []);
  });
}

test('SSRF — a 3xx whose Location LEAVES the allowlist is refused, not followed', async () => {
  const { fetchImpl, calls } = stub(
    () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }),
  );
  const res = await refreshCommunityRegistry({ registry: registry(), fetchImpl, token: TOKEN, now: NOW });
  assert.equal(calls.length, 1, 'the redirect must NOT be followed');
  assert.equal(res.errors[0].kind, 'blocked-redirect');
  assert.match(res.errors[0].message, /169\.254\.169\.254|allowlist/);
});

test('a 3xx that stays INSIDE the allowlist is followed (GitHub 301s a renamed repo)', async () => {
  let n = 0;
  const { fetchImpl, calls } = stub(() => {
    n++;
    if (n === 1) {
      return new Response(null, { status: 301, headers: { location: 'https://api.github.com/repositories/12345' } });
    }
    return json(GH_OK);
  });
  const res = await refreshCommunityRegistry({ registry: registry(), fetchImpl, token: TOKEN, now: NOW });
  assert.equal(calls.length, 2);
  assert.equal(res.nextRegistry.sources['github:obra/superpowers'].stars, 276412);
});

test('a redirect LOOP inside the allowlist terminates instead of hanging', async () => {
  const { fetchImpl, calls } = stub(
    () => new Response(null, { status: 302, headers: { location: 'https://api.github.com/repos/a/b' } }),
  );
  const res = await refreshCommunityRegistry({ registry: registry(), fetchImpl, token: TOKEN, now: NOW });
  assert.ok(calls.length <= 5, `unbounded redirect following: ${calls.length} requests`);
  assert.equal(res.errors[0].kind, 'blocked-redirect');
});

// ---------------------------------------------------------------------------
// The other two adapters
// ---------------------------------------------------------------------------

test('npm adapter: builds the documented scoped-package URL and reads dist-tags.latest + time.modified', async () => {
  const { fetchImpl, calls } = stub(() =>
    json({ 'dist-tags': { latest: '2026.7.10' }, time: { modified: '2026-07-10T03:31:11.295Z' } }),
  );
  const facts = await fetchNpmPackage({ fetchImpl, timeoutMs: 1000 }, '@modelcontextprotocol/server-filesystem');
  assert.equal(calls[0].url, 'https://registry.npmjs.org/@modelcontextprotocol%2Fserver-filesystem');
  assert.deepEqual(facts, { version: '2026.7.10', upstreamUpdatedAt: '2026-07-10T03:31:11.295Z' });
});

test('mcp adapter: reads the NESTED payload (record under "server", metadata under the dotted key)', async () => {
  const { fetchImpl, calls } = stub(() =>
    json({
      servers: [
        {
          server: { name: 'other/x', version: '9.9.9' },
          _meta: { 'io.modelcontextprotocol.registry/official': { updatedAt: '2020-01-01T00:00:00Z', isLatest: true } },
        },
        {
          server: { name: 'ac.inference.sh/mcp', version: '2.0.1' },
          _meta: { 'io.modelcontextprotocol.registry/official': { updatedAt: '2026-07-27T10:44:51.359634Z', isLatest: true } },
        },
      ],
      metadata: { count: 2 },
    }),
  );
  const facts = await fetchMcpServer({ fetchImpl, timeoutMs: 1000 }, 'ac.inference.sh/mcp');
  assert.ok(calls[0].url.startsWith('https://registry.modelcontextprotocol.io/v0/servers?'));
  assert.deepEqual(facts, { version: '2.0.1', upstreamUpdatedAt: '2026-07-27T10:44:51.359634Z' });
});

test('mcp adapter: a MISSING _meta block degrades to a null timestamp, it does not crash (the key is optional)', async () => {
  const { fetchImpl } = stub(() => json({ servers: [{ server: { name: 'a/b', version: '1.0.0' } }], metadata: {} }));
  const facts = await fetchMcpServer({ fetchImpl, timeoutMs: 1000 }, 'a/b');
  assert.deepEqual(facts, { version: '1.0.0', upstreamUpdatedAt: null });
});

test('mcp adapter: a server name not in the listing is a named not-found error, never a fabricated row', async () => {
  const { fetchImpl } = stub(() => json({ servers: [{ server: { name: 'other/x', version: '1' } }], metadata: {} }));
  await assert.rejects(
    () => fetchMcpServer({ fetchImpl, timeoutMs: 1000 }, 'absent/server'),
    (err: CommunityRefreshError) => err.kind === 'not-found',
  );
});

test('an ORPHAN source row (no item refers to it) is dropped — a repo fact nothing resolves cannot go stale unseen', async () => {
  const { fetchImpl } = stub(() => json(GH_OK));
  const reg = registry({
    sources: {
      'github:obra/superpowers': {
        stars: 1,
        starsDisplay: '1',
        upstreamUpdatedAt: null,
        fetchedAt: null,
        fetchedBy: 'seed',
      },
      'github:gone/away': {
        stars: 999,
        starsDisplay: '999',
        upstreamUpdatedAt: null,
        fetchedAt: null,
        fetchedBy: 'seed',
      },
    },
  });
  const res = await refreshCommunityRegistry({ registry: reg, fetchImpl, token: TOKEN, now: NOW });
  assert.deepEqual(Object.keys(res.nextRegistry.sources), ['github:obra/superpowers']);
});

test('a per-source failure is reported ONCE even though three items share the repo', async () => {
  const { fetchImpl } = stub(() => json({ message: 'boom' }, 500));
  const reg = registry();
  reg.items.push({
    id: 'third',
    kind: 'skill',
    name: 'Third',
    category: 'meta',
    sourceUrl: 'https://github.com/obra/superpowers/tree/main/x',
    provenance: 'obra/superpowers',
    signals: { attributedTo: null },
  });
  const res = await refreshCommunityRegistry({ registry: reg, fetchImpl, token: TOKEN, now: NOW });
  assert.equal(res.errors.length, 1, 'one upstream failure is one error, not one per row');
  assert.equal(res.outcomes.filter((o) => o.status === 'failed').length, 3, 'but every affected ITEM is reported');
});

// ---------------------------------------------------------------------------
// The fetch seam itself — the containment ratchet, driven directly.
//
// No adapter can reach this check today (every one encodes its inputs), which
// is exactly why it is tested here: it exists so that a FUTURE adapter cannot
// open the hole by forgetting to encode. A guard nothing exercises is a guard
// nobody notices deleting.
// ---------------------------------------------------------------------------

test('fetchAllowedApiUrl refuses a non-allowlisted origin BEFORE any request is made', async () => {
  for (const evil of [
    'http://169.254.169.254/latest/meta-data/',
    'https://api.github.com.evil.com/repos/a/b',
    'https://api.github.com@evil.com/repos/a/b',
    'https://api.github.com:8443/repos/a/b',
    'file:///etc/passwd',
  ]) {
    const { fetchImpl, calls } = stub(() => json(GH_OK));
    await assert.rejects(
      () => fetchAllowedApiUrl({ fetchImpl, timeoutMs: 1000 }, evil, {}),
      (err: CommunityRefreshError) => {
        assert.equal(err.kind, 'blocked-origin', `${evil} was not refused as blocked-origin`);
        return true;
      },
    );
    assert.equal(calls.length, 0, `a request was made to ${evil}`);
  }
});

test('fetchAllowedApiUrl admits an allowlisted origin and passes the headers through', async () => {
  const { fetchImpl, calls } = stub(() => json(GH_OK));
  const res = await fetchAllowedApiUrl({ fetchImpl, timeoutMs: 1000 }, 'https://api.github.com/repos/a/b', { 'X-Test': '1' });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(new Headers(calls[0].init?.headers).get('x-test'), '1');
});
