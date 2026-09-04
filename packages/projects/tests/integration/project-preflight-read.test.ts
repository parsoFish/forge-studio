/**
 * project-preflight-read.test.ts — drive the carved read-side preflight
 * handlers directly.
 *
 * M4 §4 (projects routes carve). No bridge boot (0 such tests in this
 * package today, kept 0) — each handler is called directly with a mock
 * req/res.
 *
 * Coverage carried from:
 *   - `apps/forge/id-rule.test.ts`'s "per-project routes: every :id route the
 *     walkthrough saw 404/400 now resolves ... / exact match — the
 *     lowercased id is unknown (404)" family, applied to preflight and
 *     repo-status.
 *   - `apps/forge/bridge-studio-preflight-resolve.test.ts`'s
 *     "GET preflight/fix-agent/:runId returns a state" test.
 *   - `apps/forge/bridge-studio-save-repo.test.ts`'s repo-status coverage.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { StudioContext } from '@forge/kernel';
import {
  handleProjectPreflight,
  handleProjectRepoStatus,
  handleProjectPreflightFixAgentStatus,
} from '../../project-preflight-read.ts';

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
  const root = mkdtempSync(join(tmpdir(), 'forge-projects-preflight-read-'));
  mkdirSync(join(root, '_logs'), { recursive: true });
  return root;
}

function ctxFor(forgeRoot: string): StudioContext {
  return { forgeRoot, logsRoot: join(forgeRoot, '_logs') };
}

/** A minimal project fixture `runPreflight` can run against without crashing
 *  (mirrors apps/forge/bridge-studio-preflight-resolve.test.ts's fixture). The exact
 *  clause verdicts are not under test here — only that the route resolves the
 *  project, runs preflight, and shapes the response. */
function writePreflightableProject(forgeRoot: string, id: string): string {
  const dir = join(forgeRoot, 'projects', id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{"name":"' + id + '"}');
  writeFileSync(join(dir, 'tsconfig.json'), '{}');
  writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
  return dir;
}

// ---------------------------------------------------------------------------
// GET /api/studio/projects/:id/preflight
// ---------------------------------------------------------------------------

test('handleProjectPreflight: invalid project id → 400, never reaches the filesystem', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflight(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/not%20a%20project/preflight', 'GET');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('handleProjectPreflight: unknown project (valid id, no such directory) → 404', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflight(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/no-such-project/preflight', 'GET');
    assert.equal(answered, true);
    assert.equal(captured.status, 404);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('handleProjectPreflight: a real project fixture → 200 {clauses, ready}', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    writePreflightableProject(forgeRoot, 'demoproj');
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflight(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/demoproj/preflight', 'GET');
    assert.equal(answered, true);
    assert.equal(captured.status, 200, captured.body);
    const body = JSON.parse(captured.body) as { clauses: unknown[]; ready: boolean };
    assert.ok(Array.isArray(body.clauses) && body.clauses.length > 0, 'runPreflight must have produced clause results');
    assert.equal(typeof body.ready, 'boolean');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('handleProjectPreflight: a non-matching url/method declines', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflight(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/demoproj/repo-status', 'GET');
    assert.equal(answered, false);
    assert.equal(captured.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// GET /api/studio/projects/:id/repo-status
// ---------------------------------------------------------------------------

test('handleProjectRepoStatus: invalid project id → 400', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectRepoStatus(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/..%2fetc/repo-status', 'GET');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('handleProjectRepoStatus: unknown project → 404', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectRepoStatus(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/no-such-project/repo-status', 'GET');
    assert.equal(answered, true);
    assert.equal(captured.status, 404);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('handleProjectRepoStatus: a non-git project directory → 200 {pending:false, branch}', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    writePreflightableProject(forgeRoot, 'demoproj');
    const { res, captured } = mockRes();
    const answered = await handleProjectRepoStatus(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/demoproj/repo-status', 'GET');
    assert.equal(answered, true);
    assert.equal(captured.status, 200, captured.body);
    const body = JSON.parse(captured.body) as { pending: boolean; branch: string };
    assert.equal(typeof body.pending, 'boolean');
    assert.equal(body.branch, 'forge-studio');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// GET /api/studio/projects/:id/preflight/fix-agent/:runId
// ---------------------------------------------------------------------------

test('handleProjectPreflightFixAgentStatus: invalid run id → 400', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAgentStatus(
      mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/demoproj/preflight/fix-agent/not a run id', 'GET',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('handleProjectPreflightFixAgentStatus: no event log for the run yet → 200 {ok:true, state:"running"}', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAgentStatus(
      mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/demoproj/preflight/fix-agent/demoproj-C5-abc', 'GET',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 200, captured.body);
    const body = JSON.parse(captured.body) as { ok: boolean; runId: string; state: string; cleared: boolean };
    assert.equal(body.ok, true);
    assert.equal(body.runId, 'demoproj-C5-abc');
    assert.ok(['running', 'cleared', 'not-cleared', 'failed'].includes(body.state));
    assert.equal(body.state, 'running', 'no events.jsonl on disk yet must read as still-running, never an error');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('handleProjectPreflightFixAgentStatus: a terminal "cleared" event log → 200 {state:"cleared", cleared:true}', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const runId = 'demoproj-C5-xyz';
    const runDir = join(forgeRoot, '_logs', `_preflight-fix-${runId}`);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, 'events.jsonl'),
      JSON.stringify({ event_type: 'end', message: 'preflight-fix.end', metadata: { cleared: true } }) + '\n',
      'utf8',
    );
    const { res, captured } = mockRes();
    await handleProjectPreflightFixAgentStatus(
      mockReq(), res, ctxFor(forgeRoot), `/api/studio/projects/demoproj/preflight/fix-agent/${runId}`, 'GET',
    );
    const body = JSON.parse(captured.body) as { state: string; cleared: boolean };
    assert.equal(body.state, 'cleared');
    assert.equal(body.cleared, true);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('handleProjectPreflightFixAgentStatus: a non-matching url declines', async () => {
  const forgeRoot = makeForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAgentStatus(mockReq(), res, ctxFor(forgeRoot), '/api/studio/projects/demoproj/preflight', 'GET');
    assert.equal(answered, false);
    assert.equal(captured.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
