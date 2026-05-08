/**
 * Tests for runBrainQuery — the SDK-invocation glue.
 *
 * The SDK's `query` is dependency-injectable via `queryFn`, so we yield
 * synthetic `result` messages and verify:
 *   - duration_ms and total_cost_usd are read from the result message.
 *   - error_* subtypes map to typed runner_error fields rather than throwing.
 *   - missing structured_output is surfaced as a runner_error.
 *   - successful invocations expose the answers array.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runBrainQuery, type BrainQueryFn } from './sdk.ts';

function fakeQueryFn(messages: unknown[]): BrainQueryFn {
  return () => {
    async function* gen() {
      for (const m of messages) yield m;
    }
    return gen();
  };
}

test('runBrainQuery: extracts duration_ms, cost, and structured answers from a successful result', async () => {
  const queryFn = fakeQueryFn([
    {
      type: 'result',
      subtype: 'success',
      duration_ms: 1234,
      total_cost_usd: 0.0042,
      structured_output: {
        answers: [
          {
            question: 'Q?',
            answer: 'A.',
            confidence: 'high',
            sources: ['brain/forge/themes/a.md'],
          },
        ],
      },
    },
  ]);

  const r = await runBrainQuery({ question: 'Q?', queryFn });

  assert.equal(r.durationMs, 1234);
  assert.equal(r.costUsd, 0.0042);
  assert.equal(r.runnerError, undefined);
  assert.equal(r.structured?.answers.length, 1);
  assert.equal(r.structured?.answers[0].confidence, 'high');
});

test('runBrainQuery: maps error_max_turns subtype to a typed runner_error', async () => {
  const queryFn = fakeQueryFn([
    { type: 'result', subtype: 'error_max_turns', duration_ms: 500, total_cost_usd: 0.001 },
  ]);

  const r = await runBrainQuery({ question: 'Q?', queryFn });

  assert.equal(r.structured, null);
  assert.equal(r.runnerError?.kind, 'error_max_turns');
  assert.equal(r.durationMs, 500);
});

test('runBrainQuery: maps error_max_structured_output_retries subtype', async () => {
  const queryFn = fakeQueryFn([
    {
      type: 'result',
      subtype: 'error_max_structured_output_retries',
      duration_ms: 800,
      total_cost_usd: 0.002,
    },
  ]);

  const r = await runBrainQuery({ question: 'Q?', queryFn });

  assert.equal(r.runnerError?.kind, 'error_max_structured_output_retries');
});

test('runBrainQuery: maps error_max_budget_usd subtype', async () => {
  const queryFn = fakeQueryFn([
    { type: 'result', subtype: 'error_max_budget_usd', duration_ms: 300, total_cost_usd: 0.1 },
  ]);

  const r = await runBrainQuery({ question: 'Q?', queryFn });

  assert.equal(r.runnerError?.kind, 'error_max_budget_usd');
});

test('runBrainQuery: missing structured_output surfaces as no_structured_output runner_error', async () => {
  const queryFn = fakeQueryFn([
    { type: 'result', subtype: 'success', duration_ms: 100, total_cost_usd: 0.001 },
  ]);

  const r = await runBrainQuery({ question: 'Q?', queryFn });

  assert.equal(r.structured, null);
  assert.equal(r.runnerError?.kind, 'no_structured_output');
});

test('runBrainQuery: malformed structured_output surfaces as invalid_structured_output', async () => {
  const queryFn = fakeQueryFn([
    {
      type: 'result',
      subtype: 'success',
      duration_ms: 100,
      total_cost_usd: 0.001,
      structured_output: { not_answers: [] },
    },
  ]);

  const r = await runBrainQuery({ question: 'Q?', queryFn });

  assert.equal(r.structured, null);
  assert.equal(r.runnerError?.kind, 'invalid_structured_output');
});

test('runBrainQuery: empty iterator surfaces as no_result', async () => {
  const queryFn = fakeQueryFn([]);

  const r = await runBrainQuery({ question: 'Q?', queryFn });

  assert.equal(r.structured, null);
  assert.equal(r.runnerError?.kind, 'no_result');
});

test('runBrainQuery: ignores assistant messages and waits for result', async () => {
  const queryFn = fakeQueryFn([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'thinking…' }] } },
    {
      type: 'result',
      subtype: 'success',
      duration_ms: 200,
      total_cost_usd: 0.001,
      structured_output: {
        answers: [{ question: 'Q?', answer: 'A.', confidence: 'medium', sources: [] }],
      },
    },
  ]);

  const r = await runBrainQuery({ question: 'Q?', queryFn });

  assert.equal(r.runnerError, undefined);
  assert.equal(r.structured?.answers[0].confidence, 'medium');
});
