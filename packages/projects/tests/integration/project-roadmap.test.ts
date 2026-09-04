/**
 * project-roadmap.test.ts — drive the carved contract-stages handler
 * directly.
 *
 * M4 §4 (projects routes carve). No bridge boot (0 such tests in this
 * package today, kept 0). NOTE: this file covers `handleProjectContractStages`
 * only — the roadmap handler itself (`GET /api/studio/projects/:id/roadmap`)
 * did NOT carve into this package; see `project-roadmap.ts`'s file header for
 * the confirmed `package-layer-order` blocker (`@forge/flows`, a strictly
 * higher package rank). Its bridge-level test
 * (`apps/forge/bridge-studio-roadmap.test.ts`) is unaffected — the route still lives
 * in, and is still tested against, `apps/forge/bridge-studio.ts`.
 *
 * Coverage carried from `apps/forge/bridge-studio-contract-stages.test.ts`'s AT-1
 * (malformed id), AT-2/AT-3 (traversal, percent-encoded and literal), AT-4
 * (unknown project), AT-5 (happy path, five stages in order) and AT-6
 * (malformed project.json → non-200, never a smoothed-over 200).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { StudioContext } from '@forge/kernel';
import { handleProjectContractStages } from '../../project-roadmap.ts';

type Captured = { status: number | null; body: string };

function mockRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

const mockReq = () => ({ headers: {} }) as unknown as IncomingMessage;

function makeForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-projects-roadmap-'));
  mkdirSync(join(root, '_logs'), { recursive: true });
  return root;
}

function ctxFor(forgeRoot: string): StudioContext {
  return { forgeRoot, logsRoot: join(forgeRoot, '_logs') };
}

// ---------------------------------------------------------------------------
// Validation (AT-1, AT-2, AT-3)
// ---------------------------------------------------------------------------

const invalidIds = ['not a project', '.hidden', '%2e%2e%2fetc'];

test('handleProjectContractStages: malformed / traversal-shaped ids all → 400 (table-driven, AT-1/AT-2)', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    for (const id of invalidIds) {
      const { res, captured } = mockRes();
      const answered = await handleProjectContractStages(mockReq(), res, ctxFor(forgeRoot), `/api/studio/projects/${id}/contract-stages`, 'GET');
      assert.equal(answered, true, `id=${id} must be claimed by this route`);
      assert.equal(captured.status, 400, `id=${id} must 400, got ${captured.status}`);
    }
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('handleProjectContractStages: AT-3 — a LITERAL ".." path segment (never sent by a real client, only reachable via a direct call) is rejected server-side, not just client-normalized away', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractStages(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/../contract-stages', 'GET');
    assert.equal(answered, true, 'the route must claim this URL (matching [^/]+ literally on the raw ".." segment) rather than falling through unmatched');
    assert.equal(captured.status, 400, 'the raw ".." segment must be rejected by the slug check — never treated as a real project id');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-4 — unknown project
// ---------------------------------------------------------------------------

test('handleProjectContractStages: unknown project (valid slug, no such directory) → 404', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractStages(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/no-such-project-xyz/contract-stages', 'GET');
    assert.equal(answered, true);
    assert.equal(captured.status, 404);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-5 — happy path, real deriveContractStages output
// ---------------------------------------------------------------------------

test('handleProjectContractStages: 200 {ok:true, project, stages, sourcesScanned} — five stages in D2 order, derived from the real on-disk fixture', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const okDir = join(forgeRoot, 'projects', 'onboardedproj');
    mkdirSync(join(okDir, '.forge'), { recursive: true });
    writeFileSync(join(okDir, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } } }), 'utf8');
    writeFileSync(join(okDir, 'roadmap.md'), '# Roadmap\n', 'utf8');

    const { res, captured } = mockRes();
    const answered = await handleProjectContractStages(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/onboardedproj/contract-stages', 'GET');
    assert.equal(answered, true);
    assert.equal(captured.status, 200, captured.body);
    const body = JSON.parse(captured.body) as { ok: boolean; project: string; stages: Array<{ stage: string; status: string }>; sourcesScanned: string[] };
    assert.equal(body.ok, true);
    assert.equal(body.project, 'onboardedproj');
    assert.deepEqual(
      body.stages.map((s) => s.stage),
      ['contract', 'instructions', 'secrets', 'demo', 'roadmap'],
      'all five stages, in the declared D2 order, never a dropped row',
    );
    const byStage = (s: string): { status: string } => body.stages.find((r) => r.stage === s)!;
    assert.equal(byStage('contract').status, 'present', 'the fixture declares testProcess.local.cmd');
    assert.equal(byStage('roadmap').status, 'present', 'the fixture has a real roadmap.md');
    assert.equal(byStage('instructions').status, 'absent', 'the fixture has no AGENTS.md/CLAUDE.md');
    assert.ok(Array.isArray(body.sourcesScanned) && body.sourcesScanned.length > 0);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// AT-6 — malformed config fails closed, never smoothed into a 200
// ---------------------------------------------------------------------------

test('handleProjectContractStages: a malformed .forge/project.json surfaces as a NON-200 error naming the cause, never a 200 with an empty artifact', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const badDir = join(forgeRoot, 'projects', 'brokenconfigproj');
    mkdirSync(join(badDir, '.forge'), { recursive: true });
    writeFileSync(join(badDir, '.forge', 'project.json'), '{ not valid json [[[', 'utf8');

    const { res, captured } = mockRes();
    await handleProjectContractStages(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/brokenconfigproj/contract-stages', 'GET');
    assert.notEqual(captured.status, 200, 'a malformed config must never be smoothed into a 200');
    const body = JSON.parse(captured.body) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.ok(typeof body.error === 'string' && body.error.length > 0);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Passthrough contract
// ---------------------------------------------------------------------------

test('handleProjectContractStages: a non-matching url/method declines (returns false, sends nothing)', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractStages(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/onboardedproj/roadmap', 'GET');
    assert.equal(answered, false);
    assert.equal(captured.status, null);

    const { res: res2, captured: c2 } = mockRes();
    const wrongMethod = await handleProjectContractStages(mockReq(), res2, ctxFor(forgeRoot), '/api/studio/projects/onboardedproj/contract-stages', 'POST');
    assert.equal(wrongMethod, false);
    assert.equal(c2.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
