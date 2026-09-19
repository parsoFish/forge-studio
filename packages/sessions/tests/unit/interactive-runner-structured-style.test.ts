/**
 * Bead forge-8vfn.6.6 item 1 — `turnSpec.style === 'structured'` must run a
 * real structured turn through a registered schema resolver instead of
 * throwing unconditionally. RED-NOW: `runAgentStyleStep`'s structured branch
 * (interactive-agent-step.ts) throws "no schema registry is wired yet" for
 * EVERY structured row, regardless of `schema`.
 */
import { loadFixtureDescriptor, logger, setup } from './test-fixtures/interactive-runner-fixtures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInteractiveTurn } from '../../interactive-runner.ts';
import { type QueryFn } from '../../interactive-session.ts';
import { writeSessionStatus, readSessionStatus } from '../../interactive-session.ts';

type StructuredStatus = { session_id: string; phase: string; updated_at: string };

test('turnSpec style:structured (schema:interview-qa) runs a real structured turn, advances phase, and persists the result under the declared writes dir', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionId = '2026-09-19T00-00-00';
  const sessionDir = join(projectRoot, '_interactivetest-structured', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<StructuredStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-structured');
  let queryFnCalled = false;
  const queryFn: QueryFn = () => {
    queryFnCalled = true;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0.02, structured_output: { done: true, questions: [] } };
    }
    return gen();
  };

  const result = await runInteractiveTurn(descriptor, {
    sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId),
  });

  assert.ok(queryFnCalled, 'the structured-style primitive must actually invoke queryFn');
  assert.equal(result.phase, 'awaiting-review');
  assert.equal(readSessionStatus<StructuredStatus>(sessionDir)?.phase, 'awaiting-review');
  const outputPath = join(sessionDir, 'staging', 'output.json');
  assert.ok(existsSync(outputPath), 'the structured result must be persisted under the declared writes dir');
  assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), { done: true, questions: [] });
});

test('turnSpec style:structured with NO schema declared refuses loudly, naming the kind', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionId = '2026-09-19T00-00-01';
  const sessionDir = join(projectRoot, '_interactivetest-structured-noschema', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<StructuredStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-structured-no-schema');
  const queryFn: QueryFn = () => { throw new Error('queryFn must not be called — the runner must refuse before spawning'); };

  await assert.rejects(
    () => runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) }),
    /schema/i,
  );
});

test('turnSpec style:structured naming an unregistered schema id refuses loudly, naming the offending id', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionId = '2026-09-19T00-00-02';
  const sessionDir = join(projectRoot, '_interactivetest-structured-badschema', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<StructuredStatus>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-structured-bad-schema');
  const queryFn: QueryFn = () => { throw new Error('queryFn must not be called — the runner must refuse before spawning'); };

  await assert.rejects(
    () => runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) }),
    /totally-not-a-real-schema-id/,
  );
});
