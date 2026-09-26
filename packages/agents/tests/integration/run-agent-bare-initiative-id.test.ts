/**
 * forge-8vfn.8.1.22 / T1 ruling 1577, §6.15: a `runId` that is a BARE
 * initiative id is refused tree-wide, before any spawn or marker write — an
 * initiative id's `_logs/<initiativeId>/` dir is never read by Studio, only
 * `_logs/<cycleId>/` is. Row 112 (forge-8vfn.8.1.17) closed three call sites
 * with `requireCycleId`; this is the door every `runAgent` spawn passes
 * through regardless of caller, so a missed fourth site fails loud instead
 * of silently misfiling a marker.
 *
 * Split out of `run-agent.test.ts` (which sat at the 800-line file cap) per
 * ruling 150 — split by concern, never baseline. Shares that file's fixture
 * helpers (`getFixtureDef`, `fakeQueryFn`, `throwingQueryFn`,
 * `withoutSpawnSuppressionEnv`) by re-declaring them rather than importing
 * across test files, matching this suite's existing convention of each
 * `run-agent-*.test.ts` file carrying its own small stubs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAgent } from '../../run-agent.ts';
import { listAgentDefinitions } from '../../studio/agent-registry.ts';
import type { StreamQueryFn } from '../../pinned-sdk-query.ts';
import type { AgentDefinition } from '@forge/contracts';
import { FORGE_ROOT } from '@forge/kernel';

const ROOT = FORGE_ROOT;

/** Mirrors `run-agent.test.ts`'s `fakeQueryFn` — a single successful `result` message. */
function fakeQueryFn(costUsd: number): StreamQueryFn {
  return ((_params: { prompt: unknown; options?: unknown }) => {
    async function* gen() {
      yield {
        type: 'result',
        subtype: 'success',
        total_cost_usd: costUsd,
        usage: { input_tokens: 11, output_tokens: 22 },
      };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

/** Mirrors `run-agent.test.ts`'s `throwingQueryFn` — proves the guard fires
 *  before the SDK is ever reached. */
const throwingQueryFn: StreamQueryFn = ((() => {
  throw new Error('runAgent must not invoke queryFn under dry-bridge / no-spawn suppression');
}) as unknown) as StreamQueryFn;

function getFixtureDef(defs: AgentDefinition[], slug: string): AgentDefinition {
  const def = defs.find((d) => d.slug === slug);
  assert.ok(def, `expected the ${slug} library fixture in the roster`);
  return def;
}

/** Mirrors `run-agent.test.ts`'s env-seam helper — deterministic regardless
 *  of ambient CI env vars. */
function withoutSpawnSuppressionEnv(): () => void {
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  return () => {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
  };
}

test('runAgent: refuses a bare initiative-id runId before any spawn/marker write', async () => {
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-bare-init-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review');
    const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
    const logsRoot = join(scratchRoot, '_logs');

    // A canonical id, and a legacy non-canonical one (betterado's early `INIT-1` shape).
    for (const runId of ['INIT-2026-09-26-x', 'INIT-1']) {
      await assert.rejects(
        () =>
          runAgent(def, {
            runId,
            workdir,
            prompt: 'test',
            logsRoot,
            queryFn: throwingQueryFn,
          }),
        /is an initiative id, not a run\/cycle id/,
      );
    }

    assert.ok(!existsSync(logsRoot), 'the guard fires before any logsRoot I/O — the logs dir is never created');
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }
});

test('runAgent: accepts a real cycle-id runId and a non-initiative-id runId (only the bare initiative shape is refused)', async () => {
  const restoreEnv = withoutSpawnSuppressionEnv();
  const scratchRoot = mkdtempSync(join(tmpdir(), 'forge-run-agent-accept-init-shapes-'));
  try {
    const defs = listAgentDefinitions(join(ROOT, 'skills'));
    const def = getFixtureDef(defs, 'project-scoped-review');

    // A real cycle id (ISO stamp + `_` + the initiative id) and an architect
    // session id (`architect-session-<sessionId>`, packages/sessions/kinds/
    // architect.ts) — neither is a BARE initiative id, so both must run.
    for (const runId of ['2026-09-26T07-16-37_INIT-2026-09-26-x', 'architect-session-9c1e6b2a']) {
      const workdir = mkdtempSync(join(scratchRoot, 'wd-'));
      const logsRoot = join(scratchRoot, '_logs');
      const result = await runAgent(def, {
        runId,
        workdir,
        prompt: 'test',
        logsRoot,
        queryFn: fakeQueryFn(0.01),
      });
      assert.equal(result.suppressed, false, `${runId}: expected a real (non-suppressed) run`);
      assert.ok(existsSync(join(logsRoot, runId, 'events.jsonl')), `${runId}: expected the run's own log dir`);
    }
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
    restoreEnv();
  }
});
