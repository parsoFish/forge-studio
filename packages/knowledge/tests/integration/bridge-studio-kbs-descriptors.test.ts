/**
 * Integration tests for the KB READ surface.
 *
 * The 8 KiB guidance cap, the node→KB resolver, and what `loadKbDescriptors` does and does not surface as a KB.
 *
 * Split out of `bridge-studio-kbs.test.ts` (1,306 lines) in M4: 9 of its 35
 * cases. Shared support lives in `./test-fixtures/bridge-studio-kbs.ts`.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadKbDescriptors } from '../../bridge-studio-kbs.ts';

import {
  CYCLES_KB_YAML,
  setupSharedForge,
} from './test-fixtures/bridge-studio-kbs.ts';

let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;

before(async () => {
  const shared = await setupSharedForge();
  forgeRoot = shared.root;
  bridgeUrl = shared.url;
  closeServer = shared.close;
});

after(async () => {
  await closeServer();
  rmSync(forgeRoot, { recursive: true, force: true });
});

async function post(
  path: string,
  body?: Record<string, unknown>,
  nocsrf = false,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!nocsrf) headers['x-forge-csrf'] = '1';
  const res = await fetch(`${bridgeUrl}${path}`, {
    method: 'POST',
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

async function get(path: string): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${bridgeUrl}${path}`);
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

test('POST /api/studio/kbs/:id/guidance: normal text → 200', async () => {
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: 'Short guidance note.',
  });
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['ok'], true);
});

test('POST /api/studio/kbs/:id/guidance: oversized text → 400 guidance text too large', async () => {
  // 9 KiB of text — over the 8 KiB cap
  const oversized = 'x'.repeat(9 * 1024);
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: oversized,
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
  assert.ok((json['error'] as string).includes('guidance text too large'));
});

test('POST /api/studio/kbs/:id/guidance: exactly 8192 bytes → 200 (at-cap is allowed)', async () => {
  // Exactly 8 KiB (8192 bytes) — should pass (> not >=)
  const atCap = 'a'.repeat(8192);
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: atCap,
  });
  assert.equal(status, 200, JSON.stringify(json));
});

test('POST /api/studio/kbs/:id/guidance: 8193 bytes → 400', async () => {
  const overCap = 'a'.repeat(8193);
  const { status, json } = await post('/api/studio/kbs/cycles/guidance', {
    text: overCap,
  });
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok((json['error'] as string).includes('guidance text too large'));
});

test('GET /api/studio/kbs/resolve-node/:nodeId: finds node in cycles KB', async () => {
  // 'test-theme' was written to cycles/themes/test-theme.md
  const { status, json } = await get('/api/studio/kbs/resolve-node/test-theme');
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json['kbId'], 'cycles', `expected 'cycles', got: ${JSON.stringify(json)}`);
});

test('GET /api/studio/kbs/resolve-node/:nodeId: unknown node → 404', async () => {
  const { status, json } = await get('/api/studio/kbs/resolve-node/nonexistent-node-xyz');
  assert.equal(status, 404, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
});

test('GET /api/studio/kbs/resolve-node/:nodeId: invalid node id → 400', async () => {
  // Leading dot is invalid per NODE_ID_RE
  const { status, json } = await get('/api/studio/kbs/resolve-node/.hidden');
  assert.equal(status, 400, JSON.stringify(json));
  assert.ok(typeof json['error'] === 'string');
});

// ADR 035: per-project brains live at brain/projects/<id>/. loadKbDescriptors
// must surface them alongside the top-level brains so they appear in Studio's KB
// list/graph (previously only direct subdirs of brain/ were scanned).
test('loadKbDescriptors: includes central per-project brains under brain/projects/', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-descriptors-'));
  try {
    // Top-level brain
    mkdirSync(join(root, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(root, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
    // Central per-project brain with two themes
    const proj = join(root, 'brain', 'projects', 'gitpulse');
    mkdirSync(join(proj, 'themes'), { recursive: true });
    writeFileSync(join(proj, 'kb.yaml'), 'id: gitpulse\nname: gitpulse (project)\nbinding: { kind: project, ref: gitpulse }\ndesc: Per-project brain.\nbackend: filesystem\n');
    writeFileSync(join(proj, 'themes', 'a.md'), '# A\n');
    writeFileSync(join(proj, 'themes', 'b.md'), '# B\n');

    const kbs = loadKbDescriptors(root);
    const ids = kbs.map((k) => k.id);
    assert.ok(ids.includes('cycles'), `expected top-level cycles, got ${JSON.stringify(ids)}`);
    assert.ok(ids.includes('gitpulse'), `expected per-project gitpulse, got ${JSON.stringify(ids)}`);
    const gp = kbs.find((k) => k.id === 'gitpulse');
    assert.deepEqual(gp?.binding, { kind: 'project', ref: 'gitpulse' });
    assert.equal(gp?.counts.themes, 2, 'gitpulse theme count should reflect its themes/ dir');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-4on-9 (loadKbDescriptors) [SEC-05 4on REOPEN #1] — a `.staging-<id>-<rand>`
// orphan under brain/projects/ (a rename-loser under concurrency, or a
// hard-kill DURING staging, of the transactional create fix) must NEVER surface
// as a phantom KB. loadKbDescriptors walks brain/projects/ via subDirs()
// (bridge-studio-kbs.ts:68-77 + :132-133), which filters ONLY on isDirectory()
// with no dot-prefix filter; isSafeSegment() in the path guard accepts a
// leading-dot segment (it rejects only '.'/'..'), and loadKbDescriptor reads the
// KB id straight from the yaml with no dir cross-check — so a real
// `.staging-decoy-abc123/kb.yaml` loads and is pushed. That is a phantom KB
// bound to a project that was never created — the exact "leaks
// .staging-<id>-<rand> orphans which SURFACE as phantom-KBs" vector this REOPEN
// closes.
//
// RED at base: loadKbDescriptors returns a kb with id 'staging-decoy-abc123'.
// Kills: a KB listing that walks brain/projects/ with no `.`-prefix filter. The
// `cycles` control proves the scan actually reached disk (not an accidental
// empty pass).
// ---------------------------------------------------------------------------
test('AT-4on-9: a `.staging-*` brain leftover is never surfaced as a phantom KB (control `cycles` still surfaced)', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-staging-dotdir-'));
  try {
    // Control: a real top-level brain — proves the scan reaches disk.
    mkdirSync(join(root, 'brain', 'cycles', 'themes'), { recursive: true });
    writeFileSync(join(root, 'brain', 'cycles', 'kb.yaml'), CYCLES_KB_YAML);
    // Decoy: a `.staging-<id>-<rand>` leftover under brain/projects/ carrying a
    // VALID kb.yaml (id taken straight from the yaml, no dir cross-check).
    const decoy = join(root, 'brain', 'projects', '.staging-decoy-abc123');
    mkdirSync(join(decoy, 'themes'), { recursive: true });
    const decoyYaml = join(decoy, 'kb.yaml');
    writeFileSync(
      decoyYaml,
      'id: staging-decoy-abc123\nname: Staging Decoy\nbinding: { kind: project, ref: staging-decoy-abc123 }\ndesc: A rename-loser staging orphan.\nbackend: filesystem\n',
    );
    // Fixture precondition (before any verdict): the decoy kb.yaml is on disk.
    assert.ok(existsSync(decoyYaml), 'precondition: the decoy kb.yaml must be planted');

    const kbs = loadKbDescriptors(root);
    const ids = kbs.map((k) => k.id);
    // The scan works: the control brain surfaces (guards accidental-empty).
    assert.ok(ids.includes('cycles'), `control brain must surface — got ${JSON.stringify(ids)}`);
    // The verdict: the staging leftover is NOT surfaced as a phantom KB.
    assert.ok(!ids.includes('staging-decoy-abc123'), `a .staging-* brain leftover surfaced as a phantom KB id "staging-decoy-abc123" — got ${JSON.stringify(ids)}`);
    assert.ok(!ids.includes('.staging-decoy-abc123'), `a .staging-* brain leftover surfaced verbatim — got ${JSON.stringify(ids)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
