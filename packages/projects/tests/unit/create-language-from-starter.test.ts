/**
 * Bead `forge-8vfn.6.11.33` — `CreationManifest.language` is required and both
 * production callers (`bridge-studio-project-onboard.ts`'s create route,
 * `apps/forge/cli.ts`'s `runCreate`) used to hardcode `'typescript'` instead of
 * reading it from the CHOSEN starter's own declaration
 * (`describeProjectStarters`, `packages/kernel/config.ts`, bead 6.11.4).
 *
 * THIS FILE drives the ROUTE (`handleProjectsCreate`), not `scaffoldGreenfieldProject`
 * directly — every existing `project-create.ts` test passes an explicit
 * `language` into the manifest already, so calling the function directly can
 * never exercise the resolution this bead adds. The CLI half is proven
 * separately by `apps/forge/tests/unit/cli-create.test.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';

import { type RouteContext } from '@forge/kernel';
import { makeOnboardHandlers } from '../../bridge-studio-project-onboard.ts';

type Captured = { status: number | null; body: string };

function mockRes(): { res: ServerResponse; captured: Captured } {
  const captured: Captured = { status: null, body: '' };
  const res = {
    writeHead(status: number) { captured.status = status; return res; },
    end(payload?: string) { if (payload !== undefined) captured.body = payload; return res; },
  } as unknown as ServerResponse;
  return { res, captured };
}

const mockReq = () => ({ headers: {} }) as never;

function ctx(forgeRoot: string, body: unknown): RouteContext {
  return { forgeRoot, logsRoot: join(forgeRoot, '_logs'), readBody: async () => body } as RouteContext;
}

/** A forgeRoot with ONE starter directory and NO `starters.json` beside it —
 *  `describeProjectStarters` reports this exact starter with `language: null`
 *  (a real, listed starter that declares nothing), which is the shape this
 *  bead requires a refusal for. */
function forgeRootWithUndeclaredStarter(starterId: string): string {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'create-lang-'));
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'projects'), { recursive: true });
  const tplDir = join(forgeRoot, 'studio', 'starters', 'projects', starterId);
  mkdirSync(tplDir, { recursive: true });
  writeFileSync(join(tplDir, 'README.md'), '# {{TITLE}}\n\n{{NORTH_STAR}}\n', 'utf8');
  return forgeRoot;
}

test('6.11.33 (RED): a REAL starter that declares no language refuses the create, naming the starter', async () => {
  const forgeRoot = forgeRootWithUndeclaredStarter('bare-lang');
  try {
    const { handleProjectsCreate } = makeOnboardHandlers({} as never);
    const { res, captured } = mockRes();
    await handleProjectsCreate(
      mockReq(), res, ctx(forgeRoot, { name: 'x', appType: 'bare-lang', northStar: 'y' }),
      '/api/studio/projects/create', 'POST',
    );
    assert.equal(captured.status, 400);
    const body = JSON.parse(captured.body) as { error: string };
    assert.match(body.error, /"bare-lang"/);
    assert.match(body.error, /declares no language/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('6.11.33: an explicit caller-supplied language still wins over the starter (unchanged)', async () => {
  const forgeRoot = forgeRootWithUndeclaredStarter('bare-lang');
  try {
    const { handleProjectsCreate } = makeOnboardHandlers({} as never);
    const { res, captured } = mockRes();
    await handleProjectsCreate(
      mockReq(), res, ctx(forgeRoot, { name: 'x', appType: 'bare-lang', northStar: 'y', language: 'Go' }),
      '/api/studio/projects/create', 'POST',
    );
    assert.equal(captured.status, 200);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});

test('6.11.33: an appType with no starter at all still 400s as "unknown appType" (not this refusal)', async () => {
  const forgeRoot = mkdtempSync(join(tmpdir(), 'create-lang-'));
  mkdirSync(join(forgeRoot, 'projects'), { recursive: true });
  mkdirSync(join(forgeRoot, 'brain', 'projects'), { recursive: true });
  try {
    const { handleProjectsCreate } = makeOnboardHandlers({} as never);
    const { res, captured } = mockRes();
    await handleProjectsCreate(
      mockReq(), res, ctx(forgeRoot, { name: 'x', appType: 'no-such-starter', northStar: 'y' }),
      '/api/studio/projects/create', 'POST',
    );
    assert.equal(captured.status, 400);
    const body = JSON.parse(captured.body) as { error: string };
    assert.match(body.error, /unknown appType/);
  } finally {
    rmSync(forgeRoot, { recursive: true, force: true });
  }
});
