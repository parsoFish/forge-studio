/**
 * W8-B5 WI-2 — community registry schema v2 (exit rows E4 + E5).
 *
 * E5 — `stars` is a REPO fact that v1 modelled as a PER-ITEM field. Nine items
 * across five distinct `sourceUrl`s each carried their own `signals.stars`, so
 * one repo's count was stamped onto N rows (the reverted Wave-0 diff had six
 * rows at 275713 and two at 170882). The cure here is STRUCTURAL, not a
 * validation: repo-level facts move to a top-level `sources:` map keyed by a
 * normalized repo key, and the item is given NO FIELD to hold a mis-scoped
 * copy in. A v1 item field is a loud load error, not a tolerated leftover.
 *
 * E4 — every registry write preserves the file's leading comment block, in the
 * ONE shared serializer, so all three writers inherit it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadCommunityRegistry, serializeCommunityRegistry, resolveCommunitySource, communitySkillsFromRegistry, communityRegistryPath, COMMUNITY_REGISTRY_SCHEMA_VERSION } from '@forge/library/studio/community-registry.ts';

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'forge-registry-v2-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const V2_HEADER = ['# Curated by hand.', '#', '# Every fact here is repo-scoped.'].join('\n');

const V2_DOC = `${V2_HEADER}
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
  "github:travisvn/awesome-claude-skills":
    stars: null
    starsDisplay: null
    upstreamUpdatedAt: null
    fetchedAt: null
    fetchedBy: seed

items:
  - id: superpowers-tdd
    kind: skill
    name: Test-Driven Development
    category: testing
    sourceUrl: "https://github.com/obra/superpowers"
    provenance: "obra/superpowers"
    tier: sonnet
    signals:
      attributedTo: "obra/superpowers"
  - id: systematic-debugging
    kind: skill
    name: Systematic Debugging
    category: debugging
    sourceUrl: "https://github.com/obra/superpowers"
    provenance: "obra/superpowers"
    tier: sonnet
    signals:
      attributedTo: "obra/superpowers"
  - id: blog-only
    kind: skill
    name: From A Blog Post
    category: planning
    sourceUrl: "https://www.firecrawl.dev/blog/best-claude-code-skills"
    provenance: "Matt Pocock"
    signals:
      attributedTo: "Matt Pocock"
`;

function writeRegistry(dir: string, text: string): string {
  const path = join(dir, 'registry.yaml');
  writeFileSync(path, text, 'utf8');
  return path;
}

// ---------------------------------------------------------------------------
// Load: the v2 shape
// ---------------------------------------------------------------------------

test('the schema version constant is 2 — the loader has ONE version it accepts', () => {
  assert.equal(COMMUNITY_REGISTRY_SCHEMA_VERSION, 2);
});

test('loadCommunityRegistry parses a v2 doc: repo facts live under sources, items carry only curation', () =>
  withTmp((dir) => {
    const reg = loadCommunityRegistry(writeRegistry(dir, V2_DOC));
    assert.equal(reg.schemaVersion, 2);
    assert.deepEqual(Object.keys(reg.sources).sort(), [
      'github:obra/superpowers',
      'github:travisvn/awesome-claude-skills',
    ]);
    assert.equal(reg.sources['github:obra/superpowers'].stars, 228000);
    assert.equal(reg.sources['github:obra/superpowers'].fetchedBy, 'seed');
    assert.equal(reg.items.length, 3);
    assert.deepEqual(reg.items[0].signals, { attributedTo: 'obra/superpowers' });
  }));

test('a schemaVersion 1 file is a LOUD load error naming the remedy — there is no back-compat path', () =>
  withTmp((dir) => {
    const v1 = `meta:
  schemaVersion: 1
  lastRefresh: null
items: []
`;
    assert.throws(
      () => loadCommunityRegistry(writeRegistry(dir, v1)),
      (err: Error) => {
        assert.match(err.message, /schemaVersion/);
        assert.match(err.message, /\b1\b/);
        assert.match(err.message, /v2\b/, 'must name the version this forge reads');
        assert.match(err.message, /forge community refresh|refresh/i, 'must tell the operator what to run');
        return true;
      },
    );
  }));

// ---------------------------------------------------------------------------
// E5 — the item has NO FIELD to hold a mis-scoped repo fact
// ---------------------------------------------------------------------------

for (const [field, snippet] of [
  ['signals.stars', '    signals:\n      attributedTo: "x"\n      stars: 275713\n'],
  ['signals.starsDisplay', '    signals:\n      attributedTo: "x"\n      starsDisplay: "276k"\n'],
  ['upstreamUpdatedAt', '    signals:\n      attributedTo: "x"\n    upstreamUpdatedAt: "2026-08-19T17:33:23Z"\n'],
  ['fetchedAt', '    signals:\n      attributedTo: "x"\n    fetchedAt: "2026-08-23T00:00:00Z"\n'],
  ['fetchedBy', '    signals:\n      attributedTo: "x"\n    fetchedBy: seed\n'],
] as const) {
  test(`an item carrying the retired REPO-scoped field "${field}" is REFUSED at load, naming sources: (kills: tolerating a stale mis-scoped copy)`, () =>
    withTmp((dir) => {
      const doc = `meta:
  schemaVersion: 2
  lastRefresh: null
sources: {}
items:
  - id: a
    kind: skill
    name: A
    category: testing
    sourceUrl: "https://github.com/o/r"
    provenance: "o/r"
${snippet}`;
      assert.throws(
        () => loadCommunityRegistry(writeRegistry(dir, doc)),
        (err: Error) => {
          assert.match(err.message, new RegExp(field.split('.').pop()!));
          assert.match(err.message, /sources/, 'the error must point at where the fact belongs');
          return true;
        },
      );
    }));
}

test('E5 — two items sharing one sourceUrl resolve to the SAME source row, so they CANNOT carry different star counts', () =>
  withTmp((dir) => {
    const reg = loadCommunityRegistry(writeRegistry(dir, V2_DOC));
    const tdd = reg.items.find((i) => i.id === 'superpowers-tdd')!;
    const dbg = reg.items.find((i) => i.id === 'systematic-debugging')!;
    const a = resolveCommunitySource(reg, tdd);
    const b = resolveCommunitySource(reg, dbg);
    assert.notEqual(a, null);
    assert.equal(a, b, 'the two items resolve to the very same source object — one repo, one fact');
  }));

test('E5 — the serialized item object has no stars/starsDisplay/fetchedAt/fetchedBy/upstreamUpdatedAt key at all', () =>
  withTmp((dir) => {
    const reg = loadCommunityRegistry(writeRegistry(dir, V2_DOC));
    const text = serializeCommunityRegistry(reg);
    const reparsed = loadCommunityRegistry(writeRegistry(join(dir), text));
    assert.equal(reparsed.items.length, 3);
    for (const item of reparsed.items) {
      assert.deepEqual(Object.keys(item.signals), ['attributedTo'], 'signals holds curation only');
      assert.ok(!('stars' in (item as Record<string, unknown>)));
      assert.ok(!('fetchedAt' in (item as Record<string, unknown>)));
      assert.ok(!('fetchedBy' in (item as Record<string, unknown>)));
      assert.ok(!('upstreamUpdatedAt' in (item as Record<string, unknown>)));
    }
  }));

test('E5 — the legacy CommunitySkill projection is DERIVED from the source row: both items report the identical star count', () => {
  {
    const forgeRoot = mkdtempSync(join(tmpdir(), 'forge-root-'));
    try {
      const path = communityRegistryPath(forgeRoot);
      mkdirSync(join(forgeRoot, 'studio', 'community'), { recursive: true });
      writeFileSync(path, V2_DOC, 'utf8');
      const skills = communitySkillsFromRegistry(forgeRoot);
      const tdd = skills.find((s) => s.id === 'superpowers-tdd')!;
      const dbg = skills.find((s) => s.id === 'systematic-debugging')!;
      assert.equal(tdd.starsNumeric, 228000);
      assert.equal(dbg.starsNumeric, 228000);
      assert.equal(tdd.stars, '228k');
      assert.equal(dbg.stars, '228k');
      // and the row with no parseable upstream is honestly unrefreshed
      const blog = skills.find((s) => s.id === 'blog-only')!;
      assert.equal(blog.starsNumeric, null, 'no repo ⇒ no star count, never fabricated');
      assert.equal(blog.stars, undefined);
      assert.equal(blog.fetchedAt, null);
    } finally {
      rmSync(forgeRoot, { recursive: true, force: true });
    }
  }
});

// ---------------------------------------------------------------------------
// E4 — the leading comment block survives every write
// ---------------------------------------------------------------------------

test('E4 — loadCommunityRegistry captures the leading comment block', () =>
  withTmp((dir) => {
    const reg = loadCommunityRegistry(writeRegistry(dir, V2_DOC));
    assert.equal(reg.leadingComments, `${V2_HEADER}\n`);
  }));

test('E4 — serializeCommunityRegistry re-emits the leading comment block VERBATIM above the dump', () =>
  withTmp((dir) => {
    const reg = loadCommunityRegistry(writeRegistry(dir, V2_DOC));
    const text = serializeCommunityRegistry(reg);
    assert.ok(text.startsWith(`${V2_HEADER}\n`), `serialized output lost the header:\n${text.slice(0, 200)}`);
    assert.match(text, /\nmeta:\n/);
  }));

test('E4 — a load → mutate → serialize → load round trip is comment-STABLE (no drift, no duplication)', () =>
  withTmp((dir) => {
    let text = V2_DOC;
    for (let i = 0; i < 3; i++) {
      const reg = loadCommunityRegistry(writeRegistry(dir, text));
      text = serializeCommunityRegistry({ ...reg, items: reg.items.slice(0, 2) });
      assert.equal(
        (text.match(/# Curated by hand\./g) ?? []).length,
        1,
        `header duplicated on write ${i + 1}`,
      );
    }
    assert.ok(text.startsWith(`${V2_HEADER}\n`));
  }));

test('E4 — the REAL seed file survives a load → serialize round trip with all 22 header lines intact', () => {
  const seed = readFileSync(communityRegistryPath(process.cwd()), 'utf8');
  const headerLines = seed.split('\n').findIndex((l) => l.trim().length > 0 && !l.trimStart().startsWith('#'));
  assert.ok(headerLines > 0, 'the shipped seed must carry a curation header');
  return withTmp((dir) => {
    const reg = loadCommunityRegistry(writeRegistry(dir, seed));
    const out = serializeCommunityRegistry(reg);
    const outHeader = out.split('\n').slice(0, headerLines).join('\n');
    const seedHeader = seed.split('\n').slice(0, headerLines).join('\n');
    assert.equal(outHeader, seedHeader, 'every header line must survive verbatim');
  });
});

test('E4 — the shipped seed carries NO comment inside items: (the class the linter refuses)', () => {
  const seed = readFileSync(communityRegistryPath(process.cwd()), 'utf8');
  const lines = seed.split('\n');
  const itemsAt = lines.findIndex((l) => /^items\s*:/.test(l));
  assert.ok(itemsAt >= 0);
  for (let i = itemsAt + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim().length > 0 && !/^\s/.test(l)) break;
    assert.ok(!l.trimStart().startsWith('#'), `registry.yaml:${i + 1} carries a comment inside items: — it cannot survive a write`);
  }
});
