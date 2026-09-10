/**
 * M6-D / operator ruling 477 (shape A, corrected by 582) — INSTALL BY URL, at
 * the route and bridge level.
 *
 * WHAT §3's ROW ASKED FOR, AND WHAT IT GOT. "install by id AND by URL — they
 * are different paths." Before this they were one path with two entrances:
 * adding a row by URL made an item BROWSABLE and never made it installable,
 * because nothing fetched what the URL named. S8's beat 9 is the beat that
 * says so, and `_1.0/stories/S8.md` records the finding. These tests pin the
 * second path's own decisions.
 *
 * WHY THIS FILE EXISTS SEPARATELY. `bridge-studio-community.test.ts` and
 * `community-install.test.ts` are both at their `check-file-size` ceilings,
 * and an exemption is a ceiling rather than a licence — so 477's new tests
 * live here rather than pushing two already-over-cap files further over.
 * Those two files keep the cases whose BEHAVIOUR changed (a catalog-only row
 * with an unfetchable upstream still 400s); this file carries what is new.
 *
 * NO NETWORK. Not one test here reaches the internet. The route-level tests
 * assert a pure decision, and the bridge-level test asserts that the fetch arm
 * is REFUSED under dry-bridge — which is also, at this level, the only proof
 * that the arm is reached at all. The fetch itself is driven by an injected
 * stub in `tests/unit/community-fetch-package.test.ts`; a green beat and a
 * green route test prove the door is offered, and those unit tests prove it
 * works. The two claims are kept separate on purpose.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import yaml from 'js-yaml';

import { dispatchRoute } from '@forge/kernel';
import { routeCommunityInstall } from '../../studio/community-install.ts';
import { libraryRoutes } from '../../routes.ts';
import { fixtureAgentFacts } from '../test-fixtures/agent-fixture.ts';
import { fixtureFlowSource } from '../test-fixtures/flow-fixture.ts';
import { inertAuthoringSession } from '../test-fixtures/authoring-session-fixture.ts';

let forgeRoot: string;

/** Drives the LIBRARY's own route table directly — no `apps/forge` import, so
 *  this file adds no `package-to-assembly` row to the boundary baseline, which
 *  is a ratchet that may only shrink. `bridge-studio-community-install-state.test.ts`
 *  established the shape. */
async function callRoute(
  url: string,
  method: string,
  body: unknown = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  let status = 0;
  let payload = '';
  const res = {
    writeHead: (s: number) => { status = s; },
    end: (chunk?: string) => { if (typeof chunk === 'string') payload = chunk; },
  } as unknown as ServerResponse;

  const handled = await dispatchRoute(
    libraryRoutes({
      agentFacts: fixtureAgentFacts(forgeRoot),
      isSdkAvailable: () => false,
      flowSource: fixtureFlowSource,
      authoringSession: inertAuthoringSession,
    }),
    {} as IncomingMessage,
    res,
    { forgeRoot, logsRoot: join(forgeRoot, '_logs'), readBody: async () => body },
    url,
    method,
  );

  assert.equal(handled, true, `the library route table must own ${method} ${url}`);
  return { status, json: payload === '' ? {} : (JSON.parse(payload) as Record<string, unknown>) };
}

/** A registry carrying one skill row per entry — the only fixture these tests
 *  need, since every case here turns on a row's `sourceUrl`. */
function writeRegistry(root: string, skills: readonly { id: string; source?: string }[]): void {
  const dir = join(root, 'studio', 'community');
  mkdirSync(dir, { recursive: true });
  const items = skills.map((s) => ({
    id: s.id,
    kind: 'skill',
    name: s.id,
    provenance: 'Test Author',
    sourceUrl: s.source ?? `https://github.com/test-owner/${s.id}`,
    category: 'testing',
    desc: `${s.id} description`,
    signals: { attributedTo: 'Test Author' },
  }));
  writeFileSync(
    join(dir, 'registry.yaml'),
    yaml.dump({ meta: { schemaVersion: 2, lastRefresh: null }, sources: {}, items }),
    'utf8',
  );
}

before(() => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'community-install-by-url-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });
});

after(() => {
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The routing decision — pure, and the place §3's two doors stop being one
// ---------------------------------------------------------------------------

test('a catalog-only skill whose upstream is a GitHub repo routes to the fetch pipeline, carrying that upstream', () => {
  writeRegistry(forgeRoot, [{ id: 'fetchable-skill' }]);

  const route = routeCommunityInstall(forgeRoot, 'skill', 'fetchable-skill');

  assert.equal(route.pipeline, 'fetch');
  if (route.pipeline !== 'fetch') return; // narrows for TS
  assert.equal(route.id, 'fetchable-skill');
  assert.equal(
    route.sourceUrl,
    'https://github.com/test-owner/fetchable-skill',
    "the arm must carry the ROW's own upstream — the fetch reads a package from there, and the provenance recorded names it",
  );
});

test('a catalog-only skill whose upstream is an npm package is NOT fetchable — a real upstream identity is not a skill package', () => {
  writeRegistry(forgeRoot, [{ id: 'npm-skill', source: 'https://www.npmjs.com/package/left-pad' }]);

  const route = routeCommunityInstall(forgeRoot, 'skill', 'npm-skill');

  assert.equal(route.pipeline, 'none');
  if (route.pipeline !== 'none') return;
  assert.match(route.reason, /npmjs\.com/, 'the refusal must name the upstream it could not read a package out of');
});

test('a vendored skill still routes to the ordinary skill pipeline — 477 added a first step, never a second install path', () => {
  writeRegistry(forgeRoot, [{ id: 'vendored-skill' }]);
  const dir = join(forgeRoot, 'studio', 'community', 'skills', 'vendored-skill');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: vendored-skill\n---\n\nBody.\n', 'utf8');

  const route = routeCommunityInstall(forgeRoot, 'skill', 'vendored-skill');

  assert.equal(route.pipeline, 'skill', 'bytes already on disk are never re-fetched');
});

// ---------------------------------------------------------------------------
// The wire fact the page reads — derived server-side, from ONE grammar
// ---------------------------------------------------------------------------

test('GET .../community/skill/<id>: upstreamFetchableAs names the repo ONLY for a not-vendored skill with a GitHub upstream', async () => {
  writeRegistry(forgeRoot, [
    { id: 'wire-github-skill' },
    { id: 'wire-blog-skill', source: 'https://firecrawl.dev/blog/some-post' },
    { id: 'wire-npm-skill', source: 'https://www.npmjs.com/package/left-pad' },
  ]);

  const read = async (id: string): Promise<unknown> => {
    const res = await callRoute(`/api/studio/community/skill/${id}`, 'GET');
    assert.equal(res.status, 200, `skill/${id} must be readable pre-install`);
    return res.json['upstreamFetchableAs'];
  };

  assert.equal(
    await read('wire-github-skill'),
    'https://github.com/test-owner/wire-github-skill',
    'the RESOLVED repository, not the row\'s raw sourceUrl — the page shows this to the operator before they press Install',
  );
  assert.equal(await read('wire-blog-skill'), null, 'a curated row pointing at a blog post publishes no package');
  assert.equal(await read('wire-npm-skill'), null, 'an npm package is a real upstream identity but not a skill package forge can read');
});

// ---------------------------------------------------------------------------
// Containment — the install route joined `refresh` as an outbound-network route
// ---------------------------------------------------------------------------

test('POST .../install for a fetchable row is refused under dry-bridge, BEFORE any network call', async () => {
  writeRegistry(forgeRoot, [{ id: 'dry-bridge-skill' }]);
  const prior = process.env['FORGE_DRY_BRIDGE'];
  process.env['FORGE_DRY_BRIDGE'] = '1';
  try {
    const res = await callRoute('/api/studio/community/skill/dry-bridge-skill/install', 'POST');
    assert.equal(res.status, 409, 'expected the typed dry-bridge 409');
    assert.equal(res.json['error'], 'dry-bridge');
    assert.equal(res.json['action'], 'network', 'the install route now REACHES the network, and says so by the reach it declares');
  } finally {
    if (prior === undefined) delete process.env['FORGE_DRY_BRIDGE'];
    else process.env['FORGE_DRY_BRIDGE'] = prior;
  }
});

// ---------------------------------------------------------------------------
// Regressions from the ruling-477 security review. Both HIGH findings were
// REPRODUCED against this code before they were fixed; both keep a test.
// ---------------------------------------------------------------------------

test('HIGH-1: a vendored package WITH a registry row is attributed to that row, never to forge\'s own repo', () => {
  // Before the fix, `routeCommunityInstall` returned VENDORED_UPSTREAM_SOURCE
  // for anything with a SKILL.md under studio/community/skills/. Ruling 477
  // puts THIRD-PARTY bytes in that directory, so the constant would launder a
  // stranger's package into a forge-authored one on the exact record
  // `skill-trust.ts` reads and the UI renders.
  writeRegistry(forgeRoot, [{ id: 'attributed-skill', source: 'https://github.com/attacker/evil' }]);
  const dir = join(forgeRoot, 'studio', 'community', 'skills', 'attributed-skill');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: attributed-skill\n---\n\nBody.\n', 'utf8');

  const route = routeCommunityInstall(forgeRoot, 'skill', 'attributed-skill');

  assert.equal(route.pipeline, 'skill');
  if (route.pipeline !== 'skill') return;
  assert.equal(route.upstream.source, 'https://github.com/attacker/evil', 'the provenance recorded must name where the bytes came from');
  assert.notEqual(route.upstream.source, 'https://github.com/parsoFish/forge-studio');
});

test('HIGH-2: an install destination occupied by an unmanaged local skill refuses at the ROUTE, before anything is fetched', () => {
  // The collision refusal used to live INSIDE the vendored branch, so the
  // fetch arm never reached it: forge would spend the operator's rate limit,
  // write a stranger's package into the repo-tracked tree, and only then throw
  // — answering 500 where the vendored path answers a named 400, and leaving
  // the bytes behind for the next install to adopt.
  writeRegistry(forgeRoot, [{ id: 'occupied-skill' }]);
  const local = join(forgeRoot, 'skills', 'occupied-skill');
  mkdirSync(local, { recursive: true });
  writeFileSync(join(local, 'SKILL.md'), '---\nname: occupied-skill\n---\n\nA local skill nobody installed.\n', 'utf8');

  const route = routeCommunityInstall(forgeRoot, 'skill', 'occupied-skill');

  assert.equal(route.pipeline, 'none', 'a fetchable row whose destination is occupied must refuse BEFORE the fetch');
  if (route.pipeline !== 'none') return;
  assert.match(route.reason, /occupie|collision|already/i);
});

test('MEDIUM-3: an id already installed from its upstream refuses rather than silently re-fetching today\'s bytes', () => {
  // `installSkillPackage` returns alreadyInstalled:true WITHOUT writing, so a
  // re-fetch would leave the upstream's CURRENT bytes vendored beside the
  // package the operator actually reviewed — same trust state, different code.
  writeRegistry(forgeRoot, [{ id: 'installed-skill' }]);
  const local = join(forgeRoot, 'skills', 'installed-skill');
  mkdirSync(local, { recursive: true });
  writeFileSync(
    join(local, 'SKILL.md'),
    [
      '---',
      'name: installed-skill',
      'provenance:',
      "  source: 'https://github.com/test-owner/installed-skill'",
      "  contentHash: 'abc123'",
      // QUOTED deliberately: unquoted, js-yaml parses this as a Date and
      // `extractProvenance` requires a string, so the block would read as
      // ABSENT and the fixture would be testing the collision arm instead.
      "  installedAt: '2026-09-10T00:00:00.000Z'",
      '---',
      '',
      'Body.',
      '',
    ].join('\n'),
    'utf8',
  );

  const route = routeCommunityInstall(forgeRoot, 'skill', 'installed-skill');

  assert.equal(route.pipeline, 'none');
  if (route.pipeline !== 'none') return;
  assert.match(route.reason, /already installed/i);
  assert.match(route.reason, /reviewed/i, 'the refusal must say WHY re-fetching is not idempotent');
});
