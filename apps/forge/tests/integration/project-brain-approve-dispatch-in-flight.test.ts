/**
 * Row 206 (forge-8vfn.8.5.56) — the dispatch-site sweep's double-call test
 * for `POST /api/project-brain/approve`, the one spawning route of the
 * `/api/project-brain/*` family (`projectBrainApprove`,
 * `apps/studio/lib/bridge-client-interviews.ts`, called from
 * `SessionProjectBrainPanel.tsx`).
 *
 * REAL SPAWN, deliberately — mirrors `architect-rerun-dispatch-in-flight.test.ts`'s
 * stub-CLI technique (a stand-in `apps/forge/cli.ts` that stays alive).
 *
 * UNLIKE architect/rerun (which never mutates `status.json`), approve WRITES
 * `phase: 'committing'` in the SAME synchronous tail as its spawn call, with
 * no `await` between them — so this route's own new phase gate (this sweep,
 * same PR) refuses a second sequential call BEFORE it ever reaches the seam:
 * the first call's whole read-check-write-spawn sequence runs to completion
 * (Node never yields mid-sequence; the route's only `await` is `readBody()`,
 * before any of this), so the second call always sees phase `committing`
 * already, never a live `DispatchInFlight`. That is still "no double spawn"
 * — the outcome row 206 cares about — proven here by the phase gate rather
 * than the seam, which is the honest, reachable shape for this specific
 * route (`bridge-agent-dispatch-one-start.test.ts` already proves the seam
 * itself refuses a live double-dispatch directly, agentId-agnostically).
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

test('row 206 (double-call, real spawn): two sequential /api/project-brain/approve calls for the same session -> exactly one child born, the second refused (409)', async () => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'pbrain-approve-dispatch-in-flight-'));
  writeStubCli(forgeRoot);
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;

  const sid = '2026-05-29T22-00-00';
  const dir = join(forgeRoot, '_logs', '_sessions', 'demo', '_project-brain', sid);
  mkdirSync(join(forgeRoot, 'projects', 'demo'), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'status.json'),
    JSON.stringify({
      session_id: sid, project: 'demo', project_repo_path: join(forgeRoot, 'projects', 'demo'),
      phase: 'awaiting-review', prompt: 'x', updated_at: new Date().toISOString(),
    }),
  );

  ({ url, close } = await startBridge({ forgeRoot, port: 0 }));

  const approve = () => fetch(`${url}/api/project-brain/approve`, {
    method: 'POST', headers: CSRF, body: JSON.stringify({ project: 'demo', sessionId: sid }),
  });

  const first = await approve();
  assert.equal(first.status, 200, `first approve must spawn, got ${first.status}: ${await first.text()}`);
  await waitFor(() => existsSync(join(forgeRoot, 'spawned.json')), 5000);
  const spawned = JSON.parse(readFileSync(join(forgeRoot, 'spawned.json'), 'utf8')) as { pid: number };
  livePids.push(spawned.pid);

  const second = await approve();
  const secondText = await second.text();
  assert.equal(second.status, 409, `a second approve after the first has already transitioned the session must 409, got ${second.status}: ${secondText}`);
  const secondBody = JSON.parse(secondText) as { error?: string };
  assert.match(String(secondBody.error), /committing/, 'the refusal must name the phase the first approve already advanced the session to');

  // Only one child was ever born — the refused second call never spawned,
  // so the stub's own argv-capture file still names the FIRST (and only) pid.
  const stillSpawned = JSON.parse(readFileSync(join(forgeRoot, 'spawned.json'), 'utf8')) as { pid: number };
  assert.equal(stillSpawned.pid, spawned.pid, 'the refused second approve must not have spawned a second child');

  process.kill(spawned.pid, 'SIGTERM');
});
