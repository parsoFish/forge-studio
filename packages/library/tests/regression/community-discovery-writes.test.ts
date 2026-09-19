/**
 * Operator item 87 (T1 ledger 1216) — community discovery MAY WRITE to
 * `registry.yaml`. Ruling 566's "proposes, never writes" is superseded: a hub
 * chip's count must reflect REAL rows, not a proposal nobody has acted on.
 *
 * `runCommunityRefresh`'s critical-section write used to persist ONLY
 * `sources`/`lastRefresh`/`hubs` and carry `items` through UNTOUCHED
 * (`items: current.items`) — `discovered` was report-only. This pins the new
 * contract: a hub's discovered row is APPENDED as a real registry item,
 * RE-DEDUPED by id against the document as RE-LOADED under the lock (never
 * overwriting a curated row), and the write is skipped entirely on `dryRun`.
 *
 * FRESH LOAD, always: every assertion below re-reads `registry.yaml` off disk
 * through `loadCommunityRegistry`, never the in-memory `result.discovered` —
 * the property that matters is what a SECOND tab or a `git diff` would see.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCommunityRefresh } from '../../community-refresh-run.ts';
import { loadCommunityRegistry, communityRegistryPath } from '../../studio/community-registry.ts';
import type { FetchLike } from '../../studio/community-refresh-api.ts';

const FAKE_TOKEN = 'ghp_DISCOVERYWRITESTESTTOKEN0000000000';
const HUB_REPO = 'a-hub-owner/a-hub-repo';
const HUB_URL = `https://github.com/${HUB_REPO}`;

const HEADER = '# fixture — curation header must survive every write.\n';

function registryYaml(): string {
  return `${HEADER}meta:
  schemaVersion: 2
  lastRefresh: null

sources: {}

items:
  - id: existing-thing
    kind: skill
    name: Existing Thing
    category: testing
    sourceUrl: "https://www.firecrawl.dev/blog/existing-thing"
    provenance: "a human curator"
    signals:
      attributedTo: "a human curator"
`;
}

/** A temp forgeRoot with the fixture registry and ONE declared GitHub hub
 *  whose tree publishes TWO skills: one the registry already carries
 *  (`existing-thing` — must be filtered by the discovery layer's own
 *  known-id check and never even proposed) and one it does not
 *  (`new-thing` — must be discovered and, after this change, WRITTEN). */
function setup(): { forgeRoot: string; registryPath: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'community-discovery-writes-'));
  mkdirSync(join(forgeRoot, 'studio', 'community'), { recursive: true });
  const registryPath = communityRegistryPath(forgeRoot);
  writeFileSync(registryPath, registryYaml(), 'utf8');
  writeFileSync(
    join(forgeRoot, 'studio', 'community', 'hubs.yaml'),
    `hubs:\n  - id: a-hub\n    name: a hub\n    url: ${HUB_URL}\n    kinds: skills\n`,
    'utf8',
  );
  return { forgeRoot, registryPath };
}

function hubFetchImpl(): FetchLike {
  return async (url) => {
    const u = String(url);
    if (/\/git\/trees\//.test(u)) {
      return new Response(
        JSON.stringify({
          sha: 'treesha',
          truncated: false,
          tree: [
            { path: 'skills/new-thing/SKILL.md', type: 'blob', mode: '100644', sha: 'sha-new', size: 10 },
            { path: 'skills/existing-thing/SKILL.md', type: 'blob', mode: '100644', sha: 'sha-existing', size: 10 },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

test('a hub-discovered UNKNOWN id is written as a real registry item, read back by a FRESH load', async () => {
  const { forgeRoot, registryPath } = setup();
  try {
    const r = await runCommunityRefresh({ forgeRoot, fetchImpl: hubFetchImpl(), token: FAKE_TOKEN });
    if (!r.ok) assert.fail(`expected an ok refresh, got: ${JSON.stringify(r)}`);
    assert.equal(r.wrote, true, 'a discovered row is something to write, even with nothing to verify');

    const fresh = loadCommunityRegistry(registryPath);
    const added = fresh.items.find((i) => i.id === 'new-thing');
    assert.ok(added !== undefined, 'the discovered id must appear as a registry item after a FRESH load');
    assert.equal(added!.kind, 'skill');
    assert.equal(added!.sourceUrl, HUB_URL);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('a curated row sharing a discovered id is left BYTE-IDENTICAL — discovery never overwrites', async () => {
  const { forgeRoot, registryPath } = setup();
  try {
    const before = loadCommunityRegistry(registryPath);
    const beforeExisting = before.items.find((i) => i.id === 'existing-thing');
    assert.ok(beforeExisting !== undefined, 'fixture setup: existing-thing must already be a registry item');

    const r = await runCommunityRefresh({ forgeRoot, fetchImpl: hubFetchImpl(), token: FAKE_TOKEN });
    if (!r.ok) assert.fail(`expected an ok refresh, got: ${JSON.stringify(r)}`);
    assert.deepEqual(
      r.discovered.map((d) => d.id),
      ['new-thing'],
      'existing-thing must never be proposed — the discovery layer already filters known ids',
    );

    const fresh = loadCommunityRegistry(registryPath);
    assert.ok(fresh.items.some((i) => i.id === 'new-thing'), 'new-thing must have been WRITTEN by this same refresh (proves this test exercises the write, not a no-op)');
    const afterExisting = fresh.items.find((i) => i.id === 'existing-thing');
    assert.deepEqual(afterExisting, beforeExisting, 'a curated row must be byte-identical after a refresh that wrote a DIFFERENT discovered row');
    assert.equal(fresh.items.filter((i) => i.id === 'existing-thing').length, 1, 'existing-thing must not be duplicated');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('dryRun writes NOTHING — discovered rows are still reported, the file on disk is untouched', async () => {
  const { forgeRoot, registryPath } = setup();
  try {
    const bytesBefore = readFileSync(registryPath, 'utf8');

    const r = await runCommunityRefresh({ forgeRoot, fetchImpl: hubFetchImpl(), token: FAKE_TOKEN, dryRun: true });
    if (!r.ok) assert.fail(`expected an ok refresh, got: ${JSON.stringify(r)}`);
    assert.equal(r.wrote, false, 'dryRun must never write');
    assert.deepEqual(
      r.discovered.map((d) => d.id),
      ['new-thing'],
      'a dry run still REPORTS what it would have discovered',
    );

    assert.equal(readFileSync(registryPath, 'utf8'), bytesBefore, 'dryRun must leave the file byte-identical');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
