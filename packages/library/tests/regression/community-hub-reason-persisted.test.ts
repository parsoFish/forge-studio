/**
 * `forge-8vfn.7.6.84`, T1 929 — the chip's "why" must outlive the tab.
 *
 * THE DEFECT THIS PINS, measured by S8 run 5 rather than reasoned about: the
 * per-hub reason lived in `refreshResult`, the in-memory result of the refresh
 * this page ran. Beat 4 pressed refresh; beat 5 NAVIGATED; the page remounted;
 * `data-hub-reason` was gone 600 ms later — while every other attribute on the
 * same chip came from server data and survived.
 *
 * THE SEAM DOOR (§15.500) runs the real declaration end to end: a refresh
 * writes the outcomes to `meta.hubs`, and a FRESH read — no shared state with
 * the refresh, exactly as a reload or a second tab would be — serves the
 * reason. A door that asserted the in-memory value would pass against the
 * defect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadCommunityRegistry, serializeCommunityRegistry, communityRegistryPath } from '../../studio/community-registry.ts';

function root(): string {
  const d = mkdtempSync(join(tmpdir(), 'hub-reason-'));
  mkdirSync(join(d, 'studio', 'community'), { recursive: true });
  writeFileSync(
    join(d, 'studio', 'community', 'registry.yaml'),
    'meta:\n  schemaVersion: 2\n  lastRefresh: null\n\nsources: {}\n\nitems: []\n',
  );
  return d;
}

test('a refresh’s per-hub verdicts are written to meta.hubs and READ BACK by a fresh load', () => {
  const d = root();
  try {
    const before = loadCommunityRegistry(communityRegistryPath(d));
    assert.deepEqual(before.hubs, [], 'a registry that never refreshed says nothing about its hubs');

    writeFileSync(
      communityRegistryPath(d),
      serializeCommunityRegistry({
        schemaVersion: before.schemaVersion,
        lastRefresh: '2026-09-12T13:00:00.000Z',
        hubs: [
          { hubId: 'skills-sh', discovered: 0, reason: 'not-reachable' },
          { hubId: 'mcp-registry', discovered: 206 },
        ],
        sources: before.sources,
        items: before.items,
        leadingComments: before.leadingComments,
      }),
    );

    // THE FRESH READ. Nothing is carried from the write above — this is the
    // reload, or the second tab, or tomorrow morning.
    const after = loadCommunityRegistry(communityRegistryPath(d));
    assert.equal(after.hubs.length, 2);
    assert.equal(after.hubs.find((h) => h.hubId === 'skills-sh')?.reason, 'not-reachable');
    // A hub that WAS read carries no reason: "nothing to explain" is not a
    // failure, and inventing one here would make every chip look broken.
    assert.equal(after.hubs.find((h) => h.hubId === 'mcp-registry')?.reason, undefined);
    assert.equal(after.hubs.find((h) => h.hubId === 'mcp-registry')?.discovered, 206);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('a registry with no meta.hubs loads, and writing none emits no key', () => {
  const d = root();
  try {
    const reg = loadCommunityRegistry(communityRegistryPath(d));
    const out = serializeCommunityRegistry({ ...reg, hubs: [] });
    // Absent rather than `hubs: []` — an empty key would claim a refresh
    // happened and found nothing to say, which is a different fact from never
    // having refreshed.
    assert.equal(out.includes('hubs:'), false);
    writeFileSync(communityRegistryPath(d), out);
    assert.deepEqual(loadCommunityRegistry(communityRegistryPath(d)).hubs, []);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('a malformed meta.hubs row is a malformed REGISTRY, never a row dropped in silence', () => {
  const d = root();
  try {
    const p = communityRegistryPath(d);
    writeFileSync(p, readFileSync(p, 'utf8').replace('lastRefresh: null', 'lastRefresh: null\n  hubs:\n    - hubId: ""\n      discovered: 0'));
    assert.throws(() => loadCommunityRegistry(p), /meta\.hubs\[0\]\.hubId/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
