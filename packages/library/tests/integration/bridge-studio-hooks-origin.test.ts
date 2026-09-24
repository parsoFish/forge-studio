/**
 * OOTB-provenance acceptance tests for hooks (bead forge-8vfn.8.3.7, M7-C
 * item 76 — see `packages/kernel/provenance.ts`'s `originOfHookOrTemplate`
 * header for the two-source rationale).
 *
 * A SEPARATE file from `bridge-studio-hooks.test.ts` on purpose: that file
 * sits at its file-size ratchet baseline (821 lines, `scripts/baselines/
 * file-size.json`) with zero headroom — adding cases there would trip
 * check-file-size's `grew` failure.
 *
 * IN-PROCESS dispatch, NOT `startBridge`/`apps/forge/ui-bridge.ts` — unlike
 * its sibling files (whose real-socket `startBridge` import is a GRANDFATHERED
 * `package-to-assembly` entry in `scripts/baselines/boundaries.json`), this is
 * a NEW file and `check-boundaries.mjs`'s baseline "may only shrink" (its own
 * header) — a brand-new entry there is refused. `dispatchRoute(libraryRoutes(
 * deps), ...)` against hand-built `IncomingMessage`/`ServerResponse` stand-ins
 * is the SAME direct-invocation idiom every sibling file's own
 * "passthrough contract" test already uses (see bridge-studio-templates.test.ts's
 * final test) — extended here to capture the JSON response body instead of
 * just the boolean.
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
import type { IncomingMessage, ServerResponse } from 'node:http';

import { dispatchRoute } from '@forge/kernel';
import { libraryRoutes, type LibraryRouteContext } from '../../routes.ts';
import { fixtureAgentFacts } from '../test-fixtures/agent-fixture.ts';
import { fixtureFlowSource } from '../test-fixtures/flow-fixture.ts';
import { inertAuthoringSession } from '../test-fixtures/authoring-session-fixture.ts';

let forgeRoot: string;

before(() => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-studio-hooks-origin-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  mkdirSync(join(forgeRoot, 'skills'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'hooks'), { recursive: true });
});

after(() => {
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A minimal ServerResponse stand-in that CAPTURES what sendJson (@forge/
// kernel/http-envelope.ts) writes — status + JSON body — rather than a real
// socket. Mirrors the shape (not the behaviour) of every sibling file's own
// throw-on-write passthrough mock, extended to record instead of throw.
// ---------------------------------------------------------------------------

function mockResponse(): { res: ServerResponse; result: () => { status: number; body: unknown } } {
  let status = 0;
  let chunks = '';
  const res = {
    writeHead: (code: number) => { status = code; },
    end: (payload?: string) => { chunks = payload ?? ''; },
  } as unknown as ServerResponse;
  return { res, result: () => ({ status, body: chunks ? JSON.parse(chunks) : undefined }) };
}

async function callRoute(method: string, url: string, body?: unknown): Promise<{ status: number; body: unknown }> {
  const deps = { agentFacts: fixtureAgentFacts(forgeRoot), isSdkAvailable: () => false, flowSource: fixtureFlowSource, authoringSession: inertAuthoringSession };
  const ctx: LibraryRouteContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs'), readBody: async () => body ?? {} };
  const { res, result } = mockResponse();
  const mockReq = {} as IncomingMessage;
  const handled = await dispatchRoute(libraryRoutes(deps), mockReq, res, ctx, url, method);
  assert.ok(handled, `route ${method} ${url} must be handled by the library route table`);
  return result();
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
    const { status, body } = await callRoute('GET', '/api/studio/hooks');
    assert.equal(status, 200);
    const entry = (body as { hooks: Array<Record<string, unknown>> }).hooks.find((h) => h['id'] === 'shipped-origin-hook');
    assert.ok(entry, 'the fixture hook must appear in the list');
    assert.equal(entry!['origin'], 'ootb', `a hook.yaml with no origin: key must read as ootb, got ${JSON.stringify(entry!['origin'])}`);
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', 'shipped-origin-hook'), { recursive: true, force: true });
  }
});

test('a shipped hook reads origin:"ootb" on the detail route too', async () => {
  writeShippedHookFixture('shipped-origin-hook-detail');
  try {
    const { status, body } = await callRoute('GET', '/api/studio/hooks/shipped-origin-hook-detail');
    assert.equal(status, 200);
    assert.equal((body as Record<string, unknown>)['origin'], 'ootb');
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', 'shipped-origin-hook-detail'), { recursive: true, force: true });
  }
});

test('POST /api/studio/hooks stamps origin:"operator" into the created hook, read back verbatim on both list and detail', async () => {
  const { status, body: createdBody } = await callRoute('POST', '/api/studio/hooks', {
    name: 'Created Origin Hook',
    description: 'Created through the route.',
    on: 'SessionEnd',
    scriptBody: '#!/usr/bin/env bash\necho created\n',
  });
  assert.equal(status, 200);
  const created = createdBody as { ok: boolean; id: string };
  assert.equal(created.ok, true);
  try {
    const list = await callRoute('GET', '/api/studio/hooks');
    const listEntry = (list.body as { hooks: Array<Record<string, unknown>> }).hooks.find((h) => h['id'] === created.id);
    assert.ok(listEntry, 'the created hook must appear in the list');
    assert.equal(listEntry!['origin'], 'operator', `a route-created hook must read origin:"operator", got ${JSON.stringify(listEntry!['origin'])}`);

    const detail = await callRoute('GET', `/api/studio/hooks/${created.id}`);
    assert.equal((detail.body as Record<string, unknown>)['origin'], 'operator');
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', created.id), { recursive: true, force: true });
  }
});

test('a client-supplied "origin" in the POST body is IGNORED — the server, never the client, attests origin', async () => {
  const { body: createdBody } = await callRoute('POST', '/api/studio/hooks', {
    name: 'Spoofed Origin Hook',
    description: 'Attempts to claim ootb.',
    on: 'SessionEnd',
    scriptBody: '#!/usr/bin/env bash\necho spoof\n',
    origin: 'ootb',
  });
  const created = createdBody as { ok: boolean; id: string };
  try {
    const detail = await callRoute('GET', `/api/studio/hooks/${created.id}`);
    assert.equal((detail.body as Record<string, unknown>)['origin'], 'operator', 'a client-claimed origin:"ootb" must never override the server-attested operator stamp');
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', created.id), { recursive: true, force: true });
  }
});

test('PUT /api/studio/hooks/:id (edit) PRESERVES an existing origin:"operator" — an edit must not silently regress it to ootb', async () => {
  const { body: createdBody } = await callRoute('POST', '/api/studio/hooks', {
    name: 'Editable Origin Hook',
    description: 'Will be edited.',
    on: 'SessionEnd',
    scriptBody: '#!/usr/bin/env bash\necho pre-edit\n',
  });
  const created = createdBody as { ok: boolean; id: string };
  try {
    const put = await callRoute('PUT', `/api/studio/hooks/${created.id}`, { description: 'Edited description.' });
    assert.equal(put.status, 200);

    const detail = await callRoute('GET', `/api/studio/hooks/${created.id}`);
    const detailBody = detail.body as Record<string, unknown>;
    assert.equal(detailBody['description'], 'Edited description.');
    assert.equal(detailBody['origin'], 'operator', 'editing a hook must preserve its existing origin:"operator" stamp, not silently drop it');
  } finally {
    rmSync(join(forgeRoot, 'studio', 'hooks', created.id), { recursive: true, force: true });
  }
});
