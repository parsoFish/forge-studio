/**
 * The demo LOCK step declares every file it writes into the project ground.
 *
 * `forge-qm4d`'s eighth writer, and the first one found by UNBLOCKING a beat
 * rather than by reading code. S1 beat 8 ("come back to the demo builder,
 * brief it, and lock the demo it makes") had never once reached `runLockStep`:
 * the step throws without a `.forge/demo/DEMO.html` in the repo, and until
 * #666 the write pass could not produce one. Six runs of the containment fence
 * therefore measured a code path the story could not enter, and S1 run 7 — the
 * first run to reach the lock — found all three of its writes undeclared:
 *
 *     UNDECLARED A .forge/demo/demo.lock.json
 *     UNDECLARED A .forge/demo/history/<sid>/DEMO.html
 *     UNDECLARED A .forge/demo/history/<sid>/meta.json
 *
 * The paths were never secret. `runLockStep` already emits a `log` event whose
 * `output_refs` name two of them — but the containment fence reads `file_change`
 * and a write tool's `output_refs`, deliberately and by name, because a path
 * appearing in a log at all is not evidence the run wrote it (S1 run 5's
 * architect READ `roadmap.md`, and a looser rule would have licensed it).
 *
 * NOT IMPORTED FROM `demo-builder-runner-fixtures.ts`, which registers its own
 * `test()` calls at module scope: importing it here to reuse `setup()` would
 * re-run that whole suite inside this file. Same shape as §15.394 — a module
 * that acts at import time cannot be imported for a helper.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORGE_ROOT } from '@forge/kernel/ids.ts';
import { createLogger } from '@forge/kernel';
import { runDemoBuilderTurn, demoSessionDir } from '../../kinds/demo-builder.ts';
import {
  DEMO_HTML_REL_PATH,
  DEMO_LOCK_REL_PATH,
  DEMO_SKILL_REL_PATH,
  type DemoBuilderStatus,
} from '../../kinds/demo-session-store.ts';
import { writeSessionStatus, type QueryFn } from '../../interactive-session.ts';

const SESSION_ID = '2026-09-12T00-00-00';

/** A locking turn reaches no agent; the query fn must never be called. */
const noopQueryFn: QueryFn = () => {
  async function* gen(): AsyncGenerator<unknown> {
    yield { type: 'result', total_cost_usd: 0 };
  }
  return gen();
};

/** A repo whose generate pass already left the skill and the sample behind. */
function setupLockable(): { projectRoot: string; repoPath: string; logsRoot: string } {
  const root = mkdtempSync(join(tmpdir(), 'demo-lock-emit-'));
  const projectRoot = join(root, 'project');
  const repoPath = join(root, 'repo');
  mkdirSync(join(repoPath, '.forge', 'demo'), { recursive: true });
  mkdirSync(join(repoPath, '.forge', 'skills', 'demo-design'), { recursive: true });
  writeFileSync(
    join(repoPath, '.forge', 'project.json'),
    JSON.stringify({ testProcess: { local: { cmd: ['npm', 'test'] } }, demoProcess: [] }),
  );
  writeFileSync(join(repoPath, DEMO_SKILL_REL_PATH), '# demo-design');
  writeFileSync(join(repoPath, DEMO_HTML_REL_PATH), '<!DOCTYPE html><html><body>demo</body></html>');

  const sessionDir = demoSessionDir(projectRoot, SESSION_ID);
  mkdirSync(sessionDir, { recursive: true });
  const status: DemoBuilderStatus = {
    session_id: SESSION_ID,
    project: 'demo',
    project_repo_path: repoPath,
    phase: 'locking',
    iteration: 2,
    prompt: 'Show the before/after of the headline command.',
    updated_at: new Date().toISOString(),
  };
  writeSessionStatus(sessionDir, status);
  return { projectRoot, repoPath, logsRoot: join(root, '_logs') };
}

/** What the containment fence reads: `file_change` rows only. */
function fileChangeRows(logsRoot: string): { path: string; op: string; cause: string }[] {
  const raw = readFileSync(join(logsRoot, `_demo-${SESSION_ID}`, 'events.jsonl'), 'utf8');
  return raw
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l) as { event_type?: string; output_refs?: unknown; metadata?: Record<string, unknown> })
    .filter((e) => e.event_type === 'file_change')
    .map((e) => ({
      path: Array.isArray(e.output_refs) ? String(e.output_refs[0]) : '',
      op: String(e.metadata?.op ?? ''),
      cause: String(e.metadata?.cause ?? ''),
    }));
}

test('locking declares all three of its ground writes as file_change rows', async () => {
  const { projectRoot, repoPath, logsRoot } = setupLockable();

  const result = await runDemoBuilderTurn({
    sessionId: SESSION_ID,
    projectRoot,
    forgeRoot: FORGE_ROOT,
    queryFn: noopQueryFn,
    logger: createLogger(`_demo-${SESSION_ID}`, logsRoot),
    logsRoot,
  });
  assert.equal(result.phase, 'locked');

  const declared = fileChangeRows(logsRoot);
  const paths = declared.map((r) => r.path).sort();

  // The three paths S1 run 7 measured as undeclared, named absolutely — the
  // fence discards a relative `output_ref` outright, so an emission that used
  // a bare rel path would read as no emission at all.
  const expected = [
    join(repoPath, DEMO_LOCK_REL_PATH),
    join(repoPath, '.forge', 'demo', 'history', SESSION_ID, 'DEMO.html'),
    join(repoPath, '.forge', 'demo', 'history', SESSION_ID, 'meta.json'),
  ].sort();

  assert.deepEqual(paths, expected, 'every file the lock step writes into the ground is declared');
  for (const row of declared) {
    assert.equal(row.op, 'write', `${row.path} declared as a write`);
    assert.match(row.cause, /lock/i, `${row.path}'s cause names the lock that made it`);
  }
});

test("a re-lock declares demo.lock.json as a MODIFY — the file it overwrote already existed", async () => {
  const { projectRoot, repoPath, logsRoot } = setupLockable();
  // A previous session already locked this project. Only `demo.lock.json`
  // survives a session boundary: `history/<sid>/` is per-session and is always
  // a creation, which is why the two are emitted with different ops.
  writeFileSync(join(repoPath, DEMO_LOCK_REL_PATH), '{"session_id":"2026-09-01T00-00-00"}\n');

  await runDemoBuilderTurn({
    sessionId: SESSION_ID,
    projectRoot,
    forgeRoot: FORGE_ROOT,
    queryFn: noopQueryFn,
    logger: createLogger(`_demo-${SESSION_ID}`, logsRoot),
    logsRoot,
  });

  const byPath = new Map(fileChangeRows(logsRoot).map((r) => [r.path, r.op]));
  assert.equal(
    byPath.get(join(repoPath, DEMO_LOCK_REL_PATH)),
    'modify',
    'the lock overwrote an existing file — read before the write, or every lock looks like a creation',
  );
  assert.equal(
    byPath.get(join(repoPath, '.forge', 'demo', 'history', SESSION_ID, 'DEMO.html')),
    'write',
    'this session\'s history dir is new regardless',
  );
});

test('the lock step emits into the SESSION log, not a fresh bridge run', async () => {
  const { projectRoot, logsRoot } = setupLockable();

  await runDemoBuilderTurn({
    sessionId: SESSION_ID,
    projectRoot,
    forgeRoot: FORGE_ROOT,
    queryFn: noopQueryFn,
    logger: createLogger(`_demo-${SESSION_ID}`, logsRoot),
    logsRoot,
  });

  // `emitGroundFileChanges` opens a bridge run when handed no logger, which
  // would attribute the lock's writes to `_bridge/<id>` instead of the session
  // that made them. The fence accepts either, so nothing goes red — the run
  // just records the wrong author. Assert the session carries them.
  assert.equal(fileChangeRows(logsRoot).length, 3, 'all three rows in the demo session log');
});
