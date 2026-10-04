/**
 * Row 206 (forge-8vfn.8.5.56) — the dispatch-site sweep's double-call test
 * for `POST /api/architect/rerun`, the one surviving bespoke route from the
 * sweep that still has forge-ui callers (`rerunArchitectSession`,
 * `apps/studio/lib/bridge-client-interviews.ts`, called from
 * `SessionArchitectPanel.tsx`'s StuckWarning re-run affordance).
 *
 * REAL SPAWN, deliberately (unlike `ui-bridge-architect.test.ts`, which sets
 * `FORGE_ARCHITECT_NO_SPAWN=1` for its whole file) — a stand-in
 * `apps/forge/cli.ts` that stays alive stands in for the real architect
 * runner, mirroring `ui-bridge-authoring-start.test.ts`'s AT-10 technique.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { startBridge } from '../../ui-bridge.ts';

const CSRF = { 'content-type': 'application/json', 'x-forge-csrf': '1' };

let forgeRoot: string;
let url: string;
let close: (() => Promise<void>) | undefined;
const livePids: number[] = [];
const savedNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
const savedDryBridge = process.env.FORGE_DRY_BRIDGE;

/** A stand-in `apps/forge/cli.ts` that stays alive (a plain SIGTERM ends
 *  it) — same technique as `ui-bridge-authoring-start.test.ts`'s AT-10, but
 *  the child does not exit immediately, so this file controls exactly when
 *  the "turn" ends. */
function writeStubCli(root: string): void {
  mkdirSync(join(root, 'apps', 'forge'), { recursive: true });
  writeFileSync(
    join(root, 'apps', 'forge', 'cli.ts'),
    [
      "import { writeFileSync } from 'node:fs';",
      "import { join } from 'node:path';",
      `writeFileSync(join(import.meta.dirname, '..', '..', 'spawned.json'), JSON.stringify({ argv: process.argv.slice(2), pid: process.pid }));`,
      'setInterval(() => {}, 1000);',
      '',
    ].join('\n'),
  );
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for condition');
}

after(async () => {
  for (const pid of livePids) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  if (close) await close();
  if (savedNoSpawn !== undefined) process.env.FORGE_ARCHITECT_NO_SPAWN = savedNoSpawn; else delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  if (savedDryBridge !== undefined) process.env.FORGE_DRY_BRIDGE = savedDryBridge; else delete process.env.FORGE_DRY_BRIDGE;
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

test('row 206 (double-call, real spawn): two concurrent /api/architect/rerun calls for the same session -> exactly one child born, the second 409s as DispatchInFlight', async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'architect-rerun-dispatch-in-flight-'));
  writeStubCli(forgeRoot);
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;

  const sid = '2026-05-29T21-00-00';
  const dir = join(forgeRoot, 'projects', 'demo', '_architect', sid);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({
      session_id: sid, project: 'demo', project_repo_path: dir,
      phase: 'drafting', round: 1, idea: 'stalled idea', updated_at: new Date().toISOString(),
    }),
  );

  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));

  const rerun = () => fetch(`${url}/api/architect/rerun`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'demo', sessionId: sid }),
  });

  const first = await rerun();
  assert.equal(first.status, 200, `first rerun must spawn, got ${first.status}: ${await first.text()}`);
  await waitFor(() => existsSync(join(forgeRoot, 'spawned.json')), 5000);
  const spawned = JSON.parse(readFileSync(join(forgeRoot, 'spawned.json'), 'utf8')) as { pid: number };
  livePids.push(spawned.pid);

  const second = await rerun();
  const secondText = await second.text();
  assert.equal(second.status, 409, `a second rerun while the first turn is still alive must 409, got ${second.status}: ${secondText}`);
  const secondBody = JSON.parse(secondText) as { holderPid?: number; runId?: string };
  assert.equal(secondBody.holderPid, spawned.pid, 'the 409 must name the real holder pid');
  assert.equal(secondBody.runId, sid);

  process.kill(spawned.pid, 'SIGTERM');
});
