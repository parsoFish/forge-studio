/**
 * Acceptance tests for the NON-SUPPRESSED branch of
 * `POST /api/studio/community/:kind/:id/install` when it routes to the
 * connections pipeline (R3-07-F3, `_wave5/specs/R3-07.md`) — R3-04's own
 * filed follow-up ("the real (non-suppressed) install HTTP branch has thin
 * test coverage") applied to this route, T2 round 5 AT GROUP 1.
 *
 * SEPARATE FILE, DELIBERATELY (T2's own instruction): the main
 * `cli/bridge-studio-community.test.ts` sets `FORGE_ARCHITECT_NO_SPAWN=1`
 * globally in its `before()` to keep every OTHER test in that file
 * hermetic — every test there that reaches `routedTo:'connection-install'`
 * therefore only ever exercises the SUPPRESSED branch
 * (`cli/bridge-studio-community.ts` lines ~367-375), where a hardcoded
 * `ok: true` is genuinely always correct. This file exists specifically to
 * drive the REAL (non-suppressed) executor branch (lines ~377-388), where
 * the bug lives: `ok: true` is hardcoded regardless of the real npm child's
 * exit code, unlike its sibling `cli/bridge-studio-connections.ts:200`
 * (`ok: result.ok`). Rather than fight the other file's global suppression
 * env, this file's `before()` deliberately does NOT set
 * `FORGE_ARCHITECT_NO_SPAWN` at all, and each test explicitly manages
 * `FORGE_ARCHITECT_NO_SPAWN`/`FORGE_DRY_BRIDGE` itself (save/delete/restore
 * in a `finally`) — the same per-test env discipline
 * `cli/bridge-studio-connections.test.ts`'s own "REAL, non-suppressed"
 * env-leak test already uses for exactly this reason.
 *
 * NO NETWORK INSTALL, ever (R3-04 D7 is binding — no test may depend on the
 * npm registry): the route spawns `npm` by argv, so every test here SHADOWS
 * `npm` on `PATH` with a temp script the test fully controls — the same
 * technique `cli/bridge-studio-connections.test.ts`'s reviewer-authored
 * env-leak repro already uses (a fake `npm` on a scratch dir prepended to
 * PATH, so it resolves before the real one). The fake `npm` performs no
 * real install; it only records that it ran and exits with the code the
 * test wants, so the two directions below are driven by a REAL spawned
 * child's REAL exit code, never simulated in-process.
 *
 * forge-6gv.8.2 — the confirm gate (bridge-studio-connections.ts's own D-4)
 * applies to THIS route too: every `postJson(..., {})` below now carries
 * `confirm: true` so it still reaches the real (non-suppressed) branch this
 * file exists to drive; the no-confirm/preview direction is pinned once more
 * here, against the real shadowed npm, for this route's own dispatch path.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { startBridge } from '../../apps/forge/ui-bridge.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-community-conn-install-real-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });

  // Deliberately NOT setting FORGE_ARCHITECT_NO_SPAWN here — see file header.
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

function writeMcpCatalog(id: string): void {
  const doc = {
    sdks: [{ id: 'claude', name: 'Claude', available: true }],
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sdk: 'claude', tier: 'sonnet' }],
    tools: [],
    mcps: [
      {
        id,
        name: id,
        install: { method: 'npm', package: `@forge-test/${id}`, version: '1.0.0' },
        probe: { kind: 'npm-package' },
        provenance: 'https://example.com',
        config: [],
      },
    ],
    guards: [],
    'community-skills': [],
  };
  writeFileSync(join(forgeRoot, 'studio', 'catalog.yaml'), yaml.dump(doc), 'utf8');
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' }, body: JSON.stringify(body) });
}

/** Plants a real, executable fake `npm` on a scratch dir and prepends it to
 *  PATH — mirrors cli/bridge-studio-connections.test.ts's own env-leak repro
 *  technique. Performs NO real install; it only exits with the given code. */
function shadowFakeNpm(exitCode: number): { scratchRoot: string; restore: () => void } {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'fake-npm-community-'));
  const fakeNpmPath = join(scratchRoot, 'npm');
  writeFileSync(fakeNpmPath, `#!/usr/bin/env bash\nexit ${exitCode}\n`, 'utf8');
  chmodSync(fakeNpmPath, 0o755);

  const priorPath = process.env.PATH;
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;

  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  process.env.PATH = `${scratchRoot}${process.env.PATH ? delimiter + process.env.PATH : ''}`;

  return {
    scratchRoot,
    restore: () => {
      if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
      if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN; else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
      if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE; else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
      rmSync(scratchRoot, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// The bug, both directions
// ---------------------------------------------------------------------------

test('REAL non-suppressed install, shadowed npm exits NON-ZERO: top-level "ok" must be false, matching bridge-studio-connections.ts\'s honest response for the same failure', async () => {
  writeMcpCatalog('doomed-mcp');
  const shadow = shadowFakeNpm(1); // real, controlled failure — no network
  try {
    const res = await postJson(`${bridgeUrl}/api/studio/community/mcp/doomed-mcp/install`, { confirm: true });
    assert.equal(res.status, 200, 'the route itself must not 500 on a failed npm exit — same as bridge-studio-connections.ts');
    const body = (await res.json()) as { ok: unknown; installed: unknown; routedTo: unknown; suppressed?: unknown };

    assert.notEqual(body.suppressed, true, 'sanity: this test\'s whole premise is that the install is REAL, not suppressed — if this is true, PATH-shadowing or env-deletion above did not take effect');
    assert.equal(body.installed, false, 'sanity: the real npm child really did fail');
    assert.equal(
      body.ok,
      false,
      `top-level "ok" must reflect the REAL outcome, not a hardcoded true — this is the reviewer-reproduced defect (cli/bridge-studio-community.ts:388 hardcodes ok:true regardless of result.ok, unlike its sibling bridge-studio-connections.ts:200's "ok: result.ok"). Got: ${JSON.stringify(body)}`,
    );
  } finally {
    shadow.restore();
  }
});

test('REAL non-suppressed install, shadowed npm exits ZERO: top-level "ok" must be true (the direction that must NOT regress when the bug above is fixed)', async () => {
  writeMcpCatalog('lucky-mcp');
  const shadow = shadowFakeNpm(0); // real, controlled success — no network
  try {
    const res = await postJson(`${bridgeUrl}/api/studio/community/mcp/lucky-mcp/install`, { confirm: true });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: unknown; installed: unknown; suppressed?: unknown };

    assert.notEqual(body.suppressed, true, 'sanity: this test\'s whole premise is that the install is REAL, not suppressed');
    assert.equal(body.installed, true, 'sanity: the real (fake) npm child really did succeed (exit 0)');
    assert.equal(body.ok, true, 'a genuinely successful real install must still report ok:true — a naive fix (e.g. always false, or a stale cached value) must not flip this direction');
  } finally {
    shadow.restore();
  }
});

test('REAL non-suppressed install: the response shape mirrors bridge-studio-connections.ts\'s honest failure shape (ok/installed/argv/probe all present)', async () => {
  writeMcpCatalog('shape-check-mcp');
  const shadow = shadowFakeNpm(1);
  try {
    const res = await postJson(`${bridgeUrl}/api/studio/community/mcp/shape-check-mcp/install`, { confirm: true });
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok(existsSync(shadow.scratchRoot), 'sanity: the shadow dir must still exist at inspection time (guards against a shadow.restore() ordering bug in this test itself)');
    for (const key of ['ok', 'installed', 'argv', 'probe']) {
      assert.ok(key in body, `expected the real-install response to carry "${key}", matching bridge-studio-connections.ts's own shape; got keys: ${JSON.stringify(Object.keys(body))}`);
    }
    assert.equal(body['routedTo'], 'connection-install');
  } finally {
    shadow.restore();
  }
});

test('forge-6gv.8.2: POST .../community/mcp/<id>/install with NO confirm makes ZERO executor calls even on THIS route (real shadowed npm, no suppression env) — confirm:true is the only path that installs', async () => {
  // A marker-writing fake npm (shadowFakeNpm's own fake only records an exit
  // code, not that it ran at all) — mirrors bridge-studio-connections.test.ts's
  // own confirm-gate repro.
  const scratchRoot = mkdtempSync(join(tmpdir(), 'community-confirm-gate-'));
  const markerPath = join(scratchRoot, 'ran.marker');
  const fakeNpmPath = join(scratchRoot, 'npm');
  writeFileSync(fakeNpmPath, `#!/usr/bin/env bash\necho ran > "${markerPath}"\nexit 0\n`, 'utf8');
  chmodSync(fakeNpmPath, 0o755);

  const priorPath = process.env.PATH;
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  try {
    delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    delete process.env.FORGE_DRY_BRIDGE;
    process.env.PATH = `${scratchRoot}${process.env.PATH ? delimiter + process.env.PATH : ''}`;
    writeMcpCatalog('community-confirm-gate-mcp');

    const unconfirmed = await postJson(`${bridgeUrl}/api/studio/community/mcp/community-confirm-gate-mcp/install`, {});
    assert.equal(unconfirmed.status, 200);
    const unconfirmedBody = (await unconfirmed.json()) as Record<string, unknown>;
    assert.equal(unconfirmedBody['routedTo'], 'connection-install');
    assert.ok('preview' in unconfirmedBody, `expected a preview response for the unconfirmed request; got: ${JSON.stringify(unconfirmedBody)}`);
    assert.equal(existsSync(markerPath), false, 'the real npm child must never have run for an unconfirmed request');

    const confirmed = await postJson(`${bridgeUrl}/api/studio/community/mcp/community-confirm-gate-mcp/install`, { confirm: true });
    const confirmedBody = (await confirmed.json()) as { suppressed?: unknown; installed?: unknown };
    assert.notEqual(confirmedBody.suppressed, true, 'sanity: with the shadow env in place, confirm:true must reach the REAL executor');
    assert.equal(confirmedBody.installed, true, 'confirm:true is the ONLY path that installs — the real (fake) npm child must have run exactly now');
    assert.equal(existsSync(markerPath), true, 'the real npm child must have run exactly once confirm:true was sent');
  } finally {
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN; else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE; else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});
