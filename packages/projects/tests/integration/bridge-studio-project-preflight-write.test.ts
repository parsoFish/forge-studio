/**
 * project-preflight-write.test.ts — drives `makePreflightWriteHandlers`'s
 * three handlers (save-repo, fix-auto, fix-agent) directly with a fake
 * req/res/ctx, mirroring `packages/knowledge/tests/integration/
 * routes-dispatch.test.ts`'s pattern: no bridge is booted (ruling 5), the
 * body comes from `ctx.readBody()` supplied by the test, and `spawnPreflightFix`
 * is an injected fake so the USER-tier branch of `fix-agent` never launches a
 * real child process.
 *
 * `classifyPreflightFixAgentClause` is also exercised standalone — it is the
 * exported pure half of `fix-agent`, importable without this file's factory
 * at all (the M4-projects routes budget's open question 2: whichever package
 * ultimately registers the route-table ENTRY can reuse it directly).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { makePreflightWriteHandlers, classifyPreflightFixAgentClause, type PreflightWriteDeps } from '../../bridge-studio-project-preflight-write.ts';
import type { RouteContext } from '@forge/kernel';

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

/** An empty, undiscovered-config project dir — no .forge/project.json,
 *  no git, no package.json. `runPreflight` against this fails C1 (user
 *  tier), C2 (auto tier) and C8 (agent tier) simultaneously (measured, not
 *  assumed — see this file's fix-agent tests below), so ONE minimal fixture
 *  exercises all three `fix-agent` resolution branches. */
function setup(): { forgeRoot: string; projectDir: string } {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'ppw-'));
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  const projectDir = join(forgeRoot, 'projects', 'demoproj');
  mkdirSync(projectDir, { recursive: true });
  return { forgeRoot, projectDir };
}

/** A discoverable project that is ALSO a real git repo with one commit on
 *  `main` — `saveProjectRepo`'s minimum requirement (mirrors
 *  `project-repo-tx.test.ts`'s `setupRepo`). */
function setupGitProject(): { forgeRoot: string; projectDir: string } {
  const { forgeRoot, projectDir } = setup();
  execFileSync('git', ['-C', projectDir, 'init', '-b', 'main'], { stdio: 'ignore' });
  execFileSync('git', ['-C', projectDir, 'config', 'user.email', 'test@forge.dev']);
  execFileSync('git', ['-C', projectDir, 'config', 'user.name', 'Forge Test']);
  writeFileSync(join(projectDir, 'README.md'), '# demoproj\n');
  execFileSync('git', ['-C', projectDir, 'add', '-A']);
  execFileSync('git', ['-C', projectDir, 'commit', '-m', 'init'], { stdio: 'ignore' });
  return { forgeRoot, projectDir };
}

function ctx(forgeRoot: string, body?: unknown): RouteContext {
  return {
    forgeRoot,
    logsRoot: join(forgeRoot, '_logs'),
    readBody: async () => {
      if (body === undefined) throw new Error('readBody() called by a handler this test gave no body');
      return body;
    },
  };
}

/** A fake `spawnPreflightFix` dep that records its calls instead of
 *  launching a real detached process — the same shape the real
 *  `cli/bridge-studio-writes.ts` export has, minus the child_process spawn. */
function fakeDeps(): PreflightWriteDeps & { calls: Array<{ forgeRoot: string; p: { project: string; clause: string; instruction: string; detail: string; runId: string } }> } {
  const calls: Array<{ forgeRoot: string; p: { project: string; clause: string; instruction: string; detail: string; runId: string } }> = [];
  return {
    calls,
    spawnPreflightFix: (forgeRoot, p) => { calls.push({ forgeRoot, p }); },
  };
}

// ---------------------------------------------------------------------------
// save-repo
// ---------------------------------------------------------------------------

test('save-repo: a non-matching url/method is declined (returns false, nothing sent)', async () => {
  const { forgeRoot } = setup();
  try {
    const { handleProjectSaveRepo } = makePreflightWriteHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectSaveRepo(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/demoproj/save-repo', 'GET');
    assert.equal(answered, false, 'GET must not be claimed — this route is POST-only');
    assert.equal(captured.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('save-repo: under FORGE_DRY_BRIDGE=1, refuses with the typed dry-bridge shape (action: git-remote)', async () => {
  const { forgeRoot } = setup();
  const had = Object.prototype.hasOwnProperty.call(process.env, 'FORGE_DRY_BRIDGE');
  const prev = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    const { handleProjectSaveRepo } = makePreflightWriteHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectSaveRepo(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/demoproj/save-repo', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 409);
    assert.equal(JSON.parse(captured.body).error, 'dry-bridge');
  } finally {
    if (had) process.env.FORGE_DRY_BRIDGE = prev; else delete process.env.FORGE_DRY_BRIDGE;
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('save-repo: an invalid project id is refused before any fs lookup', async () => {
  const { forgeRoot } = setup();
  try {
    const { handleProjectSaveRepo } = makePreflightWriteHandlers(fakeDeps());
    const { res, captured } = mockRes();
    // A single path SEGMENT (so the route's own regex still matches — a
    // multi-segment value like "../escape" fails the `[^/]+` capture group
    // outright and falls through unmatched, which is a different, correct
    // behaviour, not this AT) that nonetheless fails PROJECT_ID_RE (a space
    // is not in `[A-Za-z0-9_-]`).
    const answered = await handleProjectSaveRepo(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/bad%20id/save-repo', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('save-repo: an unknown (undiscovered) project id 404s', async () => {
  const { forgeRoot } = setup();
  try {
    const { handleProjectSaveRepo } = makePreflightWriteHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectSaveRepo(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/ghost/save-repo', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 404);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('save-repo: a real git-backed project merges to main and answers 200', async () => {
  const { forgeRoot, projectDir } = setupGitProject();
  try {
    const { handleProjectSaveRepo } = makePreflightWriteHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectSaveRepo(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/demoproj/save-repo', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 200, `expected 200, got ${captured.status} body=${captured.body}`);
    const body = JSON.parse(captured.body);
    assert.equal(body.ok, true);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
    void projectDir;
  }
});

// ---------------------------------------------------------------------------
// fix-auto
// ---------------------------------------------------------------------------

test('fix-auto: a non-matching url is declined', async () => {
  const { forgeRoot } = setup();
  try {
    const { handleProjectPreflightFixAuto } = makePreflightWriteHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAuto(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/demoproj/preflight/fix-agent', 'POST');
    assert.equal(answered, false);
    assert.equal(captured.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('fix-auto: clears the AUTO-tier clauses (C2/C4) on the empty fixture and reports the clause list', async () => {
  const { forgeRoot } = setup();
  try {
    const { handleProjectPreflightFixAuto } = makePreflightWriteHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAuto(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/demoproj/preflight/fix-auto', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 200, `expected 200, got ${captured.status} body=${captured.body}`);
    const body = JSON.parse(captured.body);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.applied) && body.applied.some((a: { clause: string }) => a.clause === 'C2'), `C2 should auto-clear; applied=${JSON.stringify(body.applied)}`);
    assert.ok(Array.isArray(body.clauses), 'the after-fix clause DTOs must be reported');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// fix-agent — the three-tier classify/spawn split
// ---------------------------------------------------------------------------

test('fix-agent: a non-matching url is declined', async () => {
  const { forgeRoot } = setup();
  try {
    const { handleProjectPreflightFixAgent } = makePreflightWriteHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAgent(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/demoproj/preflight/fix-auto', 'POST');
    assert.equal(answered, false);
    assert.equal(captured.status, null);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('fix-agent: a body with no clauseId is refused 400', async () => {
  const { forgeRoot } = setup();
  try {
    const { handleProjectPreflightFixAgent } = makePreflightWriteHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAgent(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/demoproj/preflight/fix-agent', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('fix-agent: an unknown clauseId 404s', async () => {
  const { forgeRoot } = setup();
  try {
    const { handleProjectPreflightFixAgent } = makePreflightWriteHandlers(fakeDeps());
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAgent(mockReq(), res, ctx(forgeRoot, { clauseId: 'NOPE' }), '/api/studio/projects/demoproj/preflight/fix-agent', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 404);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('fix-agent: an AUTO-tier clause (C2) is refused with route:"auto" — use fix-auto instead', async () => {
  const { forgeRoot } = setup();
  try {
    const deps = fakeDeps();
    const { handleProjectPreflightFixAgent } = makePreflightWriteHandlers(deps);
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAgent(mockReq(), res, ctx(forgeRoot, { clauseId: 'C2' }), '/api/studio/projects/demoproj/preflight/fix-agent', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
    assert.equal(JSON.parse(captured.body).route, 'auto');
    assert.equal(deps.calls.length, 0, 'an auto-tier clause must never spawn');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('fix-agent: an AGENT-tier clause (C8) hands back its route/fixHint and does NOT spawn', async () => {
  const { forgeRoot } = setup();
  try {
    const deps = fakeDeps();
    const { handleProjectPreflightFixAgent } = makePreflightWriteHandlers(deps);
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAgent(mockReq(), res, ctx(forgeRoot, { clauseId: 'C8' }), '/api/studio/projects/demoproj/preflight/fix-agent', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 200, `expected 200, got ${captured.status} body=${captured.body}`);
    const body = JSON.parse(captured.body);
    assert.equal(body.resolution, 'agent');
    assert.equal(body.route, 'instructions');
    assert.equal(deps.calls.length, 0, 'an agent-tier clause must never spawn spawnPreflightFix');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('fix-agent: a USER-tier clause (C1) spawns via the injected dep with the runId it reports, and marks the agent turn', async () => {
  const { forgeRoot } = setup();
  try {
    const deps = fakeDeps();
    const { handleProjectPreflightFixAgent } = makePreflightWriteHandlers(deps);
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAgent(
      mockReq(), res, ctx(forgeRoot, { clauseId: 'C1', instruction: 'use npm test' }),
      '/api/studio/projects/demoproj/preflight/fix-agent', 'POST',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 200, `expected 200, got ${captured.status} body=${captured.body}`);
    const body = JSON.parse(captured.body);
    assert.equal(body.resolution, 'user');
    assert.equal(body.route, 'preflight-fix');
    assert.equal(typeof body.runId, 'string');
    assert.equal(deps.calls.length, 1, 'the USER tier must spawn exactly once');
    assert.equal(deps.calls[0]!.p.project, 'demoproj');
    assert.equal(deps.calls[0]!.p.clause, 'C1');
    assert.equal(deps.calls[0]!.p.instruction, 'use npm test');
    assert.equal(deps.calls[0]!.p.runId, body.runId);
    assert.equal(deps.calls[0]!.forgeRoot, forgeRoot);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('fix-agent: a spawn failure from the injected dep is reported as a 500, not silently swallowed', async () => {
  const { forgeRoot } = setup();
  try {
    const deps: PreflightWriteDeps = { spawnPreflightFix: () => { throw new Error('boom'); } };
    const { handleProjectPreflightFixAgent } = makePreflightWriteHandlers(deps);
    const { res, captured } = mockRes();
    const answered = await handleProjectPreflightFixAgent(mockReq(), res, ctx(forgeRoot, { clauseId: 'C1' }), '/api/studio/projects/demoproj/preflight/fix-agent', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 500);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// classifyPreflightFixAgentClause — the standalone pure half
// ---------------------------------------------------------------------------

test('classifyPreflightFixAgentClause: reproduces the same three tiers a bare function call, no handler/ctx needed', () => {
  const { forgeRoot, projectDir } = setup();
  try {
    assert.deepEqual(classifyPreflightFixAgentClause(projectDir, forgeRoot, 'NOPE'), { kind: 'not-found' });
    assert.deepEqual(classifyPreflightFixAgentClause(projectDir, forgeRoot, 'C2'), { kind: 'auto' });
    const agent = classifyPreflightFixAgentClause(projectDir, forgeRoot, 'C8');
    assert.equal(agent.kind, 'agent');
    const user = classifyPreflightFixAgentClause(projectDir, forgeRoot, 'C1');
    assert.equal(user.kind, 'user');
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
