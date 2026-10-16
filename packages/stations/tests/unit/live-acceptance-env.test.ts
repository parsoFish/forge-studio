/**
 * The dev-loop's live-acceptance env guard (bead forge-mfv5.3.5, D-34
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

import { liveAcceptanceEnvFor, liveAcceptanceEnvForCheck } from '../../phases/live-acceptance-env.ts';

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

test('forge-mfv5.1.44: a check is read by its arguments, never by the text of an inline program', () => {
  const gw = { match: 'tests/acceptance', requires_env: ['GW_CALLER_TOKEN'] };
  const guard = ['python3', '-c', "import subprocess,sys; r=subprocess.run(['grep','-rqnE','gw-acc-','gitweave','tests/acceptance']).returncode; sys.exit(0 if r==1 else 1)"];
  assert.equal(liveAcceptanceEnvForCheck(gw, guard), undefined);
  assert.deepEqual(liveAcceptanceEnvFor(gw, guard), ['GW_CALLER_TOKEN'], 'the WI gate keeps the D-34 substring guard');
  assert.deepEqual(liveAcceptanceEnvForCheck(gw, ['python3', '-m', 'pytest', 'tests/acceptance', '-q']), ['GW_CALLER_TOKEN']);
  assert.deepEqual(liveAcceptanceEnvForCheck(gw, ['node', '-e', 'run()', 'tests/acceptance']), ['GW_CALLER_TOKEN'], 'an argument after the program still counts');
  assert.deepEqual(liveAcceptanceEnvForCheck(ACC_GATE, LIVE_CMD), ['TF_ACC', 'AZDO_PERSONAL_ACCESS_TOKEN']);
  assert.equal(liveAcceptanceEnvForCheck(gw, ['node', '--eval=/* tests/acceptance */ 0']), undefined, 'the joined --eval= form is program text too');
  assert.equal(liveAcceptanceEnvForCheck(gw, ['/usr/bin/python3.12', '-Ic', 'print("tests/acceptance")']), undefined, 'a clustered -c flag');
});

test('forge-mfv5.1.44: a shell\'s -c operand is a command line — a shell-wrapped suite run keeps the D-34 guard', () => {
  const gw = { match: 'tests/acceptance', requires_env: ['GW_CALLER_TOKEN'] };
  assert.deepEqual(liveAcceptanceEnvForCheck(gw, ['sh', '-c', 'pytest tests/acceptance -q']), ['GW_CALLER_TOKEN']);
  assert.deepEqual(liveAcceptanceEnvForCheck(gw, ['bash', '-lc', 'pytest tests/acceptance -q']), ['GW_CALLER_TOKEN']);
  assert.deepEqual(liveAcceptanceEnvForCheck(ACC_GATE, ['sh', '-c', 'go test ./azuredevops/internal/acceptancetests/...']), ['TF_ACC', 'AZDO_PERSONAL_ACCESS_TOKEN']);
  assert.deepEqual(liveAcceptanceEnvForCheck(gw, ['pytest', '-c', 'tests/acceptance/pytest.ini']), ['GW_CALLER_TOKEN'], 'a runner\'s own -c (config file) is an argument');
});
