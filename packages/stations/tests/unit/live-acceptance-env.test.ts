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

import { liveAcceptanceClassOf, liveAcceptanceEnvFor, liveAcceptanceEnvForCheck } from '../../phases/live-acceptance-env.ts';

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

test('forge-mfv5.1.59: everything from the program operand to the end of argv is the program — its own argv is never matched', () => {
  const gw = { match: 'tests/acceptance', requires_env: ['GW_CALLER_TOKEN'] };
  // I4 WI-18 SB13's exact shape: every argv string ≤ 500 chars, so the program is exec-split across its own sys.argv.
  const sb13 = ['python3', '-c', "import sys;exec(''.join(sys.argv[1:]))", "import subprocess,sys,json;r=subprocess.run([sys.executable,'-m','pytest','-q','--ignore=tests/acceptance',", "'tests/test_overlay_status.py'],capture_output=True,text=True);print(json.dumps([2,1,1]))"];
  assert.equal(liveAcceptanceEnvForCheck(gw, sb13), undefined);
  assert.equal(liveAcceptanceEnvForCheck(gw, ['python3', '-c', 'print("tests/acceptance")']), undefined, 'the -c operand (forge-mfv5.1.44 kept)');
  assert.equal(liveAcceptanceEnvForCheck(gw, ['node', '-e', 'run()', 'tests/acceptance']), undefined, 'a positional after an inline program is the program\'s own argv');
  assert.equal(liveAcceptanceEnvForCheck(gw, ['node', '--eval=run()', 'tests/acceptance']), undefined, 'the joined --eval= form');
  assert.equal(liveAcceptanceEnvForCheck(gw, ['python3', '-uc', 'run()', '--ignore=tests/acceptance']), undefined, 'a clustered -c');
  assert.equal(liveAcceptanceEnvForCheck(gw, ['perl', '-ne', 'print', 'tests/acceptance/x']), undefined);
  assert.equal(liveAcceptanceEnvForCheck(gw, ['php', '-r', 'echo 1;', 'tests/acceptance']), undefined);
  assert.deepEqual(liveAcceptanceEnvForCheck(gw, ['python3', '-m', 'pytest', 'tests/acceptance']), ['GW_CALLER_TOKEN'], 'a module run targets its arguments');
  assert.deepEqual(liveAcceptanceEnvForCheck(gw, ['python3', 'run_acc.py', 'tests/acceptance']), ['GW_CALLER_TOKEN'], 'a script file\'s arguments are its target');
  assert.deepEqual(liveAcceptanceEnvForCheck(gw, ['python3', '-I', '-u', '-m', 'pytest', 'tests/acceptance']), ['GW_CALLER_TOKEN'], 'flags before the program are unaffected');
  assert.deepEqual(liveAcceptanceEnvForCheck(gw, ['python3', '-E', '-m', 'pytest', 'tests/acceptance']), ['GW_CALLER_TOKEN'], 'python -E is not a program flag');
  assert.deepEqual(liveAcceptanceEnvForCheck(gw, ['php', '-c', 'php.ini', 'tests/acceptance/run.php']), ['GW_CALLER_TOKEN'], 'php -c is a config file');
});

test('forge-mfv5.1.59: the class names the argv token that made it', () => {
  const gw = { match: 'tests/acceptance', requires_env: ['GW_CALLER_TOKEN'] };
  assert.deepEqual(liveAcceptanceClassOf(gw, ['python3', '-m', 'pytest', '-q', 'tests/acceptance/test_live.py']), { requiresEnv: ['GW_CALLER_TOKEN'], index: 4, token: 'tests/acceptance/test_live.py' });
  assert.deepEqual(liveAcceptanceClassOf(gw, ['sh', '-c', 'pytest tests/acceptance']), { requiresEnv: ['GW_CALLER_TOKEN'], index: 2, token: 'pytest tests/acceptance' });
  assert.equal(liveAcceptanceClassOf(gw, ['python3', '-c', 'x', 'tests/acceptance']), undefined);
  assert.equal(liveAcceptanceClassOf({ match: 'tests/acceptance' }, ['pytest', 'tests/acceptance']), undefined, 'no requires_env, no class');
});

test('forge-mfv5.1.59: options are read only up to the program, a script file or a module — a script\'s own -c/-p/-e is its argument', () => {
  const gw = { match: 'tests/acceptance', requires_env: ['X'] };
  for (const argv of [
    ['python3', '-m', 'pytest', '-c', 'tests/acceptance/pytest.ini'],
    ['python3', '-m', 'pytest', '-cconf.ini', 'tests/acceptance'],
    ['python3', 'run.py', '-c', 'tests/acceptance'],
    ['python3', '-W', 'ignore', 'run.py', '-c', 'tests/acceptance'],
    ['python3', '-', '-c', 'tests/acceptance'],
    ['node', 'run.mjs', '-p', 'tests/acceptance'],
    ['node', '-r', './setup.cjs', 'run.mjs', '-e', 'tests/acceptance'],
    ['ruby', 'x.rb', '-e', 'tests/acceptance'],
    ['ruby', '-rtime', 'x.rb', 'tests/acceptance'],
    ['perl', 'x.pl', '-e', 'tests/acceptance'],
    ['php', 'x.php', '-r', 'tests/acceptance'],
  ]) assert.deepEqual(liveAcceptanceEnvForCheck(gw, argv), ['X'], argv.join(' '));
  for (const argv of [
    ['python3', '-W', 'ignore', '-X', 'dev', '-c', 'x', 'tests/acceptance'],
    ['python3', '-Rc', 'x', 'tests/acceptance'],
    ['pypy3', '-c', 'x', 'tests/acceptance'],
    ['node', '-r', './setup.cjs', '-e', 'x', 'tests/acceptance'],
    ['node', '-pe', 'x', 'tests/acceptance'],
    ['ruby3.2', '-e', 'x', 'tests/acceptance'],
    ['ruby', '-I', 'lib', '-ne', 'x', 'tests/acceptance'],
    ['perl', '-0777ne', 'x', 'tests/acceptance'],
    ['php8.3', '-d', 'x=1', '-r', 'x', 'tests/acceptance'],
  ]) assert.equal(liveAcceptanceEnvForCheck(gw, argv), undefined, argv.join(' '));
});
