/**
 * Tests for completeness-critic-runner.ts.
 *
 * The critic is a one-shot structured-output SDK turn (no session-dir state
 * machine of its own) — so these tests exercise `runCompletenessCritic`
 * directly with an injectable `queryFn`, mirroring architect-runner.test.ts's
 * fake-generator pattern. No live LLM, no logger dependency (the module never
 * emits events itself — the caller owns that).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runCompletenessCritic,
  completenessCriticAgentSpec,
  COMPLETENESS_CRITIC_MODEL,
  CRITIC_MAX_TOTAL_PROMPT_CHARS,
  CRITIC_MAX_FINDINGS,
  CRITIC_MAX_GAP_CHARS,
  CRITIC_MAX_CRASH_ERROR_CHARS,
  type QueryFn,
  type RunCompletenessCriticInput,
} from './completeness-critic-runner.ts';

const BASE_INPUT: RunCompletenessCriticInput = {
  idea: 'Migrate every resource to the plugin framework.',
  interviewSummary: '1. Q: Any resources out of scope?\n   A: No, all of them.',
  planMarkdown: '# PLAN\n\nMigrate all resources.',
  manifestsSummary: '- INIT-1 (release_definition): migrate release_definition\n',
};

function queryFnReturning(structured: unknown): QueryFn {
  return () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0.01, structured_output: structured };
    }
    return gen();
  };
}

async function* nothing(): AsyncGenerator<never> {}

test('spec: derives sonnet tier + empty (tool-free) allow-list from the SKILL.md', () => {
  assert.equal(completenessCriticAgentSpec.phase, 'architect');
  assert.equal(completenessCriticAgentSpec.tier, 'sonnet');
  assert.deepEqual(completenessCriticAgentSpec.allowedTools, []);
  assert.equal(COMPLETENESS_CRITIC_MODEL, 'claude-sonnet-4-6');
});

test('returns findings from a well-formed structured response', async () => {
  const queryFn = queryFnReturning({
    findings: [{ severity: 'high', initiativeId: 'INIT-1', gap: 'data_source_x is never covered by any initiative.' }],
  });
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.equal(result.crashed, false);
  assert.deepEqual(result.findings, [
    { severity: 'high', initiativeId: 'INIT-1', gap: 'data_source_x is never covered by any initiative.' },
  ]);
});

test('returns empty findings on a clean pass (structured_output.findings: [])', async () => {
  const queryFn = queryFnReturning({ findings: [] });
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.equal(result.crashed, false);
  assert.deepEqual(result.findings, []);
  assert.equal('error' in result, false, 'no error detail on a non-crash result');
});

test('returns empty findings when structured_output is null (no fallback fenced JSON either)', async () => {
  const queryFn = queryFnReturning(null);
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.equal(result.crashed, false);
  assert.deepEqual(result.findings, []);
});

test('returns empty findings when the stream yields no result message at all', async () => {
  const queryFn: QueryFn = () => nothing();
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.equal(result.crashed, false);
  assert.deepEqual(result.findings, []);
});

test('sanitizes malformed findings: drops empty-gap entries, defaults an invalid/missing severity to medium', async () => {
  const queryFn = queryFnReturning({
    findings: [
      { severity: 'urgent', gap: 'a genuinely reported gap' },
      { severity: 'high', gap: '   ' },
      { gap: 'no severity field at all' },
      { severity: 'low' },
    ],
  });
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.equal(result.crashed, false);
  assert.deepEqual(result.findings, [
    { severity: 'medium', gap: 'a genuinely reported gap' },
    { severity: 'medium', gap: 'no severity field at all' },
  ]);
});

test('drops a blank/whitespace-only initiativeId rather than passing it through', async () => {
  const queryFn = queryFnReturning({
    findings: [{ severity: 'low', initiativeId: '   ', gap: 'a plan-wide gap with no single owner' }],
  });
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.deepEqual(result.findings, [{ severity: 'low', gap: 'a plan-wide gap with no single owner' }]);
  assert.equal('initiativeId' in result.findings[0], false);
});

test('returns crashed:true + empty findings + the error message when the queryFn throws synchronously', async () => {
  const queryFn: QueryFn = () => {
    throw new Error('sdk unavailable');
  };
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.equal(result.crashed, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.error, 'sdk unavailable');
});

test('returns crashed:true + empty findings + the error message when the stream throws mid-iteration', async () => {
  const queryFn: QueryFn = () => {
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'assistant', message: { content: [] } };
      throw new Error('stream died');
    }
    return gen();
  };
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.equal(result.crashed, true);
  assert.deepEqual(result.findings, []);
  assert.equal(result.error, 'stream died');
});

test('bounds a huge crash error message to CRITIC_MAX_CRASH_ERROR_CHARS', async () => {
  const queryFn: QueryFn = () => {
    throw new Error('e'.repeat(CRITIC_MAX_CRASH_ERROR_CHARS * 4));
  };
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.equal(result.crashed, true);
  assert.equal(result.error?.length, CRITIC_MAX_CRASH_ERROR_CHARS);
});

test('a non-Error throw still yields a bounded string error detail', async () => {
  const queryFn: QueryFn = () => {
    // eslint-disable-next-line no-throw-literal
    throw 'raw string failure';
  };
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.equal(result.crashed, true);
  assert.equal(result.error, 'raw string failure');
});

test('caps the findings array at CRITIC_MAX_FINDINGS, dropping the excess', async () => {
  const findings = Array.from({ length: CRITIC_MAX_FINDINGS + 5 }, (_, i) => ({
    severity: 'low',
    gap: `gap number ${i}`,
  }));
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn: queryFnReturning({ findings }) });
  assert.equal(result.crashed, false);
  assert.equal(result.findings.length, CRITIC_MAX_FINDINGS);
  assert.equal(result.findings[0].gap, 'gap number 0', 'keeps the first findings, drops the tail');
});

test('truncates an oversized gap string to CRITIC_MAX_GAP_CHARS', async () => {
  const queryFn = queryFnReturning({
    findings: [{ severity: 'high', gap: 'g'.repeat(CRITIC_MAX_GAP_CHARS + 500) }],
  });
  const result = await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].gap.length, CRITIC_MAX_GAP_CHARS);
});

test('bounds the total assembled prompt to CRITIC_MAX_TOTAL_PROMPT_CHARS (+marker) and keeps the closing instruction', async () => {
  let seenPrompt = '';
  const queryFn: QueryFn = ({ prompt }) => {
    seenPrompt = prompt;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: { findings: [] } };
    }
    return gen();
  };
  // Roadmap-scale sessions are the design target: a manifests summary far past
  // the total budget must not blow the context window.
  const huge = 'm'.repeat(CRITIC_MAX_TOTAL_PROMPT_CHARS + 50_000);
  await runCompletenessCritic({ ...BASE_INPUT, manifestsSummary: huge, queryFn });
  assert.ok(
    seenPrompt.length <= CRITIC_MAX_TOTAL_PROMPT_CHARS + 200,
    `prompt must be bounded (got ${seenPrompt.length})`,
  );
  assert.match(seenPrompt, /\[truncated \d+ chars\]/);
  assert.match(
    seenPrompt,
    /Return ONLY the structured findings JSON\.\s*$/,
    'the closing output instruction must survive truncation',
  );
});

test('a prompt under the total budget passes through without a truncation marker', async () => {
  let seenPrompt = '';
  const queryFn: QueryFn = ({ prompt }) => {
    seenPrompt = prompt;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: { findings: [] } };
    }
    return gen();
  };
  await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.doesNotMatch(seenPrompt, /\[truncated \d+ chars\]/);
});

test('prompt sent to the model carries the idea, interview, PLAN, and manifests context', async () => {
  let seenPrompt = '';
  const queryFn: QueryFn = ({ prompt }) => {
    seenPrompt = prompt;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: { findings: [] } };
    }
    return gen();
  };
  await runCompletenessCritic({ ...BASE_INPUT, queryFn });
  assert.match(seenPrompt, /Migrate every resource to the plugin framework\./);
  assert.match(seenPrompt, /Any resources out of scope\?/);
  assert.match(seenPrompt, /Migrate all resources\./);
  assert.match(seenPrompt, /migrate release_definition/);
});

test('a null planMarkdown renders as an explicit "no PLAN.md" note, not a crash', async () => {
  let seenPrompt = '';
  const queryFn: QueryFn = ({ prompt }) => {
    seenPrompt = prompt;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0, structured_output: { findings: [] } };
    }
    return gen();
  };
  await runCompletenessCritic({ ...BASE_INPUT, planMarkdown: null, queryFn });
  assert.match(seenPrompt, /no PLAN\.md on disk/);
});
