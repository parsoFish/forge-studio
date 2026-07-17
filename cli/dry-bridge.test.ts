/**
 * Tests for cli/dry-bridge.ts — the R5-01-F1 dry-bridge seam.
 *
 * Motivated by the 2026-07-16 incident: the Studio bridge self-merged a forge
 * PR with the operator's real gh token during a ui:journey harness run.
 * FORGE_DRY_BRIDGE=1 makes every real-acting bridge route refuse (or, for the
 * verdict-approve special case, stub out only the real-acting sub-steps)
 * instead of silently doing nothing OR silently doing the real thing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  DRY_BRIDGE_ENV,
  isDryBridge,
  BRIDGE_ROUTE_CLASSIFICATION,
  refuseDryBridge,
  emitDryBridgeSkip,
  dryBridgeAgentTurnMarker,
  DRY_BRIDGE_LOG_BUCKET,
} from './dry-bridge.ts';
import { createLogger } from '../orchestrator/logging.ts';

// ---------------------------------------------------------------------------
// isDryBridge()
// ---------------------------------------------------------------------------

test('DRY_BRIDGE_ENV names the env var (single source of truth)', () => {
  assert.equal(DRY_BRIDGE_ENV, 'FORGE_DRY_BRIDGE');
});

test('isDryBridge() is false when the env var is unset', () => {
  assert.equal(isDryBridge({}), false);
});

test('isDryBridge() is false for any value other than the literal "1"', () => {
  assert.equal(isDryBridge({ FORGE_DRY_BRIDGE: 'true' }), false);
  assert.equal(isDryBridge({ FORGE_DRY_BRIDGE: '0' }), false);
  assert.equal(isDryBridge({ FORGE_DRY_BRIDGE: '' }), false);
});

test('isDryBridge() is true when FORGE_DRY_BRIDGE=1', () => {
  assert.equal(isDryBridge({ FORGE_DRY_BRIDGE: '1' }), true);
});

test('isDryBridge() defaults to reading process.env when called with no argument', () => {
  const prior = process.env[DRY_BRIDGE_ENV];
  try {
    delete process.env[DRY_BRIDGE_ENV];
    assert.equal(isDryBridge(), false);
    process.env[DRY_BRIDGE_ENV] = '1';
    assert.equal(isDryBridge(), true);
  } finally {
    if (prior === undefined) delete process.env[DRY_BRIDGE_ENV];
    else process.env[DRY_BRIDGE_ENV] = prior;
  }
});

// ---------------------------------------------------------------------------
// BRIDGE_ROUTE_CLASSIFICATION — the coverage table (data, not prose)
// ---------------------------------------------------------------------------

test('BRIDGE_ROUTE_CLASSIFICATION is a non-empty array of well-typed rows', () => {
  assert.ok(Array.isArray(BRIDGE_ROUTE_CLASSIFICATION));
  assert.ok(BRIDGE_ROUTE_CLASSIFICATION.length > 20, 'expected broad route coverage');
  const validClass = new Set(['refuse', 'stub-actions', 'exempt-local', 'read-only']);
  const validAction = new Set(['spawn-agent', 'git-remote', 'daemon']);
  for (const row of BRIDGE_ROUTE_CLASSIFICATION) {
    assert.ok(row.method, `row missing method: ${JSON.stringify(row)}`);
    assert.ok(row.route, `row missing route: ${JSON.stringify(row)}`);
    assert.ok(validClass.has(row.classification), `bad classification: ${JSON.stringify(row)}`);
    assert.ok(row.reason && row.reason.length > 0, `row missing reason: ${JSON.stringify(row)}`);
    if (row.classification === 'refuse') {
      assert.ok(row.action && validAction.has(row.action), `refuse row missing/bad action: ${JSON.stringify(row)}`);
    }
  }
});

test('BRIDGE_ROUTE_CLASSIFICATION has no duplicate method+route pairs', () => {
  const seen = new Set<string>();
  for (const row of BRIDGE_ROUTE_CLASSIFICATION) {
    const key = `${row.method} ${row.route}`;
    assert.ok(!seen.has(key), `duplicate route entry: ${key}`);
    seen.add(key);
  }
});

function classify(method: string, route: string): (typeof BRIDGE_ROUTE_CLASSIFICATION)[number] | undefined {
  return BRIDGE_ROUTE_CLASSIFICATION.find((r) => r.method === method && r.route === route);
}

test('scheduler start/stop are refuse/daemon', () => {
  assert.equal(classify('POST', '/api/scheduler/start')?.classification, 'refuse');
  assert.equal(classify('POST', '/api/scheduler/start')?.action, 'daemon');
  assert.equal(classify('POST', '/api/scheduler/stop')?.classification, 'refuse');
  assert.equal(classify('POST', '/api/scheduler/stop')?.action, 'daemon');
});

test('scheduler pause/resume are exempt-local (flag file only)', () => {
  assert.equal(classify('POST', '/api/scheduler/pause')?.classification, 'exempt-local');
  assert.equal(classify('POST', '/api/scheduler/resume')?.classification, 'exempt-local');
});

test('verdict routes are stub-actions, not full refuse', () => {
  assert.equal(classify('POST', '/api/verdict')?.classification, 'stub-actions');
  assert.equal(classify('POST', '/api/runs/:id/gates/verdict')?.classification, 'stub-actions');
});

test('reflect answer, recovery abandon/requeue, runs resume, save-repo, PUT project are refuse', () => {
  assert.equal(classify('POST', '/api/reflect/:cycleId/answer')?.classification, 'refuse');
  assert.equal(classify('POST', '/api/reflect/:cycleId/answer')?.action, 'spawn-agent');
  assert.equal(classify('POST', '/api/recovery/:id/abandon')?.classification, 'refuse');
  assert.equal(classify('POST', '/api/recovery/:id/abandon')?.action, 'git-remote');
  assert.equal(classify('POST', '/api/recovery/:id/requeue')?.classification, 'refuse');
  assert.equal(classify('POST', '/api/runs/:id/resume')?.classification, 'refuse');
  assert.equal(classify('POST', '/api/studio/projects/:id/save-repo')?.classification, 'refuse');
  assert.equal(classify('PUT', '/api/studio/projects/:id')?.classification, 'refuse');
  assert.equal(classify('PUT', '/api/studio/projects/:id')?.action, 'git-remote');
});

test('KB maintenance op=fix-agent is refuse/spawn-agent; op=lint|fix-auto|index is exempt-local', () => {
  const fixAgent = classify('POST', '/api/studio/kbs/:id/maintenance (op=fix-agent)');
  assert.equal(fixAgent?.classification, 'refuse');
  assert.equal(fixAgent?.action, 'spawn-agent');
  const rest = classify('POST', '/api/studio/kbs/:id/maintenance (op=lint|fix-auto|index)');
  assert.equal(rest?.classification, 'exempt-local');
});

test('the NO_SPAWN-guarded spawn routes are stub-actions via the spawn-helper mechanism (never a 409)', () => {
  const spawnRoutes: Array<[string, string]> = [
    ['POST', '/api/architect/start'],
    ['POST', '/api/architect/answer'],
    ['POST', '/api/plan-verdict'],
    ['POST', '/api/runs/:id/gates/plan'],
    ['POST', '/api/instructions/brief'],
    ['POST', '/api/instructions/answer'],
    ['POST', '/api/instructions/verdict'],
    ['POST', '/api/project-brain/brief'],
    ['POST', '/api/project-brain/approve'],
    ['POST', '/api/demo-builder/brief'],
    ['POST', '/api/demo-builder/feedback'],
    ['POST', '/api/demo-builder/lock'],
    ['POST', '/api/demo-builder/abandon'],
    ['POST', '/api/studio/projects/:id/preflight/fix-agent'],
  ];
  for (const [method, route] of spawnRoutes) {
    const row = classify(method, route);
    assert.ok(row, `missing classification row for ${method} ${route}`);
    assert.equal(row?.classification, 'stub-actions', `${method} ${route} — session bookkeeping proceeds, spawn is skipped explicitly`);
    assert.equal(row?.guard, 'spawn-helper', `${method} ${route} suppression lives inside the spawn helper, not a route-level 409`);
  }
});

test('all GET routes are represented as read-only', () => {
  const row = classify('GET', '*');
  assert.equal(row?.classification, 'read-only');
});

// ---------------------------------------------------------------------------
// refuseDryBridge() — the typed 409 + JSONL event
// ---------------------------------------------------------------------------

async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'dry-bridge-'));
  try { await fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('refuseDryBridge() writes the typed 409 body and emits a JSONL refusal event', async () => {
  await withTmp(async (logsRoot) => {
    const server = createServer((_req, res) => {
      refuseDryBridge(res, 'null', {
        route: '/api/scheduler/start',
        method: 'POST',
        action: 'daemon',
        logsRoot,
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/anything`, { method: 'POST' });
      assert.equal(res.status, 409);
      const body = (await res.json()) as Record<string, unknown>;
      assert.deepEqual(body, {
        error: 'dry-bridge',
        route: '/api/scheduler/start',
        method: 'POST',
        action: 'daemon',
      });

      const eventsPath = join(logsRoot, DRY_BRIDGE_LOG_BUCKET, 'events.jsonl');
      const lines = readFileSync(eventsPath, 'utf8').trim().split('\n');
      assert.equal(lines.length, 1);
      const entry = JSON.parse(lines[0]) as Record<string, unknown>;
      assert.equal(entry.message, 'dry-bridge.refuse');
      assert.deepEqual(entry.metadata, { route: '/api/scheduler/start', method: 'POST', action: 'daemon' });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

test('refuseDryBridge() never throws even if the event emit fails (never break the HTTP response)', async () => {
  await withTmp(async (logsRoot) => {
    const server = createServer((_req, res) => {
      // An unwritable logsRoot must not prevent the 409 from being sent.
      refuseDryBridge(res, 'null', {
        route: '/api/scheduler/stop',
        method: 'POST',
        action: 'daemon',
        logsRoot: join(logsRoot, 'does', 'not', 'exist', '\0bad'),
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/anything`, { method: 'POST' });
      assert.equal(res.status, 409);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

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
