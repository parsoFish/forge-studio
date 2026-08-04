/**
 * Acceptance tests for orchestrator/studio/community-install.ts (R3-07-F3,
 * `_wave5/specs/R3-07.md` D2/D9) — DOES NOT EXIST YET. This file is RED at
 * branch base: `Cannot find module './community-install.ts'` on import. Do
 * not stub the module into existence; red is the deliverable of this round.
 *
 * D2 — install ROUTES, it never re-implements. `routeCommunityInstall`
 * NEVER writes anything and NEVER calls a trust-mutating function
 * (approveSkillDraft/approveHook/overrideHookBlock/writeHookApprovalLedgerEntry)
 * — it only DECIDES which of the three existing pipelines owns an item and
 * what argument that pipeline needs. `installCommunityHookPackage` is the
 * ONE piece of new install-side behaviour this initiative authors (D2: hook
 * install has no bridge-callable "install a package from a directory" route
 * the way skills do — R3-01's `installSkillPackage` — so this materialises
 * the vendored bytes into `studio/hooks/<id>/` and STOPS, exactly at the
 * point the roadmap draws the line: "hookRunState reports needsReview: true,
 * runnable: false because no approval-ledger entry exists").
 *
 * Style: node:test + node:assert/strict, real temp forge roots via
 * mkdtempSync, mirroring community-index.test.ts / hook-scan.test.ts.
 *
 * ---------------------------------------------------------------------------
 * T2 ROUND 2 RULING (escalation #3): `routeCommunityInstall` for a
 * WELL-FORMED-SLUG id that resolves to NO item at all returns
 * `{pipeline:'none', reason}` — it does NOT throw. A throw is reserved for
 * MALFORMED input (traversal-shaped, non-slug, over-length — D9, unchanged
 * below): that is an attack or a programming error. A well-formed slug
 * matching no item is an ordinary not-found, the SAME bucket as "known item,
 * no vendored package" — both are legitimately "no route" outcomes. The two
 * `reason` strings must be TEXTUALLY DISTINGUISHABLE (pinned below) so a
 * caller (the bridge) can map "unknown item" → 404 and "known but not
 * vendored" → 400 without guessing — collapsing them into one indistinguishable
 * `none` would be the "declared-data-fails-open inside the enforcement
 * mechanism" shape this campaign keeps hitting.
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import yaml from 'js-yaml';

import { hookDir, hookYamlPath } from './hook-library.ts';
import { hookRunState, isHookRunnable, readHookApprovalLedger } from './hook-scan.ts';
import { vendoredPackageDir } from './community-index.ts';
import { routeCommunityInstall, installCommunityHookPackage } from './community-install.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const createdDirs: string[] = [];

function makeForgeRoot(prefix = 'community-install-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

after(() => {
  for (const dir of createdDirs) rmSync(dir, { recursive: true, force: true });
});

function writeCatalog(root: string, opts: { tools?: Array<Record<string, unknown>>; mcps?: Array<Record<string, unknown>> } = {}): void {
  const doc = {
    sdks: [{ id: 'claude', name: 'Claude', available: true }],
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sdk: 'claude', tier: 'sonnet' }],
    tools: (opts.tools ?? []).map((t) => ({
      id: t['id'], name: t['id'], install: { method: 'system-provided' },
      probe: { kind: 'command-presence', command: t['id'] }, provenance: 'https://example.com', config: [],
    })),
    mcps: (opts.mcps ?? []).map((m) => ({
      id: m['id'], name: m['id'], install: { method: 'npm', package: `@forge-test/${m['id']}`, version: '1.0.0' },
      probe: { kind: 'npm-package' }, provenance: 'https://example.com', config: [],
    })),
    guards: [],
    'community-skills': [],
  };
  mkdirSync(join(root, 'studio'), { recursive: true });
  writeFileSync(join(root, 'studio', 'catalog.yaml'), yaml.dump(doc), 'utf8');
}

function vendorSkillPackage(root: string, id: string): void {
  const dir = join(root, 'studio', 'community', 'skills', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), matter.stringify('\nBody.\n', { name: id, description: `${id} desc`, library: true }), 'utf8');
}

function vendorHookPackage(root: string, id: string, script = '#!/usr/bin/env bash\nexit 0\n'): void {
  const dir = join(root, 'studio', 'community', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({ id, name: id, description: `${id} desc`, on: 'PreToolUse', script: 'scripts/run.sh', permissions: { env: [], read: [], network: false } }),
    'utf8',
  );
  writeFileSync(join(dir, 'scripts', 'run.sh'), script, 'utf8');
}

// ===========================================================================
// routeCommunityInstall — D2 dispatch, D9 server-decided packageDir
// ===========================================================================

describe('routeCommunityInstall — skill', () => {
  it('a vendored skill → {pipeline:"skill", packageDir: byte-exact vendoredPackageDir, upstream.source non-empty}', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {});
    vendorSkillPackage(root, 'vendored-skill');
    const route = routeCommunityInstall(root, 'skill', 'vendored-skill');
    assert.equal(route.pipeline, 'skill');
    if (route.pipeline !== 'skill') return; // narrows for TS
    assert.equal(route.packageDir, vendoredPackageDir(root, 'skill', 'vendored-skill'), 'packageDir must be BYTE-EXACT the same path vendoredPackageDir resolves — not a look-alike');
    assert.ok(typeof route.upstream.source === 'string' && route.upstream.source.length > 0, 'upstream.source must be a real, non-empty attribution');
  });

  it('a catalog-only skill (no matching vendored package) → {pipeline:"none", reason} — D5: the install control is structurally absent', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {});
    // Note: no vendorSkillPackage call — id exists nowhere on disk under studio/community/skills/.
    const route = routeCommunityInstall(root, 'skill', 'catalog-only-with-no-bytes');
    assert.equal(route.pipeline, 'none');
    if (route.pipeline !== 'none') return;
    assert.ok(route.reason.length > 0, 'the 400 the bridge returns must NAME this reason — it cannot be blank');
    assert.match(route.reason, /vendor/i, `expected the reason to name the actual cause (no vendored package); got: "${route.reason}"`);
  });
});

describe('routeCommunityInstall — hook', () => {
  it('a vendored hook → {pipeline:"hook", packageDir: byte-exact vendoredPackageDir}', () => {
    const root = makeForgeRoot();
    vendorHookPackage(root, 'vendored-hook');
    const route = routeCommunityInstall(root, 'hook', 'vendored-hook');
    assert.equal(route.pipeline, 'hook');
    if (route.pipeline !== 'hook') return;
    assert.equal(route.packageDir, vendoredPackageDir(root, 'hook', 'vendored-hook'));
  });
});

describe('routeCommunityInstall — connection (mcp/tool)', () => {
  it('a real catalog tool → {pipeline:"connection", connectionId: the same id, byte-exact}', () => {
    const root = makeForgeRoot();
    writeCatalog(root, { tools: [{ id: 'a-real-tool' }] });
    const route = routeCommunityInstall(root, 'tool', 'a-real-tool');
    assert.equal(route.pipeline, 'connection');
    if (route.pipeline !== 'connection') return;
    assert.equal(route.connectionId, 'a-real-tool');
  });

  it('a real catalog mcp → {pipeline:"connection", connectionId}', () => {
    const root = makeForgeRoot();
    writeCatalog(root, { mcps: [{ id: 'a-real-mcp' }] });
    const route = routeCommunityInstall(root, 'mcp', 'a-real-mcp');
    assert.equal(route.pipeline, 'connection');
    if (route.pipeline !== 'connection') return;
    assert.equal(route.connectionId, 'a-real-mcp');
  });
});

describe('routeCommunityInstall — D9: id validation', () => {
  const TRAVERSAL_IDS = ['../../etc/passwd', '..', '.', 'a/b', 'a\\b', ''];

  for (const badId of TRAVERSAL_IDS) {
    it(`a traversal-shaped or non-slug id ("${badId}") THROWS rather than resolving to any route`, () => {
      const root = makeForgeRoot();
      writeCatalog(root, {});
      assert.throws(() => routeCommunityInstall(root, 'skill', badId), /invalid|slug/i);
    });
  }

  it('an over-length id THROWS (mirrors assertSkillSlug\'s MAX_SKILL_ID_LENGTH guard)', () => {
    const root = makeForgeRoot();
    assert.throws(() => routeCommunityInstall(root, 'hook', 'x'.repeat(200)));
  });
});

// ===========================================================================
// routeCommunityInstall — T2 ruling #3: a well-formed slug matching NO item
// returns {pipeline:'none', reason}, distinguishable from "known but not
// vendored". Never throws — only a malformed id throws (D9, above).
// ===========================================================================

describe('routeCommunityInstall — unknown item (T2 ruling #3)', () => {
  it('a well-formed slug matching NO item anywhere → {pipeline:"none", reason} — never a throw', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {});
    const route = routeCommunityInstall(root, 'skill', 'totally-unknown-item-nowhere');
    assert.equal(route.pipeline, 'none');
    if (route.pipeline !== 'none') return;
    assert.ok(route.reason.length > 0);
  });

  it('the "unknown item" reason is TEXTUALLY DISTINGUISHABLE from the "known, no vendored package" reason', () => {
    const root = makeForgeRoot();
    writeCatalog(root, { communitySkills: [{ id: 'known-but-not-vendored' }] });

    const unknownRoute = routeCommunityInstall(root, 'skill', 'genuinely-unknown-item');
    const knownNoVendorRoute = routeCommunityInstall(root, 'skill', 'known-but-not-vendored');

    assert.equal(unknownRoute.pipeline, 'none');
    assert.equal(knownNoVendorRoute.pipeline, 'none');
    if (unknownRoute.pipeline !== 'none' || knownNoVendorRoute.pipeline !== 'none') return;

    assert.notEqual(unknownRoute.reason, knownNoVendorRoute.reason, 'the two reasons must not collapse into the same indistinguishable string — a caller (the bridge) must be able to tell "unknown" from "no vendored package" apart WITHOUT guessing');
    assert.match(unknownRoute.reason, /unknown|no such|not found|does not exist/i, `expected the unknown-item reason to name itself as such; got: "${unknownRoute.reason}"`);
    assert.doesNotMatch(unknownRoute.reason, /vendor/i, 'the unknown-item reason must not read as "no vendored package" — that would collapse the two cases');
    assert.match(knownNoVendorRoute.reason, /vendor/i, `expected the known-but-not-vendored reason to name the real cause; got: "${knownNoVendorRoute.reason}"`);
    assert.doesNotMatch(knownNoVendorRoute.reason, /unknown|no such|not found|does not exist/i, 'the known-but-not-vendored reason must not read as "unknown" — the item genuinely exists in the catalog');
  });

  it('an unknown hook id and an unknown connection id ALSO return {pipeline:"none"}, never a throw', () => {
    const root = makeForgeRoot();
    writeCatalog(root, {});
    const hookRoute = routeCommunityInstall(root, 'hook', 'no-such-hook-anywhere');
    const mcpRoute = routeCommunityInstall(root, 'mcp', 'no-such-mcp-anywhere');
    assert.equal(hookRoute.pipeline, 'none');
    assert.equal(mcpRoute.pipeline, 'none');
  });
});

// ===========================================================================
// installCommunityHookPackage — D2: materialise-then-stop, no trust mutation
// ===========================================================================

describe('installCommunityHookPackage', () => {
  it('materialises the vendored bytes to studio/hooks/<id>/ byte-identically', () => {
    const root = makeForgeRoot();
    vendorHookPackage(root, 'materialise-me', '#!/usr/bin/env bash\necho "distinctive marker line"\nexit 0\n');

    const result = installCommunityHookPackage({ forgeRoot: root, id: 'materialise-me' });
    assert.equal(result.alreadyInstalled, false);

    assert.ok(existsSync(hookYamlPath('materialise-me', root)), 'hook.yaml must now exist at the REAL (non-vendored) hook path');
    const installedScript = readFileSync(join(hookDir('materialise-me', root), 'scripts', 'run.sh'), 'utf8');
    const vendoredScript = readFileSync(join(root, 'studio', 'community', 'hooks', 'materialise-me', 'scripts', 'run.sh'), 'utf8');
    assert.equal(installedScript, vendoredScript, 'the installed script bytes must be byte-identical to the vendored source');
    assert.ok(installedScript.includes('distinctive marker line'));
  });

  it('is idempotent: a second call reports alreadyInstalled:true and does not overwrite', () => {
    const root = makeForgeRoot();
    vendorHookPackage(root, 'idempotent-hook');
    const first = installCommunityHookPackage({ forgeRoot: root, id: 'idempotent-hook' });
    assert.equal(first.alreadyInstalled, false);
    const second = installCommunityHookPackage({ forgeRoot: root, id: 'idempotent-hook' });
    assert.equal(second.alreadyInstalled, true);
  });

  it('NEVER writes an approval-ledger entry and NEVER makes the hook runnable — D2\'s "materialise, then STOP"', () => {
    const root = makeForgeRoot();
    vendorHookPackage(root, 'stop-here-hook');
    installCommunityHookPackage({ forgeRoot: root, id: 'stop-here-hook' });

    assert.equal(isHookRunnable(root, 'stop-here-hook'), false, 'a freshly community-installed hook must never be runnable — that is a SEPARATE, explicit approval act');
    const runState = hookRunState(root, 'stop-here-hook');
    assert.equal(runState.needsReview, true);
    const ledger = readHookApprovalLedger(root);
    assert.equal(ledger.has('stop-here-hook'), false, 'no approval-ledger entry may exist — installCommunityHookPackage must never call approveHook/writeHookApprovalLedgerEntry');
  });

  it('an id with no vendored package on disk throws — there is nothing to materialise', () => {
    const root = makeForgeRoot();
    assert.throws(() => installCommunityHookPackage({ forgeRoot: root, id: 'never-vendored-anywhere' }));
  });
});
