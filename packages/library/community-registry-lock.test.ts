/**
 * W8-B5 security review, FINDING 1 — `studio/community/registry.yaml` has
 * TWO independent read-modify-write callers and, before this file existed,
 * not one of them took a lock:
 *
 *   1. `runCommunityRefresh`      (cli/community-refresh-run.ts)
 *   2. `mutateCommunityRegistry`  (bridge-studio-community-crud.ts, the CRUD routes)
 *
 * (HISTORY, W8-B5b: a third caller, `commitRegistryDraft`
 * (orchestrator/interactive-finalizers.ts), existed until the community-
 * refresh interactive session kind it finalized — mechanism A — retired,
 * superseded by `runCommunityRefresh`'s deterministic refresh, W8-B5.)
 *
 * Each loaded the file, computed, then temp-wrote + renamed. The rename is
 * atomic, so the file was never CORRUPT — it was silently WRONG: last rename
 * wins and the other writer's update vanishes with no error surfaced to
 * either caller. W8-B5 made that materially worse by putting a NETWORK phase
 * (timeoutMs x N distinct sources — minutes for a large registry) inside the
 * refresh's read-modify-write window.
 *
 * THE DESIGN UNDER TEST — optimistic concurrency, not a lock held across the
 * network. Holding the lock through the fetches would block every curation
 * edit for minutes; that trades a rare lost update for a common stall. So:
 * fetch OUTSIDE any lock, then take the lock, RE-LOAD the registry from disk,
 * apply the freshly-verified facts onto THAT document, write, release.
 *
 * This composes correctly because of schema v2's shape: the refresh writes
 * only `sources` + `meta.lastRefresh`; CRUD writes only `items`. Under a
 * re-load-under-lock the two MERGE rather than one clobbering the other, and
 * these tests are what pins that — each one starts both writers and lets them
 * interleave for real, never merely asserting that a lock object was acquired.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { startBridge } from '../../apps/forge/ui-bridge.ts';
import { runCommunityRefresh } from './community-refresh-run.ts';
import {
  COMMUNITY_REGISTRY_LOCK_STALE_MS,
  CommunityRegistryLockError,
  communityRegistryLockTarget,
  lockCommunityRegistry,
} from './community-registry-lock.ts';
import type { FetchLike } from './studio/community-refresh-api.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };
const FAKE_TOKEN = 'ghp_LOCKTESTTOKENneverRendered000000000000';

const A_KEY = 'github:example/alpha';
const B_KEY = 'github:example/beta';

const ITEM_A = {
  id: 'alpha',
  kind: 'skill',
  name: 'Alpha',
  category: 'testing',
  sourceUrl: 'https://github.com/example/alpha',
  provenance: 'example/alpha',
  signals: { attributedTo: null },
};

const ITEM_B = {
  id: 'beta',
  kind: 'skill',
  name: 'Beta',
  category: 'testing',
  sourceUrl: 'https://github.com/example/beta',
  provenance: 'example/beta',
  signals: { attributedTo: null },
};

/** The pre-refresh, hand-seeded facts. `fetchedBy: seed` is what makes a
 *  clobber visible: a row the refresh really wrote reads `api:github`. */
const SEED_SOURCE = {
  stars: 1,
  starsDisplay: '1',
  upstreamUpdatedAt: null,
  fetchedAt: null,
  fetchedBy: 'seed',
};

const NEW_ITEM_BODY = {
  id: 'gamma',
  kind: 'skill',
  name: 'Gamma',
  desc: 'added by the operator mid-refresh',
  category: 'testing',
  sourceUrl: 'https://github.com/example/gamma',
  provenance: 'example/gamma',
  signals: { attributedTo: null },
};

const HEADER = '# curation header — must survive every write\n';

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;
let registryPath: string;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'community-registry-lock-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'community'), { recursive: true });
  registryPath = join(forgeRoot, 'studio', 'community', 'registry.yaml');

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

function seed(items: unknown[] = [ITEM_A, ITEM_B], sources: Record<string, unknown> = { [A_KEY]: SEED_SOURCE, [B_KEY]: SEED_SOURCE }): void {
  writeFileSync(registryPath, HEADER + yaml.dump({ meta: { schemaVersion: 2, lastRefresh: null }, sources, items }), 'utf8');
}

beforeEach(() => {
  seed();
});

type Doc = {
  meta: { schemaVersion: number; lastRefresh: string | null };
  sources: Record<string, Record<string, unknown>>;
  items: Array<Record<string, unknown>>;
};

function readDoc(): Doc {
  return yaml.load(readFileSync(registryPath, 'utf8')) as Doc;
}

function ghBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    full_name: 'example/repo',
    stargazers_count: 4242,
    pushed_at: '2026-08-20T00:00:00Z',
    archived: false,
    topics: ['testing'],
    html_url: 'https://github.com/example/repo',
    ...over,
  };
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A `fetchImpl` whose every response is held until `open()` is called, and
 *  which resolves `entered` as soon as the refresh has actually begun its
 *  network phase. That is the interleave point: a second writer runs while the
 *  refresh sits mid-fetch, exactly as it would against a slow upstream. */
function gatedFetch(handler: (url: string) => Response = () => jsonRes(ghBody())): {
  fetchImpl: FetchLike;
  entered: Promise<void>;
  open: () => void;
} {
  let markEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    markEntered = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl: FetchLike = async (url) => {
    markEntered();
    await gate;
    return handler(url);
  };
  return { fetchImpl, entered, open: () => release() };
}

async function crud(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method,
    headers: CSRF,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, text: await res.text() };
}

// ---------------------------------------------------------------------------
// The real race: a curation edit landing WHILE the refresh is on the network
// ---------------------------------------------------------------------------

test('RACE: an item ADDED during the refresh survives, and so do the refresh\'s verified source facts', async () => {
  const { fetchImpl, entered, open } = gatedFetch();

  const refreshing = runCommunityRefresh({ forgeRoot, fetchImpl, token: FAKE_TOKEN });
  await entered; // the refresh is now mid-network, holding no lock

  const added = await crud('POST', '/api/studio/community/registry/items', { item: NEW_ITEM_BODY });
  assert.equal(added.status, 200, `the CRUD add must succeed while a refresh is fetching: ${added.text}`);

  open();
  const result = await refreshing;
  assert.equal(result.ok, true, `refresh failed: ${JSON.stringify(result)}`);
  assert.equal(result.ok && result.wrote, true, 'the refresh verified sources, so it must have written');

  const doc = readDoc();
  const ids = doc.items.map((i) => i.id).sort();
  assert.deepEqual(ids, ['alpha', 'beta', 'gamma'], 'the concurrent curation add was silently discarded by the refresh');
  assert.equal(doc.sources[A_KEY].fetchedBy, 'api:github', 'the refresh\'s own verified facts must survive the merge');
  assert.equal(doc.sources[A_KEY].stars, 4242);
  assert.match(String(doc.meta.lastRefresh), /^\d{4}-/, 'a real write moves the stamp');
  assert.ok(readFileSync(registryPath, 'utf8').startsWith(HEADER), 'the curation header must survive the merged write');
});

test('RACE: an item DELETED during the refresh stays deleted, and its now-orphaned source row is PRUNED', async () => {
  const { fetchImpl, entered, open } = gatedFetch();

  const refreshing = runCommunityRefresh({ forgeRoot, fetchImpl, token: FAKE_TOKEN });
  await entered;

  const removed = await crud('DELETE', '/api/studio/community/registry/items/beta');
  assert.equal(removed.status, 200, `the CRUD delete must succeed while a refresh is fetching: ${removed.text}`);

  open();
  const result = await refreshing;
  assert.equal(result.ok, true, `refresh failed: ${JSON.stringify(result)}`);

  const doc = readDoc();
  assert.deepEqual(doc.items.map((i) => i.id), ['alpha'], 'the refresh resurrected an item the operator deleted');
  assert.equal(doc.sources[A_KEY].fetchedBy, 'api:github');
  // ORPHAN POLICY (documented in cli/community-refresh-run.ts): a source row
  // no surviving item resolves to is DROPPED, matching the by-construction
  // pruning refreshCommunityRegistry already performs and the
  // `community-registry/orphan-source` rule `forge studio lint` enforces.
  assert.equal(B_KEY in doc.sources, false, 'the deleted item\'s source row is an orphan and must not be re-written');
});

test('RACE: a source this pass FAILED to verify is never re-written from this pass\'s own stale snapshot', async () => {
  // The subtler half of the merge. `refreshCommunityRegistry` carries a FAILED
  // source forward byte-for-byte from the snapshot it loaded before the
  // network phase — correct in isolation, and a silent clobber once that
  // snapshot is minutes old: another refresh (or a draft commit) may have
  // landed REAL facts for that key in the meantime. Only keys this pass
  // actually verified may be applied; everything else must come from the
  // re-loaded document.
  const { fetchImpl, entered, open } = gatedFetch((url) =>
    url.includes('/beta') ? jsonRes({ message: 'Server Error' }, 500) : jsonRes(ghBody()),
  );

  const refreshing = runCommunityRefresh({ forgeRoot, fetchImpl, token: FAKE_TOKEN });
  await entered;

  // Another writer lands verified facts for BETA while we are mid-network.
  seed([ITEM_A, ITEM_B], {
    [A_KEY]: SEED_SOURCE,
    [B_KEY]: { stars: 777, starsDisplay: '777', upstreamUpdatedAt: null, fetchedAt: '2026-08-23T00:00:00.000Z', fetchedBy: 'api:github' },
  });

  open();
  const result = await refreshing;
  assert.equal(result.ok, true, `refresh failed: ${JSON.stringify(result)}`);

  const doc = readDoc();
  assert.equal(doc.sources[A_KEY].fetchedBy, 'api:github', 'the source this pass DID verify must be written');
  assert.equal(doc.sources[A_KEY].stars, 4242);
  assert.equal(doc.sources[B_KEY].stars, 777, 'a source this pass failed to verify must keep the row now on disk, not the stale one this pass loaded');
  assert.equal(doc.sources[B_KEY].fetchedBy, 'api:github');
});

// ---------------------------------------------------------------------------
// Contention -> 503, from the ROUTES (not just from the primitive)
// ---------------------------------------------------------------------------

test('CONTENTION: the CRUD route answers 503 (not 500, not a silent clobber) while the registry lock is held', async () => {
  const release = await lockCommunityRegistry(forgeRoot);
  try {
    const r = await crud('POST', '/api/studio/community/registry/items', { item: NEW_ITEM_BODY });
    assert.equal(r.status, 503, `expected 503 while locked, got ${r.status}: ${r.text}`);
    const body = JSON.parse(r.text) as Record<string, unknown>;
    assert.equal(body.reason, 'registry-locked');
    assert.deepEqual(readDoc().items.map((i) => i.id), ['alpha', 'beta'], 'a refused write must leave the registry untouched');
  } finally {
    await release();
  }
});

test('CONTENTION: the refresh route answers 503 while the registry lock is held, and writes nothing', async () => {
  const before = readFileSync(registryPath, 'utf8');
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    if (url.startsWith('https://api.github.com/')) return jsonRes(ghBody());
    return (realFetch as (i: unknown, x?: unknown) => Promise<Response>)(input, init);
  }) as unknown as typeof fetch;
  const prevToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = FAKE_TOKEN;

  const release = await lockCommunityRegistry(forgeRoot);
  try {
    const res = await fetch(`${bridgeUrl}/api/studio/community/refresh`, { method: 'POST', headers: CSRF });
    const text = await res.text();
    assert.equal(res.status, 503, `expected 503 while locked, got ${res.status}: ${text}`);
    const body = JSON.parse(text) as Record<string, unknown>;
    assert.equal(body.reason, 'registry-locked');
    assert.equal(body.wrote, false);
    assert.ok(!text.includes(FAKE_TOKEN), 'the credential must never reach the response');
    assert.equal(readFileSync(registryPath, 'utf8'), before, 'a lock-refused refresh must not touch a single byte');
  } finally {
    await release();
    globalThis.fetch = realFetch;
    if (prevToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = prevToken;
  }
});

// ---------------------------------------------------------------------------
// The property we are relying on proper-lockfile for
// ---------------------------------------------------------------------------

test('STALENESS: a lock left behind by a DEAD process does not deadlock the next caller', async () => {
  // A crashed holder leaves `<registry>.lock/` on disk with nothing refreshing
  // its mtime. proper-lockfile compromises a lock whose mtime is older than
  // `stale`; that is the exact property this design relies on to avoid a
  // permanently wedged registry, so it is pinned here rather than assumed.
  // The REAL lock path, asked of the module rather than re-derived here — a
  // hand-built path silently stops colliding the day the target moves, and
  // this test would then pass by acquiring an uncontended lock.
  const lockDir = `${communityRegistryLockTarget(forgeRoot)}.lock`;
  mkdirSync(lockDir, { recursive: true });
  const longAgo = new Date(Date.now() - COMMUNITY_REGISTRY_LOCK_STALE_MS * 10);
  utimesSync(lockDir, longAgo, longAgo);

  const release = await lockCommunityRegistry(forgeRoot);
  await release();
});

test('CONTENTION: the primitive throws a NAMED CommunityRegistryLockError, never a bare Error', async () => {
  const release = await lockCommunityRegistry(forgeRoot);
  try {
    let caught: unknown;
    try {
      await lockCommunityRegistry(forgeRoot);
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof CommunityRegistryLockError, `expected CommunityRegistryLockError, got ${String(caught)}`);
    assert.match((caught as Error).message, /registry\.yaml/);
  } finally {
    await release();
  }
});
