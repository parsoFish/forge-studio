/**
 * Bead forge-8vfn.6.6 item 3 — runFinalizeStep's SLUG_RE packageId gate must
 * be conditional on the resolved finalizer actually needing one, not
 * unconditional for every finalizer. RED-NOW: a real instructions-shaped
 * session id (YYYY-MM-DDTHH-mm-ss-<8hex>, which SLUG_RE rejects outright —
 * leading digit) refuses at the gate BEFORE ever reaching writeToRepoRoot,
 * which doesn't use a packageId at all.
 */
import { loadFixtureDescriptor, logger, setup } from './test-fixtures/interactive-runner-fixtures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInteractiveTurn } from '../../interactive-runner.ts';
import { writeSessionStatus } from '../../interactive-session.ts';
import { neverCalledQueryFn } from './test-fixtures/interactive-runner-fixtures.ts';

// A REAL instructions-shaped session id — SLUG_RE requires a leading
// lowercase letter, and this one starts with a digit.
const INSTRUCTIONS_SHAPED_ID = '2026-09-19T00-00-00-a1b2c3d4';

type Status = { session_id: string; phase: string; updated_at: string; project_repo_path?: string; project?: string };

test('committing + finalizer:writeToRepoRoot reaches the finalizer with a real instructions-shaped (non-slug) session id — needsPackageId:false skips the gate', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionDir = join(projectRoot, '_interactivetest-writetorepo', INSTRUCTIONS_SHAPED_ID);
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'AGENTS.draft.md'), '# fixture\n');
  const repoRoot = join(projectRoot, 'target-repo');
  mkdirSync(repoRoot, { recursive: true });
  writeSessionStatus<Status>(sessionDir, {
    session_id: INSTRUCTIONS_SHAPED_ID, phase: 'committing', updated_at: new Date().toISOString(),
    project_repo_path: repoRoot, project: 'fixture-project',
  });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-writetorepo');
  const result = await runInteractiveTurn(descriptor, {
    sessionId: INSTRUCTIONS_SHAPED_ID, projectRoot, forgeRoot, logsRoot,
    queryFn: neverCalledQueryFn(), logger: logger(logsRoot, INSTRUCTIONS_SHAPED_ID),
  });

  assert.equal(result.phase, 'committed');
  const dest = join(repoRoot, 'AGENTS.draft.md');
  assert.ok(existsSync(dest), 'writeToRepoRoot must actually have run');
  assert.equal(readFileSync(dest, 'utf8'), '# fixture\n');
});

test('committing + finalizer:copyStagingToLibrary with the SAME non-slug id still refuses — needsPackageId:true is unchanged', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  mkdirSync(join(forgeRoot, 'library'), { recursive: true });
  mkdirSync(join(forgeRoot, 'studio', 'library'), { recursive: true });
  const sessionDir = join(projectRoot, '_interactivetest', INSTRUCTIONS_SHAPED_ID);
  mkdirSync(join(sessionDir, 'staging'), { recursive: true });
  writeFileSync(join(sessionDir, 'staging', 'README.md'), '# fixture\n');
  writeSessionStatus<Status>(sessionDir, { session_id: INSTRUCTIONS_SHAPED_ID, phase: 'committing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  await assert.rejects(
    () => runInteractiveTurn(descriptor, {
      sessionId: INSTRUCTIONS_SHAPED_ID, projectRoot, forgeRoot, logsRoot,
      queryFn: neverCalledQueryFn(), logger: logger(logsRoot, INSTRUCTIONS_SHAPED_ID),
    }),
    /not a valid slug/,
  );
});
