/**
 * bridge-studio-project-reset.test.ts — S3 (1.0.md §3), "Rebuild contract".
 *
 * Drives `handleProjectContractResetDryRun` / `handleProjectContractResetApply`
 * directly with a fake req/res/ctx — mirrors
 * `bridge-studio-project-preflight-write.test.ts`'s pattern: no bridge is
 * ever booted (a PACKAGE test never boots the bridge, per this lane's brief),
 * and the body comes from `ctx.readBody()` supplied by the test.
 *
 * Covers: the dry-run computes and returns a real drift report while
 * writing NOTHING (byte-level, not "same file count"); an unresolvable app
 * type surfaces as a readable, typed 400 (`{error, availableAppTypes}`)
 * through BOTH routes, never a bare 500; an explicit `appType` in the body
 * resolves cleanly with no persisted `config.appType`; apply actually
 * writes the regenerated sections and reports them; non-matching url/method
 * and malformed-JSON-body edges.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  handleProjectContractResetDryRun,
  handleProjectContractResetApply,
} from '../../bridge-studio-project-reset.ts';
import { projectStartersDir, FORGE_ROOT, type RouteContext } from '@forge/kernel';

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

function ctx(forgeRoot: string, body: unknown = {}): RouteContext {
  return {
    forgeRoot,
    logsRoot: join(forgeRoot, '_logs'),
    readBody: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

/** A forgeRoot carrying a real copy of the shipped app-type starters — the
 *  same fixture shape `reset-app-type-required.test.ts` /
 *  `reset-drift-report.test.ts` use, plus the `projects/` dir this route's
 *  own `resolveProjectsDir` default resolves into (`resolveManagedProject`'s
 *  fixtures don't need it; this route mirrors `cmdProjectReset`'s own
 *  resolution instead — see the production file's header). */
function isolatedForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pcr-forge-'));
  const startersDest = join(root, 'studio', 'starters', 'projects');
  mkdirSync(startersDest, { recursive: true });
  cpSync(projectStartersDir(FORGE_ROOT), startersDest, { recursive: true });
  mkdirSync(join(root, 'projects'), { recursive: true });
  return root;
}

/** A project under `<forgeRoot>/projects/<id>`, shaped like
 *  `terraform-provider-betterado` — onboarded (predates `appType`), no
 *  persisted app type. */
function driftedProjectNoAppType(forgeRoot: string, id: string): string {
  const dir = join(forgeRoot, 'projects', id);
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    `${JSON.stringify({ name: id, testProcess: { local: { cmd: ['echo', 'ok'] } } }, null, 2)}\n`,
    'utf8',
  );
  return dir;
}

/** A project WITH a persisted `appType` — never needs the control's
 *  app-type field. */
function projectWithAppType(forgeRoot: string, id: string, appType: string): string {
  const dir = join(forgeRoot, 'projects', id);
  mkdirSync(join(dir, '.forge'), { recursive: true });
  writeFileSync(
    join(dir, '.forge', 'project.json'),
    `${JSON.stringify({ name: id, appType, testProcess: { local: { cmd: ['echo', 'ok'] } } }, null, 2)}\n`,
    'utf8',
  );
  return dir;
}

/** Every path under `dir` (relative) AND, for files, their content — proves
 *  "writes nothing" at the byte level, mirroring
 *  `reset-drift-report.test.ts`'s own `snapshotTree`. */
function snapshotTree(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = abs.slice(root.length + 1);
      if (entry.isDirectory()) {
        out.set(`${rel}/`, '<dir>');
        walk(abs);
      } else {
        out.set(rel, readFileSync(abs, 'utf8'));
      }
    }
  };
  walk(root);
  return out;
}

function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Dry-run — non-matching url/method
// ---------------------------------------------------------------------------

test('dry-run: a non-matching method is declined (returns false, nothing sent)', async () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetDryRun(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/demoproj/contract-reset', 'GET');
    assert.equal(answered, false, 'GET must not be claimed — this route is POST-only');
    assert.equal(captured.status, null);
  } finally {
    cleanup(forgeRoot);
  }
});

test('dry-run: the apply URL is not claimed by the dry-run handler', async () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetDryRun(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/demoproj/contract-reset/apply', 'POST');
    assert.equal(answered, false, 'the /apply suffix belongs to the apply handler only');
    assert.equal(captured.status, null);
  } finally {
    cleanup(forgeRoot);
  }
});

test('dry-run: an invalid project id is refused 400 before any fs lookup', async () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetDryRun(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/bad%20id/contract-reset', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
  } finally {
    cleanup(forgeRoot);
  }
});

test('dry-run: an unknown project id 404s', async () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetDryRun(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/nosuchproj/contract-reset', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 404);
  } finally {
    cleanup(forgeRoot);
  }
});

test('dry-run: a malformed JSON body is refused 400', async () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = projectWithAppType(forgeRoot, 'demoproj', 'typescript-cli');
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetDryRun(
      mockReq(), res, ctx(forgeRoot, new Error('bad json')), '/api/studio/projects/demoproj/contract-reset', 'POST',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
  } finally {
    cleanup(forgeRoot, projectDir);
  }
});

// ---------------------------------------------------------------------------
// Dry-run — the drift report, and that it writes nothing
// ---------------------------------------------------------------------------

test('dry-run: computes and returns a real drift report, and writes NOTHING at all (byte-level snapshot)', async () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = projectWithAppType(forgeRoot, 'demoproj', 'typescript-cli');
  try {
    const before = snapshotTree(projectDir);
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetDryRun(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/demoproj/contract-reset', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 200);
    const body = JSON.parse(captured.body);
    assert.equal(body.ok, true);
    assert.equal(body.drift.projectId, 'demoproj');
    assert.equal(body.drift.appType, 'typescript-cli');
    assert.ok(Array.isArray(body.drift.rows) && body.drift.rows.length > 0, 'a real DriftReport carries rows');
    for (const row of body.drift.rows) {
      assert.ok(typeof row.section === 'string' && row.section.length > 0);
      assert.ok(['regenerate', 'preserve', 'add', 'unchanged'].includes(row.action));
    }
    const after = snapshotTree(projectDir);
    assert.deepEqual(after, before, 'computeContractDrift is PURE — the dry-run route must write nothing at all');
  } finally {
    cleanup(forgeRoot, projectDir);
  }
});

test('dry-run: an explicit appType in the body resolves cleanly even with NO persisted appType', async () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = driftedProjectNoAppType(forgeRoot, 'demoproj');
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetDryRun(
      mockReq(), res, ctx(forgeRoot, { appType: 'typescript-cli' }), '/api/studio/projects/demoproj/contract-reset', 'POST',
    );
    assert.equal(answered, true);
    assert.equal(captured.status, 200);
    const body = JSON.parse(captured.body);
    assert.equal(body.drift.appType, 'typescript-cli');
  } finally {
    cleanup(forgeRoot, projectDir);
  }
});

// ---------------------------------------------------------------------------
// The app-type error-sentinel — a readable 400, never a bare 500
// ---------------------------------------------------------------------------

test('dry-run: an unresolvable app type surfaces as a readable 400 with availableAppTypes, never a bare 500', async () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = driftedProjectNoAppType(forgeRoot, 'demoproj');
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetDryRun(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/demoproj/contract-reset', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 400, 'AppTypeUnresolvedError must answer 400 (readable, actionable), not 500');
    const body = JSON.parse(captured.body);
    assert.match(body.error, /--app-type|appType/i, 'the message must be readable, not the bare error class name');
    assert.deepEqual(
      [...body.availableAppTypes].sort(),
      ['typescript-api', 'typescript-cli', 'typescript-web'],
      'the control populates its app-type field from EXACTLY this list',
    );
  } finally {
    cleanup(forgeRoot, projectDir);
  }
});

test('apply: an unresolvable app type ALSO surfaces as a readable 400, and writes nothing', async () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = driftedProjectNoAppType(forgeRoot, 'demoproj');
  try {
    const before = snapshotTree(projectDir);
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetApply(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/demoproj/contract-reset/apply', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 400);
    const body = JSON.parse(captured.body);
    assert.ok(Array.isArray(body.availableAppTypes) && body.availableAppTypes.length === 3);
    assert.deepEqual(snapshotTree(projectDir), before, 'an unresolved app type must never reach applyContractReset\'s write path');
  } finally {
    cleanup(forgeRoot, projectDir);
  }
});

// ---------------------------------------------------------------------------
// Apply — actually writes the regenerated sections
// ---------------------------------------------------------------------------

test('apply: writes the regenerated sections and reports them', async () => {
  const forgeRoot = isolatedForgeRoot();
  const projectDir = projectWithAppType(forgeRoot, 'demoproj', 'typescript-cli');
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetApply(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/demoproj/contract-reset/apply', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 200);
    const body = JSON.parse(captured.body);
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.result.applied), 'ResetResult.applied must be a real array');
    assert.ok(typeof body.result.preflight === 'object' && body.result.preflight !== null, 'apply re-runs preflight and reports it');

    const written = JSON.parse(readFileSync(join(projectDir, '.forge', 'project.json'), 'utf8'));
    assert.equal(written.appType, 'typescript-cli', 'the persisted appType survives the reset untouched');
  } finally {
    cleanup(forgeRoot, projectDir);
  }
});

test('apply: a non-matching method is declined (returns false, nothing sent)', async () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetApply(mockReq(), res, ctx(forgeRoot), '/api/studio/projects/demoproj/contract-reset/apply', 'GET');
    assert.equal(answered, false);
    assert.equal(captured.status, null);
  } finally {
    cleanup(forgeRoot);
  }
});

test('apply: an unknown project id 404s and writes nothing', async () => {
  const forgeRoot = isolatedForgeRoot();
  try {
    const { res, captured } = mockRes();
    const answered = await handleProjectContractResetApply(mockReq(), res, ctx(forgeRoot, {}), '/api/studio/projects/nosuchproj/contract-reset/apply', 'POST');
    assert.equal(answered, true);
    assert.equal(captured.status, 404);
  } finally {
    cleanup(forgeRoot);
  }
});
