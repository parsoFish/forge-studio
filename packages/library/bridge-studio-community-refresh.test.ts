/**
 * W8-B5 WI-3 — acceptance tests for `POST /api/studio/community/refresh`
 * (exit row E7), driven through the REAL bridge (`startBridge`), never through
 * a hand-made `req`/`res` pair: an optional-param bug in the route's own call
 * site is exactly the defect class this repo's bridge tests exist to catch.
 *
 * RED AT BRANCH BASE: the route does not exist, so every request below gets a
 * 404 from the dispatcher.
 *
 * NO REAL NETWORK. The bridge runs IN THIS PROCESS, so the route's `fetch` IS
 * `globalThis.fetch`. Each test installs a stub that answers the three API
 * origins from a fixture and DELEGATES everything else (crucially, the test's
 * own requests to the bridge on 127.0.0.1) to the real implementation. A stub
 * that answered everything would break the test harness itself; one that
 * answered nothing would let a real request out.
 *
 * THE SHARED-IMPLEMENTATION PIN (the real content of E1/E7) is P1 at the
 * bottom: the same fixture + the same stubbed upstream, once through the route
 * and once through the CLI verb, must produce byte-identical registry files
 * modulo the two timestamps. If either surface grows its own load → refresh →
 * write, that test goes red.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../apps/forge/ui-bridge.ts';
import { cmdCommunity } from './community-refresh-cmd.ts';

const FAKE_TOKEN = 'ghp_ROUTETESTTOKENneverRendered0000000000';

const HEADER = [
  '# Community registry fixture — curation header, must survive every write.',
  '# js-yaml cannot round-trip comments; the serializer threads this block.',
].join('\n');

function registryYaml(): string {
  return `${HEADER}
meta:
  schemaVersion: 2
  lastRefresh: null

sources:
  "github:obra/superpowers":
    stars: 228000
    starsDisplay: "228k"
    upstreamUpdatedAt: null
    fetchedAt: null
    fetchedBy: seed

items:
  - id: handoff
    kind: skill
    name: Handoff
    category: memory
    sourceUrl: "https://github.com/obra/superpowers"
    provenance: "obra/superpowers"
    signals:
      attributedTo: "obra/superpowers"
  - id: pre-impl-interview
    kind: skill
    name: Pre-impl Interview
    category: planning
    sourceUrl: "https://www.firecrawl.dev/blog/best-claude-code-skills"
    provenance: "firecrawl.dev blog"
    signals:
      attributedTo: null
`;
}

const GH_BODY = {
  full_name: 'obra/superpowers',
  stargazers_count: 276412,
  pushed_at: '2026-08-19T17:33:23Z',
  archived: false,
  topics: ['claude', 'skills'],
  html_url: 'https://github.com/obra/superpowers',
};

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;
let registryPath: string;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-community-refresh-'));
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

/** Reset the fixture before each scenario (the bridge is shared for the file). */
function seed(): string {
  const raw = registryYaml();
  writeFileSync(registryPath, raw, 'utf8');
  return raw;
}

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/**
 * Installs a stub that intercepts ONLY the three refresh API origins and lets
 * every other request (this test's own calls to the bridge) through to the
 * real fetch.
 */
async function withUpstream<T>(handler: (url: string) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    if (/^https:\/\/(api\.github\.com|registry\.npmjs\.org|registry\.modelcontextprotocol\.io)\//.test(url)) {
      return handler(url);
    }
    return (real as (i: unknown, x?: unknown) => Promise<Response>)(input, init);
  }) as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const prev = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    prev.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function postRefresh(): Promise<{ status: number; body: Record<string, unknown>; text: string }> {
  const res = await fetch(`${bridgeUrl}/api/studio/community/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* a non-JSON body is itself the finding — `text` carries it */
  }
  return { status: res.status, body, text };
}

// ---------------------------------------------------------------------------

test('B1: no GH_TOKEN — a 409 naming the variable, NOT a 500 and NOT a 200 with stale rows', async () => {
  const before = seed();
  const r = await withEnv({ GH_TOKEN: undefined }, () =>
    withUpstream(async (url) => {
      throw new Error(`NETWORK CALLED for ${url}`);
    }, postRefresh),
  );
  assert.equal(r.status, 409, `expected 409, got ${r.status}: ${r.text}`);
  assert.equal(r.body.reason, 'missing-token');
  assert.match(String(r.body.error), /GH_TOKEN/);
  assert.match(String(r.body.remedy ?? ''), /\.env\.example/);
  assert.equal(readFileSync(registryPath, 'utf8'), before, 'a refused refresh must not touch a single byte');
});

test('B2: GitHub rejects the credential — 409 with its OWN reason, distinct from missing', async () => {
  const before = seed();
  const r = await withEnv({ GH_TOKEN: FAKE_TOKEN }, () =>
    withUpstream(async () => jsonRes(401, { message: 'Bad credentials' }), postRefresh),
  );
  assert.equal(r.status, 409, `expected 409, got ${r.status}: ${r.text}`);
  assert.equal(r.body.reason, 'invalid-token');
  assert.equal(readFileSync(registryPath, 'utf8'), before);
  assert.ok(!r.text.includes(FAKE_TOKEN), 'the credential leaked into the response');
  assert.ok(!r.text.includes(FAKE_TOKEN.slice(0, 12)), 'a truncated credential is still a credential');
});

test('B3: rate-limited — 429, the semantically correct status, nothing written', async () => {
  const before = seed();
  const r = await withEnv({ GH_TOKEN: FAKE_TOKEN }, () =>
    withUpstream(
      async () => jsonRes(403, { message: 'rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1787000000' }),
      postRefresh,
    ),
  );
  assert.equal(r.status, 429, `expected 429, got ${r.status}: ${r.text}`);
  assert.equal(r.body.reason, 'rate-limited');
  assert.equal(readFileSync(registryPath, 'utf8'), before);
});

test('B4: every source failed — 502, wrote:false, registry byte-identical', async () => {
  const before = seed();
  const r = await withEnv({ GH_TOKEN: FAKE_TOKEN }, () =>
    withUpstream(async () => jsonRes(500, { message: 'upstream boom' }), postRefresh),
  );
  assert.equal(r.status, 502, `expected 502, got ${r.status}: ${r.text}`);
  assert.equal(r.body.reason, 'all-sources-failed');
  assert.equal(readFileSync(registryPath, 'utf8'), before, 'nothing verified ⇒ nothing written');
});

test('B5: a successful refresh — 200 carrying per-row statuses, counts, lastRefresh and errors', async () => {
  seed();
  const r = await withEnv({ GH_TOKEN: FAKE_TOKEN }, () =>
    withUpstream(async () => jsonRes(200, GH_BODY), postRefresh),
  );
  assert.equal(r.status, 200, `expected 200, got ${r.status}: ${r.text}`);
  assert.equal(r.body.wrote, true);
  assert.equal(typeof r.body.lastRefresh, 'string');

  const outcomes = r.body.outcomes as { id: string; status: string; source: string | null }[];
  assert.ok(Array.isArray(outcomes) && outcomes.length === 2, 'the UI needs one row per registry item');
  assert.equal(outcomes.find((o) => o.id === 'handoff')?.status, 'refreshed');
  assert.equal(outcomes.find((o) => o.id === 'pre-impl-interview')?.status, 'no-upstream');

  const counts = r.body.counts as Record<string, number>;
  assert.equal(counts.refreshed, 1);
  assert.equal(counts.noUpstream, 1);
  assert.deepEqual(r.body.errors, []);

  const written = readFileSync(registryPath, 'utf8');
  assert.ok(written.startsWith(HEADER), 'the curation header must survive the route write');
  assert.match(written, /stars: 276412/);
  assert.match(written, /fetchedBy: api:github/);
  assert.ok(!written.includes(FAKE_TOKEN));
});

test('B6: dry-bridge refuses the route outright — the first outbound-network route forge has ever had', async () => {
  const before = seed();
  const r = await withEnv({ GH_TOKEN: FAKE_TOKEN, FORGE_DRY_BRIDGE: '1' }, () =>
    withUpstream(async (url) => {
      throw new Error(`NETWORK CALLED for ${url} under FORGE_DRY_BRIDGE=1`);
    }, postRefresh),
  );
  assert.equal(r.status, 409, `expected the typed dry-bridge 409, got ${r.status}: ${r.text}`);
  assert.equal(r.body.error, 'dry-bridge');
  assert.equal(r.body.action, 'network');
  assert.equal(readFileSync(registryPath, 'utf8'), before);
});

// ---------------------------------------------------------------------------
// P1 — the shared-implementation pin
// ---------------------------------------------------------------------------

/** Replaces every ISO-8601 timestamp so two runs a few milliseconds apart
 *  compare byte-for-byte on everything EXCEPT when they ran. */
function normalizeTimestamps(yaml: string): string {
  return yaml.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<STAMP>');
}

test('P1: the route and the CLI produce the same registry for the same input (ONE implementation)', async () => {
  seed();
  const routeResult = await withEnv({ GH_TOKEN: FAKE_TOKEN }, () =>
    withUpstream(async () => jsonRes(200, GH_BODY), postRefresh),
  );
  assert.equal(routeResult.status, 200, routeResult.text);
  const viaRoute = readFileSync(registryPath, 'utf8');

  const cliRoot = mkdtempSync(join(tmpdir(), 'community-refresh-parity-'));
  try {
    mkdirSync(join(cliRoot, 'studio', 'community'), { recursive: true });
    const cliRegistry = join(cliRoot, 'studio', 'community', 'registry.yaml');
    writeFileSync(cliRegistry, registryYaml(), 'utf8');

    const origLog = console.log;
    const origErr = console.error;
    console.log = () => {};
    console.error = () => {};
    let code: number;
    try {
      code = await withEnv({ GH_TOKEN: FAKE_TOKEN }, () =>
        withUpstream(async () => jsonRes(200, GH_BODY), () => cmdCommunity(['refresh'], cliRoot)),
      );
    } finally {
      console.log = origLog;
      console.error = origErr;
    }
    assert.equal(code, 0);

    assert.equal(
      normalizeTimestamps(readFileSync(cliRegistry, 'utf8')),
      normalizeTimestamps(viaRoute),
      'the route and the CLI diverged — they are no longer sharing one load → refresh → write implementation',
    );
  } finally {
    rmSync(cliRoot, { recursive: true, force: true });
  }
});
