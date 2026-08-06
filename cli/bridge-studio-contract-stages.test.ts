/**
 * Acceptance tests for `GET /api/studio/projects/<id>/contract-stages`
 * (R4-17, D9 — the data contract R4-12-F1 renders on the project page in
 * batch D). The route DOES NOT EXIST YET — this file is RED at branch base
 * (every 200-path assertion fails against a 404 fallthrough; the malformed-id
 * ATs may coincidentally already read as errors via the generic bridge
 * fallthrough — see the RED-proof report for the exact per-test reason).
 *
 * Wire-level rule (path-shaped param — mirrors the R4-16 precedent in
 * cli/bridge-studio-sessions.test.ts's own header): a real `fetch()` client
 * normalizes a LITERAL `..` path segment away before the request ever leaves
 * the client, so that shape can only be exercised by calling
 * `handleStudioRoutes` DIRECTLY with a hand-built `rawUrl` string (AT-3). A
 * PERCENT-ENCODED traversal (`%2e%2e%2f`) is NOT normalized client-side and
 * genuinely reaches the server over a real `fetch()` call (AT-2) — both
 * shapes are tested, on the path that actually exercises them.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from './ui-bridge.ts';
import { handleStudioRoutes } from './bridge-studio.ts';
import type { StudioContext } from './bridge-studio.ts';

let forgeRoot: string;
let url: string;
let close: () => Promise<void>;

before(async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'bridge-contract-stages-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  const okDir = join(forgeRoot, 'projects', 'onboardedproj');
  mkdirSync(join(okDir, '.forge'), { recursive: true });
  writeFileSync(join(okDir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } } }), 'utf8');
  writeFileSync(join(okDir, 'roadmap.md'), '# Roadmap\n', 'utf8');

  const badDir = join(forgeRoot, 'projects', 'brokenconfigproj');
  mkdirSync(join(badDir, '.forge'), { recursive: true });
  writeFileSync(join(badDir, '.forge', 'project.json'), '{ not valid json [[[', 'utf8');

  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (close) await close();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Validation (AT-1, AT-2, AT-3)
// ---------------------------------------------------------------------------

test('R4-17 AT-1: GET /api/studio/projects/<id>/contract-stages — malformed id (uppercase, invalid slug) → 400', async () => {
  const res = await fetch(`${url}/api/studio/projects/Not_A_Slug/contract-stages`);
  assert.equal(res.status, 400);
});

test('R4-17 AT-2 (real client path — percent-encoded traversal survives client-side normalization): id = "%2e%2e%2fetc" reaches the server verbatim and is rejected server-side (not merely client-normalized away)', async () => {
  const res = await fetch(`${url}/api/studio/projects/%2e%2e%2fetc/contract-stages`);
  assert.equal(res.status, 400, 'a percent-encoded traversal must be rejected by the server-side slug check, not silently 404 as "not found" (which would be indistinguishable from an unvalidated pass-through)');
});

test('R4-17 AT-3 (RAW-request, wire-level rule): a LITERAL ".." path segment — which a real fetch() client normalizes away before the request is ever sent — is rejected by the SERVER-SIDE guard when driven directly, proving the guard does not rely on client-side normalization', async () => {
  const mockRes = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    writeHead(code: number) { this.statusCode = code; return this; },
    end() { /* no-op — we only inspect statusCode */ },
    setHeader() { /* no-op */ },
  } as unknown as import('node:http').ServerResponse;
  const mockReq = { headers: {} } as import('node:http').IncomingMessage;
  const ctx: StudioContext = { forgeRoot, logsRoot: join(forgeRoot, '_logs') };

  const handled = await handleStudioRoutes(mockReq, mockRes, ctx, '/api/studio/projects/../contract-stages', 'GET');
  assert.equal(handled, true, 'the route must claim this URL (matching [^/]+ literally on the raw ".." segment) rather than falling through unmatched');
  assert.equal((mockRes as unknown as { statusCode: number }).statusCode, 400, 'the raw ".." segment must be rejected by the slug check — never treated as a real project id');
});

test('R4-17 AT-4: GET /api/studio/projects/<id>/contract-stages — unknown project (valid slug, no such directory) → 404', async () => {
  const res = await fetch(`${url}/api/studio/projects/no-such-project-xyz/contract-stages`);
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// Happy path — real deriveContractStages output over the wire (AT-5)
// ---------------------------------------------------------------------------

test('R4-17 AT-5: GET /api/studio/projects/<id>/contract-stages — 200 {ok:true, project, stages, sourcesScanned}, five stages in D2 order, derived from the REAL on-disk project fixture', async () => {
  const res = await fetch(`${url}/api/studio/projects/onboardedproj/contract-stages`);
  const text = await res.text();
  assert.equal(res.status, 200, text);
  const body = JSON.parse(text) as { ok: boolean; project: string; stages: Array<{ stage: string; status: string }>; sourcesScanned: string[] };
  assert.equal(body.ok, true);
  assert.equal(body.project, 'onboardedproj');
  assert.deepEqual(
    body.stages.map((s) => s.stage),
    ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
    'all five stages, in the declared D2 order, over the real wire — never a dropped row',
  );
  const byStage = (s: string): { status: string } => body.stages.find((r) => r.stage === s)!;
  assert.equal(byStage('contract').status, 'present', 'the fixture declares testProcess.local.cmd');
  assert.equal(byStage('roadmap').status, 'present', 'the fixture has a real roadmap.md');
  assert.equal(byStage('instructions').status, 'absent', 'the fixture has no AGENTS.md/CLAUDE.md');
  assert.ok(Array.isArray(body.sourcesScanned) && body.sourcesScanned.length > 0);
});

// ---------------------------------------------------------------------------
// Malformed config — fail-closed reaches the wire (AT-6)
// ---------------------------------------------------------------------------

test('R4-17 AT-6: a project with a malformed .forge/project.json → deriveContractStages\'s {ok:false} surfaces as a NON-200 error naming the cause, never a 200 with an empty artifact', async () => {
  const res = await fetch(`${url}/api/studio/projects/brokenconfigproj/contract-stages`);
  assert.notEqual(res.status, 200, 'a malformed project.json must never be smoothed into a 200 — this is the "declared data fails open" shape this campaign keeps finding');
  const body = (await res.json()) as { error?: string; ok?: boolean };
  assert.ok(typeof body.error === 'string' && body.error.length > 0, `the error response must name the cause, got: ${JSON.stringify(body)}`);
  assert.notEqual(body.ok, true);
});
