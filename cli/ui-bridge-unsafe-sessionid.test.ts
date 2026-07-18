/**
 * R2-01 final-review fix (e) — `spawnAgentTurn`'s sessionId path-traversal
 * guard (`isSafeRunId`, `orchestrator/run-agent.ts`).
 *
 * Both `FORGE_ARCHITECT_NO_SPAWN` and `FORGE_DRY_BRIDGE` are deliberately
 * UNSET here so this exercises the guard added in fix (e), not either of the
 * two pre-existing harness-safety short-circuits earlier in `spawnAgentTurn`
 * — both of which would otherwise mask a regression by returning before the
 * sessionId guard ever runs.
 *
 * Safety: with both harness-safety vars unset, a broken/removed guard would
 * fall through to a real `spawn(...)` — but cwd is this test's tmp
 * forgeRoot, which has no `orchestrator/cli.ts`, so the child process fails
 * fast (ENOENT) inside `spawnAgentTurn`'s own best-effort try/catch; nothing
 * escapes the sandbox (same reasoning `ui-bridge-dry-spawn.test.ts`
 * documents for its own NO_SPAWN-unset case).
 *
 * `sessionId` is crafted as `<real>/../<real>` — a `..`-bearing,
 * multi-segment string that `path.join` algebraically collapses (pure
 * string normalisation, no filesystem lookup) back to the SAME real session
 * directory, so the route's upstream `readSessionStatus` 404 check is
 * satisfied and execution actually reaches `spawnAgentTurn` — but the raw
 * id is exactly the shape `isSafeRunId` must reject (it contains `/`,
 * disallowed by `SAFE_RUN_ID_RE`).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startBridge } from './ui-bridge.ts';

const PROJECT = 'demoproj';

let forgeRoot: string;
let bridgeUrl: string;
let closeServer: () => Promise<void>;
let priorNoSpawn: string | undefined;
let priorDryBridge: string | undefined;

before(async () => {
  priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;

  forgeRoot = mkdtempSync(join(tmpdir(), 'unsafe-sessionid-'));
  mkdirSync(join(forgeRoot, 'projects', PROJECT), { recursive: true });
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });

  ({ url: bridgeUrl, close: closeServer } = await startBridge({ forgeRoot, port: 0 }));
});

after(async () => {
  if (closeServer) await closeServer();
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
  if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
  if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
  else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
});

test('spawnAgentTurn refuses an unsafe sessionId: no _logs dir created, no spawn attempted', async () => {
  const realSessionId = 'sess1';
  const dir = join(forgeRoot, 'projects', PROJECT, '_instructions', realSessionId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({
      session_id: realSessionId,
      project: PROJECT,
      project_repo_path: dir,
      phase: 'briefing',
      mode: 'init',
      round: 1,
      prompt: '',
      updated_at: new Date().toISOString(),
    }),
  );

  // Collapses (via path.join's string-level `..` resolution) to the SAME
  // `dir` above, so the route's upstream session-exists check passes — but
  // is itself an unsafe, multi-segment id `isSafeRunId` must reject.
  const unsafeSessionId = `${realSessionId}/../${realSessionId}`;

  const res = await fetch(`${bridgeUrl}/api/instructions/brief`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forge-csrf': '1' },
    body: JSON.stringify({ project: PROJECT, sessionId: unsafeSessionId, brief: 'x' }),
  });
  const json = await res.json();
  // Best-effort: session bookkeeping still succeeds even though the spawn
  // itself was refused (mirrors spawnAgentTurn's fire-and-forget contract).
  assert.equal(res.status, 200, JSON.stringify(json));

  const logsEntries = existsSync(join(forgeRoot, '_logs')) ? readdirSync(join(forgeRoot, '_logs')) : [];
  assert.ok(
    !logsEntries.some((e) => e.startsWith('_instructions-')),
    `expected no _instructions-* dir under _logs/ for an unsafe sessionId, found: ${JSON.stringify(logsEntries)}`,
  );
});
