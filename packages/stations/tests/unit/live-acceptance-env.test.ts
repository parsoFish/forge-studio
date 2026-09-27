/**
 * The dev-loop's live-acceptance env guard reads the CLASS, not the project
 * (ADR 051 decision 2 as amended, bead forge-mfv5.3.5).
 *
 * `liveAcceptanceEnvFor` (`phases/live-acceptance-env.ts`) is the one decision
 * the per-WI gate wiring in `developer-loop.ts` makes about `requiresEnv`: for
 * a `required` class a WI gate that targets the project's live-acceptance
 * suite may not run without the declared env (else the runner skips and the gate false-passes); for an
 * `advisory` class the tier may still run, but the guard is not imposed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { liveAcceptanceEnvFor } from '../../phases/live-acceptance-env.ts';

const ACC_GATE = { match: 'acceptancetests', requires_env: ['TF_ACC', 'AZDO_PERSONAL_ACCESS_TOKEN'] };
const LIVE_CMD = ['go', 'test', '-run', 'TestAccFoo', './azuredevops/internal/acceptancetests/...'];
const UNIT_CMD = ['go', 'test', './azuredevops/internal/service/...'];

test('forge-mfv5.3.5: a required class (code) enforces requiresEnv on a gate that targets the live suite', () => {
  assert.deepEqual(liveAcceptanceEnvFor(ACC_GATE, 'required', LIVE_CMD), ['TF_ACC', 'AZDO_PERSONAL_ACCESS_TOKEN']);
});

test('forge-mfv5.3.5: an advisory class (docs) is not forced — the same live gate runs without the env demand', () => {
  assert.equal(liveAcceptanceEnvFor(ACC_GATE, 'advisory', LIVE_CMD), undefined);
});

test('a required class demands nothing of a gate that does not target the live suite', () => {
  assert.equal(liveAcceptanceEnvFor(ACC_GATE, 'required', UNIT_CMD), undefined);
});

test('a required class on a project with no live tier, or a tier with no env, demands nothing', () => {
  assert.equal(liveAcceptanceEnvFor(undefined, 'required', LIVE_CMD), undefined);
  assert.equal(liveAcceptanceEnvFor({ match: 'acceptancetests', requires_env: [] }, 'required', LIVE_CMD), undefined);
  assert.equal(liveAcceptanceEnvFor({ match: 'acceptancetests' }, 'required', LIVE_CMD), undefined);
});
