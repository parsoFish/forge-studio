/**
 * M6-D / operator ruling 478 — asking a declared hub what it publishes.
 *
 * NO NETWORK IN ANY TEST: every case drives the same injected `RequestCtx` the
 * deterministic refresh uses.
 *
 * The property that matters most is the LAST test here, and it is the reason
 * the convention was chosen rather than invented: **a discovered row must be
 * installable by the code that installs rows.** Discovery that proposes
 * something `community-fetch-package.ts` cannot then fetch is a decoration, so
 * the two are pinned against each other rather than each against its own idea
 * of the layout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { indexGithubHub, type HubIndexOutcome } from '../../studio/community-hub-index.ts';
import type { RequestCtx } from '../../studio/community-refresh-api.ts';

const HUB = { id: 'superpowers', url: 'https://github.com/obra/superpowers' };
const REPO_URL = 'https://api.github.com/repos/obra/superpowers';
const treeUrl = (ref: string) => `https://api.github.com/repos/obra/superpowers/git/trees/${ref}?recursive=1`;

function stub(paths: readonly string[], opts: { truncated?: boolean; status?: number } = {}): { ctx: RequestCtx; asked: string[] } {
  const asked: string[] = [];
  const ctx = {
    timeoutMs: 5000,
    token: 'gho_TEST',
    fetchImpl: async (url: string | URL) => {
      const key = String(url);
      asked.push(key);
      if (opts.status !== undefined) return new Response('{}', { status: opts.status });
      if (key === REPO_URL) return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
      if (key === treeUrl('main')) {
        return new Response(
          JSON.stringify({
            sha: 'treesha',
            truncated: opts.truncated === true,
            tree: paths.map((p) => ({ path: p, type: 'blob', mode: '100644', sha: `sha-${p}`, size: 10 })),
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    },
  } as unknown as RequestCtx;
  return { ctx, asked };
}

function ok(o: HubIndexOutcome): Extract<HubIndexOutcome, { ok: true }> {
  assert.equal(o.ok, true, `expected a successful index, got ${JSON.stringify(o)}`);
  return o as Extract<HubIndexOutcome, { ok: true }>;
}

test('a hub that publishes skills/<name>/SKILL.md yields one row per skill', async () => {
  const { ctx } = stub([
    'README.md',
    'skills/brainstorming/SKILL.md',
    'skills/brainstorming/references/deep.md',
    'skills/systematic-debugging/SKILL.md',
  ]);

  const out = ok(await indexGithubHub(ctx, HUB, new Set()));

  assert.deepEqual(out.discovered.map((d) => d.id), ['brainstorming', 'systematic-debugging']);
  assert.equal(out.discovered[0]!.sourceUrl, HUB.url);
  assert.equal(out.discovered[0]!.path, 'skills/brainstorming/SKILL.md');
});

test('rows the registry ALREADY carries are not proposed again', async () => {
  const { ctx } = stub(['skills/brainstorming/SKILL.md', 'skills/systematic-debugging/SKILL.md']);

  const out = ok(await indexGithubHub(ctx, HUB, new Set(['brainstorming'])));

  assert.deepEqual(out.discovered.map((d) => d.id), ['systematic-debugging']);
});

test('a repo that IS one skill (root SKILL.md) proposes the repo name', async () => {
  const { ctx } = stub(['SKILL.md', 'README.md']);

  const out = ok(await indexGithubHub(ctx, HUB, new Set()));

  assert.deepEqual(out.discovered.map((d) => d.id), ['superpowers']);
});

test('a hub whose layout forge does not read indexes NOTHING rather than guessing', async () => {
  // A real shape: MCP servers under `src/<name>/`, with no SKILL.md anywhere.
  const { ctx } = stub(['src/filesystem/index.ts', 'src/git/index.ts', 'README.md']);

  const out = ok(await indexGithubHub(ctx, HUB, new Set()));

  assert.deepEqual(out.discovered, [], 'inferring a layout is how you propose rows that cannot be installed');
});

test('a directory name that is not a valid slug is SKIPPED, never sanitised into one', async () => {
  const { ctx } = stub(['skills/Not A Slug!/SKILL.md', 'skills/fine-one/SKILL.md']);

  const out = ok(await indexGithubHub(ctx, HUB, new Set()));

  assert.deepEqual(out.discovered.map((d) => d.id), ['fine-one'], "a stranger's directory name becomes an id and then a path segment");
});

test('a NON-GitHub hub is not-reachable, and no request is made', async () => {
  const { ctx, asked } = stub([]);

  const out = await indexGithubHub(ctx, { id: 'skills-sh', url: 'https://skills.sh' }, new Set());

  assert.equal(out.ok, false);
  assert.equal(out.ok === false ? out.reason : null, 'not-reachable');
  assert.deepEqual(asked, [], 'a hub outside the allowlist must not become a request');
});

test('a truncated tree refuses rather than proposing a partial list', async () => {
  const { ctx } = stub(['skills/one/SKILL.md'], { truncated: true });

  const out = await indexGithubHub(ctx, HUB, new Set());

  assert.equal(out.ok === false ? out.reason : null, 'tree-truncated');
});

test('a transport failure is a typed refusal, never a throw', async () => {
  const { ctx } = stub([], { status: 404 });

  const out = await indexGithubHub(ctx, HUB, new Set());

  assert.equal(out.ok === false ? out.reason : null, 'fetch-failed');
});

test('DISCOVERY AND INSTALL COMPOSE: every id proposed is one the package fetcher looks for', async () => {
  // The contract, pinned against the OTHER side rather than against this
  // module's own idea of it. `community-fetch-package.ts` looks for exactly
  // `SKILL.md`, `skills/<id>/SKILL.md` and `<id>/SKILL.md`; a proposal outside
  // that set would be a row an operator could add and never install.
  const { ctx } = stub(['skills/alpha/SKILL.md', 'beta/SKILL.md', 'SKILL.md']);

  const out = ok(await indexGithubHub(ctx, HUB, new Set()));

  const candidatesFor = (id: string) => ['SKILL.md', `skills/${id}/SKILL.md`, `${id}/SKILL.md`];
  for (const d of out.discovered) {
    assert.ok(
      candidatesFor(d.id).includes(d.path),
      `discovered "${d.id}" at "${d.path}", which install-by-URL would not look for — discovery and install have drifted apart`,
    );
  }
  assert.deepEqual(out.discovered.map((d) => d.id).sort(), ['alpha', 'beta', 'superpowers']);
});
