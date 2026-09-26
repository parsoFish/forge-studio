/**
 * A declared ground change that a traced session ALSO wrote is a MATCHED
 * declaration — T1 1587, measured on S3 funded run 4 (row 109).
 *
 * The run's own fence log, verbatim:
 *   own ground: PRODUCED M .forge/project.json — written by _agent/onboarding-agent-…-q5tq
 *   own ground: DECLARATION UNMATCHED M .forge/project.json — the story declared this change and the product did not make it
 *
 * Both lines describe ONE change. The beat-5 rebuild rewrote `.forge/project.json`
 * (reset.ts applyContractReset writes it whenever a regenerate/add row applies),
 * and the onboarding agent later wrote it too, as a traced file_change. The
 * classifier credited the change to the agent and never consulted the
 * declarations for it, so it reported the product as not having made a change
 * that plainly happened — and the run exited red on a false statement.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyOwnGroundDrift, groundIgnoreNoneForTests } from './ground-hash.mjs';

const AGENT = '_agent/onboarding-agent-2026-09-26T12-41-15-393-q5tq';
const declared = [{ path: '.forge/project.json', change: 'modified', beat: 5 }];

function run4Shape({ changedInBeatWindow }) {
  const changes = { added: [], removed: [], modified: ['.forge/project.json'] };
  const writes = new Map([[AGENT, ['.forge/project.json']]]);
  const window = { added: [], removed: [], modified: changedInBeatWindow ? ['.forge/project.json'] : [] };
  return classifyOwnGroundDrift(changes, [], writes, groundIgnoreNoneForTests(), declared, new Map([[5, window]]));
}

test('S3 run 4: a declared change that a traced agent ALSO wrote is matched, not reported as never made', () => {
  const got = run4Shape({ changedInBeatWindow: true });
  assert.deepEqual(got.unmatchedDeclarations, [], 'the change happened — the declaration is satisfied');
  assert.ok(
    got.produced.some((l) => l.startsWith('M .forge/project.json — written by ' + AGENT)),
    `the path is still credited to its writer: ${JSON.stringify(got.produced)}`,
  );
  assert.deepEqual(got.undeclared, []);
});

test('the beat window still governs: a declared change a session wrote BEFORE the declared beat stays unmatched', () => {
  const got = run4Shape({ changedInBeatWindow: false });
  assert.equal(got.unmatchedDeclarations.length, 1, 'no change inside the declared beat window, so the product did not make it');
});

test('a declaration no change touched at all is still unmatched (the rule is not loosened)', () => {
  const changes = { added: [], removed: [], modified: [] };
  const got = classifyOwnGroundDrift(changes, [], new Map(), groundIgnoreNoneForTests(), declared, new Map([[5, { added: [], removed: [], modified: [] }]]));
  assert.equal(got.unmatchedDeclarations.length, 1);
});
