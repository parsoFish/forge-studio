/**
 * R2-04-F3 (ADR-041) — guard coverage for externally-originated triggers.
 *
 * Two pins:
 *  1. Harness mode: a staged cron/webhook request drained through the REAL
 *     default dispatch performs ONLY queue/fs writes (a pending manifest + the
 *     payload artifact) — no run dir, no events, no spawn. The only path from
 *     a minted manifest to an agent is the scheduler claim, which sits behind
 *     the FORGE_ARCHITECT_NO_SPAWN / dry-bridge perimeter in `runAgent`.
 *  2. The ui:journey seeding guard (`journey-daemon-guard.mjs`) refuses stray
 *     `_queue/flow-runs/` request files exactly like stray manifests — staged
 *     dispatch fuel from a prior run must not leak into a harness run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stageFlowRunRequest, drainFlowRunRequests } from './flow-run-requests.ts';
// @ts-expect-error — plain .mjs harness helper, no type declarations.
import { assertNoLiveDaemon } from '../scripts/lib/journey-daemon-guard.mjs';

const FLOW_YAML = [
  'id: tick',
  'name: Tick',
  'version: 1',
  'goal: Fixture flow for trigger-guard tests.',
  'project: someproj',
  'kb: null',
  'costCeilingUsd: 5',
  'origin: seed',
  'disposable: true',
  'nodes:',
  '  - { id: pm, agent: project-manager }',
  'edges: []',
  'triggers: []',
].join('\n');

function makeForgeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forge-trigger-guard-'));
  mkdirSync(join(root, 'studio', 'flows', 'tick'), { recursive: true });
  writeFileSync(join(root, 'studio', 'flows', 'tick', 'flow.yaml'), FLOW_YAML);
  mkdirSync(join(root, 'projects', 'someproj'), { recursive: true });
  mkdirSync(join(root, '_queue'), { recursive: true });
  return root;
}

test('harness mode: a drained cron origination mints queue state ONLY — no run dir, no events, no spawn surface', () => {
  const root = makeForgeRoot();
  const queueRoot = join(root, '_queue');
  const savedNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const savedDry = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    stageFlowRunRequest(
      {
        target: { kind: 'flow', ref: 'tick' },
        origin: 'cron',
        triggeredBy: 'cron:tick',
        payload: { kind: 'cron', schedule: '0 3 * * *', firedAt: new Date().toISOString() },
      },
      { queueRoot },
    );
    const results = drainFlowRunRequests({ queueRoot, forgeRoot: root });
    assert.deepEqual(results.map((r) => r.status), ['dispatched']);

    // The COMPLETE effect set: one pending manifest + one payload artifact.
    const pending = readdirSync(join(queueRoot, 'pending')).filter((f) => f.endsWith('.md'));
    assert.equal(pending.length, 1, 'exactly one minted manifest');
    const manifest = readFileSync(join(queueRoot, 'pending', pending[0]), 'utf8');
    assert.match(manifest, /^origin: triggered$/m);
    const cycleId = /^cycle_id: (.+)$/m.exec(manifest)?.[1];
    assert.ok(cycleId, 'cycle_id persisted');
    const runDir = join(root, '_logs', cycleId!);
    assert.deepEqual(
      readdirSync(runDir),
      ['artifacts'],
      'the run dir holds ONLY the artifacts dir — no events.jsonl, nothing ran',
    );
    assert.deepEqual(readdirSync(join(runDir, 'artifacts')), ['trigger-payload.json']);
    // Nothing was claimed: the manifest awaits the (NO_SPAWN-guarded) scheduler.
    assert.equal(existsSync(join(queueRoot, 'in-flight', pending[0])), false);
  } finally {
    if (savedNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = savedNoSpawn;
    if (savedDry === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = savedDry;
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// ACCEPTANCE TEST (T3, R2-08-F2 pin #12) — extends the harness-mode pin above
// to the new agent-complete origination: the COMPLETE effect set of firing an
// on: agent-complete trigger under the no-spawn/dry-bridge perimeter is
// enumerated exhaustively, the same way the cron test above does. Depends on
// `fireAgentCompleteTriggers` (pinned in orchestrator/agent-complete-trigger.test.ts)
// — loaded dynamically so a missing export fails only THIS test, not the
// whole file's collection (the two pre-existing tests above must stay green
// regardless of F2's implementation state).
// ---------------------------------------------------------------------------

test('harness mode: an agent-complete fire stages a claimable request ONLY, then drains to a manifest with NO run dir (no payload to persist) — no spawn surface', async () => {
  const mod = (await import('./flow-trigger.ts')) as unknown as Record<string, unknown>;
  const fireAgentCompleteTriggers = mod['fireAgentCompleteTriggers'] as
    | ((
        flows: Array<{ id: string; triggers: unknown[] }>,
        completedAgentSlug: string,
        opts?: { queueRoot?: string },
      ) => Promise<unknown[]>)
    | undefined;
  assert.equal(
    typeof fireAgentCompleteTriggers,
    'function',
    'expected orchestrator/flow-trigger.ts to export fireAgentCompleteTriggers (R2-08-F2 pinned contract — see orchestrator/agent-complete-trigger.test.ts)',
  );

  const root = makeForgeRoot();
  const queueRoot = join(root, '_queue');
  const savedNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const savedDry = process.env.FORGE_DRY_BRIDGE;
  process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
  process.env.FORGE_DRY_BRIDGE = '1';
  try {
    // T1 ruling #1: agent-complete rows require `agent:`, the source slug,
    // matched by identity — the completed slug below must equal it exactly.
    const flows = [{ id: 'watcher', triggers: [{ on: 'agent-complete', target: { kind: 'flow', ref: 'tick' }, agent: 'doc-updater' }] }];
    await fireAgentCompleteTriggers!(flows, 'doc-updater', { queueRoot });

    const staged = readdirSync(join(queueRoot, 'flow-runs')).filter((f) => f.endsWith('.json'));
    assert.equal(staged.length, 1, 'exactly one staged request');

    const results = drainFlowRunRequests({ queueRoot, forgeRoot: root });
    assert.deepEqual(results.map((r) => r.status), ['dispatched']);

    // The COMPLETE effect set: one pending manifest. Unlike the cron/webhook
    // case above, agent-complete carries no payload — mintTriggeredInitiative
    // only creates the artifacts dir (and therefore the run dir) when
    // `req.payload` is present — so NOTHING should exist under `_logs/` at
    // all here. Enumerated exhaustively, not just "no events.jsonl".
    const pending = readdirSync(join(queueRoot, 'pending')).filter((f) => f.endsWith('.md'));
    assert.equal(pending.length, 1, 'exactly one minted manifest');
    const manifest = readFileSync(join(queueRoot, 'pending', pending[0]), 'utf8');
    assert.match(manifest, /^origin: triggered$/m);
    const cycleId = /^cycle_id: (.+)$/m.exec(manifest)?.[1];
    assert.ok(cycleId, 'cycle_id persisted onto the manifest');
    assert.equal(
      existsSync(join(root, '_logs', cycleId!)),
      false,
      'agent-complete origination carries no payload — expect NO run dir at all under _logs/, unlike cron/webhook which persist a trigger-payload artifact',
    );
    // Nothing was claimed: the manifest awaits the (NO_SPAWN-guarded) scheduler.
    assert.equal(existsSync(join(queueRoot, 'in-flight', pending[0])), false);
  } finally {
    if (savedNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = savedNoSpawn;
    if (savedDry === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = savedDry;
    rmSync(root, { recursive: true, force: true });
  }
});

test('journey-daemon-guard refuses a stray staged flow-run request (dispatch fuel must not leak into a harness run)', async () => {
  const root = mkdtempSync(join(tmpdir(), 'forge-guard-stray-'));
  try {
    mkdirSync(join(root, '_queue', 'flow-runs'), { recursive: true });
    writeFileSync(
      join(root, '_queue', 'flow-runs', 'flow-run-tick-x.json'),
      JSON.stringify({ target: { kind: 'flow', ref: 'tick' }, origin: 'cron', triggeredBy: 'cron:tick', createdAt: 'x' }),
    );
    await assert.rejects(
      () => assertNoLiveDaemon(root),
      /flow-runs\/flow-run-tick-x\.json/,
      'the seeding guard names the stray request',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
