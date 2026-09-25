/**
 * Seam F6 half 2 (operator ruling 97): a flow may narrow the review-band's
 * class lenses via its own `review.lenses` declaration, threaded from
 * `flow-runner.ts` as `AdversarialReviewInput.flowReview` (never re-read by
 * this pipeline). Shares the `adversarial-review.test.ts` harness.
 *
 * (a) narrowing to one of the class's own lenses -> the spawn's prompt
 *     carries ONLY that lens.
 * (b) a lens outside the class -> the named refusal, before any spawn.
 * (c) absent -> unchanged (already covered by every other test in this
 *     suite, none of which set `flowReview` at all).
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  CODE_LENSES, collectLogger, makeFixture, run, stubQueryFn,
  validFindingsJson, withoutSpawnSuppressionEnv,
} from '../test-fixtures/adversarial-review-fixture.ts';

test('(a) narrowing to one of the class\'s own lenses: the spawn briefing carries ONLY that lens', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn([
      (prompt) => writeFileSync(
        join(fx.worktree, '.forge', 'review-findings.json'),
        validFindingsJson(prompt, { lenses: ['correctness'] }),
      ),
    ], prompts);
    const res = await run(fx, qf, logger, { flowReview: { flowId: 'narrow-flow', lenses: ['correctness'] } });

    assert.equal(res.status, 'complete', res.status === 'failed' ? res.detail : undefined);
    assert.ok(prompts.length > 0, 'the review DID spawn');
    assert.ok(prompts[0]!.includes('correctness'), 'the narrowed lens is in the briefing');
    for (const excluded of CODE_LENSES.filter((l) => l !== 'correctness')) {
      assert.ok(!prompts[0]!.includes(excluded), `excluded lens "${excluded}" must not be in the briefing`);
    }
  } finally {
    fx.cleanup();
    restore();
  }
});

test('(b) a lens the class does not have: the named refusal, before any spawn', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger } = collectLogger(fx.logsRoot);
    let spawned = false;
    const qf = stubQueryFn([() => { spawned = true; }]);
    const res = await run(fx, qf, logger, {
      flowReview: { flowId: 'bad-narrow-flow', lenses: ['correctness', 'not-a-real-lens'] },
    });

    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'lens-narrowing-invalid');
    assert.equal(
      (res as { detail: string }).detail,
      "flow bad-narrow-flow narrows review to lens not-a-real-lens, which class code does not have; " +
        `the class's lenses are ${CODE_LENSES.join(', ')}`,
    );
    assert.equal(spawned, false, 'refused BEFORE any review spawn');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('(c) absent flowReview: unchanged — every class lens still reaches the briefing', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn([
      (prompt) => writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(prompt)),
    ], prompts);
    const res = await run(fx, qf, logger); // no opts — no flowReview at all

    assert.equal(res.status, 'complete', res.status === 'failed' ? res.detail : undefined);
    for (const lens of CODE_LENSES) assert.ok(prompts[0]!.includes(lens), `unnarrowed lens ${lens} present`);
  } finally {
    fx.cleanup();
    restore();
  }
});
