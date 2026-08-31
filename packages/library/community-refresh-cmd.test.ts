/**
 * W8-B5 WI-3 — acceptance tests for `forge community refresh` (exit row E1)
 * and for the ONE shared load → refresh → write runner both surfaces call
 * (`cli/community-refresh-run.ts`).
 *
 * RED AT BRANCH BASE: neither `./community-refresh-run.ts` nor
 * `./community-refresh-cmd.ts` exists — every test in this file fails on the
 * import with `Cannot find module`. That red is the deliverable of round 1.
 *
 * WHAT THIS FILE IS DEFENDING, stated so a future reader knows which failure
 * each test buys:
 *
 *   1. NO TEST MAKES A REAL NETWORK CALL. Every scenario injects a stub
 *      `fetchImpl` (the runner's seam) or replaces `globalThis.fetch` (the CLI
 *      wrapper, which deliberately has no test-only parameter). The one test
 *      that spawns the real CLI binary proves its own hermeticity: it deletes
 *      GH_TOKEN from the child env AND asserts the shipped registry still
 *      carries a github.com source, which is what makes the credential check
 *      fire BEFORE any request is attempted.
 *
 *   2. THE FILE IS THE ASSERTION, NOT THE EXIT CODE. Every failure path
 *      asserts the registry's BYTES are unchanged. An implementation that
 *      exits 1 after having rewritten `meta.lastRefresh` would pass an
 *      exit-code-only test and would be exactly the "stale served as fresh"
 *      defect this lane exists to close.
 *
 *   3. THE CREDENTIAL IS NEVER RENDERED. Two tests drive a distinctive token
 *      value through the success path and the 401 path and assert it appears
 *      in NO output stream and in NO written byte — not truncated, not
 *      fingerprinted, not "present (ghp_…)".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { communityRefreshRemedy, runCommunityRefresh, type CommunityRefreshRunReason } from './community-refresh-run.ts';
import { cmdCommunity } from './community-refresh-cmd.ts';
import { loadCommunityRegistry } from '../../orchestrator/studio/registry.ts';
import type { FetchLike } from './studio/community-refresh-api.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A distinctive, obviously-fake credential. Chosen so a substring search for
 *  it cannot collide with anything else a report might legitimately print. */
const FAKE_TOKEN = 'ghp_TESTTOKENmustNeverBePrinted0000000000';

const HEADER = [
  '# Community registry fixture — this curation header is load-bearing:',
  '# `js-yaml` cannot round-trip comments, so a refresh that rebuilds the',
  '# document without threading `leadingComments` destroys these three lines.',
].join('\n');

/** Two github sources (one of which the partial-failure tests fail) plus one
 *  row whose source is a blog post — the honestly-unrefreshable row that
 *  proves nothing is fabricated. */
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
  "github:anthropics/skills":
    stars: null
    starsDisplay: null
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
  - id: brainstorming
    kind: skill
    name: Brainstorming
    category: planning
    sourceUrl: "https://github.com/obra/superpowers"
    provenance: "obra/superpowers"
    signals:
      attributedTo: null
  - id: anthropic-skills
    kind: skill
    name: Anthropic Skills
    category: review
    sourceUrl: "https://github.com/anthropics/skills"
    provenance: "anthropics/skills"
    signals:
      attributedTo: null
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

function seedRoot(): { forgeRoot: string; registryPath: string; cleanup: () => void } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'community-refresh-cmd-'));
  const dir = join(forgeRoot, 'studio', 'community');
  mkdirSync(dir, { recursive: true });
  const registryPath = join(dir, 'registry.yaml');
  writeFileSync(registryPath, registryYaml(), 'utf8');
  return { forgeRoot, registryPath, cleanup: () => rmSync(forgeRoot, { recursive: true, force: true }) };
}

// ---------------------------------------------------------------------------
// Stub fetches — the ONLY network any test in this file sees
// ---------------------------------------------------------------------------

function jsonRes(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const GH_BODY = {
  full_name: 'obra/superpowers',
  stargazers_count: 276412,
  pushed_at: '2026-08-19T17:33:23Z',
  archived: false,
  topics: ['claude', 'skills'],
  html_url: 'https://github.com/obra/superpowers',
};

/** Dispatches on a URL substring. Any unexpected URL is a LOUD failure, never
 *  a silent default 200 — a stub that answers everything hides a refresh
 *  fetching something it should not. */
function fetchFor(map: Record<string, () => Promise<Response>>): FetchLike {
  return async (url: string) => {
    for (const [fragment, handler] of Object.entries(map)) {
      if (url.includes(fragment)) return handler();
    }
    throw new Error(`stub fetch: unexpected URL ${url}`);
  };
}

const failIfCalled: FetchLike = async (url: string) => {
  throw new Error(`NETWORK CALLED for ${url} — the credential check must run BEFORE any request`);
};

function throwsWith(name: string, message: string): () => Promise<Response> {
  return async () => {
    const err = new Error(message);
    err.name = name;
    throw err;
  };
}

// ---------------------------------------------------------------------------
// Console capture (node:test's own reporter writes to process.stdout, not
// console.log, so replacing these cannot corrupt the TAP stream).
// ---------------------------------------------------------------------------

function captureConsole(): { out: string[]; err: string[]; all: () => string; restore: () => void } {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => { out.push(a.map((x) => String(x)).join(' ')); };
  console.error = (...a: unknown[]) => { err.push(a.map((x) => String(x)).join(' ')); };
  return {
    out,
    err,
    all: () => [...out, ...err].join('\n'),
    restore: () => { console.log = origLog; console.error = origErr; },
  };
}

async function withStubbedGlobalFetch<T>(impl: FetchLike, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl as unknown as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

async function withToken<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'GH_TOKEN');
  const prev = process.env.GH_TOKEN;
  if (value === undefined) delete process.env.GH_TOKEN;
  else process.env.GH_TOKEN = value;
  try {
    return await fn();
  } finally {
    if (had) process.env.GH_TOKEN = prev;
    else delete process.env.GH_TOKEN;
  }
}

// ===========================================================================
// R — the shared runner
// ===========================================================================

test('R1: no GH_TOKEN — refuses BEFORE any request, and the registry is byte-identical', async () => {
  const { forgeRoot, registryPath, cleanup } = seedRoot();
  const before = readFileSync(registryPath, 'utf8');
  try {
    const r = await withToken(undefined, () => runCommunityRefresh({ forgeRoot, fetchImpl: failIfCalled }));
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'missing-token');
    assert.match(r.ok === false ? r.message : '', /GH_TOKEN/);
    assert.equal(readFileSync(registryPath, 'utf8'), before, 'a refused refresh must not touch a single byte');
  } finally {
    cleanup();
  }
});

test('R2: GitHub rejects the credential (401) — invalid-token, nothing written', async () => {
  const { forgeRoot, registryPath, cleanup } = seedRoot();
  const before = readFileSync(registryPath, 'utf8');
  try {
    const r = await runCommunityRefresh({
      forgeRoot,
      token: FAKE_TOKEN,
      fetchImpl: fetchFor({ 'api.github.com': async () => jsonRes(401, { message: 'Bad credentials' }) }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'invalid-token');
    assert.equal(readFileSync(registryPath, 'utf8'), before);
  } finally {
    cleanup();
  }
});

test('R3: rate-limited (403 + x-ratelimit-remaining: 0) — its OWN reason, nothing written', async () => {
  const { forgeRoot, registryPath, cleanup } = seedRoot();
  const before = readFileSync(registryPath, 'utf8');
  try {
    const r = await runCommunityRefresh({
      forgeRoot,
      token: FAKE_TOKEN,
      fetchImpl: fetchFor({
        'api.github.com': async () =>
          jsonRes(403, { message: 'rate limit exceeded' }, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1787000000' }),
      }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'rate-limited');
    assert.match(r.ok === false ? r.message : '', /5000/, 'the remedy must name the authenticated limit');
    assert.equal(readFileSync(registryPath, 'utf8'), before);
  } finally {
    cleanup();
  }
});

test('R4: EVERY source failed — no write at all, and each failure keeps its own distinct message', async () => {
  const { forgeRoot, registryPath, cleanup } = seedRoot();
  const before = readFileSync(registryPath, 'utf8');
  try {
    const r = await runCommunityRefresh({
      forgeRoot,
      token: FAKE_TOKEN,
      fetchImpl: fetchFor({
        'obra/superpowers': throwsWith('TimeoutError', 'aborted'),
        'anthropics/skills': throwsWith('TypeError', 'fetch failed: ECONNREFUSED'),
      }),
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'all-sources-failed');
    const msg = r.ok === false ? r.message : '';
    assert.match(msg, /timeout/, 'the timed-out source must be reported as a timeout');
    assert.match(msg, /network-error/, 'the unreachable source must be reported as a network error');
    assert.equal(readFileSync(registryPath, 'utf8'), before, 'a pass where nothing verified must not rewrite the file');
  } finally {
    cleanup();
  }
});

test('R5: a real 200 stamps lastRefresh + the source rows, preserves the header, and invents nothing', async () => {
  const { forgeRoot, registryPath, cleanup } = seedRoot();
  const now = new Date('2026-08-23T12:00:00.000Z');
  try {
    const r = await runCommunityRefresh({
      forgeRoot,
      token: FAKE_TOKEN,
      now,
      fetchImpl: fetchFor({
        'obra/superpowers': async () => jsonRes(200, GH_BODY),
        'anthropics/skills': async () => jsonRes(200, { ...GH_BODY, full_name: 'anthropics/skills', stargazers_count: 151234 }),
      }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.ok === true && r.wrote, true);

    const written = readFileSync(registryPath, 'utf8');
    assert.ok(written.startsWith(HEADER), 'the curation header must survive the write verbatim');
    assert.match(written, /lastRefresh: "?2026-08-23T12:00:00\.000Z"?/);
    assert.match(written, /stars: 276412/);
    assert.match(written, /fetchedBy: api:github/);
    // The blog-post row is reported honestly and gets NO source row invented.
    const outcomes = r.ok === true ? r.outcomes : [];
    const blog = outcomes.find((o) => o.id === 'pre-impl-interview');
    assert.equal(blog?.status, 'no-upstream');
    assert.equal(blog?.source, null);
    // Structural, not textual: the written document must carry EXACTLY the two
    // real source keys. A fabricated row for the blog-post item — under any
    // quoting the serializer happens to choose — fails here.
    const reloaded = loadCommunityRegistry(registryPath);
    assert.deepEqual(Object.keys(reloaded.sources).sort(), ['github:anthropics/skills', 'github:obra/superpowers']);
    assert.equal(reloaded.sources['github:obra/superpowers'].fetchedAt, '2026-08-23T12:00:00.000Z');
    assert.equal(reloaded.lastRefresh, '2026-08-23T12:00:00.000Z');

    // Two items share one repo — they resolve to the SAME source row, so the
    // counts cannot diverge (exit row E5, re-asserted from this surface).
    assert.equal(outcomes.filter((o) => o.source === 'github:obra/superpowers').length, 2);
  } finally {
    cleanup();
  }
});

test('R6: --dry-run computes a full report and writes NOTHING', async () => {
  const { forgeRoot, registryPath, cleanup } = seedRoot();
  const before = readFileSync(registryPath, 'utf8');
  try {
    const r = await runCommunityRefresh({
      forgeRoot,
      token: FAKE_TOKEN,
      dryRun: true,
      fetchImpl: fetchFor({ 'api.github.com': async () => jsonRes(200, GH_BODY) }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.ok === true && r.wrote, false);
    assert.equal(r.ok === true && r.dryRun, true);
    assert.ok(r.ok === true && r.counts.refreshed > 0, 'a dry run must still REPORT what it would have written');
    assert.equal(readFileSync(registryPath, 'utf8'), before);
  } finally {
    cleanup();
  }
});

test('R7: one source up, one down — the verified row is written, the failed row is byte-identical', async () => {
  const { forgeRoot, registryPath, cleanup } = seedRoot();
  try {
    const r = await runCommunityRefresh({
      forgeRoot,
      token: FAKE_TOKEN,
      now: new Date('2026-08-23T12:00:00.000Z'),
      fetchImpl: fetchFor({
        'obra/superpowers': async () => jsonRes(200, GH_BODY),
        'anthropics/skills': async () => jsonRes(500, { message: 'upstream boom' }),
      }),
    });
    assert.equal(r.ok, true);
    assert.equal(r.ok === true && r.wrote, true);
    assert.equal(r.ok === true && r.errors.length, 1);

    // Read back through the ONE loader rather than string-slicing the YAML:
    // the assertion is about the DOCUMENT, not about how js-yaml quoted a key.
    const reloaded = loadCommunityRegistry(registryPath);
    assert.equal(reloaded.sources['github:obra/superpowers'].stars, 276412, 'the verified source is updated');
    assert.equal(reloaded.sources['github:obra/superpowers'].fetchedBy, 'api:github');
    // The failed source keeps its seed row EXACTLY: still never-verified.
    const failed = reloaded.sources['github:anthropics/skills'];
    assert.equal(failed.fetchedBy, 'seed', 'a failed source must never be stamped as verified');
    assert.equal(failed.fetchedAt, null);
    assert.equal(failed.stars, null);
  } finally {
    cleanup();
  }
});

test('R8: a missing registry file is a typed refusal, never a crash and never a created file', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'community-refresh-empty-'));
  try {
    const r = await runCommunityRefresh({ forgeRoot, token: FAKE_TOKEN, fetchImpl: failIfCalled });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.reason, 'registry-missing');
    assert.equal(existsSync(join(forgeRoot, 'studio', 'community', 'registry.yaml')), false);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('R9: every refusal reason carries an ACTIONABLE remedy, and no remedy can leak a credential', () => {
  // Written after a kill-proof run found R3 passing for the wrong reason: it
  // matched /5000/ against the FETCH CORE's own error text, so gutting this
  // module's remedy wording changed nothing and the mutation survived. These
  // assertions name the remedy function directly.
  const reasons: CommunityRefreshRunReason[] = [
    'missing-token', 'invalid-token', 'rate-limited', 'refresh-refused',
    'registry-missing', 'registry-invalid', 'all-sources-failed', 'write-failed',
  ];
  for (const reason of reasons) {
    assert.ok(communityRefreshRemedy(reason).length > 40, `"${reason}" has no usable remedy text`);
  }
  const missing = communityRefreshRemedy('missing-token');
  assert.match(missing, /GH_TOKEN/);
  assert.match(missing, /60/, 'the operator must be told WHY the credential is required, not just that it is');
  assert.match(missing, /5000/);
  assert.match(missing, /\.env\.example/);

  const rateLimited = communityRefreshRemedy('rate-limited');
  assert.match(rateLimited, /60/);
  assert.match(rateLimited, /5000/);

  assert.match(communityRefreshRemedy('invalid-token'), /\.env\.example/);

  // Structural, not incidental: a remedy is a constant string per reason, so it
  // has no way to interpolate the live credential even by accident.
  const withToken = withEnvSync('SHOULD_NOT_APPEAR_IN_A_REMEDY', () => reasons.map((r) => communityRefreshRemedy(r)).join('\n'));
  assert.ok(!withToken.includes('SHOULD_NOT_APPEAR_IN_A_REMEDY'));
});

/** Synchronous GH_TOKEN swap, for the one assertion that does not await. */
function withEnvSync<T>(token: string, fn: () => T): T {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'GH_TOKEN');
  const prev = process.env.GH_TOKEN;
  process.env.GH_TOKEN = token;
  try {
    return fn();
  } finally {
    if (had) process.env.GH_TOKEN = prev;
    else delete process.env.GH_TOKEN;
  }
}

// ===========================================================================
// C — the CLI verb
// ===========================================================================

test('C1: usage — no sub-verb, an unknown sub-verb and an unknown flag all exit 2', async () => {
  const { forgeRoot, cleanup } = seedRoot();
  const cap = captureConsole();
  try {
    assert.equal(await cmdCommunity([], forgeRoot), 2);
    assert.equal(await cmdCommunity(['sync'], forgeRoot), 2);
    assert.equal(await cmdCommunity(['refresh', '--turbo'], forgeRoot), 2);
    assert.match(cap.err.join('\n'), /usage: forge community refresh/);
  } finally {
    cap.restore();
    cleanup();
  }
});

test('C2: no GH_TOKEN — exit 1, names the variable, the 60-vs-5000 reason and .env.example', async () => {
  const { forgeRoot, registryPath, cleanup } = seedRoot();
  const before = readFileSync(registryPath, 'utf8');
  const cap = captureConsole();
  try {
    const code = await withToken(undefined, () =>
      withStubbedGlobalFetch(failIfCalled, () => cmdCommunity(['refresh'], forgeRoot)),
    );
    assert.equal(code, 1);
    const err = cap.err.join('\n');
    assert.match(err, /GH_TOKEN/);
    assert.match(err, /60/);
    assert.match(err, /5000/);
    assert.match(err, /\.env\.example/);
    assert.equal(readFileSync(registryPath, 'utf8'), before);
  } finally {
    cap.restore();
    cleanup();
  }
});

test('C3: a successful refresh exits 0 and prints a per-row summary plus a tally', async () => {
  const { forgeRoot, cleanup } = seedRoot();
  const cap = captureConsole();
  try {
    const code = await withToken(FAKE_TOKEN, () =>
      withStubbedGlobalFetch(fetchFor({ 'api.github.com': async () => jsonRes(200, GH_BODY) }), () =>
        cmdCommunity(['refresh'], forgeRoot),
      ),
    );
    assert.equal(code, 0);
    const out = cap.out.join('\n');
    for (const id of ['handoff', 'brainstorming', 'anthropic-skills', 'pre-impl-interview']) {
      assert.match(out, new RegExp(id), `every row must appear in the summary — missing "${id}"`);
    }
    assert.match(out, /no-upstream/, 'the honestly-unrefreshable row must say so');
    assert.match(out, /refreshed \d+/, 'a final tally is required');
  } finally {
    cap.restore();
    cleanup();
  }
});

test('C4: a partial failure still exits 1 — a failed source must never read as a clean run', async () => {
  const { forgeRoot, cleanup } = seedRoot();
  const cap = captureConsole();
  try {
    const code = await withToken(FAKE_TOKEN, () =>
      withStubbedGlobalFetch(
        fetchFor({
          'obra/superpowers': async () => jsonRes(200, GH_BODY),
          'anthropics/skills': async () => jsonRes(500, { message: 'boom' }),
        }),
        () => cmdCommunity(['refresh'], forgeRoot),
      ),
    );
    assert.equal(code, 1, 'a run with an unreported-as-failed source is exactly the defect this closes');
    assert.match(cap.all(), /failed/);
  } finally {
    cap.restore();
    cleanup();
  }
});

test('C5: --dry-run exits 0, says so, and leaves the file byte-identical', async () => {
  const { forgeRoot, registryPath, cleanup } = seedRoot();
  const before = readFileSync(registryPath, 'utf8');
  const cap = captureConsole();
  try {
    const code = await withToken(FAKE_TOKEN, () =>
      withStubbedGlobalFetch(fetchFor({ 'api.github.com': async () => jsonRes(200, GH_BODY) }), () =>
        cmdCommunity(['refresh', '--dry-run'], forgeRoot),
      ),
    );
    assert.equal(code, 0);
    assert.match(cap.out.join('\n'), /dry run/i);
    assert.equal(readFileSync(registryPath, 'utf8'), before);
  } finally {
    cap.restore();
    cleanup();
  }
});

test('C6: the token appears in NO output stream and in NO written byte — success path', async () => {
  const { forgeRoot, registryPath, cleanup } = seedRoot();
  const cap = captureConsole();
  try {
    await withToken(FAKE_TOKEN, () =>
      withStubbedGlobalFetch(fetchFor({ 'api.github.com': async () => jsonRes(200, GH_BODY) }), () =>
        cmdCommunity(['refresh'], forgeRoot),
      ),
    );
    assert.ok(!cap.all().includes(FAKE_TOKEN), 'the credential leaked into CLI output');
    // Not even a prefix: a truncated credential is still a credential.
    assert.ok(!cap.all().includes(FAKE_TOKEN.slice(0, 12)), 'a truncated credential is still a credential');
    assert.ok(!readFileSync(registryPath, 'utf8').includes(FAKE_TOKEN), 'the credential leaked into the registry');
  } finally {
    cap.restore();
    cleanup();
  }
});

test('C7: the token appears in NO output stream on the 401 path either', async () => {
  const { forgeRoot, cleanup } = seedRoot();
  const cap = captureConsole();
  try {
    const code = await withToken(FAKE_TOKEN, () =>
      withStubbedGlobalFetch(fetchFor({ 'api.github.com': async () => jsonRes(401, { message: 'Bad credentials' }) }), () =>
        cmdCommunity(['refresh'], forgeRoot),
      ),
    );
    assert.equal(code, 1);
    assert.ok(!cap.all().includes(FAKE_TOKEN));
    assert.ok(!cap.all().includes(FAKE_TOKEN.slice(0, 12)));
    assert.match(cap.err.join('\n'), /rejected/i, 'the operator must be told the credential was REJECTED, not that it is missing');
  } finally {
    cap.restore();
    cleanup();
  }
});

// ===========================================================================
// D — the real dispatch, spawned. Hermetic BY CONSTRUCTION, and it proves it.
// ===========================================================================

const CLI_ENTRY = resolve(import.meta.dirname, '..', '..', 'apps', 'forge', 'cli.ts');
const REAL_REGISTRY = resolve(import.meta.dirname, '..', '..', 'studio', 'community', 'registry.yaml');

function runForge(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const env: NodeJS.ProcessEnv = { ...process.env, FORGE_ARCHITECT_NO_SPAWN: '1' };
  // Deleted, not blanked: the child must take the genuinely-absent path, and
  // this is what makes the spawn hermetic (no request is attempted at all).
  delete env.GH_TOKEN;
  const r = spawnSync(process.execPath, ['--experimental-strip-types', CLI_ENTRY, ...args], {
    encoding: 'utf8',
    timeout: 60_000,
    env,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('D1: the shipped registry still has a github.com source — the precondition that makes D2 hermetic', () => {
  const raw = readFileSync(REAL_REGISTRY, 'utf8');
  assert.match(
    raw,
    /sourceUrl: "https:\/\/github\.com\//,
    'D2 spawns the REAL CLI against the REAL registry and relies on the missing-credential check firing before any request. ' +
      'That holds only while at least one row resolves to a github source. If this assertion ever fails, D2 is no longer hermetic — fix D2, do not delete this.',
  );
});

test('D2: `forge community refresh` with no GH_TOKEN exits non-zero and leaves the real registry byte-identical', () => {
  const before = readFileSync(REAL_REGISTRY, 'utf8');
  const r = runForge(['community', 'refresh']);
  assert.notEqual(r.status, 0, 'a missing credential must never exit 0');
  assert.doesNotMatch(r.stderr, /unknown command/, 'the verb must actually dispatch');
  assert.match(r.stderr, /GH_TOKEN/);
  assert.match(r.stderr, /\.env\.example/);
  assert.equal(readFileSync(REAL_REGISTRY, 'utf8'), before, 'the repo-tracked registry must not be touched by a refused run');
});

test('D3: `forge community` with no sub-verb exits 2 with usage, not "unknown command"', () => {
  const r = runForge(['community']);
  assert.equal(r.status, 2);
  assert.doesNotMatch(r.stderr, /unknown command/);
  assert.match(r.stderr, /usage: forge community refresh/);
});
