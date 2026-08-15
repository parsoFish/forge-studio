/**
 * W6-CR-3 — pins the contract for `commitRegistryDraft`
 * (`orchestrator/interactive-finalizers.ts`), the `community-refresh`
 * session's `committing`-phase finalizer (ADR-043 §2/§5; `studio/session-
 * kinds.yaml`'s `community-refresh` row).
 *
 * Kept in a SEPARATE file from `interactive-finalizers.test.ts` (rather than
 * appended to that already-1200+-line suite) — one finalizer's contract per
 * file, mirroring this repo's "small, focused files, organised by feature"
 * convention.
 *
 * THE CONTRACT PINNED HERE:
 *   - validates the staged `staging/registry.yaml` through the CR-1 loader
 *     (`loadCommunityRegistry`) — a malformed draft throws a NAMED
 *     (`InteractiveFinalizerError`) error and writes NOTHING to the real
 *     registry.
 *   - a draft item whose content (every field except `fetchedAt`/
 *     `fetchedBy`) differs from the live registry's same-id row — OR has no
 *     live counterpart at all (a proposed new item) — is stamped
 *     `fetchedAt: <now>`, `fetchedBy: "community-refresh/<sessionId>"` in
 *     the output, discarding whatever the draft itself carried for those two
 *     fields.
 *   - a draft item whose content is IDENTICAL to the live row is written out
 *     as the EXACT live object — untouched, never restamped.
 *   - the write is containment-guarded (`resolveGuardedPath`) and
 *     temp-then-rename; a source-side (staging/) containment escape throws
 *     and never touches the real registry.
 *   - `meta.lastRefresh` is bumped to the commit time; `meta.schemaVersion`
 *     carries over from the draft.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import yaml from 'js-yaml';

import { FINALIZERS, resolveFinalizer, commitRegistryDraft } from './interactive-finalizers.ts';

type Scratch = {
  base: string;
  forgeRoot: string;
  libraryRoot: string;
  sessionDir: string;
  stagingDir: string;
  registryPath: string;
};

function mkScratch(prefix: string): Scratch {
  const base = mkdtempSync(join(tmpdir(), prefix));
  const forgeRoot = join(base, 'forge');
  const libraryRoot = join(forgeRoot, '_interactive-library');
  const sessionDir = join(forgeRoot, '_community-refresh', 'sess-001');
  const stagingDir = join(sessionDir, 'staging');
  const communityDir = join(forgeRoot, 'studio', 'community');
  mkdirSync(libraryRoot, { recursive: true });
  mkdirSync(stagingDir, { recursive: true });
  mkdirSync(communityDir, { recursive: true });
  return { base, forgeRoot, libraryRoot, sessionDir, stagingDir, registryPath: join(communityDir, 'registry.yaml') };
}

function cleanup(...roots: string[]): void {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
}

const ALPHA_LIVE = {
  id: 'alpha',
  kind: 'skill',
  name: 'Alpha',
  desc: 'the alpha skill',
  category: 'testing',
  sourceUrl: 'https://github.com/example/alpha',
  provenance: 'example/alpha',
  tier: 'sonnet',
  signals: { stars: 100, starsDisplay: '100', attributedTo: 'example/alpha' },
  upstreamUpdatedAt: null,
  fetchedAt: null,
  fetchedBy: 'seed',
};

const BETA_LIVE = {
  id: 'beta',
  kind: 'skill',
  name: 'Beta',
  category: 'testing',
  sourceUrl: 'https://github.com/example/beta',
  provenance: 'example/beta',
  signals: { stars: null, starsDisplay: null, attributedTo: null },
  upstreamUpdatedAt: null,
  fetchedAt: null,
  fetchedBy: 'seed',
};

function writeLiveRegistry(s: Scratch, items: unknown[]): void {
  writeFileSync(s.registryPath, yaml.dump({ meta: { schemaVersion: 1, lastRefresh: null }, items }));
}

function writeDraft(s: Scratch, items: unknown[]): void {
  writeFileSync(join(s.stagingDir, 'registry.yaml'), yaml.dump({ meta: { schemaVersion: 1, lastRefresh: null }, items }));
}

function readLive(s: Scratch): { meta: { schemaVersion: number; lastRefresh: string | null }; items: Record<string, unknown>[] } {
  return yaml.load(readFileSync(s.registryPath, 'utf8')) as never;
}

function ctxFor(s: Scratch): { sessionDir: string; forgeRoot: string; libraryRoot: string; packageId: string } {
  return { sessionDir: s.sessionDir, forgeRoot: s.forgeRoot, libraryRoot: s.libraryRoot, packageId: 'community-registry' };
}

const BUILTIN_ERROR_NAMES = new Set(['Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'EvalError', 'URIError']);

function assertNamedThrow(err: unknown, context: string): void {
  assert.ok(err instanceof Error, `${context}: must throw a real Error`);
  assert.ok(
    !BUILTIN_ERROR_NAMES.has((err as Error).name),
    `${context}: must throw a deliberately named custom error, not a bare ${(err as Error).name}`,
  );
}

// ---------------------------------------------------------------------------
// Registry wiring
// ---------------------------------------------------------------------------

test('commitRegistryDraft is registered in FINALIZERS and resolveFinalizer', () => {
  assert.ok(FINALIZERS.some((row) => row.id === 'commitRegistryDraft'));
  assert.equal(resolveFinalizer('commitRegistryDraft'), commitRegistryDraft);
});

// ---------------------------------------------------------------------------
// Verified rows are stamped; unverified rows are untouched
// ---------------------------------------------------------------------------

test('verified-rows-stamped / unverified-untouched: a changed row is stamped, an identical row is preserved byte-for-byte', async () => {
  const s = mkScratch('cr-stamp-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE, BETA_LIVE]);
    const alphaUpdated = {
      ...ALPHA_LIVE,
      signals: { stars: 250, starsDisplay: '250', attributedTo: 'example/alpha' },
      upstreamUpdatedAt: '2026-08-01T00:00:00.000Z',
      // The draft is instructed never to set these — commitRegistryDraft
      // must discard whatever it carries here regardless.
      fetchedAt: '1999-01-01T00:00:00.000Z',
      fetchedBy: 'a-lying-draft',
    };
    writeDraft(s, [alphaUpdated, BETA_LIVE]);

    const before = new Date();
    const wrote = await commitRegistryDraft(ctxFor(s));
    const after = new Date();

    assert.deepEqual(wrote, [s.registryPath]);
    const out = readLive(s);
    const outAlpha = out.items.find((i) => i.id === 'alpha')!;
    const outBeta = out.items.find((i) => i.id === 'beta')!;

    // Verified/changed row: real new signals carried through, fetchedAt/
    // fetchedBy are the FINALIZER's own stamp — never the draft's lying values.
    assert.equal((outAlpha.signals as { stars: number }).stars, 250);
    assert.equal(outAlpha.upstreamUpdatedAt, '2026-08-01T00:00:00.000Z');
    assert.notEqual(outAlpha.fetchedAt, '1999-01-01T00:00:00.000Z');
    assert.equal(outAlpha.fetchedBy, 'community-refresh/sess-001');
    const stampedAt = new Date(outAlpha.fetchedAt as string);
    assert.ok(stampedAt >= before && stampedAt <= after, 'fetchedAt must be the real commit time');

    // Unverified/unchanged row: byte-identical to the live entry — never
    // restamped.
    assert.deepEqual(outBeta, BETA_LIVE);

    // meta bumped/preserved correctly.
    assert.equal(out.meta.schemaVersion, 1);
    assert.ok(out.meta.lastRefresh !== null);
    const lastRefresh = new Date(out.meta.lastRefresh as string);
    assert.ok(lastRefresh >= before && lastRefresh <= after);
  } finally {
    cleanup(s.base);
  }
});

test('a proposed NEW item (no live counterpart) is stamped exactly like a changed row', async () => {
  const s = mkScratch('cr-new-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    const gamma = {
      id: 'gamma',
      kind: 'skill',
      name: 'Gamma',
      category: 'testing',
      sourceUrl: 'https://github.com/example/gamma',
      provenance: 'example/gamma',
      signals: { stars: 42, starsDisplay: '42', attributedTo: 'example/gamma' },
      upstreamUpdatedAt: '2026-08-01T00:00:00.000Z',
      fetchedAt: null,
      fetchedBy: 'seed',
    };
    writeDraft(s, [ALPHA_LIVE, gamma]);

    await commitRegistryDraft(ctxFor(s));
    const out = readLive(s);
    const outGamma = out.items.find((i) => i.id === 'gamma')!;
    assert.equal(outGamma.fetchedBy, 'community-refresh/sess-001');
    assert.ok(outGamma.fetchedAt !== null);
  } finally {
    cleanup(s.base);
  }
});

test('a fresh forge root with no live registry.yaml yet: every draft row is treated as new and stamped', async () => {
  const s = mkScratch('cr-fresh-');
  try {
    // No writeLiveRegistry call — studio/community/registry.yaml does not exist.
    assert.equal(existsSync(s.registryPath), false);
    writeDraft(s, [ALPHA_LIVE]);
    const wrote = await commitRegistryDraft(ctxFor(s));
    assert.deepEqual(wrote, [s.registryPath]);
    const out = readLive(s);
    assert.equal(out.items[0].fetchedBy, 'community-refresh/sess-001');
  } finally {
    cleanup(s.base);
  }
});

// ---------------------------------------------------------------------------
// Malformed draft — throws, no write
// ---------------------------------------------------------------------------

test('malformed draft (items not an array): throws a named error and leaves the live registry untouched', async () => {
  const s = mkScratch('cr-malformed-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    const beforeRaw = readFileSync(s.registryPath, 'utf8');
    writeFileSync(join(s.stagingDir, 'registry.yaml'), yaml.dump({ meta: { schemaVersion: 1, lastRefresh: null }, items: 'not-an-array' }));

    let caught: unknown;
    try {
      await commitRegistryDraft(ctxFor(s));
    } catch (err) {
      caught = err;
    }
    assertNamedThrow(caught, 'malformed draft (items not array)');
    assert.match((caught as Error).message, /items/i);
    assert.equal(readFileSync(s.registryPath, 'utf8'), beforeRaw, 'the live registry must be byte-identical after a refused commit');
  } finally {
    cleanup(s.base);
  }
});

test('malformed draft (bad kind vocab): throws a named error and leaves the live registry untouched', async () => {
  const s = mkScratch('cr-badkind-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    const beforeRaw = readFileSync(s.registryPath, 'utf8');
    writeDraft(s, [{ ...ALPHA_LIVE, kind: 'not-a-real-kind' }]);

    let caught: unknown;
    try {
      await commitRegistryDraft(ctxFor(s));
    } catch (err) {
      caught = err;
    }
    assertNamedThrow(caught, 'malformed draft (bad kind)');
    assert.equal(readFileSync(s.registryPath, 'utf8'), beforeRaw);
  } finally {
    cleanup(s.base);
  }
});

test('no staged draft at all: throws a named error and leaves the live registry untouched', async () => {
  const s = mkScratch('cr-nodraft-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    const beforeRaw = readFileSync(s.registryPath, 'utf8');
    // staging/ exists (mkScratch creates it) but carries no registry.yaml.

    let caught: unknown;
    try {
      await commitRegistryDraft(ctxFor(s));
    } catch (err) {
      caught = err;
    }
    assertNamedThrow(caught, 'no staged draft');
    assert.equal(readFileSync(s.registryPath, 'utf8'), beforeRaw);
  } finally {
    cleanup(s.base);
  }
});

// ---------------------------------------------------------------------------
// Containment — a staged registry.yaml that is a symlink escaping staging/
// ---------------------------------------------------------------------------

test('containment: a symlinked staging/registry.yaml pointing outside the session is refused, never followed', async (t) => {
  const s = mkScratch('cr-symlink-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    const beforeRaw = readFileSync(s.registryPath, 'utf8');

    const secretPath = join(s.base, 'secret-registry.yaml');
    const secretItem = { ...ALPHA_LIVE, id: 'exfiltrated-secret' };
    writeFileSync(secretPath, yaml.dump({ meta: { schemaVersion: 1, lastRefresh: null }, items: [secretItem] }));

    const draftPath = join(s.stagingDir, 'registry.yaml');
    try {
      symlinkSync(secretPath, draftPath);
    } catch {
      t.skip('platform cannot create symlinks in this environment');
      return;
    }

    let caught: unknown;
    try {
      await commitRegistryDraft(ctxFor(s));
    } catch (err) {
      caught = err;
    }
    assertNamedThrow(caught, 'symlinked staging draft');
    assert.equal(readFileSync(s.registryPath, 'utf8'), beforeRaw, 'the live registry must be untouched');
    assert.doesNotMatch(readFileSync(s.registryPath, 'utf8'), /exfiltrated-secret/, 'the secret content must never reach the live registry');
  } finally {
    cleanup(s.base);
  }
});
