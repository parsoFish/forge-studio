/**
 * M6-D / ruling 477 (shape A, as corrected by ruling 582) — fetching a
 * community skill package from its declared upstream, so that "install by
 * URL" ends in an install rather than an outbound link.
 *
 * NO NETWORK IN ANY TEST. `fetchCommunitySkillPackage` takes the same injected
 * `RequestCtx` the deterministic refresh uses, so every case here is driven by
 * a stub and every assertion is about what the module DID or REFUSED to
 * request.
 *
 * THE CONTRACT UNDER TEST, in one line: DECIDE FROM THE TREE, THEN FETCH. The
 * caps (`MAX_PACKAGE_FILES`, `MAX_PACKAGE_BYTES`) are enforced against the
 * sizes the tree listing reports, BEFORE a single blob is requested — so an
 * oversized package costs one listing, not a download. Two tests below assert
 * that by counting the stub's blob requests, which is the only way the claim
 * can be enforced rather than merely written here.
 *
 * The operator's URL is NEVER a fetch target. It is parsed into an upstream
 * identity and every request goes to `api.github.com` through
 * `fetchAllowedApiUrl`. `refuses a sourceUrl that is not a parseable github
 * upstream` is that claim's test: a hostile host does not become a request, it
 * fails the parse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  fetchCommunitySkillPackage,
  vendorFetchedPackage,
  type FetchPackageOutcome,
} from '../../studio/community-fetch-package.ts';
import { MAX_PACKAGE_FILES, MAX_PACKAGE_BYTES } from '../../studio/skill-package.ts';
import type { RequestCtx } from '../../studio/community-refresh-api.ts';

const SOURCE_URL = 'https://github.com/parsoFish/forge-studio';
const ID = 'story-s8-skill';

type Route = { body: unknown; status?: number };

/** A stub that records every URL it was asked for, so a test can assert on
 *  requests NOT made as strongly as on ones that were. */
function stubFetch(routes: Record<string, Route>): { ctx: RequestCtx; asked: string[] } {
  const asked: string[] = [];
  const ctx: RequestCtx = {
    timeoutMs: 5000,
    token: 'ghp_TOTALLY_SECRET_VALUE_do_not_leak',
    fetchImpl: async (url: string | URL) => {
      const key = String(url);
      asked.push(key);
      const route = routes[key];
      if (route === undefined) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(route.body), {
        status: route.status ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  } as RequestCtx;
  return { ctx, asked };
}

const REPO_URL = 'https://api.github.com/repos/parsoFish/forge-studio';
const treeUrl = (ref: string) => `https://api.github.com/repos/parsoFish/forge-studio/git/trees/${ref}?recursive=1`;
const blobUrl = (sha: string) => `https://api.github.com/repos/parsoFish/forge-studio/git/blobs/${sha}`;

function blob(text: string): Route {
  return { body: { content: Buffer.from(text, 'utf8').toString('base64'), encoding: 'base64' } };
}

const TREE_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4';

/** Mirrors the git trees API: `mode` is what distinguishes a regular file
 *  (100644/100755) from a SYMLINK (120000) — both are `type: 'blob'`. */
function tree(entries: readonly { path: string; sha: string; size?: number; mode?: string }[], truncated = false): Route {
  return {
    body: {
      sha: TREE_SHA,
      truncated,
      tree: entries.map((e) => ({ path: e.path, type: 'blob', mode: e.mode ?? '100644', sha: e.sha, size: e.size ?? 10 })),
    },
  };
}

function ok(outcome: FetchPackageOutcome): Extract<FetchPackageOutcome, { ok: true }> {
  assert.equal(outcome.ok, true, `expected a fetched package, got refusal: ${JSON.stringify(outcome)}`);
  return outcome as Extract<FetchPackageOutcome, { ok: true }>;
}

/** Asserts a refusal and narrows to it — `assert.fail` returns `never`, so the
 *  reason check below it narrows the union to the one arm being asserted. */
function refusal(outcome: FetchPackageOutcome): Extract<FetchPackageOutcome, { ok: false }> {
  if (outcome.ok) assert.fail(`expected a refusal, got a fetched package`);
  return outcome;
}

test('fetches a package whose SKILL.md sits at the repo root', async () => {
  const { ctx } = stubFetch({
    [REPO_URL]: { body: { default_branch: 'main' } },
    [treeUrl('main')]: tree([
      { path: 'SKILL.md', sha: 'sha-skill' },
      { path: 'references/deep.md', sha: 'sha-ref' },
    ]),
    [blobUrl('sha-skill')]: blob('---\nname: story-s8-skill\n---\n# body\n'),
    [blobUrl('sha-ref')]: blob('reference body\n'),
  });

  const out = ok(await fetchCommunitySkillPackage(ctx, SOURCE_URL, ID));

  assert.deepEqual(
    out.package.files.map((f) => f.path),
    ['SKILL.md', 'references/deep.md'],
  );
  assert.match(out.package.files[0]!.body, /name: story-s8-skill/);
  assert.equal(out.package.ref, TREE_SHA, 'the ref recorded must be the TREE SHA — a branch name does not identify what was installed');
  assert.equal(out.package.resolvedUrl, 'https://github.com/parsoFish/forge-studio');
});

test('fetches a package published under skills/<id>/, with paths relative to the package root', async () => {
  const { ctx } = stubFetch({
    [REPO_URL]: { body: { default_branch: 'trunk' } },
    [treeUrl('trunk')]: tree([
      { path: 'README.md', sha: 'sha-readme' },
      { path: `skills/${ID}/SKILL.md`, sha: 'sha-skill' },
      { path: `skills/${ID}/scripts/run.sh`, sha: 'sha-run' },
    ]),
    [blobUrl('sha-skill')]: blob('# skill\n'),
    [blobUrl('sha-run')]: blob('#!/bin/sh\n'),
  });

  const out = ok(await fetchCommunitySkillPackage(ctx, SOURCE_URL, ID));

  assert.deepEqual(
    out.package.files.map((f) => f.path),
    ['SKILL.md', 'scripts/run.sh'],
  );
});

test('does not fetch the repo README when the package lives in a subdirectory', async () => {
  const { ctx, asked } = stubFetch({
    [REPO_URL]: { body: { default_branch: 'main' } },
    [treeUrl('main')]: tree([
      { path: 'README.md', sha: 'sha-readme' },
      { path: `skills/${ID}/SKILL.md`, sha: 'sha-skill' },
    ]),
    [blobUrl('sha-skill')]: blob('# skill\n'),
  });

  ok(await fetchCommunitySkillPackage(ctx, SOURCE_URL, ID));

  assert.equal(asked.includes(blobUrl('sha-readme')), false, 'fetched a file outside the package root');
});

test('refuses a repo that publishes no SKILL.md, naming every path it looked at', async () => {
  const { ctx } = stubFetch({
    [REPO_URL]: { body: { default_branch: 'main' } },
    [treeUrl('main')]: tree([{ path: 'README.md', sha: 'sha-readme' }]),
  });

  const out = await fetchCommunitySkillPackage(ctx, SOURCE_URL, ID);

  const r = refusal(out);
  assert.equal(r.reason, 'no-skill-package');
  assert.match(r.message, /SKILL\.md/);
  assert.match(r.message, new RegExp(`skills/${ID}/SKILL\\.md`));
});

test('refuses a truncated tree rather than vendoring a partial package', async () => {
  const { ctx, asked } = stubFetch({
    [REPO_URL]: { body: { default_branch: 'main' } },
    [treeUrl('main')]: tree([{ path: 'SKILL.md', sha: 'sha-skill' }], true),
  });

  const out = await fetchCommunitySkillPackage(ctx, SOURCE_URL, ID);

  assert.equal(refusal(out).reason, 'tree-truncated');
  assert.equal(asked.some((u) => u.includes('/git/blobs/')), false, 'fetched a blob from a tree it could not enumerate');
});

test('enforces the file cap from the TREE, before any blob is fetched', async () => {
  const entries = Array.from({ length: MAX_PACKAGE_FILES + 1 }, (_, i) => ({
    path: i === 0 ? 'SKILL.md' : `f${i}.md`,
    sha: `sha-${i}`,
  }));
  const { ctx, asked } = stubFetch({
    [REPO_URL]: { body: { default_branch: 'main' } },
    [treeUrl('main')]: tree(entries),
  });

  const out = await fetchCommunitySkillPackage(ctx, SOURCE_URL, ID);

  assert.equal(refusal(out).reason, 'too-many-files');
  assert.equal(asked.some((u) => u.includes('/git/blobs/')), false, 'downloaded an oversized package before refusing it');
});

test('enforces the byte cap from the TREE, before any blob is fetched', async () => {
  const { ctx, asked } = stubFetch({
    [REPO_URL]: { body: { default_branch: 'main' } },
    [treeUrl('main')]: tree([
      { path: 'SKILL.md', sha: 'sha-skill', size: 10 },
      { path: 'huge.bin', sha: 'sha-huge', size: MAX_PACKAGE_BYTES },
    ]),
  });

  const out = await fetchCommunitySkillPackage(ctx, SOURCE_URL, ID);

  assert.equal(refusal(out).reason, 'too-many-bytes');
  assert.equal(asked.some((u) => u.includes('/git/blobs/')), false, 'downloaded an oversized package before refusing it');
});

test('refuses a sourceUrl that is not a parseable github upstream, without making a request', async () => {
  const { ctx, asked } = stubFetch({});

  const out = await fetchCommunitySkillPackage(ctx, 'http://localhost:8080/internal', ID);

  assert.equal(refusal(out).reason, 'not-github');
  assert.deepEqual(asked, [], 'a caller-supplied URL became an outbound request');
});

test('reports a transport failure as a typed refusal, never as a throw', async () => {
  const { ctx } = stubFetch({ [REPO_URL]: { body: {}, status: 404 } });

  const out = await fetchCommunitySkillPackage(ctx, SOURCE_URL, ID);

  const r = refusal(out);
  if (r.reason !== 'fetch-failed') assert.fail(`expected fetch-failed, got ${r.reason}`);
  assert.equal(r.kind, 'not-found');
});

test('refuses a blob whose body is not the base64 the contents API promises', async () => {
  const { ctx } = stubFetch({
    [REPO_URL]: { body: { default_branch: 'main' } },
    [treeUrl('main')]: tree([{ path: 'SKILL.md', sha: 'sha-skill' }]),
    [blobUrl('sha-skill')]: { body: { content: 'not-base64-at-all', encoding: 'utf-9' } },
  });

  const out = await fetchCommunitySkillPackage(ctx, SOURCE_URL, ID);

  const r = refusal(out);
  if (r.reason !== 'fetch-failed') assert.fail(`expected fetch-failed, got ${r.reason}`);
  assert.equal(r.kind, 'malformed-response');
});

// ---------------------------------------------------------------------------
// vendorFetchedPackage — the bytes reaching disk
// ---------------------------------------------------------------------------

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'forge-fetch-pkg-'));
}

test('vendors the fetched files under studio/community/skills/<id>/', () => {
  const forgeRoot = tempRoot();

  const { dir } = vendorFetchedPackage({
    forgeRoot,
    id: ID,
    files: [
      { path: 'SKILL.md', body: '# skill\n' },
      { path: 'references/deep.md', body: 'deep\n' },
    ],
  });

  assert.equal(dir, join(forgeRoot, 'studio', 'community', 'skills', ID));
  assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), '# skill\n');
  assert.equal(readFileSync(join(dir, 'references', 'deep.md'), 'utf8'), 'deep\n');
});

test('refuses to overwrite a vendored package that is already on disk', () => {
  const forgeRoot = tempRoot();
  const dir = join(forgeRoot, 'studio', 'community', 'skills', ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), 'the package already here\n');

  assert.throws(
    () => vendorFetchedPackage({ forgeRoot, id: ID, files: [{ path: 'SKILL.md', body: 'replacement\n' }] }),
    /already vendored/,
  );
  assert.equal(readFileSync(join(dir, 'SKILL.md'), 'utf8'), 'the package already here\n');
});

test('leaves nothing behind when a file in the package cannot be written', () => {
  const forgeRoot = tempRoot();

  assert.throws(() =>
    vendorFetchedPackage({
      forgeRoot,
      id: ID,
      // `..` in a fetched path is the traversal case: it must refuse, and the
      // refusal must not leave a half-written package at the destination.
      files: [
        { path: 'SKILL.md', body: '# skill\n' },
        { path: '../escaped.md', body: 'nope\n' },
      ],
    }),
  );

  assert.equal(existsSync(join(forgeRoot, 'studio', 'community', 'skills', ID)), false, 'a refused vendor left a package behind');
  assert.equal(existsSync(join(forgeRoot, 'studio', 'community', 'skills', 'escaped.md')), false);
});

// ---------------------------------------------------------------------------
// Regressions from the ruling-477 security review — each is a finding that was
// REPRODUCED before it was fixed, so each keeps a test rather than a note
// ---------------------------------------------------------------------------

test('LOW-8: with no credential it refuses missing-token and makes NO request — never a bare `Bearer ` and a "GitHub rejected the credential" remedy', async () => {
  const { ctx, asked } = stubFetch({});
  const noToken: RequestCtx = { ...ctx, token: '' };

  const out = await fetchCommunitySkillPackage(noToken, SOURCE_URL, ID);

  const r = refusal(out);
  if (r.reason !== 'fetch-failed') assert.fail(`expected fetch-failed, got ${r.reason}`);
  assert.equal(r.kind, 'missing-token', 'an ABSENT token is not a REJECTED one, and the remedy differs');
  assert.deepEqual(asked, [], 'a request was attempted without a credential');
});

test('LOW-9: a git SYMLINK entry is skipped — it is a blob (mode 120000), not a separate type', async () => {
  const { ctx, asked } = stubFetch({
    [REPO_URL]: { body: { default_branch: 'main' } },
    [treeUrl('main')]: tree([
      { path: 'SKILL.md', sha: 'sha-skill' },
      { path: 'link-to-secrets', sha: 'sha-link', mode: '120000' },
    ]),
    [blobUrl('sha-skill')]: blob('# skill\n'),
    [blobUrl('sha-link')]: blob('/etc/passwd'),
  });

  const out = ok(await fetchCommunitySkillPackage(ctx, SOURCE_URL, ID));

  assert.deepEqual(out.package.files.map((f) => f.path), ['SKILL.md'], 'the symlink entry became a package file');
  assert.equal(asked.includes(blobUrl('sha-link')), false, 'the symlink blob was fetched');
});

test('MEDIUM-4: the resolved identity is recorded, not the raw sourceUrl that can read as another repo', async () => {
  // This URL parses to `parsoFish/forge-studio` — `new URL` normalizes the
  // encoded traversal away before the segments are taken — while READING like
  // a repo under `anthropics`. The provenance and the operator-facing link
  // must both name what the fetch actually reached.
  const sneaky = 'https://github.com/anthropics/skills/%2e%2e/%2e%2e/parsoFish/forge-studio';
  const { ctx } = stubFetch({
    [REPO_URL]: { body: { default_branch: 'main' } },
    [treeUrl('main')]: tree([{ path: 'SKILL.md', sha: 'sha-skill' }]),
    [blobUrl('sha-skill')]: blob('# skill\n'),
  });

  const out = ok(await fetchCommunitySkillPackage(ctx, sneaky, ID));

  assert.equal(out.package.resolvedUrl, 'https://github.com/parsoFish/forge-studio');
  assert.notEqual(out.package.resolvedUrl, sneaky);
});
