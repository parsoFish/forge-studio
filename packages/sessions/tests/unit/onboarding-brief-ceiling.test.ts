/**
 * forge-nk1y.5 — the onboarding start stamps a ceiling and a separate CLI run
 * (`forge agent dispatch`) does the work, so the brief must hand that run the
 * stamped ceiling (`--cost-ceiling-usd`). Without it only the agent's own
 * SKILL.md budget bounded the run and FORGE_COST_CEILING_USD never bound.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ServerResponse } from 'node:http';

import { handleOnboardingBrief } from '../../bridge-studio-kickoff.ts';
import type { AffordanceRouteContext } from '../../bridge-studio-sessions-affordance-shell.ts';

const RUN_ID = '_agent-onboarding-agent-20261009T000000Z';

async function brief(status: Record<string, unknown>): Promise<unknown[]> {
  const logsRoot = mkdtempSync(join(tmpdir(), 'onboarding-brief-ceiling-'));
  try {
    mkdirSync(join(logsRoot, '_sessions', 'demoproj', '_onboarding', 's1'), { recursive: true });
    let spawnArgs: unknown[] = [];
    const ctx = {
      forgeRoot: logsRoot,
      logsRoot,
      claimAgentDispatchSlot: () => undefined,
      spawnClaimedAgentDispatch: (...args: unknown[]) => { spawnArgs = args; },
      broadcastKindChanged: () => undefined,
      dryBridgeAgentTurnMarker: () => ({}),
    } as unknown as AffordanceRouteContext;
    const res = { writeHead: () => res, end: () => res } as unknown as ServerResponse;
    await handleOnboardingBrief(
      ctx, res, 'null', logsRoot, ['_sessions', 'demoproj', '_onboarding', 's1'],
      { phase: 'briefing', project: 'demoproj', runId: RUN_ID, ...status }, 'demoproj', 's1',
      { answers: [{ question: 'brief', answer: 'a north star' }] },
    );
    return spawnArgs;
  } finally {
    rmSync(logsRoot, { recursive: true, force: true });
  }
}

test('the brief dispatches the run under the ceiling the start stamped', async () => {
  const args = await brief({ costCeilingUsd: 55, costCeilingSource: 'env' });
  assert.equal(args[1], 'onboarding-agent');
  assert.equal(args[6], 55);
});

test('a session minted without a stamped ceiling dispatches with none (the agent budget still applies)', async () => {
  const args = await brief({});
  assert.equal(args[6], undefined);
});
