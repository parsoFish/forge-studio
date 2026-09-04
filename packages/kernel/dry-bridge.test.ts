/**
 * Tests for the three dry-bridge symbols lifted here from `apps/forge/dry-bridge.ts`
 * (bead forge-8vfn.24, M5-A): `DryBridgeStubAction`, `emitDryBridgeSkip` and
 * `dryBridgeAgentTurnMarker`. They are event-log shapes, and `emitDryBridgeRefusal`
 * — their sibling, written the same way against the same bucket — has lived in this
 * module since M4. Their previous home meant five packages that need them had to
 * import the ASSEMBLY (`package-to-assembly`, handoff F3); the tests move with the
 * code, unchanged, so the move is provably behaviour-preserving.
 *
 * Motivated by the 2026-07-16 incident: the Studio bridge self-merged a forge PR
 * with the operator's real gh token during a ui:journey harness run.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createLogger, emitDryBridgeSkip, dryBridgeAgentTurnMarker, DRY_BRIDGE_LOG_BUCKET } from './index.ts';

async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'kernel-dry-bridge-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
// ---------------------------------------------------------------------------
// emitDryBridgeSkip() — the stub-actions per-skip event (verdict-approve)
// ---------------------------------------------------------------------------

test('emitDryBridgeSkip() emits one dry-bridge.skip event carrying the action name', async () => {
  await withTmp(async (logsRoot) => {
    const logger = createLogger('INIT-2026-07-17-example', logsRoot);
    emitDryBridgeSkip(logger, 'INIT-2026-07-17-example', 'merge-pr');
    const lines = readFileSync(logger.logFilePath, 'utf8').trim().split('\n');
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    assert.equal(entry.message, 'dry-bridge.skip');
    assert.deepEqual(entry.metadata, { action: 'merge-pr' });
    assert.equal(entry.initiative_id, 'INIT-2026-07-17-example');
  });
});

// ---------------------------------------------------------------------------
// dryBridgeAgentTurnMarker() — the stub-actions marker for the spawn families
// ---------------------------------------------------------------------------

test('dryBridgeAgentTurnMarker() is a no-op when dry-bridge is inactive (NO_SPAWN-only stays byte-identical)', async () => {
  await withTmp(async (logsRoot) => {
    const priorDry = process.env.FORGE_DRY_BRIDGE;
    const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
    delete process.env.FORGE_DRY_BRIDGE;
    process.env.FORGE_ARCHITECT_NO_SPAWN = '1'; // legacy mode alone: no marker, no event
    try {
      const marker = dryBridgeAgentTurnMarker(logsRoot, '/api/architect/start', 'sid-1');
      assert.deepEqual(marker, {}, 'no marker fragment when dry-bridge is off');
      assert.ok(
        !existsSync(join(logsRoot, DRY_BRIDGE_LOG_BUCKET, 'events.jsonl')),
        'no event emitted when dry-bridge is off',
      );
    } finally {
      if (priorDry === undefined) delete process.env.FORGE_DRY_BRIDGE;
      else process.env.FORGE_DRY_BRIDGE = priorDry;
      if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
      else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    }
  });
});

test('dryBridgeAgentTurnMarker() under FORGE_DRY_BRIDGE=1 returns the marker and emits one agent-turn skip event', async () => {
  await withTmp(async (logsRoot) => {
    const priorDry = process.env.FORGE_DRY_BRIDGE;
    process.env.FORGE_DRY_BRIDGE = '1';
    try {
      const marker = dryBridgeAgentTurnMarker(logsRoot, '/api/instructions/brief', 'sid-2');
      assert.deepEqual(marker, { dryBridge: { skipped: ['agent-turn'] } });
      const eventsPath = join(logsRoot, DRY_BRIDGE_LOG_BUCKET, 'events.jsonl');
      const lines = readFileSync(eventsPath, 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);
      const entry = JSON.parse(lines[0]) as { message: string; metadata: Record<string, unknown> };
      assert.equal(entry.message, 'dry-bridge.skip');
      assert.deepEqual(entry.metadata, { action: 'agent-turn', route: '/api/instructions/brief', sessionId: 'sid-2' });
    } finally {
      if (priorDry === undefined) delete process.env.FORGE_DRY_BRIDGE;
      else process.env.FORGE_DRY_BRIDGE = priorDry;
    }
  });
});

// ---------------------------------------------------------------------------
// bead forge-8nw / forge-720 — the run's OWN events.jsonl must carry a
// terminal marker for the ONE standalone-dispatch route
// (POST /api/agents/:slug/run), the file `deriveStandaloneRunState`
// (apps/forge/ui-bridge.ts) actually reads to derive a standalone run's state.
// Before this fix, `dryBridgeAgentTurnMarker` wrote ONLY into the shared
// `DRY_BRIDGE_LOG_BUCKET` — the run's own `<logsRoot>/<runId>/events.jsonl`
// never received a terminal fact, so the run derived `state: 'running'`
// forever (the real zombie `_agent-*` dirs bead forge-720 found on disk).
// ---------------------------------------------------------------------------

async function withDryBridgeEnv(fn: () => Promise<void>): Promise<void> {
  const prior = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    await fn();
  } finally {
    if (prior === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = prior;
  }
}

test('forge-8nw AT-1: dryBridgeAgentTurnMarker() for the standalone dispatch route (/api/agents/:slug/run) writes a terminal marker into the RUN\'S OWN events.jsonl — the exact path deriveStandaloneRunState reads (<logsRoot>/<runId>/events.jsonl) — whose message is one deriveStandaloneStateFromEvents recognises ("run-agent.spawn-suppressed", cli/ui-bridge.ts, same literal orchestrator/run-agent.ts already writes for a REAL suppressed spawn)', async () => {
  await withTmp(async (logsRoot) => {
    await withDryBridgeEnv(async () => {
      const runId = '_agent-forge-8nw-fixture-2026-08-23T00-00-00-000-abcd';

      const marker = dryBridgeAgentTurnMarker(logsRoot, '/api/agents/:slug/run', runId);
      assert.deepEqual(marker, { dryBridge: { skipped: ['agent-turn'] } });

      // Assert on the FILE CONTENT at the exact path deriveStandaloneRunState
      // reads (logsRoot/<runEntryName>/events.jsonl, apps/forge/ui-bridge.ts) — never
      // on a helper's return value, which would look identical whether or not
      // the run's own log was ever touched.
      const ownEventsPath = join(logsRoot, runId, 'events.jsonl');
      assert.ok(existsSync(ownEventsPath), `expected the run's own events.jsonl to exist at ${ownEventsPath} — this is the file deriveStandaloneRunState actually reads`);
      const ownLines = readFileSync(ownEventsPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
      const terminalMarker = ownLines.find((e) => e.message === 'run-agent.spawn-suppressed');
      assert.ok(
        terminalMarker,
        `expected a 'run-agent.spawn-suppressed' event in the run's own events.jsonl — got: ${JSON.stringify(ownLines)}`,
      );

      // The shared bucket still gets its diagnostic event too (unchanged
      // behaviour, not replaced by the fix).
      const bucketPath = join(logsRoot, DRY_BRIDGE_LOG_BUCKET, 'events.jsonl');
      assert.ok(existsSync(bucketPath), 'the shared DRY_BRIDGE_LOG_BUCKET diagnostic event must still be written');
    });
  });
});

test('forge-8nw AT-2 (scope control): dryBridgeAgentTurnMarker() for a SESSION route (e.g. /api/architect/start) does NOT write into <logsRoot>/<sessionId>/ — only the one standalone-dispatch route gets the run\'s-own-log write, so this must not pollute a session\'s directory with a phantom, nobody-reads-it events.jsonl', async () => {
  await withTmp(async (logsRoot) => {
    await withDryBridgeEnv(async () => {
      const sessionId = 'sid-not-a-runid';
      dryBridgeAgentTurnMarker(logsRoot, '/api/architect/start', sessionId);
      const phantomPath = join(logsRoot, sessionId, 'events.jsonl');
      assert.ok(
        !existsSync(phantomPath),
        `a session-kind route must never get the standalone-run write — found an unexpected ${phantomPath}`,
      );
    });
  });
});

test('forge-8nw AT-3 (negative control): dryBridgeAgentTurnMarker() for the standalone dispatch route writes NOTHING (shared bucket OR run log) when dry-bridge is inactive', async () => {
  await withTmp(async (logsRoot) => {
    const priorDry = process.env.FORGE_DRY_BRIDGE;
    delete process.env.FORGE_DRY_BRIDGE;
    try {
      const runId = '_agent-forge-8nw-inactive-2026-08-23T00-00-00-000-wxyz';
      const marker = dryBridgeAgentTurnMarker(logsRoot, '/api/agents/:slug/run', runId);
      assert.deepEqual(marker, {});
      assert.ok(!existsSync(join(logsRoot, runId, 'events.jsonl')), 'no run-own write when dry-bridge is inactive');
      assert.ok(!existsSync(join(logsRoot, DRY_BRIDGE_LOG_BUCKET)), 'no shared-bucket write when dry-bridge is inactive');
    } finally {
      if (priorDry === undefined) delete process.env.FORGE_DRY_BRIDGE;
      else process.env.FORGE_DRY_BRIDGE = priorDry;
    }
  });
});
