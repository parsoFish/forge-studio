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
 * REVIEW ROUND 2 (bead forge-eip's stamping-semantics fix): the stamping
 * decision moved from a draft-vs-live CONTENT DIFF to the session's own
 * staged `staging/evidence.json` (machine-readable, required alongside
 * `registry.yaml`) — the agent's own per-item verification record IS the
 * fact this finalizer stamps from, never a re-derived guess. This closes
 * the "verified but the numbers happened not to change" gap the old
 * content-diff design silently discarded (an honest re-verification with an
 * unchanged result was previously indistinguishable from "never checked").
 *
 * THE CONTRACT PINNED HERE:
 *   - validates the staged `staging/registry.yaml` through the CR-1 loader
 *     (`loadCommunityRegistry`) AND the staged `staging/evidence.json`
 *     (a JSON object mapping item id -> `{status: "verified"|"verifyFailed",
 *     ...}`) — either malformed throws a NAMED (`InteractiveFinalizerError`)
 *     error and writes NOTHING to the real registry.
 *   - a draft item whose evidence entry has `status: "verified"` is stamped
 *     `fetchedAt: <now>`, `fetchedBy: "community-refresh/<sessionId>"` and
 *     its OTHER fields are trusted as drafted — UNCONDITIONALLY, even when
 *     unchanged from the live row (an honest "we checked it again" fact).
 *   - a draft item with `status: "verifyFailed"`, or NO evidence entry at
 *     all, is committed as the LIVE registry's own row, byte-for-byte —
 *     the draft's own content for that row is never trusted.
 *   - a "new" item (no live counterpart) with no verified evidence entry
 *     REFUSES the whole commit — there's nothing honest to fall back to.
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

function writeEvidence(s: Scratch, evidence: Record<string, { status: 'verified' | 'verifyFailed'; source?: string; note?: string }>): void {
  writeFileSync(join(s.stagingDir, 'evidence.json'), JSON.stringify(evidence, null, 2));
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
// Evidence-driven stamping: verified rows (changed OR unchanged) get
// stamped; verifyFailed / no-evidence rows are committed as the live row,
// byte-for-byte, regardless of what the draft proposed.
// ---------------------------------------------------------------------------

test('verified-CHANGED row is stamped: real new signals carried through, fetchedAt/fetchedBy are the finalizer\'s own stamp, never the draft\'s', async () => {
  const s = mkScratch('cr-verified-changed-');
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
    writeEvidence(s, {
      alpha: { status: 'verified', source: 'https://api.github.com/repos/example/alpha', note: 'stargazers_count=250' },
      beta: { status: 'verifyFailed', source: 'https://github.com/example/beta', note: '404 Not Found' },
    });

    const before = new Date();
    const wrote = await commitRegistryDraft(ctxFor(s));
    const after = new Date();

    assert.deepEqual(wrote, [s.registryPath]);
    const out = readLive(s);
    const outAlpha = out.items.find((i) => i.id === 'alpha')!;
    const outBeta = out.items.find((i) => i.id === 'beta')!;

    assert.equal((outAlpha.signals as { stars: number }).stars, 250);
    assert.equal(outAlpha.upstreamUpdatedAt, '2026-08-01T00:00:00.000Z');
    assert.notEqual(outAlpha.fetchedAt, '1999-01-01T00:00:00.000Z');
    assert.equal(outAlpha.fetchedBy, 'community-refresh/sess-001');
    const stampedAt = new Date(outAlpha.fetchedAt as string);
    assert.ok(stampedAt >= before && stampedAt <= after, 'fetchedAt must be the real commit time');

    // verifyFailed row: byte-identical to the live entry — never restamped.
    assert.deepEqual(outBeta, BETA_LIVE);

    assert.equal(out.meta.schemaVersion, 1);
    assert.ok(out.meta.lastRefresh !== null);
    const lastRefresh = new Date(out.meta.lastRefresh as string);
    assert.ok(lastRefresh >= before && lastRefresh <= after);
  } finally {
    cleanup(s.base);
  }
});

test('verified-UNCHANGED row is STILL stamped: an honest re-verification with the same numbers is not fabrication', async () => {
  const s = mkScratch('cr-verified-unchanged-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    // Draft proposes the EXACT same content as live — the agent re-checked
    // and nothing had changed, but it DID genuinely verify it this pass.
    writeDraft(s, [ALPHA_LIVE]);
    writeEvidence(s, {
      alpha: { status: 'verified', source: 'https://api.github.com/repos/example/alpha', note: 'still 100 stars, confirmed live' },
    });

    const before = new Date();
    await commitRegistryDraft(ctxFor(s));
    const after = new Date();

    const out = readLive(s);
    const outAlpha = out.items.find((i) => i.id === 'alpha')!;
    // The whole point of this test: content-unchanged does NOT mean
    // untouched. A genuinely verified row is stamped regardless.
    assert.equal(outAlpha.fetchedBy, 'community-refresh/sess-001');
    assert.ok(outAlpha.fetchedAt !== null);
    const stampedAt = new Date(outAlpha.fetchedAt as string);
    assert.ok(stampedAt >= before && stampedAt <= after);
  } finally {
    cleanup(s.base);
  }
});

test('verifyFailed row is untouched BYTE-IDENTICAL even when the draft proposes different content for it — the draft is never trusted for an unverified row', async () => {
  const s = mkScratch('cr-failed-tampered-');
  try {
    writeLiveRegistry(s, [BETA_LIVE]);
    // The draft proposes DIFFERENT content for beta despite marking it
    // verifyFailed — this must be ignored entirely; the live row wins.
    const betaTampered = { ...BETA_LIVE, signals: { stars: 9999, starsDisplay: '9999', attributedTo: 'attacker' } };
    writeDraft(s, [betaTampered]);
    writeEvidence(s, { beta: { status: 'verifyFailed', note: 'timeout fetching sourceUrl' } });

    await commitRegistryDraft(ctxFor(s));
    const out = readLive(s);
    assert.deepEqual(out.items.find((i) => i.id === 'beta'), BETA_LIVE, 'the committed row must be the LIVE entry, ignoring the draft\'s tampered content');
  } finally {
    cleanup(s.base);
  }
});

test('a draft item with NO evidence entry at all is treated exactly like verifyFailed — untouched, live wins', async () => {
  const s = mkScratch('cr-noevidence-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    writeDraft(s, [{ ...ALPHA_LIVE, signals: { stars: 999, starsDisplay: '999', attributedTo: 'nope' } }]);
    writeEvidence(s, {}); // no entry for "alpha" at all

    await commitRegistryDraft(ctxFor(s));
    const out = readLive(s);
    assert.deepEqual(out.items.find((i) => i.id === 'alpha'), ALPHA_LIVE);
  } finally {
    cleanup(s.base);
  }
});

test('a proposed NEW item (no live counterpart) marked verified is stamped and committed', async () => {
  const s = mkScratch('cr-new-verified-');
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
    writeEvidence(s, {
      alpha: { status: 'verified', note: 'still current' },
      gamma: { status: 'verified', source: 'https://github.com/example/gamma', note: 'new item found via forge-seed hub' },
    });

    await commitRegistryDraft(ctxFor(s));
    const out = readLive(s);
    const outGamma = out.items.find((i) => i.id === 'gamma')!;
    assert.equal(outGamma.fetchedBy, 'community-refresh/sess-001');
    assert.ok(outGamma.fetchedAt !== null);
  } finally {
    cleanup(s.base);
  }
});

test('a proposed NEW item with NO verified evidence entry refuses the whole commit — nothing honest to fall back to', async () => {
  const s = mkScratch('cr-new-unverified-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    const before = readFileSync(s.registryPath, 'utf8');
    const gamma = { ...ALPHA_LIVE, id: 'gamma', name: 'Gamma' };
    writeDraft(s, [ALPHA_LIVE, gamma]);
    // "gamma" has NO evidence entry — a brand-new item nobody verified.
    writeEvidence(s, { alpha: { status: 'verified' } });

    let caught: unknown;
    try {
      await commitRegistryDraft(ctxFor(s));
    } catch (err) {
      caught = err;
    }
    assertNamedThrow(caught, 'new item, no verified evidence');
    assert.match((caught as Error).message, /gamma/);
    assert.equal(readFileSync(s.registryPath, 'utf8'), before, 'a refused commit must leave the live registry untouched');
  } finally {
    cleanup(s.base);
  }
});

test('a fresh forge root with no live registry.yaml yet: a verified draft row commits; an unverified one refuses (no live fallback exists)', async () => {
  const s = mkScratch('cr-fresh-');
  try {
    assert.equal(existsSync(s.registryPath), false);
    writeDraft(s, [ALPHA_LIVE]);
    writeEvidence(s, { alpha: { status: 'verified' } });
    const wrote = await commitRegistryDraft(ctxFor(s));
    assert.deepEqual(wrote, [s.registryPath]);
    const out = readLive(s);
    assert.equal(out.items[0].fetchedBy, 'community-refresh/sess-001');
  } finally {
    cleanup(s.base);
  }
});

// ---------------------------------------------------------------------------
// Malformed draft / evidence — throws, no write
// ---------------------------------------------------------------------------

test('malformed draft (items not an array): throws a named error and leaves the live registry untouched', async () => {
  const s = mkScratch('cr-malformed-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    const beforeRaw = readFileSync(s.registryPath, 'utf8');
    writeFileSync(join(s.stagingDir, 'registry.yaml'), yaml.dump({ meta: { schemaVersion: 1, lastRefresh: null }, items: 'not-an-array' }));
    writeEvidence(s, { alpha: { status: 'verified' } });

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
    writeEvidence(s, { alpha: { status: 'verified' } });

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

test('no staged evidence.json at all: throws a named error and leaves the live registry untouched', async () => {
  const s = mkScratch('cr-noevidencefile-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    const beforeRaw = readFileSync(s.registryPath, 'utf8');
    writeDraft(s, [ALPHA_LIVE]);
    // No writeEvidence() call at all.

    let caught: unknown;
    try {
      await commitRegistryDraft(ctxFor(s));
    } catch (err) {
      caught = err;
    }
    assertNamedThrow(caught, 'no staged evidence.json');
    assert.match((caught as Error).message, /evidence\.json/);
    assert.equal(readFileSync(s.registryPath, 'utf8'), beforeRaw);
  } finally {
    cleanup(s.base);
  }
});

test('malformed evidence.json (bad status value): throws a named error and leaves the live registry untouched', async () => {
  const s = mkScratch('cr-badstatus-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    const beforeRaw = readFileSync(s.registryPath, 'utf8');
    writeDraft(s, [ALPHA_LIVE]);
    writeFileSync(join(s.stagingDir, 'evidence.json'), JSON.stringify({ alpha: { status: 'probably-fine' } }));

    let caught: unknown;
    try {
      await commitRegistryDraft(ctxFor(s));
    } catch (err) {
      caught = err;
    }
    assertNamedThrow(caught, 'malformed evidence.json (bad status)');
    assert.match((caught as Error).message, /alpha/);
    assert.equal(readFileSync(s.registryPath, 'utf8'), beforeRaw);
  } finally {
    cleanup(s.base);
  }
});

test('malformed evidence.json (not valid JSON): throws a named error and leaves the live registry untouched', async () => {
  const s = mkScratch('cr-badjson-');
  try {
    writeLiveRegistry(s, [ALPHA_LIVE]);
    const beforeRaw = readFileSync(s.registryPath, 'utf8');
    writeDraft(s, [ALPHA_LIVE]);
    writeFileSync(join(s.stagingDir, 'evidence.json'), '{ not json at all');

    let caught: unknown;
    try {
      await commitRegistryDraft(ctxFor(s));
    } catch (err) {
      caught = err;
    }
    assertNamedThrow(caught, 'malformed evidence.json (not JSON)');
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
    writeEvidence(s, { alpha: { status: 'verified' } });

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
