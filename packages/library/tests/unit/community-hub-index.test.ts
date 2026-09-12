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

import {
  indexGithubHub,
  indexMcpRegistryHub,
  indexerForHub,
  type HubIndexOutcome,
} from '../../studio/community-hub-index.ts';
import type { RequestCtx } from '../../studio/community-refresh-api.ts';

const HUB = { id: 'superpowers', url: 'https://github.com/obra/superpowers', kinds: 'skills' };
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

  const out = await indexGithubHub(ctx, { id: 'skills-sh', url: 'https://skills.sh', kinds: 'skills' }, new Set());

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

// ---------------------------------------------------------------------------
// The MCP registry reader — `forge-8vfn.7.6.84` PR A, T1 890/893.
//
// Same rule as above: NO NETWORK. Every case drives the injected `RequestCtx`.
//
// The test that matters is the name one. A published MCP name is reverse-DNS
// with a path and cannot pass `SLUG_RE` as it stands, so the reader SELECTS the
// final segment and requires THAT to pass unchanged. A reader that cleaned the
// name up instead would propose ids nobody published, which is the failure this
// module's "a stranger's string is never sanitised" rule exists to prevent.
// ---------------------------------------------------------------------------

const MCP_HUB = { id: 'mcp-registry', url: 'https://registry.modelcontextprotocol.io' };
const serversUrl = (cursor?: string) =>
  `https://registry.modelcontextprotocol.io/v0/servers?version=latest&limit=50${cursor === undefined ? '' : `&cursor=${cursor}`}`;

/** Pages of server names, keyed by the cursor that asks for them. */
function mcpStub(pages: ReadonlyArray<{ names: readonly string[]; next?: string }>, opts: { status?: number; body?: string } = {}) {
  const asked: string[] = [];
  let page = 0;
  const ctx = {
    timeoutMs: 5000,
    token: 'gho_TEST',
    fetchImpl: async (url: string | URL) => {
      asked.push(String(url));
      if (opts.status !== undefined) return new Response('{}', { status: opts.status });
      if (opts.body !== undefined) return new Response(opts.body, { status: 200 });
      const p = pages[page];
      page += 1;
      return new Response(
        JSON.stringify({
          servers: (p?.names ?? []).map((name) => ({ server: { name, version: '1.0.0' } })),
          metadata: p?.next === undefined ? {} : { nextCursor: p.next },
        }),
        { status: 200 },
      );
    },
  } as unknown as RequestCtx;
  return { ctx, asked };
}
const ids = (o: HubIndexOutcome) => (o.ok ? o.discovered.map((d) => d.id) : []);

test('MCP: the final segment is SELECTED and must pass the slug guard unchanged', async () => {
  const { ctx } = mcpStub([
    {
      names: [
        'io.github.acme/weather-server', // → weather-server
        'io.github.acme/Weather_Server', // capital + underscore: skipped, NOT cleaned
        'io.github.acme/db.tools', // a dot: skipped
        'plain-name', // no slash at all: the whole name, and it passes
        'io.github.acme/', // empty final segment: skipped
      ],
    },
  ]);
  const out = await indexMcpRegistryHub(ctx, MCP_HUB, new Set());
  assert.deepEqual(ids(out), ['plain-name', 'weather-server']);
});

test('MCP: a name already in the registry is not proposed again', async () => {
  const { ctx } = mcpStub([{ names: ['io.github.acme/weather-server', 'io.github.acme/other-server'] }]);
  const out = await indexMcpRegistryHub(ctx, MCP_HUB, new Set(['weather-server']));
  assert.deepEqual(ids(out), ['other-server']);
});

test('MCP: two published names collapsing to one id propose it once', async () => {
  // `a/tools` and `b/tools` both select `tools`. First wins, deterministically —
  // the same rule the GitHub reader applies across hubs.
  const { ctx } = mcpStub([{ names: ['io.github.a/tools', 'io.github.b/tools'] }]);
  const out = await indexMcpRegistryHub(ctx, MCP_HUB, new Set());
  assert.deepEqual(ids(out), ['tools']);
});

test('MCP: it follows the cursor, and `path` records the name that was matched', async () => {
  const { ctx, asked } = mcpStub([
    { names: ['io.github.acme/one-server'], next: 'CUR2' },
    { names: ['io.github.acme/two-server'] },
  ]);
  const out = await indexMcpRegistryHub(ctx, MCP_HUB, new Set());
  assert.deepEqual(ids(out), ['one-server', 'two-server']);
  assert.deepEqual(asked, [serversUrl(), serversUrl('CUR2')]);
  assert.equal(out.ok ? out.discovered[0]?.path : null, 'io.github.acme/one-server');
});

test('MCP: a bad status is a fetch-failed OUTCOME, never a throw', async () => {
  const { ctx } = mcpStub([], { status: 503 });
  const out = await indexMcpRegistryHub(ctx, MCP_HUB, new Set());
  assert.equal(out.ok, false);
  assert.equal(out.ok === false ? out.reason : null, 'fetch-failed');
});

test('MCP: a listing with no `servers` array is malformed, not empty', async () => {
  // "the API answered something I cannot read" and "the API published nothing"
  // are different states; reporting the first as the second is how a broken
  // source reads as an empty one.
  const { ctx } = mcpStub([], { body: JSON.stringify({ metadata: {} }) });
  const out = await indexMcpRegistryHub(ctx, MCP_HUB, new Set());
  assert.equal(out.ok, false);
  assert.equal(out.ok === false ? out.reason : null, 'fetch-failed');
});

test('MCP: it reads no other host, and says so', async () => {
  const { ctx, asked } = mcpStub([{ names: [] }]);
  const out = await indexMcpRegistryHub(ctx, { id: 'smithery', url: 'https://smithery.ai' }, new Set());
  assert.equal(out.ok, false);
  assert.equal(out.ok === false ? out.reason : null, 'not-reachable');
  assert.deepEqual(asked, [], 'a host it does not read must not be fetched');
});

test('the reader is chosen by URL, never by the hub’s declared kinds', () => {
  // `mcp-servers` declares `kinds: MCPs` and is a GitHub REPO. Keying the
  // dispatch on the kind would ask the registry about a GitHub repository.
  assert.equal(indexerForHub({ url: 'https://registry.modelcontextprotocol.io' }), indexMcpRegistryHub);
  assert.equal(indexerForHub({ url: 'https://github.com/modelcontextprotocol/servers' }), indexGithubHub);
  assert.equal(indexerForHub({ url: 'https://skills.sh' }), indexGithubHub, 'a host with no reader falls to the one whose refusal names the limit');
  assert.equal(indexerForHub({ url: 'not a url' }), indexGithubHub);
});

test('MCP: a list cut short by the reader’s own bound is marked a FLOOR', async () => {
  // MEASURED against the live registry: it holds at least 2000 servers and this
  // reader takes 5 pages of 50. Returning 250 with no way to say "there is more"
  // is a floor presented as a total — the shape this field exists to refuse.
  const { ctx } = mcpStub([
    { names: ['io.github.a/one-server'], next: 'C2' },
    { names: ['io.github.a/two-server'], next: 'C3' },
    { names: ['io.github.a/three-server'], next: 'C4' },
    { names: ['io.github.a/four-server'], next: 'C5' },
    { names: ['io.github.a/five-server'], next: 'C6' }, // still more, and we stop
  ]);
  const out = await indexMcpRegistryHub(ctx, MCP_HUB, new Set());
  assert.equal(out.ok, true);
  assert.equal(out.ok === true ? out.partial : null, true);
  assert.equal(out.ok === true ? out.readCap : null, '5 pages of 50');
  assert.equal(ids(out).length, 5);
});

test('MCP: a list read to the end is NOT marked partial', async () => {
  // The other half, and the one that keeps the flag meaningful: a source that
  // ended is not reported as truncated, so `partial` says something when set.
  const { ctx } = mcpStub([
    { names: ['io.github.a/one-server'], next: 'C2' },
    { names: ['io.github.a/two-server'] }, // no cursor: the registry is done
  ]);
  const out = await indexMcpRegistryHub(ctx, MCP_HUB, new Set());
  assert.equal(out.ok, true);
  assert.equal(out.ok === true ? out.partial : 'unset', undefined);
});

// ---------------------------------------------------------------- 7.6.91
// AN OK-BUT-EMPTY READ IS TWO DIFFERENT FACTS, and the chip showed one label.
//
// `cc-templates` is read perfectly — authenticated, allowlisted, tree returned —
// and yields nothing, because it publishes HOOKS and `community-fetch-package`
// installs three `SKILL.md` layouts and no hook arm. The operator saw "declared
// — nothing indexed", which is what an empty SKILLS hub also says. "Nothing
// forge can install" is the narrower truth and the one they can act on.
//
// THESE DOORS EXIST BECAUSE THE LAST FIELD I ADDED HAD NONE (7.6.96): a
// predicate that was false on every machine in this campaign passed six green
// doors, because nothing asserted it. The negative cases below are the half
// that makes the positive one mean something.

const HOOKS_HUB = { id: 'cc-templates', url: 'https://github.com/obra/superpowers', kinds: 'hooks' };

test('7.6.91: an OK read that finds nothing, from a hub with no installable kind, SAYS SO', async () => {
  const { ctx } = stub(['hooks/some-hook/hook.yaml', 'README.md']);

  const out = ok(await indexGithubHub(ctx, HOOKS_HUB, new Set()));

  assert.deepEqual(out.discovered, [], 'the read succeeded and proposed nothing');
  assert.equal(out.reason, 'no-installable-kind');
  assert.equal(out.kinds, 'hooks', "the hub's OWN declared string, carried for the label to render");
});

test('7.6.91: an OK read that finds nothing in a SKILLS hub carries NO reason', async () => {
  // The negative that stops the reason becoming "empty" by another name: this
  // hub publishes the kind forge installs and simply has none today, which is
  // "nothing indexed" and nothing more.
  const { ctx } = stub(['README.md']);

  const out = ok(await indexGithubHub(ctx, HUB, new Set()));

  assert.deepEqual(out.discovered, []);
  assert.equal(out.reason, undefined, 'an empty SKILLS hub has nothing to explain');
  assert.equal(out.kinds, undefined);
});

test('7.6.91: a hub that DISCOVERED rows never carries the reason, EVEN declaring no installable kind', async () => {
  // THE EMPTINESS IS LOAD-BEARING AND THIS DOOR PROVES IT. The hub declares
  // `hooks` — no installable kind — and its tree nonetheless contains a
  // `SKILL.md` the reader can propose. So `hasNoInstallableKind` is TRUE here
  // and the row count is what must stop the reason being emitted.
  //
  // The first version of this door declared `hooks, skills`, which made
  // `hasNoInstallableKind` false and the door unable to fail: dropping the
  // emptiness check from the reader left all 23 tests green. It is the
  // together-rule's lesson in a unit test — a door has to be able to observe
  // the thing it claims to pin, and only the MUTATION said that it could not.
  const { ctx } = stub(['skills/one/SKILL.md', 'hooks/h/hook.yaml']);

  const out = ok(await indexGithubHub(ctx, HOOKS_HUB, new Set()));

  assert.equal(out.discovered.length, 1, 'the reader proposes from the layout, not from the declaration');
  assert.equal(out.reason, undefined, 'rows were proposed, so there is nothing to explain');
  assert.equal(out.kinds, undefined);
});

test('7.6.91: a REFUSAL keeps its own reason — the OK branch never overwrites it', async () => {
  // `smithery` is the live case: it refuses with `not-reachable` before any of
  // this can apply, and a refusal already carries the reason it earned.
  const { ctx } = stub([]);

  const out = await indexGithubHub(ctx, { id: 'smithery', url: 'https://smithery.ai', kinds: 'MCPs' }, new Set());

  assert.equal(out.ok, false);
  assert.equal(out.ok === false ? out.reason : null, 'not-reachable');
});
