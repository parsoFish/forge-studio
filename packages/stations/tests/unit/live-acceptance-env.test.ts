/**
 * The dev-loop's live-acceptance env guard (bead forge-mfv5.3.5, ADR 051
 * decision 2 as amended). `liveAcceptanceEnvFor`
 * (`phases/live-acceptance-env.ts`) is the one decision the per-WI gate wiring
 * in `developer-loop.ts` makes about `requiresEnv`: a WI gate that targets the
 * project's live-acceptance suite never runs without the declared env, WHATEVER
 * the initiative's class — else the runner skips and the gate false-passes. The
 * class's `acceptance` column decides only whether the project manager must
 * plan such a work item; an `advisory` (docs) initiative whose gate does target
 * the live suite still runs under the guard, so a mis-declared class cannot
 * turn the guard off.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { liveAcceptanceEnvFor } from '../../phases/live-acceptance-env.ts';

const ACC_GATE = { match: 'acceptancetests', requires_env: ['TF_ACC', 'AZDO_PERSONAL_ACCESS_TOKEN'] };
const LIVE_CMD = ['go', 'test', '-run', 'TestAccFoo', './azuredevops/internal/acceptancetests/...'];
const UNIT_CMD = ['go', 'test', './azuredevops/internal/service/...'];

test('forge-mfv5.3.5: a gate that targets the live suite demands requiresEnv', () => {
  assert.deepEqual(liveAcceptanceEnvFor(ACC_GATE, LIVE_CMD), ['TF_ACC', 'AZDO_PERSONAL_ACCESS_TOKEN']);
});

test('forge-mfv5.3.5: the guard takes no class — an advisory (docs) initiative cannot switch it off', () => {
  assert.equal(liveAcceptanceEnvFor.length, 2, 'the decision reads the gate and the tier only, never the class');
});

test('a gate that does not target the live suite demands nothing', () => {
  assert.equal(liveAcceptanceEnvFor(ACC_GATE, UNIT_CMD), undefined);
});

test('a project with no live tier, or a tier with no env, demands nothing', () => {
  assert.equal(liveAcceptanceEnvFor(undefined, LIVE_CMD), undefined);
  assert.equal(liveAcceptanceEnvFor({ match: 'acceptancetests', requires_env: [] }, LIVE_CMD), undefined);
  assert.equal(liveAcceptanceEnvFor({ match: 'acceptancetests' }, LIVE_CMD), undefined);
});
