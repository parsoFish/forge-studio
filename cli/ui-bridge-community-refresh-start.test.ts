/**
 * Acceptance tests for `POST /api/studio/community-refresh/start` (W6-CR-3 —
 * the community-refresh session's kickoff route, `cli/ui-bridge.ts`).
 *
 * UNLIKE every other interactive kind's `/start` route, this one takes NO
 * `project`/`prompt` at all — the community registry is forge's own single,
 * forge-wide file, not a per-project artifact. The session anchors under the
 * ONE fixed pseudo-project `COMMUNITY_REFRESH_PROJECT_ANCHOR`
 * (`.community-registry`, `cli/bridge-studio-sessions.ts`), mirroring
 * kb-cleanup's own non-project `.kb-<id>` anchor precedent.
 *
 * Mirrors `cli/ui-bridge-authoring-start.test.ts`'s shape where the contract
 * actually overlaps (modelTier validation, distinct-session-ids, containment)
 * — a deliberately smaller suite since there is no project/prompt surface to
 * cover here at all.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };
const ANCHOR = '.community-registry';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

/** The real community-refresh SKILL.md's runtime envelope, seeded verbatim
 *  (strategy:range [sonnet, opus]) — needed only by the modelTier tests
 *  below; `resolveKickoffModelTier` never even reads it when the request
 *  omits `modelTier` (see AT-1/AT-2). */
function seedCommunityRefreshSkill(root: string): void {
  mkdirSync(join(root, 'skills', 'community-refresh'), { recursive: true });
  writeFileSync(
    join(root, 'skills', 'community-refresh', 'SKILL.md'),
    [
      '---',
      'name: community-refresh',
      'description: fixture',
      'surface: interactive',
      'library: true',
      'purpose: fixture',
      'composition: { skills: [], tools: [], mcps: [], guards: [] }',
      'runtime:',
      '  sdk: claude',
      '  strategy: range',
      '  range:',
      '    - claude-sonnet-4-6',
      '    - claude-opus-4-8',
      'brainAccess: none',
      'interactivity: fixture',
      'allowed-tools: []',
      'disallowed-tools: []',
      '---',
      '',
      'Fixture body.',
      '',
    ].join('\n'),
    'utf8',
  );
}

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-community-refresh-start-'));
  for (const state of ['pending', 'in-flight', 'ready-for-review', 'done', 'failed']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'community'), { recursive: true });
  writeFileSync(join(forgeRoot, 'studio', 'community', 'registry.yaml'), 'meta:\n  schemaVersion: 1\n  lastRefresh: null\nitems: []\n', 'utf8');
  seedCommunityRefreshSkill(forgeRoot);

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

function start(body: unknown = {}): Promise<Response> {
  return fetch(`${url}/api/studio/community-refresh/start`, { method: 'POST', headers: CSRF, body: JSON.stringify(body) });
}

function sessionDirFor(sessionId: string): string {
  return join(forgeRoot, 'projects', ANCHOR, '_community-refresh', sessionId);
}

// ---------------------------------------------------------------------------
// Happy path — no project/prompt at all
// ---------------------------------------------------------------------------

test('AT-1: a bare POST (no body fields) succeeds, seeding a real session dir under the fixed anchor, phase "gathering"', async () => {
  const res = await start({});
  const text = await res.text();
  assert.equal(res.status, 200, `expected 200, got ${res.status}: ${text}`);
  const body = JSON.parse(text) as { ok: boolean; sessionId: string; project: string };
  assert.equal(body.ok, true);
  assert.equal(body.project, ANCHOR, 'the anchor pseudo-project must be returned verbatim, mirroring kb-cleanup\'s own sessionProject echo');
  assert.ok(body.sessionId, 'sessionId must be present on a successful start');

  const status = JSON.parse(readFileSync(join(sessionDirFor(body.sessionId), 'status.json'), 'utf8')) as {
    phase: string;
    project: string;
    package_id: string;
    registryPath: string;
    hubsPath: string;
  };
  assert.equal(status.phase, 'gathering', 'the seeded phase must be "gathering" — the community-refresh turnSpec\'s own first row');
  assert.equal(status.project, ANCHOR);
  assert.equal(status.package_id, 'community-registry', 'a fixed, SLUG_RE-valid packageId — satisfies the generic finalize-step machinery only; commitRegistryDraft itself ignores it');
  assert.equal(status.registryPath, join(forgeRoot, 'studio', 'community', 'registry.yaml'));
  assert.equal(status.hubsPath, join(forgeRoot, 'studio', 'community', 'hubs.yaml'));
});

test('AT-2: two starts mint two distinct session ids, both real', async () => {
  const r1 = await start({});
  const r2 = await start({});
  const b1 = (await r1.json()) as { sessionId: string };
  const b2 = (await r2.json()) as { sessionId: string };
  assert.notEqual(b1.sessionId, b2.sessionId);
  assert.ok(existsSync(sessionDirFor(b1.sessionId)));
  assert.ok(existsSync(sessionDirFor(b2.sessionId)));
});

// ---------------------------------------------------------------------------
// ADR-043 §3 amendment (wave-6 kickoff model-tier seam)
// ---------------------------------------------------------------------------

test('AT-3: a valid modelTier ("opus", within the declared range) is persisted into status.json', async () => {
  const res = await start({ modelTier: 'opus' });
  const body = (await res.json()) as { sessionId: string };
  assert.equal(res.status, 200);
  const status = JSON.parse(readFileSync(join(sessionDirFor(body.sessionId), 'status.json'), 'utf8')) as { modelTier?: string };
  assert.equal(status.modelTier, 'opus');
});

test('AT-4: an out-of-envelope modelTier ("haiku") 400s naming the value and the allowed set, no session dir created', async () => {
  const res = await start({ modelTier: 'haiku' });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /requested model tier "haiku".*allowed tier\(s\): sonnet, opus/);
});

test('AT-5: a non-string modelTier -> 400, no session dir created', async () => {
  const res = await start({ modelTier: 42 });
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// W7-B3 (community-08) — the optional operator brief: "find me skills for X"
// rides the kickoff body into status.json, where the generic turn prompt
// inlines it for the SKILL's targeted-search contract. Validated at the
// boundary: string only, non-blank after trim, bounded length.
// ---------------------------------------------------------------------------

test('AT-6: a brief is trimmed and persisted into status.json verbatim', async () => {
  const res = await start({ brief: '  find me skills for terraform drift detection  ' });
  const body = (await res.json()) as { sessionId: string };
  assert.equal(res.status, 200);
  const status = JSON.parse(readFileSync(join(sessionDirFor(body.sessionId), 'status.json'), 'utf8')) as { brief?: string };
  assert.equal(status.brief, 'find me skills for terraform drift detection');
});

test('AT-7: no brief -> status.json carries NO brief key at all (full refresh is the absence of a brief, never an empty string)', async () => {
  const res = await start({});
  const body = (await res.json()) as { sessionId: string };
  assert.equal(res.status, 200);
  const status = JSON.parse(readFileSync(join(sessionDirFor(body.sessionId), 'status.json'), 'utf8')) as Record<string, unknown>;
  assert.ok(!('brief' in status), 'an omitted brief must not materialise as any key');
});

test('AT-8: a non-string brief -> 400', async () => {
  const res = await start({ brief: ['skills'] });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /brief/);
});

test('AT-9: a whitespace-only brief -> 400 (never silently dropped into a full refresh the operator did not ask for)', async () => {
  const res = await start({ brief: '   ' });
  assert.equal(res.status, 400);
});

test('AT-10: an over-long brief (> 2000 chars) -> 400 naming the cap', async () => {
  const res = await start({ brief: 'x'.repeat(2001) });
  assert.equal(res.status, 400);
  const body = (await res.json()) as { error: string };
  assert.match(body.error, /2000/);
});
