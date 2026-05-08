/**
 * Tests for the LLM Council critic-chain runner.
 *
 * Each critic is invoked as an SDK subagent. Tests inject a fake queryFn that
 * yields a `result` message whose `structured_output` is the critic's verdict.
 * We verify:
 *   - Critics are invoked in declared order.
 *   - flags (mechanical) are auto-applied to the draft.
 *   - escalations (taste) are aggregated and de-duplicated.
 *   - The chain stops if a critic times out / errors and surfaces the error.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runCouncil,
  defaultCritics,
  type Critic,
  type CriticVerdict,
  type CouncilQueryFn,
} from './council.ts';

type CapturedInvocation = { criticName: string; prompt: string };

function fakeQueryFn(
  verdictsByCritic: Record<string, CriticVerdict>,
  captured: CapturedInvocation[],
): CouncilQueryFn {
  return ({ prompt, options }) => {
    const criticName = String((options as Record<string, unknown>)?.['_criticName'] ?? '<unknown>');
    captured.push({ criticName, prompt });
    const verdict = verdictsByCritic[criticName] ?? { flags: [], escalations: [] };
    async function* gen() {
      yield {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.01,
        num_turns: 1,
        structured_output: verdict,
      };
    }
    return gen();
  };
}

const DRAFT = '# Draft initiative\n\nAdd login + profile.';

test('runCouncil: invokes critics in declared order', async () => {
  const captured: CapturedInvocation[] = [];
  const critics: Critic[] = [
    { name: 'ceo', prompt: 'You are the CEO critic.', model: 'sonnet' },
    { name: 'eng', prompt: 'You are the engineering critic.', model: 'sonnet' },
    { name: 'design', prompt: 'You are the design critic.', model: 'sonnet' },
    { name: 'dx', prompt: 'You are the DX critic.', model: 'sonnet' },
  ];

  await runCouncil({
    draft: DRAFT,
    critics,
    queryFn: fakeQueryFn({}, captured),
  });

  assert.deepEqual(
    captured.map((c) => c.criticName),
    ['ceo', 'eng', 'design', 'dx'],
  );
  for (const c of captured) assert.match(c.prompt, /Add login/);
});

test('runCouncil: auto-applies flags and aggregates escalations', async () => {
  const captured: CapturedInvocation[] = [];
  const critics: Critic[] = [
    { name: 'ceo', prompt: 'CEO', model: 'sonnet' },
    { name: 'eng', prompt: 'Eng', model: 'sonnet' },
  ];
  const verdicts: Record<string, CriticVerdict> = {
    ceo: {
      flags: [{ id: 'missing-rollback', description: 'No rollback note', appliedFix: 'Added rollback section to body.' }],
      escalations: [
        {
          critic: 'ceo',
          question: 'One initiative or two?',
          options: [
            { label: 'one', rationale: 'simpler review' },
            { label: 'two', rationale: 'parallel work' },
          ],
        },
      ],
    },
    eng: {
      flags: [{ id: 'undeclared-dep', description: 'FEAT-2 missing depends_on', appliedFix: 'Added depends_on: [FEAT-1] to FEAT-2.' }],
      escalations: [
        // Duplicate escalation — should de-dupe by (critic, question).
        {
          critic: 'ceo',
          question: 'One initiative or two?',
          options: [{ label: 'one', rationale: 'duplicate' }],
        },
        {
          critic: 'eng',
          question: 'Use server-side or client-side validation?',
          options: [
            { label: 'server', rationale: 'authoritative' },
            { label: 'client', rationale: 'snappier UX' },
          ],
        },
      ],
    },
  };

  const result = await runCouncil({
    draft: DRAFT,
    critics,
    queryFn: fakeQueryFn(verdicts, captured),
  });

  assert.equal(result.flags.length, 2, 'two flags collected');
  assert.equal(result.escalations.length, 2, 'duplicate escalation de-duped');
  assert.deepEqual(
    result.escalations.map((e) => `${e.critic}:${e.question}`),
    ['ceo:One initiative or two?', 'eng:Use server-side or client-side validation?'],
  );
  assert.ok(result.totalCostUsd > 0, 'cost accumulated across critics');
  assert.equal(result.totalCostUsd, 0.02, 'cost = sum of per-critic cost');
});

test('runCouncil: surfaces an error when a critic returns no result', async () => {
  const critics: Critic[] = [{ name: 'ceo', prompt: 'CEO', model: 'sonnet' }];
  const queryFn: CouncilQueryFn = () => {
    async function* gen() {
      // No `result` event — simulates a timeout / abort.
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } };
    }
    return gen();
  };

  await assert.rejects(
    runCouncil({ draft: DRAFT, critics, queryFn }),
    /ceo.*no result|no.*verdict/i,
  );
});

test('runCouncil: missing structured_output triggers a typed error', async () => {
  const critics: Critic[] = [{ name: 'eng', prompt: 'Eng', model: 'sonnet' }];
  const queryFn: CouncilQueryFn = () => {
    async function* gen() {
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.01, num_turns: 1 };
      // structured_output missing
    }
    return gen();
  };

  await assert.rejects(
    runCouncil({ draft: DRAFT, critics, queryFn }),
    /structured_output|verdict/i,
  );
});

test('defaultCritics: returns ceo + eng + design + dx in order', () => {
  const critics = defaultCritics();
  assert.deepEqual(
    critics.map((c) => c.name),
    ['ceo', 'eng', 'design', 'dx'],
  );
  // Each has a non-trivial prompt
  for (const c of critics) {
    assert.ok(c.prompt.length > 50, `${c.name} prompt is non-trivial`);
  }
});
