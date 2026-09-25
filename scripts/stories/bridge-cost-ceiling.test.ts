/**
 * bridge-cost-ceiling.test.ts — the story bridge's own cost bound.
 *
 * GAP forge-8vfn.8.1 row 6 (story ceiling). `run-story.mjs`'s beat-boundary
 * spend check (`spendSoFar`, bead `forge-8vfn.7.6.51`) only ever fires
 * BETWEEN beats. A single beat that opens a real dev-loop wait can run for
 * its ENTIRE declared bound with nothing inside it able to stop early,
 * because the product's own cost bound (`packages/flows/cycle.ts`'s
 * `resolveCostCeilingOverride`) reads `FORGE_COST_CEILING_USD` from ITS OWN
 * process env, and `bootOwnBridge` never set it — the runner's ceiling never
 * reached the process whose job is to halt inside the beat.
 *
 * THE ENV-REACH CHAIN THIS CLOSES, verified by reading (not guessed):
 *   this module's `env` -> the bridge process (`bootOwnBridge`, bridge.mjs)
 *     -> `apps/forge/bridge-scheduler.ts`'s `POST /api/scheduler/start`
 *     -> `packages/flows/daemon.ts`'s `spawnServeDetached`: `spawn(...)` with
 *        NO `env:` override, i.e. a full inherit of the BRIDGE's own
 *        `process.env` — no allowlist sits at this seam
 *     -> the `forge serve` daemon calls `runCycle` IN-PROCESS
 *        (`packages/flows/scheduler-run-one.ts`)
 *     -> `resolveCostCeilingOverride` reads `process.env.FORGE_COST_CEILING_USD`
 *        directly, same process (`packages/flows/cycle.ts:96`)
 *     -> `flow-runner.ts`'s `CostTracker` and the dev-loop's per-iteration
 *        halt (`packages/stations/phases/dev-cost-bound.ts`) read that SAME
 *        tracker.
 * `AGENT_ENV_ALLOWLIST` (`packages/kernel/spawn-env.ts`) never enters this
 * path — it governs a DIFFERENT, later spawn boundary (an individual
 * station's Claude Code CLI child), not the flow-runner/CostTracker that
 * enforces the ceiling.
 *
 * Mirrors GH_TOKEN's own pattern exactly (`bridge-gh-token.test.ts`): set the
 * env var when there is a usable number, DELETE it when there is not, so an
 * ambient value from whatever shell started this runner never rides through
 * into a costless run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import { bridgeSpawnOptions } from './bridge.mjs';
import { effectiveCeiling } from './spend.mjs';
import { runnerSourceContaining } from './runner-source.mjs';

/** Read one env var back out of a real child, same proof shape as (a)/(e) in
 *  `bridge-gh-token.test.ts` — an options bag with the right `env` object that
 *  `bootOwnBridge` never actually spawns would still pass a test that only
 *  read `opts.env`. */
function readEnvVar(env: NodeJS.ProcessEnv, name: string): string {
  return execFileSync(
    process.execPath,
    ['-e', `process.stdout.write(String(process.env.${name} ?? "<absent>"))`],
    { env, encoding: 'utf8' },
  );
}

test('(a) a usable ceiling reaches the bridge CHILD env, proven by a real spawn', () => {
  const opts = bridgeSpawnOptions('/tmp', { readToken: () => null, ceilingUsd: 25 });
  assert.equal(
    readEnvVar(opts.env as NodeJS.ProcessEnv, 'FORGE_COST_CEILING_USD'),
    '25',
    'a cycle this bridge starts must be able to halt INSIDE its own beat',
  );
});

test('(b) no ceiling means no AMBIENT value rides through — absence is represented, not merely not-added', () => {
  const before = process.env.FORGE_COST_CEILING_USD;
  process.env.FORGE_COST_CEILING_USD = '999';
  try {
    const opts = bridgeSpawnOptions('/tmp', { readToken: () => null, ceilingUsd: null });
    assert.equal(
      'FORGE_COST_CEILING_USD' in (opts.env as NodeJS.ProcessEnv),
      false,
      'absent, never merely "not added" — an ambient value from the operator\'s shell must not leak in',
    );
    assert.equal(readEnvVar(opts.env as NodeJS.ProcessEnv, 'FORGE_COST_CEILING_USD'), '<absent>');
  } finally {
    if (before === undefined) delete process.env.FORGE_COST_CEILING_USD;
    else process.env.FORGE_COST_CEILING_USD = before;
  }
});

test('with no `ceilingUsd` option at all, the default behaves like "no ceiling"', () => {
  const opts = bridgeSpawnOptions('/tmp', { readToken: () => null });
  assert.equal('FORGE_COST_CEILING_USD' in (opts.env as NodeJS.ProcessEnv), false);
});

test('the boot note says which ceiling (or none) the bridge env carries, like the GH_TOKEN note does', () => {
  const withCeiling = bridgeSpawnOptions('/tmp', { readToken: () => null, ceilingUsd: 25 });
  assert.match(withCeiling.ceilingNote, /FORGE_COST_CEILING_USD/);
  assert.match(withCeiling.ceilingNote, /25/);
  assert.equal(withCeiling.ceilingNote.includes('\n'), false, 'one line, like the GH_TOKEN note');

  const without = bridgeSpawnOptions('/tmp', { readToken: () => null, ceilingUsd: null });
  assert.match(without.ceilingNote, /no FORGE_COST_CEILING_USD/i);
});

test('(c) the SAME effectiveCeiling the beat loop enforces reaches bootOwnBridge, through the existing boot call site', () => {
  const { source } = runnerSourceContaining('bridgeSpawnOptions(ROOT');
  assert.match(
    source,
    /effectiveCeiling\(/,
    'the batch ceiling handed to the bridge must reuse the SAME combination rule run-story applies per beat, not a second one',
  );
  assert.match(
    source,
    /bridgeSpawnOptions\(ROOT,\s*\{\s*ceilingUsd/,
    'and the computed number must actually reach the boot call site',
  );
});

test('effectiveCeiling(25, 25) is exactly the number bridgeSpawnOptions is asked to carry', () => {
  const ceiling = effectiveCeiling(25, 25);
  const opts = bridgeSpawnOptions('/tmp', { readToken: () => null, ceilingUsd: ceiling.usd });
  assert.equal(readEnvVar(opts.env as NodeJS.ProcessEnv, 'FORGE_COST_CEILING_USD'), '25');
});

test('GH_TOKEN handling is unaffected by the new option — the two env vars are set independently', () => {
  const opts = bridgeSpawnOptions('/tmp', { readToken: () => 'gho_TEST', ceilingUsd: 25 });
  assert.equal(readEnvVar(opts.env as NodeJS.ProcessEnv, 'GH_TOKEN'), 'gho_TEST');
  assert.equal(readEnvVar(opts.env as NodeJS.ProcessEnv, 'FORGE_COST_CEILING_USD'), '25');
});
