/**
 * Acceptance tests for cli/bridge-studio-connections.ts (R3-04-F2/F3, D6/D7
 * of `_wave5/specs/R3-04.md`) — DOES NOT EXIST YET. This file is RED at
 * branch base (`Cannot find module './bridge-studio-connections.ts'`) — the
 * expected, deliberate red. Do not stub the module into existence.
 *
 * Owns EVERY `/api/studio/connections*` route, mirroring
 * cli/bridge-studio-hooks.ts's one-module-per-category precedent:
 *
 *   GET  /api/studio/connections           → { connections: ConnectionWire[] }
 *   GET  /api/studio/connections/:id       → one ConnectionWire (full detail)
 *   POST /api/studio/connections/:id/probe   → re-runs the real probe, returns it
 *   POST /api/studio/connections/:id/install → the D6 security core
 *
 *   NO create/update/delete route exists ANYWHERE for this category (D1's
 *   structural negative AC) — proven against the REAL bridge dispatcher, not
 *   this module's handler in isolation, so a future route addition anywhere
 *   in ui-bridge.ts that accidentally opens a mutating path is caught too.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT DECISIONS MADE HERE THAT WERE NOT SPECIFIED (ratify or redirect —
 * full list in the T3 final report):
 *
 *  D-1. Response envelope: `{ connections: [...] }` (list) / a flat
 *       `ConnectionWire` object (detail) — mirrors bridge-studio-hooks.ts's
 *       `{ hooks: [...] }` / flat-detail-object style. List and detail carry
 *       the SAME shape (unlike hooks' list-vs-detail split) — a connection
 *       has no script/package body to reveal only at detail depth; every
 *       field (install/config/probe/provenance/capabilities/usedBy/live
 *       probe state) is safe to return at list time (D5: config carries
 *       NAMES only, never a value).
 *  D-2. `GET /api/studio/connections` runs a REAL probe per entry on every
 *       request (D3: "readiness is EXECUTED per entry, never declared") —
 *       no caching layer in this initiative's scope. Each entry's `probe`
 *       field in the wire payload IS that request's live `ProbeResult`.
 *  D-3. `POST /api/studio/connections/:id/probe` re-runs the same real probe
 *       on demand and returns `{ ok: true, probe: ProbeResult }` — an
 *       explicit user-triggered re-check (e.g. "I just set the env var,
 *       check again").
 *  D-4. `POST /api/studio/connections/:id/install` (D6, the security core):
 *       - a `system-provided` entry → 400 (no install action, F2's literal
 *         "git shows system-provided/available with no install action" AC).
 *       - an unknown id → 404.
 *       - a request body carrying `package`/`version`/`registry` is IGNORED
 *         — the installed argv is derived from the catalog pin ONLY, proven
 *         by comparing the response's `wouldInstall`/executed argv across an
 *         empty body vs. a body carrying those three fields: byte-identical.
 *       - forge-6gv.8.2: NO confirm (absent body, or a body without
 *         `confirm: true`) → 200 `{ok: true, preview}` and ZERO network/
 *         executor calls — `installConnection` is never reached. ONLY a body
 *         carrying `confirm: true` reaches the rest of D-4 below.
 *       - REUSES the ALREADY-SHIPPED dry-bridge / no-spawn suppression
 *         convention (`FORGE_ARCHITECT_NO_SPAWN=1`, set in `before()` below,
 *         exactly as bridge-studio-hooks.test.ts already does to keep bridge
 *         tests hermetic) — when suppressed, the route computes+returns the
 *         install argv WITHOUT executing it: `{ ok: true, suppressed: true,
 *         wouldInstall: { command, args } }`. This is the ONLY way to pin
 *         "byte-exact argv, no execution" (D7) at the HTTP layer without a
 *         bespoke injection seam on a production route — reusing an
 *         established, precedented mechanism rather than inventing a new
 *         one. RATIFIED by T2 (round 2, item 3) with three pinned
 *         constraints, each with its own AT below:
 *           (a) the suppressed response is EXACTLY `{ok, suppressed,
 *               wouldInstall}` — no other key, so nothing could be
 *               misread as a completed install.
 *           (b) BOTH `FORGE_DRY_BRIDGE=1` and `FORGE_ARCHITECT_NO_SPAWN=1`
 *               independently suppress (mirrors `orchestrator/run-agent.ts`
 *               checking both).
 *           (c) a suppressed install changes NOTHING about real state — a
 *               subsequent real probe of the same connection still reports
 *               `not-installed` (proven by an actual round-trip HTTP call,
 *               not an assumption).
 *  D-5. Traversal/malformed ids on any `:id` route → 400, mirroring
 *       bridge-studio-hooks.ts's `assertSkillSlug` guard precedent.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { join, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { startBridge } from '../../cli/ui-bridge.ts';
import { dispatchRoute } from '@forge/kernel'; import { libraryRoutes } from './routes.ts';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-connections-'));
  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio'), { recursive: true });

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1'; // hermetic — no real spawn, mirrors bridge-studio-hooks.test.ts
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

type RawEntry = {
  id: string;
  name?: string;
  install?: Record<string, unknown>;
  config?: Array<Record<string, unknown>>;
  probe?: Record<string, unknown>;
  provenance?: string;
  capabilities?: Array<{ name: string; summary: string }>;
};

// D13/D15 (round 3): install is a THREE-method union (system-provided | npm
// | external); probe is KIND-tagged (command | command-presence |
// npm-package), coherent with install method.
function toolDoc(f: RawEntry): Record<string, unknown> {
  return {
    id: f.id,
    name: f.name ?? f.id,
    install: f.install ?? { method: 'system-provided' },
    config: f.config ?? [],
    probe: f.probe ?? { kind: 'command', command: f.id, args: ['--version'] },
    provenance: f.provenance ?? 'system',
  };
}

function mcpDoc(f: RawEntry): Record<string, unknown> {
  return {
    ...toolDoc(f),
    install: f.install ?? { method: 'npm', package: `@forge-test/${f.id}`, version: '1.0.0' },
    probe: f.probe ?? { kind: 'npm-package' },
    capabilities: f.capabilities ?? [{ name: 'query', summary: 'Do the thing.' }],
  };
}

/** D13: an external mcp fixture doc — the real "no npm distribution" shape. */
function externalMcpDoc(f: RawEntry): Record<string, unknown> {
  return {
    ...toolDoc(f),
    install: f.install ?? { method: 'external', upstream: `https://example.com/${f.id}` },
    probe: f.probe ?? { kind: 'command-presence', command: `mcp-${f.id}` },
    capabilities: f.capabilities ?? [{ name: 'query', summary: 'Do the thing.' }],
  };
}

/** Overwrite studio/catalog.yaml with the given connections-extended
 *  tools:/mcps: — each test writes its own so entries don't leak across
 *  tests sharing one bridge instance. */
function writeCatalog(opts: { tools?: RawEntry[]; mcps?: RawEntry[]; externalMcps?: RawEntry[] } = {}): void {
  const doc = {
    sdks: [{ id: 'claude', name: 'Claude', available: true }],
    models: [{ id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', sdk: 'claude', tier: 'sonnet' }],
    tools: (opts.tools ?? []).map(toolDoc),
    mcps: [...(opts.mcps ?? []).map(mcpDoc), ...(opts.externalMcps ?? []).map(externalMcpDoc)],
    guards: [],
  };
  writeFileSync(join(forgeRoot, 'studio', 'catalog.yaml'), yaml.dump(doc), 'utf8');
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// GET /api/studio/connections — list, real probe state, curated capabilities
// ---------------------------------------------------------------------------

test('GET /api/studio/connections: a system-provided, present command lists kind/installable/live probe state', async () => {
  writeCatalog({ tools: [{ id: 'node', probe: { kind: 'command', command: 'node', args: ['--version'] } }] });
  const res = await fetch(`${bridgeUrl}/api/studio/connections`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { connections: Array<Record<string, unknown>> };
  const entry = body.connections.find((c) => c['id'] === 'node');
  assert.ok(entry, 'expected the fixture connection in the list');
  assert.equal(entry!['kind'], 'tool');
  assert.equal(entry!['installable'], false);
  const probe = entry!['probe'] as { state: string };
  assert.equal(probe.state, 'available', `expected a REAL live probe, got: ${JSON.stringify(probe)}`);
});

test('GET /api/studio/connections: a real absent-command entry lists probe.state "not-installed"', async () => {
  writeCatalog({ mcps: [{ id: 'absent-mcp', probe: { kind: 'command', command: 'definitely-absent-binary-xyz-forge-bridge-test', args: [] } }] });
  const res = await fetch(`${bridgeUrl}/api/studio/connections`);
  const body = (await res.json()) as { connections: Array<Record<string, unknown>> };
  const entry = body.connections.find((c) => c['id'] === 'absent-mcp');
  assert.ok(entry);
  assert.equal((entry!['probe'] as { state: string }).state, 'not-installed');
});

test('GET /api/studio/connections: an mcp entry carries capabilities labelled curated; a tool entry carries none', async () => {
  writeCatalog({
    tools: [{ id: 'git' }],
    mcps: [{ id: 'memory', capabilities: [{ name: 'create_entities', summary: 'Create graph entities.' }] }],
  });
  const res = await fetch(`${bridgeUrl}/api/studio/connections`);
  const body = (await res.json()) as { connections: Array<Record<string, unknown>> };
  const mcp = body.connections.find((c) => c['id'] === 'memory');
  const tool = body.connections.find((c) => c['id'] === 'git');
  assert.deepEqual(mcp!['capabilities'], [{ name: 'create_entities', summary: 'Create graph entities.' }]);
  assert.equal(mcp!['capabilitiesSource'], 'curated');
  assert.equal('capabilities' in tool!, false, 'a tool entry must not carry a fabricated capabilities key');
});

test('GET /api/studio/connections: an EXTERNAL mcp entry (D13 — no npm distribution) lists installable:false and its upstream', async () => {
  writeCatalog({ externalMcps: [{ id: 'sqlite' }] });
  const res = await fetch(`${bridgeUrl}/api/studio/connections`);
  const body = (await res.json()) as { connections: Array<Record<string, unknown>> };
  const entry = body.connections.find((c) => c['id'] === 'sqlite');
  assert.ok(entry, 'expected the external fixture connection in the list');
  assert.equal(entry!['installable'], false, 'external is not forge-installable, same as system-provided (D13)');
  const install = entry!['install'] as { method: string; upstream: string };
  assert.equal(install.method, 'external');
  assert.ok(install.upstream.startsWith('http'));
});

test('GET /api/studio/connections: config carries the env-var NAME only — a set sentinel value never appears in the payload', async () => {
  const SENTINEL = 'FORGE_BRIDGE_TEST_SENTINEL_4d2a';
  process.env['FORGE_BRIDGE_CONN_SECRET'] = SENTINEL;
  try {
    writeCatalog({ mcps: [{ id: 'secretful-mcp', config: [{ env: 'FORGE_BRIDGE_CONN_SECRET', required: true, purpose: 'auth' }] }] });
    const res = await fetch(`${bridgeUrl}/api/studio/connections`);
    const raw = await res.text();
    assert.ok(!raw.includes(SENTINEL), 'the live env-var VALUE must never be present on the wire');
    assert.ok(raw.includes('FORGE_BRIDGE_CONN_SECRET'), 'the NAME is expected to appear');
  } finally {
    delete process.env['FORGE_BRIDGE_CONN_SECRET'];
  }
});

// ---------------------------------------------------------------------------
// GET /api/studio/connections/:id — detail
// ---------------------------------------------------------------------------

test('GET /api/studio/connections/<id>: detail carries install/probe/provenance/usedBy', async () => {
  writeCatalog({ tools: [{ id: 'gh', provenance: 'system' }] });
  const res = await fetch(`${bridgeUrl}/api/studio/connections/gh`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body['id'], 'gh');
  assert.equal(body['provenance'], 'system');
  assert.ok(body['install']);
  assert.ok(Array.isArray(body['usedBy']));
  assert.ok(body['usedByDerivation']);
});

test('GET /api/studio/connections/<unknown>: 404, never a fabricated entry', async () => {
  const res = await fetch(`${bridgeUrl}/api/studio/connections/no-such-connection-anywhere`);
  assert.equal(res.status, 404);
  const body = (await res.json()) as { error: string };
  assert.ok(typeof body.error === 'string' && body.error.length > 0);
});

test('GET /api/studio/connections/<traversal>: 400, never 500, no read outside studio/', async () => {
  const probes = ['..%2F..%2Fetc%2Fpasswd', '%252e%252e%252fetc%252fpasswd', 'evil%00conn', 'a'.repeat(150)];
  for (const probe of probes) {
    const res = await fetch(`${bridgeUrl}/api/studio/connections/${probe}`);
    assert.equal(res.status, 400, `probe "${probe}" must be rejected with 400`);
  }
});

// ---------------------------------------------------------------------------
// POST /api/studio/connections/:id/probe — explicit re-check
// ---------------------------------------------------------------------------

test('POST /api/studio/connections/<id>/probe: re-runs the real probe and returns the live state', async () => {
  writeCatalog({ tools: [{ id: 'node-probe-route', probe: { kind: 'command', command: 'node', args: ['--version'] } }] });
  const res = await postJson(`${bridgeUrl}/api/studio/connections/node-probe-route/probe`, {});
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; probe: { state: string } };
  assert.equal(body.ok, true);
  assert.equal(body.probe.state, 'available');
});

test('POST /api/studio/connections/<unknown>/probe: 404', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/connections/no-such-id/probe`, {});
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// POST /api/studio/connections/:id/install — the D6 security core
// ---------------------------------------------------------------------------

test('POST /api/studio/connections/<system-provided>/install: 400 — no install action exists for a system-provided entry', async () => {
  writeCatalog({ tools: [{ id: 'git-no-install' }] });
  const res = await postJson(`${bridgeUrl}/api/studio/connections/git-no-install/install`, {});
  assert.equal(res.status, 400);
});

test('POST /api/studio/connections/<external>/install: 400 — D13: external has NO install action either, parallel to system-provided', async () => {
  writeCatalog({ externalMcps: [{ id: 'sqlite-no-install' }] });
  const res = await postJson(`${bridgeUrl}/api/studio/connections/sqlite-no-install/install`, {});
  assert.equal(res.status, 400);
});

test('POST /api/studio/connections/<unknown>/install: 404', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/connections/no-such-id/install`, {});
  assert.equal(res.status, 404);
});

test('POST /api/studio/connections/<installable>/install, CONFIRMED: the argv is derived from the catalog pin ONLY — a body carrying package/version/registry changes NOTHING (D6 security core)', async () => {
  writeCatalog({
    mcps: [{ id: 'installable-mcp', install: { method: 'npm', package: '@forge-test/installable-mcp', version: '2.3.4' } }],
  });

  const withEmptyBody = await postJson(`${bridgeUrl}/api/studio/connections/installable-mcp/install`, { confirm: true });
  assert.equal(withEmptyBody.status, 200);
  const emptyBodyResult = (await withEmptyBody.json()) as {
    ok: boolean;
    suppressed: boolean;
    wouldInstall: { command: string; args: string[] };
  };
  assert.equal(emptyBodyResult.suppressed, true, 'FORGE_ARCHITECT_NO_SPAWN=1 must suppress real execution — byte-exact argv, no execution (D7)');
  assert.equal(emptyBodyResult.wouldInstall.command, 'npm');
  const args = emptyBodyResult.wouldInstall.args;
  assert.equal(args.length, 8, `expected exactly 8 argv entries, got: ${JSON.stringify(args)}`);
  assert.equal(args[0], 'install');
  assert.equal(args[1], '--prefix');
  assert.ok(typeof args[2] === 'string' && args[2].length > 0, 'argv[2] must be a real, non-empty connectionsRoot path');
  assert.equal(args[3], '--ignore-scripts');
  assert.equal(args[4], '--no-audit');
  assert.equal(args[5], '--no-fund');
  assert.equal(args[6], '--save-exact');
  assert.equal(args[7], '@forge-test/installable-mcp@2.3.4');

  const withHostileBody = await postJson(`${bridgeUrl}/api/studio/connections/installable-mcp/install`, {
    confirm: true,
    package: 'evil-package',
    version: '99.99.99',
    registry: 'https://evil.example.com',
  });
  assert.equal(withHostileBody.status, 200);
  const hostileResult = (await withHostileBody.json()) as { wouldInstall: { command: string; args: string[] } };

  assert.deepEqual(
    hostileResult.wouldInstall,
    emptyBodyResult.wouldInstall,
    'a request body naming package/version/registry must produce the IDENTICAL install argv as an empty body — those fields are structurally ignored, never merely validated-then-ignored by convention',
  );
  assert.ok(!hostileResult.wouldInstall.args.some((a) => a.includes('evil')), 'the hostile body must never leak into the argv');
});

// ---------------------------------------------------------------------------
// forge-6gv.8.2 — the confirm gate. NO confirm → preview only, zero network/
// executor calls; ONLY confirm:true reaches the pre-existing suppressed/real
// behaviour pinned above and below.
// ---------------------------------------------------------------------------

test('POST /api/studio/connections/<installable>/install, NO confirm: 200 {ok, preview} — package/version/registry/command/args/willRunLifecycleScripts, ignoring a hostile body exactly like the confirmed path', async () => {
  writeCatalog({
    mcps: [{ id: 'preview-mcp', install: { method: 'npm', package: '@forge-test/preview-mcp', version: '5.6.7' } }],
  });

  const noBody = await fetch(`${bridgeUrl}/api/studio/connections/preview-mcp/install`, {
    method: 'POST',
    headers: { 'x-forge-csrf': '1' }, // deliberately NO body at all — "absent body" half of the contract
  });
  assert.equal(noBody.status, 200);
  const previewFromNoBody = (await noBody.json()) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(previewFromNoBody).sort(),
    ['ok', 'preview'],
    `an unconfirmed install response must carry EXACTLY {ok, preview} — no "suppressed"/"installed" key that could read as a completed or dry-run install; got: ${JSON.stringify(Object.keys(previewFromNoBody))}`,
  );
  assert.equal(previewFromNoBody['ok'], true);
  const preview = previewFromNoBody['preview'] as Record<string, unknown>;
  assert.equal(preview['package'], '@forge-test/preview-mcp');
  assert.equal(preview['version'], '5.6.7');
  assert.ok(typeof preview['registry'] === 'string' && (preview['registry'] as string).length > 0, 'registry must be a real, non-empty string');
  assert.equal(preview['command'], 'npm');
  assert.equal(preview['willRunLifecycleScripts'], false, '--ignore-scripts is always in the argv (D7) — the preview must say so honestly');
  assert.ok(Array.isArray(preview['args']) && (preview['args'] as string[]).includes('--ignore-scripts'));

  const hostileBody = await postJson(`${bridgeUrl}/api/studio/connections/preview-mcp/install`, {
    package: 'evil-package',
    version: '99.99.99',
    registry: 'https://evil.example.com',
  });
  const previewFromHostileBody = (await hostileBody.json()) as { preview: Record<string, unknown> };
  assert.deepEqual(previewFromHostileBody.preview, preview, 'a body naming package/version/registry (without confirm:true) must produce the IDENTICAL preview — those fields never reach the preview either');
});

test('POST /api/studio/connections/<installable>/install: NO confirm makes ZERO network/executor calls; confirm:true is the ONLY path that actually installs (proven against a REAL shadowed npm child, not FORGE_ARCHITECT_NO_SPAWN)', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'bridge-install-confirm-gate-'));
  const markerPath = join(scratchRoot, 'ran.marker');
  const fakeNpmPath = join(scratchRoot, 'npm');
  writeFileSync(fakeNpmPath, `#!/usr/bin/env bash\necho ran > "${markerPath}"\nexit 0\n`, 'utf8');
  chmodSync(fakeNpmPath, 0o755);

  const priorPath = process.env.PATH;
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  try {
    // Turn OFF every suppression seam — if the confirm gate did not exist (or
    // did not gate the executor), THIS is what would let a no-confirm request
    // reach the real spawnSync call below.
    delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    delete process.env.FORGE_DRY_BRIDGE;
    process.env.PATH = `${scratchRoot}${process.env.PATH ? delimiter + process.env.PATH : ''}`;

    writeCatalog({
      mcps: [{ id: 'confirm-gate-mcp', install: { method: 'npm', package: '@forge-test/confirm-gate-mcp', version: '1.0.0' } }],
    });

    const unconfirmed = await postJson(`${bridgeUrl}/api/studio/connections/confirm-gate-mcp/install`, {});
    assert.equal(unconfirmed.status, 200);
    const unconfirmedBody = (await unconfirmed.json()) as Record<string, unknown>;
    assert.ok('preview' in unconfirmedBody, 'expected a preview response for the unconfirmed request');
    assert.equal(existsSync(markerPath), false, 'the real npm child must NEVER have run for an unconfirmed request — installConnection must be unreached on this path');

    const confirmed = await postJson(`${bridgeUrl}/api/studio/connections/confirm-gate-mcp/install`, { confirm: true });
    assert.equal(confirmed.status, 200);
    const confirmedBody = (await confirmed.json()) as { suppressed?: boolean };
    assert.notEqual(confirmedBody.suppressed, true, 'sanity: with both suppression env vars deleted, confirm:true must reach the REAL executor');
    assert.equal(existsSync(markerPath), true, 'confirm:true is the ONLY path that installs — the real npm child must have run exactly now, not before');
  } finally {
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN; else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE; else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

// T2 ruling (round 2, item 3): three pinned constraints on the suppressed
// install response. All three now require confirm:true to reach this branch
// at all (forge-6gv.8.2) — an empty/no-confirm body no longer does.

test('POST /api/studio/connections/<installable>/install (confirmed, suppressed): the response is STRUCTURALLY DISTINCT — exactly {ok, suppressed, wouldInstall}, never a shape mistakable for a completed install', async () => {
  writeCatalog({ mcps: [{ id: 'shape-check-mcp', install: { method: 'npm', package: '@forge-test/shape-check-mcp', version: '1.0.0' } }] });
  const res = await postJson(`${bridgeUrl}/api/studio/connections/shape-check-mcp/install`, { confirm: true });
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(body).sort(),
    ['ok', 'suppressed', 'wouldInstall'],
    `a suppressed install response must carry EXACTLY {ok, suppressed, wouldInstall} and nothing else — a stray "installed"/"state"/"probe" key here would read as a completed install; got keys: ${JSON.stringify(Object.keys(body))}`,
  );
  assert.equal(body['suppressed'], true);
  assert.notEqual(body['ok'], 'installed', 'ok must be the boolean true (request succeeded), never a string that could be misread as a completed-install status');
});

test('POST /api/studio/connections/<installable>/install (confirmed): honours FORGE_DRY_BRIDGE=1 independently of FORGE_ARCHITECT_NO_SPAWN (T2 ruling: both seams, same as run-agent.ts)', async () => {
  writeCatalog({ mcps: [{ id: 'dry-bridge-only-mcp', install: { method: 'npm', package: '@forge-test/dry-bridge-only-mcp', version: '1.0.0' } }] });
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  try {
    delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    process.env.FORGE_DRY_BRIDGE = '1';
    const res = await postJson(`${bridgeUrl}/api/studio/connections/dry-bridge-only-mcp/install`, { confirm: true });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; suppressed: boolean; wouldInstall: { command: string; args: string[] } };
    assert.equal(body.suppressed, true, 'FORGE_DRY_BRIDGE=1 alone (without FORGE_ARCHITECT_NO_SPAWN) must ALSO suppress real execution');
    assert.equal(body.wouldInstall.command, 'npm');
  } finally {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
  }
});

test('POST /api/studio/connections/<installable>/install (confirmed, suppressed): a SUBSEQUENT probe of the same connection still reports not-installed — the suppressed path changes NOTHING about real state', async () => {
  writeCatalog({
    mcps: [{ id: 'suppressed-no-state-change-mcp', install: { method: 'npm', package: '@forge-test/suppressed-no-state-change-mcp', version: '1.0.0' } }],
  });
  const installRes = await postJson(`${bridgeUrl}/api/studio/connections/suppressed-no-state-change-mcp/install`, { confirm: true });
  const installBody = (await installRes.json()) as { suppressed: boolean };
  assert.equal(installBody.suppressed, true, 'sanity: this test\'s whole premise is that the install was suppressed, not real');

  const probeRes = await postJson(`${bridgeUrl}/api/studio/connections/suppressed-no-state-change-mcp/probe`, {});
  const probeBody = (await probeRes.json()) as { ok: boolean; probe: { state: string } };
  assert.equal(
    probeBody.probe.state,
    'not-installed',
    'a suppressed (never-executed) install must not fabricate an "available" state on the next real probe — nothing on disk actually changed',
  );
});

// ---------------------------------------------------------------------------
// Round 6 (adversarial-review FIX FIRST, item 2): the REAL, non-suppressed
// install path calls spawnSync('npm', argv) with NO env override at all —
// the child inherits the operator's FULL environment, sentinel
// ANTHROPIC_API_KEY included. Its sibling probe child (connection-probe.ts)
// is stripped for exactly this threat model (D11); install runs MORE
// untrusted code than a probe does (arbitrary npm lifecycle-adjacent
// third-party code vs. a `--version` flag), so it needs the SAME protection,
// not less. Driven against a REAL spawned child (a fake `npm` shadowed onto
// PATH that dumps its own env to a marker file) — not by reading a constant,
// mirroring connection-probe.test.ts's own D11 env-leak AT exactly. This is
// also the FIRST coverage of the non-suppressed install branch at all — the
// implementer flagged it untested, and the reviewer proved that gap was
// hiding a real defect.
// ---------------------------------------------------------------------------

test('POST /api/studio/connections/<installable>/install (REAL, non-suppressed): the spawned npm child must NOT see ANTHROPIC_API_KEY — proven against a real child, not a constant (round-6 FIX-FIRST)', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'bridge-install-env-leak-'));
  const markerPath = join(scratchRoot, 'env-dump.txt');
  const fakeNpmPath = join(scratchRoot, 'npm');
  // A fake `npm` that performs NO real install — it only records what its
  // own env actually contained, then exits 0 so the install "succeeds" and
  // nothing downstream (the post-install re-probe) throws on a nonzero exit.
  writeFileSync(
    fakeNpmPath,
    [
      '#!/usr/bin/env bash',
      `{`,
      `  echo "ANTHROPIC_API_KEY:\${ANTHROPIC_API_KEY-<absent>}"`,
      `  echo "PATH:\${PATH:+present}"`,
      `  echo "HOME:\${HOME:+present}"`,
      `} > "${markerPath}"`,
      'exit 0',
    ].join('\n'),
    'utf8',
  );
  chmodSync(fakeNpmPath, 0o755);

  const priorPath = process.env.PATH;
  const priorAnthropicKey = process.env.ANTHROPIC_API_KEY;
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  try {
    // Drive the REAL, non-suppressed path — this file's before() sets
    // FORGE_ARCHITECT_NO_SPAWN=1 globally to keep every OTHER test hermetic;
    // this is the one test that deliberately turns real execution back on.
    delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    delete process.env.FORGE_DRY_BRIDGE;
    // Shadow the real npm: our fake one MUST resolve first.
    process.env.PATH = `${scratchRoot}${process.env.PATH ? delimiter + process.env.PATH : ''}`;
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-sentinel-must-never-leak-into-install-child';

    writeCatalog({
      mcps: [{ id: 'env-leak-install-mcp', install: { method: 'npm', package: '@forge-test/env-leak-install-mcp', version: '1.0.0' } }],
    });
    const res = await postJson(`${bridgeUrl}/api/studio/connections/env-leak-install-mcp/install`, { confirm: true });
    const body = (await res.json()) as { suppressed?: boolean; error?: string };
    assert.equal(res.status, 200, `expected the real (fake-npm) install to report success, got ${res.status}: ${JSON.stringify(body)}`);
    assert.notEqual(body.suppressed, true, 'sanity: this test\'s whole premise is that the install is REAL, not suppressed — a suppressed response here means the env vars above did not actually take effect');

    assert.ok(existsSync(markerPath), 'the fake npm must have actually run and written its env dump — if this is missing, the real spawnSync call never fired at all');
    const dump = readFileSync(markerPath, 'utf8');
    const fields = Object.fromEntries(
      dump.trim().split('\n').map((line) => {
        const idx = line.indexOf(':');
        return [line.slice(0, idx), line.slice(idx + 1)];
      }),
    );

    assert.equal(fields['ANTHROPIC_API_KEY'], '<absent>', `the real install child must NOT receive ANTHROPIC_API_KEY — the sibling probe child is stripped for exactly this threat model (D11); install runs MORE untrusted code, not less. Got: ${JSON.stringify(fields)}`);
    assert.equal(fields['PATH'], 'present', 'npm needs PATH to resolve anything it shells out to — base hygiene, not stripped to nothing');
    assert.equal(fields['HOME'], 'present', 'npm needs HOME for its own config/cache resolution');
  } finally {
    if (priorPath === undefined) delete process.env.PATH; else process.env.PATH = priorPath;
    if (priorAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = priorAnthropicKey;
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN; else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE; else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Negative AC (D1's structural "no authoring" rule): NO route accepts a
// connection create/update/delete — proven against the REAL bridge
// dispatcher (the full HTTP server via startBridge), so this catches a
// future accidental route addition ANYWHERE in ui-bridge.ts, not just inside
// this module's own handler.
// ---------------------------------------------------------------------------

test('the real bridge REFUSES POST/PUT/DELETE at /api/studio/connections (collection) — no create route exists anywhere', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const res = await fetch(`${bridgeUrl}/api/studio/connections`, {
      method,
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: method === 'PUT' || method === 'POST' ? JSON.stringify({ id: 'hostile-new-connection', name: 'Hostile' }) : undefined,
    });
    assert.ok(res.status === 404 || res.status === 405, `${method} /api/studio/connections must be refused, got ${res.status}`);
  }
});

test('the real bridge REFUSES PUT/DELETE at /api/studio/connections/:id (item) — no update/delete route exists anywhere', async () => {
  writeCatalog({ tools: [{ id: 'gh' }] });
  for (const method of ['PUT', 'DELETE']) {
    const res = await fetch(`${bridgeUrl}/api/studio/connections/gh`, {
      method,
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: method === 'PUT' ? JSON.stringify({ name: 'Renamed' }) : undefined,
    });
    assert.ok(res.status === 404 || res.status === 405, `${method} /api/studio/connections/gh must be refused, got ${res.status}`);
  }
});

test('POST /api/studio/connections (bare collection, no sub-path) is refused — creating via POST-to-collection is not a real route', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/connections`, { id: 'hostile', name: 'Hostile' });
  assert.ok(res.status === 404 || res.status === 405);
});

// ---------------------------------------------------------------------------
// Handler contract — direct invocation (mirrors bridge-studio-hooks.test.ts)
// ---------------------------------------------------------------------------

test('the library route table declines a non-matching URL (passthrough contract)', async () => {
  const mockRes = {
    writeHead: () => { throw new Error('must not write a response for a non-matching URL'); },
    end: () => { throw new Error('must not end a response for a non-matching URL'); },
  } as unknown as import('node:http').ServerResponse;
  const mockReq = {} as import('node:http').IncomingMessage;
  const ctx = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };
  const handled = await dispatchRoute(libraryRoutes, mockReq, mockRes, { ...ctx, readBody: async () => ({}) }, '/api/studio/nonexistent', 'GET');
  assert.equal(handled, false, 'a non-matching studio-connections URL must return false');
});
