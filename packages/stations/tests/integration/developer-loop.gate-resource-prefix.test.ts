/**
 * forge-mfv5.3.7 (operator ruling 2026-09-12) — DEV-LOOP-LEVEL pin for the
 * per-WI gate's env, alongside forge-mfv5.3.5 / D-34's
 * class-independent live-acceptance guard.
 *
 * Calls `buildWiQualityGate` (`packages/stations/phases/wi-quality-gate.ts`)
 * DIRECTLY — the exact function `developer-loop.ts`'s per-WI dispatch body
 * calls to build the `qualityGate` it hands `runRalph`. This is a
 * *structural* pin, not a hand-written mirror of the closure: if
 * `developer-loop.ts` (or `wi-quality-gate.ts` itself) ever stopped passing
 * `initiativeId` through, or the live-acc guard stopped firing, THIS test
 * would fail on the real production code path, not on a copy of it that
 * could silently drift out of step.
 *
 * `runDeveloperLoop` itself still can't be called directly in a test (it
 * always spawns a real Claude SDK query internally — see
 * `developer-loop.cost-ceiling.test.ts`'s own note); `buildWiQualityGate` is
 * the narrowest real seam that exists below that spawn.
 *
 * Proves two things:
 *   (a) a WI's gate command sees FORGE_RESOURCE_PREFIX equal to
 *       deriveResourcePrefix(initiativeId) for that run's initiative;
 *   (b) a WI gate that targets the project's live-acceptance suite (`match`)
 *       with `requiresEnv` declared and unset is still ERRORED by the guard
 *       — never run and passed — and this holds with NO notion of "class"
 *       anywhere in the call: `liveAcceptanceEnvFor` (which
 *       `buildWiQualityGate` calls) takes only the gate config and the WI's
 *       own command (see also
 *       `packages/stations/tests/unit/live-acceptance-env.test.ts`, which
 *       pins that the function itself takes no class argument). A
 *       DOCS-class initiative's PM-time decision to skip planning an
 *       acceptance WI (`project-manager.ts`'s `accGateViolation`) is a
 *       SEPARATE, earlier decision that never reaches this per-WI gate seam.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GateRunInfo } from '@forge/agents';
import { RESOURCE_PREFIX_ENV, RESOURCE_PREFIX_RE, deriveResourcePrefix } from '@forge/kernel';
import type { AcceptanceGateConfig } from '@forge/projects';
import type { WorkItem } from '@forge/flows';

import { buildWiQualityGate } from '../../phases/wi-quality-gate.ts';

/** A minimal WI fixture — only the fields `gateRequiredPaths`/`buildWiQualityGate`
 *  actually read matter to these tests; `files_in_scope: []` + a
 *  `'files-in-scope'` source keeps `requiredPaths` empty, isolating the two
 *  behaviours under test. */
function wi(cmd: readonly string[]): WorkItem {
  return {
    work_item_id: 'WI-1',
    initiative_id: 'initiative-devloop-alpha',
    status: 'pending',
    depends_on: [],
    acceptance_criteria: [{ given: 'g', when: 'w', then: 't' }],
    files_in_scope: [],
    quality_gate_cmd: [...cmd],
    estimated_iterations: 1,
    body: '',
  };
}

test('dev-loop per-WI gate: FORGE_RESOURCE_PREFIX reaches the gate child, equal to deriveResourcePrefix(initiativeId) (forge-mfv5.3.7)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-devloop-nsprefix-'));
  try {
    const initiativeId = 'initiative-devloop-alpha';
    const effective = ['sh', '-c', `echo "PREFIX=$${RESOURCE_PREFIX_ENV}"`];
    let info: GateRunInfo | undefined;
    const gate = buildWiQualityGate({
      worktreePath: dir,
      // No live-acc tier declared — isolates the resource-prefix behaviour
      // from the requiredEnv guard exercised in the test below.
      accGate: undefined,
      effective,
      wi: wi(effective),
      requiredPathsSource: 'files-in-scope',
      ciGateUnsetEnv: undefined,
      localGateTimeoutMs: undefined,
      initiativeId,
      onRun: (i) => { info = i; },
    });

    assert.equal(gate(), true);
    assert.ok(info, 'onRun must fire');
    const match = info!.stdoutTail.match(/PREFIX=(\S+)/);
    assert.ok(match, `the dev-loop's real per-WI gate child never saw ${RESOURCE_PREFIX_ENV}`);
    assert.equal(match![1], deriveResourcePrefix(initiativeId), 'the gate child must see the SAME value the pure derivation produces for this initiative');
    assert.match(match![1]!, RESOURCE_PREFIX_RE);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("dev-loop per-WI gate: a WI gate targeting the live-acc suite with requiresEnv unset is ERRORED, never run-and-passed — the guard takes no class (forge-mfv5.3.5 + forge-mfv5.3.7)", () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-devloop-liveacc-'));
  const UNSET_VAR = 'FORGE_TEST_DEVLOOP_UNSET_TFACC_XYZ';
  delete process.env[UNSET_VAR];
  try {
    const accGate: AcceptanceGateConfig = { match: 'acceptancetests', requires_env: [UNSET_VAR] };
    // The WI's own quality_gate_cmd — realistic betterADO shape (a `go test`
    // invocation whose target package path names the acc suite). If the
    // guard ever let this actually RUN, it would echo the marker and exit 0
    // — a silent false-pass. There is no "class" parameter anywhere in this
    // test, in `buildWiQualityGate`, or in `liveAcceptanceEnvFor`'s own
    // signature: the guard fires purely because the WI's own command
    // matches the project's declared `match`.
    const effective = ['sh', '-c', 'echo RAN_AND_PASSED_MARKER; exit 0 # target: acceptancetests'];
    let info: GateRunInfo | undefined;
    const gate = buildWiQualityGate({
      worktreePath: dir,
      accGate,
      effective,
      wi: wi(effective),
      requiredPathsSource: 'files-in-scope',
      ciGateUnsetEnv: undefined,
      localGateTimeoutMs: undefined,
      initiativeId: 'initiative-devloop-docs-class-wi',
      onRun: (i) => { info = i; },
    });

    assert.equal(gate(), false, 'the gate must NOT pass when requiresEnv is unset for a live-acc-targeting command');
    assert.ok(info, 'onRun must fire');
    assert.equal(info!.errored, true, 'a live-acc gate without its env is a broken/unvalidatable gate, not a silent skip-and-pass');
    assert.equal(info!.rejectReason, 'live-env-missing');
    assert.doesNotMatch(
      info!.stdoutTail,
      /RAN_AND_PASSED_MARKER/,
      'the command must never actually execute — running it would be exactly the false-pass this guard exists to prevent',
    );
    assert.match(info!.stderrTail, new RegExp(UNSET_VAR));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
