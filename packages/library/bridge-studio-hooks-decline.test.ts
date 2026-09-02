/**
 * Acceptance tests for `POST /api/studio/hooks/:id/decline`
 * (bridge-studio-hooks-decline.ts, bead forge-8vfn.5.2) — the THIRD review
 * outcome, alongside approve/override/revoke-approval.
 *
 * SEPARATE FILE, DELIBERATELY: `bridge-studio-hooks.test.ts` is baselined at
 * the repo's 800-line hard cap (`scripts/check-file-size.mjs`) with zero
 * headroom — the same reason `bridge-studio-hooks-decline.ts` itself is a
 * sibling of `bridge-studio-hooks.ts` rather than an addition to it. Own
 * bridge instance rather than reusing that file's `before()`/`after()`.
 *
 * Contract pinned here:
 *   - A declined hook is reported `trust:'declined'` (both list and detail)
 *     and stays `runnable:false` — decline grants nothing.
 *   - Declining a currently-approved hook supersedes the approval.
 *   - Unknown id → 404; a traversal-shaped id → 400, not 500.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../cli/ui-bridge.ts';

let forgeRoot: string;
let bridgeUrl: string;
let closeBridge: () => Promise<void>;

const DENY_ALL = { env: [], read: [], network: false };
const BENIGN_SCRIPT = '#!/usr/bin/env bash\necho "hook ran ok"\n';

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-hooks-decline-'));
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

function writeHookFixture(id: string): void {
  const dir = join(forgeRoot, 'studio', 'hooks', id);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts', 'run.sh'), BENIGN_SCRIPT, 'utf8');
  writeFileSync(
    join(dir, 'hook.yaml'),
    [
      `name: ${id}`,
      `description: Test hook ${id}.`,
      'on: PreToolUse',
      'script: scripts/run.sh',
      'permissions:',
      `  env: [${DENY_ALL.env.join(', ')}]`,
      `  read: [${DENY_ALL.read.join(', ')}]`,
      `  network: ${DENY_ALL.network}`,
      '',
    ].join('\n'),
    'utf8',
  );
}

function removeHookFixture(id: string): void {
  rmSync(join(forgeRoot, 'studio', 'hooks', id), { recursive: true, force: true });
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify(body),
  });
}

test('POST /api/studio/hooks/<id>/decline: a clean, never-reviewed hook becomes trust:declined and stays NOT runnable', async () => {
  writeHookFixture('decline-clean-hook');
  try {
    const res = await postJson(`${bridgeUrl}/api/studio/hooks/decline-clean-hook/decline`, { reason: 'operator does not want this hook' });
    assert.equal(res.status, 200);

    const detailRes = await fetch(`${bridgeUrl}/api/studio/hooks/decline-clean-hook`);
    const detail = (await detailRes.json()) as { trust: string; runnable: boolean; declined?: { declinedAt: string; reason?: string } };
    assert.equal(detail.trust, 'declined');
    assert.equal(detail.runnable, false, 'a declined hook must NEVER be runnable — decline is a review outcome, not an approval');
    assert.ok(detail.declined, 'expected a declined record on the detail response');
    assert.equal(detail.declined!.reason, 'operator does not want this hook');
    assert.equal(typeof detail.declined!.declinedAt, 'string');

    const listRes = await fetch(`${bridgeUrl}/api/studio/hooks`);
    const listBody = (await listRes.json()) as { hooks: Array<Record<string, unknown>> };
    const listEntry = listBody.hooks.find((h) => h['id'] === 'decline-clean-hook');
    assert.equal(listEntry?.['trust'], 'declined', 'GET /api/studio/hooks must also report the declined trust label');
  } finally {
    removeHookFixture('decline-clean-hook');
  }
});

test('POST /api/studio/hooks/<id>/decline: declining a currently-approved hook supersedes the approval', async () => {
  writeHookFixture('decline-approved-hook');
  try {
    const approve = await postJson(`${bridgeUrl}/api/studio/hooks/decline-approved-hook/approve`, {});
    assert.equal(approve.status, 200);

    const decline = await postJson(`${bridgeUrl}/api/studio/hooks/decline-approved-hook/decline`, {});
    assert.equal(decline.status, 200);

    const detail = (await (await fetch(`${bridgeUrl}/api/studio/hooks/decline-approved-hook`)).json()) as { trust: string; runnable: boolean };
    assert.equal(detail.trust, 'declined');
    assert.equal(detail.runnable, false, 'declining a previously-approved hook must revoke its runnability, not just relabel it');
  } finally {
    removeHookFixture('decline-approved-hook');
  }
});

test('POST /api/studio/hooks/<unknown>/decline: 404', async () => {
  const res = await postJson(`${bridgeUrl}/api/studio/hooks/no-such-hook/decline`, {});
  assert.equal(res.status, 404);
});

test('POST /api/studio/hooks/<traversal>/decline: hostile ids rejected with 400, not 500', async () => {
  const probes = ['..%2F..%2Fetc%2Fpasswd', '%252e%252e%252fetc%252fpasswd', 'evil%00hook', 'a'.repeat(150)];
  for (const probe of probes) {
    const res = await postJson(`${bridgeUrl}/api/studio/hooks/${probe}/decline`, {});
    assert.equal(res.status, 400, `decline probe "${probe}" must be rejected with 400`);
  }
});
