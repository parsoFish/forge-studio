/**
 * OOTB-provenance acceptance tests for hooks (bead forge-8vfn.8.3.7, M7-C
 * item 76 — see `packages/kernel/provenance.ts`'s `originOfHookOrTemplate`
 * header for the two-source rationale).
 *
 * A SEPARATE file from `bridge-studio-hooks.test.ts` on purpose: that file
 * sits at its file-size ratchet baseline (821 lines, `scripts/baselines/
 * file-size.json`) with zero headroom — adding cases there would trip
 * check-file-size's `grew` failure. Mirrors that file's own real-bridge +
 * fetch style exactly (`startBridge`, `writeHookFixture`'s raw-doc idiom).
 *
 * What this file proves:
 *  - A hook.yaml with no `origin:` key at all (the shape every OOTB-shipped
 *    hook carries today — `studio/hooks/post-merge-brain-ingest/hook.yaml`,
 *    `studio/hooks/pre-pr-security-review/hook.yaml`) reads `origin: 'ootb'`
 *    on BOTH the list and detail routes.
 *  - `POST /api/studio/hooks` stamps `origin: 'operator'` into the written
 *    hook.yaml, server-side — never trusting a client-supplied `origin` in
 *    the request body — and the list/detail routes read it back verbatim.
 *  - `PUT /api/studio/hooks/:id` (edit) PRESERVES an existing `origin` —
 *    editing an operator-authored hook must not silently regress it to
 *    reading `ootb` just because the edit route rebuilds hook.yaml from
 *    structured fields rather than passing raw bytes through.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';

import { startBridge } from '../../../../apps/forge/ui-bridge.ts';

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-hooks-origin-'));

  for (const state of ['in-flight', 'done', 'failed', 'pending']) {
    mkdirSync(join(forgeRoot, '_queue', state), { recursive: true });
  }
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'hooks'), { recursive: true });
  writeFileSync(
    join(forgeRoot, 'studio', 'catalog.yaml'),
    ['sdks: []', 'models: []', 'tools: []', 'mcps: []', 'guards: []', 'community-skills: []', ''].join('\n'),
  );

  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  const result = await startBridge({ forgeRoot, port: 0 });
  bridgeUrl = result.url;
  closeBridge = result.close;
});

after(async () => {
  if (closeBridge) await closeBridge();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

/** Writes a raw studio/hooks/<id>/hook.yaml with NO `origin:` key — the
 *  exact shape every OOTB-shipped hook carries today. */
function writeShippedHookFixture(id: string): void {
  const dir = join(forgeRoot, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'run.sh'), '#!/usr/bin/env bash\necho ok\n', 'utf8');
  writeFileSync(
    join(dir, 'hook.yaml'),
    yaml.dump({
      name: id,
      description: `Shipped fixture hook ${id}.`,
      on: 'PreToolUse',
      script: 'scripts/run.sh',
      permissions: { env: [], read: [], network: false },
    }),
    'utf8',
  );
}

test('a shipped hook (no origin: key on disk) reads origin:"ootb" on the list route', async () => {
  writeShippedHookFixture('shipped-origin-hook');
  try {
    const res = await fetch(`${bridgeUrl}/api/studio/hooks`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { hooks: Array<Record<string, unknown>> };
    const entry = body.hooks.find((h) => h['id'] === 'shipped-origin-hook');
    assert.ok(entry, 'the fixture hook must appear in the list');
    assert.equal(entry!['origin'], 'ootb', `a hook.yaml with no origin: key must read as ootb, got ${JSON.stringify(entry!['origin'])}`);
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', 'shipped-origin-hook'), { recursive: true, force: true });
  }
});

test('a shipped hook reads origin:"ootb" on the detail route too', async () => {
  writeShippedHookFixture('shipped-origin-hook-detail');
  try {
    const res = await fetch(`${bridgeUrl}/api/studio/hooks/shipped-origin-hook-detail`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['origin'], 'ootb');
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', 'shipped-origin-hook-detail'), { recursive: true, force: true });
  }
});

test('POST /api/studio/hooks stamps origin:"operator" into the created hook, read back verbatim on both list and detail', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/hooks`, {
    name: 'Created Origin Hook',
    description: 'Created through the route.',
    on: 'SessionEnd',
    scriptBody: '#!/usr/bin/env bash\necho created\n',
  });
  assert.equal(res.status, 200);
  const created = (await res.json()) as { ok: boolean; id: string };
  assert.equal(created.ok, true);
  try {
    const listRes = await fetch(`${bridgeUrl}/api/studio/hooks`);
    const listBody = (await listRes.json()) as { hooks: Array<Record<string, unknown>> };
    const listEntry = listBody.hooks.find((h) => h['id'] === created.id);
    assert.ok(listEntry, 'the created hook must appear in the list');
    assert.equal(listEntry!['origin'], 'operator', `a route-created hook must read origin:"operator", got ${JSON.stringify(listEntry!['origin'])}`);

    const detailRes = await fetch(`${bridgeUrl}/api/studio/hooks/${created.id}`);
    const detailBody = (await detailRes.json()) as Record<string, unknown>;
    assert.equal(detailBody['origin'], 'operator');
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', created.id), { recursive: true, force: true });
  }
});

test('a client-supplied "origin" in the POST body is IGNORED — the server, never the client, attests origin', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/hooks`, {
    name: 'Spoofed Origin Hook',
    description: 'Attempts to claim ootb.',
    on: 'SessionEnd',
    scriptBody: '#!/usr/bin/env bash\necho spoof\n',
    origin: 'ootb',
  });
  assert.equal(res.status, 200);
  const created = (await res.json()) as { ok: boolean; id: string };
  try {
    const detailRes = await fetch(`${bridgeUrl}/api/studio/hooks/${created.id}`);
    const detailBody = (await detailRes.json()) as Record<string, unknown>;
    assert.equal(detailBody['origin'], 'operator', 'a client-claimed origin:"ootb" must never override the server-attested operator stamp');
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', created.id), { recursive: true, force: true });
  }
});

test('PUT /api/studio/hooks/:id (edit) PRESERVES an existing origin:"operator" — an edit must not silently regress it to ootb', async () => {
  const createRes = await postJson(`${bridgeUrl}/api/studio/hooks`, {
    name: 'Editable Origin Hook',
    description: 'Will be edited.',
    on: 'SessionEnd',
    scriptBody: '#!/usr/bin/env bash\necho pre-edit\n',
  });
  const created = (await createRes.json()) as { ok: boolean; id: string };
  try {
    const putRes = await fetch(`${bridgeUrl}/api/studio/hooks/${created.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
      body: JSON.stringify({ description: 'Edited description.' }),
    });
    assert.equal(putRes.status, 200);

    const detailRes = await fetch(`${bridgeUrl}/api/studio/hooks/${created.id}`);
    const detailBody = (await detailRes.json()) as Record<string, unknown>;
    assert.equal(detailBody['description'], 'Edited description.');
    assert.equal(detailBody['origin'], 'operator', 'editing a hook must preserve its existing origin:"operator" stamp, not silently drop it');
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', created.id), { recursive: true, force: true });
  }
});
