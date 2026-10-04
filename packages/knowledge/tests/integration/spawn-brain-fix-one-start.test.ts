/**
 * HIGH-1 (row 206 follow-up, forge-8vfn.8.5.56) — `spawnBrainFix`
 * (bridge-studio-kb-routes-maintenance.ts) is a raw spawn with no claim. It
 * must go through the SAME dispatch claim the agent-dispatch seam uses
 * (`claimDispatchSlot`/`releaseDispatchSlot`, `@forge/kernel`), so two
 * dispatches for the same runId never spawn two children.
 *
 * REAL SPAWN, deliberately — mirrors
 * apps/forge/tests/integration/bridge-agent-dispatch-one-start.test.ts's own
 * stand-in-CLI technique.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { spawnBrainFix } from '../../bridge-studio-kb-routes-maintenance.ts';
import { DispatchInFlight } from '@forge/kernel';

let forgeRoot: string;
const savedNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
const savedDryBridge = process.env.FORGE_DRY_BRIDGE;
const livePids: number[] = [];

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

before(() => {
  forgeRoot = mkdtempSync(join(tmpdir(), 'spawn-brain-fix-one-start-'));
  mkdirSync(join(forgeRoot, '_logs'), { recursive: true });
  writeStubCli(forgeRoot);
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
});

after(() => {
  for (const pid of livePids) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  if (savedNoSpawn !== undefined) process.env.FORGE_ARCHITECT_NO_SPAWN = savedNoSpawn; else delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  if (savedDryBridge !== undefined) process.env.FORGE_DRY_BRIDGE = savedDryBridge; else delete process.env.FORGE_DRY_BRIDGE;
  if (forgeRoot) rmSync(forgeRoot, { recursive: true, force: true });
});

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timed out waiting for condition');
}

function readTurnPid(runId: string): number {
  const raw = readFileSync(join(forgeRoot, '_logs', `_brainfix-${runId}`, 'turn.pid'), 'utf8');
  return Number.parseInt(raw.trim(), 10);
}

async function waitForExit(pid: number, timeoutMs = 5000): Promise<void> {
  await waitFor(() => {
    try { process.kill(pid, 0); return false; } catch { return true; }
  }, timeoutMs);
}

/** `isTurnAlive` stand-in: real liveness proof is `@forge/sessions`' own
 *  (rank 4, unavailable here); process.kill(pid, 0) is enough to tell this
 *  stub child apart from a dead pid for this test's purpose. */
function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('row 206 (spawnBrainFix): two dispatches for one runId -> exactly one child born, the second refused as a typed DispatchInFlight', async () => {
  const runId = `row206-brainfix-${Date.now()}`;
  const p = { kbId: 'cycles', file: '/brain/cycles/themes/x.md', check: 'checkFrontmatter', kind: 'frontmatter.missing-field', message: 'msg', runId };

  spawnBrainFix(forgeRoot, p, isAlive);
  await waitFor(() => existsSync(join(forgeRoot, 'spawned.json')), 5000);
  const spawnedPid = readTurnPid(runId);
  assert.ok(Number.isInteger(spawnedPid) && spawnedPid > 1, `turn.pid must name the real child, got ${spawnedPid}`);
  livePids.push(spawnedPid);

  assert.throws(
    () => spawnBrainFix(forgeRoot, p, isAlive),
    (err: unknown) => {
      assert.ok(err instanceof DispatchInFlight, `expected a typed DispatchInFlight, got ${err}`);
      assert.equal((err as DispatchInFlight).holderPid, spawnedPid);
      return true;
    },
    'a second dispatch for an in-flight runId must throw DispatchInFlight, not spawn a second child',
  );
  assert.equal(readTurnPid(runId), spawnedPid, 'the refused second dispatch must not overwrite the live holder\'s turn.pid');

  process.kill(spawnedPid, 'SIGTERM');
  await waitForExit(spawnedPid);
});
