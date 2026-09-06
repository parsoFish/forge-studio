/**
 * Tests for the R4-08-F1 adversarial-review pipeline — input assembly (real git
 * fixtures), spawn (stubbed queryFn), harvest/validate (+ bounded retry,
 * identity-echo verification), the mechanical scope guard, budget-exhaustion,
 * suppression, and worktree scrubbing (no untracked leftovers).
 *
 * How the review is CUT and BOUGHT — the per-work-item chunking, the per-file
 * split and the per-chunk store — is `adversarial-review-chunking.test.ts`. The
 * fixture both drive is `adversarial-review-fixture.test.ts`.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { reviewFindingsJsonPath, validateReviewFindings } from '@forge/flows/flow-artifacts.ts';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';

import {
  CODE_LENSES, CYCLE_ID, EXPECTED, collectLogger, makeFixture, run, stubQueryFn,
  validFindingsJson, withoutSpawnSuppressionEnv,
} from './adversarial-review-fixture.test.ts';
import { assertAdversarialReviewDeclaration } from './adversarial-review.ts';

test('happy path: findings harvested + persisted, worktree scrubbed, briefing carries the diff, the ACs and the class lenses', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn([
      (prompt) => writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(prompt)),
    ], prompts);
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'complete');
    const p = reviewFindingsJsonPath(fx.logsRoot, CYCLE_ID);
    assert.ok(existsSync(p));
    const rec = JSON.parse(readFileSync(p, 'utf8'));
    assert.deepEqual(validateReviewFindings(rec, EXPECTED), []);
    // Two chunks: WI-1 (its declared `src.ts`) and the unattributed remainder
    // (`demo/…/demo.json`, which no work item claims). Ids are namespaced by
    // their chunk, so a merged list can still refer to a finding and a reader
    // can see which work item it is about (bead forge-8vfn.6.10.24).
    assert.deepEqual(rec.findings.map((f: { id: string }) => f.id), ['WI-1/RF-1', 'unattributed/RF-1']);
    const planned = events.find((e) => e.message === 'review.chunks.planned');
    assert.ok(planned, 'the chunk plan is evented — a review whose shape is invisible cannot be audited');
    assert.deepEqual((planned!.metadata as Record<string, unknown>).labels, ['WI-1', 'unattributed']);
    // Each chunk is briefed with ONLY its own files.
    assert.ok(prompts[0]!.includes('src.ts') && !prompts[0]!.includes('demo.json'));
    assert.ok(prompts[1]!.includes('demo.json') && !prompts[1]!.includes('- `src.ts`'));
    // Worktree scrubbed — nothing untracked left to block a later merge.
    assert.ok(!existsSync(join(fx.worktree, '.forge', 'review-findings.json')), 'findings worktree copy deleted');
    assert.ok(!existsSync(join(fx.worktree, '.forge', 'review-input')), 'review-input dir deleted');
    // Briefing content.
    assert.ok(prompts[0]!.includes('.forge/review-input/diff.patch'));
    assert.ok(prompts[0]!.includes('(WI-1) GIVEN a request WHEN handled THEN it returns 200'));
    // The class's lenses, not a fixed four — and the demo's own AC claims are
    // NOT in the briefing any more: the reviewer produces the verdict now, so
    // inlining someone else's would be handing it the answer it was asked for.
    for (const lens of CODE_LENSES) assert.ok(prompts[0]!.includes(lens), `lens ${lens} in the briefing`);
    assert.ok(!prompts[0]!.includes('acEvaluations available'), 'no demo AC-proof block remains');
    // The assembled diff really contains the change.
    assert.ok(events.some((e) => e.message === 'review.input.assembled'));
    const authored = events.find((e) => e.message === 'review.findings.authored');
    assert.ok(authored);
    assert.equal((authored!.metadata as Record<string, unknown>).major, 2, 'one finding per chunk, merged');
    assert.equal((authored!.metadata as Record<string, unknown>).chunks, 2);
  } finally {
    fx.cleanup();
    restore();
  }
});

test('missing findings file: one retry naming it, then success', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn([
      () => { /* writes nothing */ },
      (prompt) => writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(prompt)),
    ], prompts);
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'complete');
    // Three spawns, not two: chunk WI-1 misses then retries, and the
    // unattributed chunk is its own review. The retry budget is PER CHUNK,
    // which is what "bounded by construction" buys.
    assert.equal(prompts.length, 3);
    assert.ok(/review-findings\.json/.test(prompts[1]!));
    assert.equal(events.filter((e) => e.message === 'review.author.invalid').length, 1);
  } finally {
    fx.cleanup();
    restore();
  }
});

test('identity-echo mismatch (wrong headSha): author-invalid names the field', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn([
      (prompt) => writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(prompt, { headSha: 'wrong000' })),
    ], prompts);
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'author-invalid');
    assert.ok(/headSha/.test((res as { detail: string }).detail));
    assert.ok(/headSha/.test(prompts[1] ?? ''), 'retry prompt names the mismatched field');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('empty findings array: a legal explicit clean pass', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const qf = stubQueryFn([
      (prompt) => writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(prompt, { findings: [], summary: 'clean pass — no findings' })),
    ]);
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'complete');
    const authored = events.find((e) => e.message === 'review.findings.authored');
    assert.equal((authored!.metadata as Record<string, unknown>).total, 0);
  } finally {
    fx.cleanup();
    restore();
  }
});

test('scope guard: reviewer edits project code → hard scope-violation', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    const qf = stubQueryFn([
      (prompt) => {
        writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(prompt));
        writeFileSync(join(fx.worktree, 'src.ts'), 'export const v = 99; // reviewer edit\n');
      },
    ], prompts);
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'scope-violation');
    assert.ok((res as { detail: string }).detail.includes('src.ts'));
    assert.equal(prompts.length, 1);
    assert.ok(events.some((e) => e.message === 'review.scope-violation'));
  } finally {
    fx.cleanup();
    restore();
  }
});

test('kills "a budget kill is reported anonymously": the failure NAMES the work item whose chunk was too large (ruling 290)', async () => {
  // G2's failure read `adversarial-review spawn terminated by the SDK
  // (error_max_turns) — raise the declared budgets or shrink the diff`. It named
  // nothing, so the only actions it suggested were the two that must not be
  // taken: widen the budget, or guess which part of the diff was the problem.
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    let calls = 0;
    const qf = ((_p: { prompt: string }) => {
      calls += 1;
      async function* gen(): AsyncGenerator<unknown> {
        yield { type: 'result', subtype: 'error_max_turns', total_cost_usd: 1.0, usage: { input_tokens: 1, output_tokens: 1 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'budget-exhausted');
    const detail = (res as { detail: string }).detail;
    assert.match(detail, /^WI-1 is too large for review/, 'the message opens with the work item, not with the SDK');
    assert.match(detail, /Split the work item, not the budget/, 'and it names the action that is allowed');
    assert.doesNotMatch(detail, /raise the declared budgets/, 'widening the budget is exactly what must not be suggested');
    assert.equal(calls, 1, 'no retry, and no later chunk is attempted once one has failed');
    const evt = events.find((e) => e.message === 'review.budget-exhausted');
    assert.equal((evt!.metadata as Record<string, unknown>).chunk, 'WI-1');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('budget-exhausted spawn: hard failure, one call', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger } = collectLogger(fx.logsRoot);
    let calls = 0;
    const qf = ((_p: { prompt: string }) => {
      calls += 1;
      async function* gen(): AsyncGenerator<unknown> {
        yield { type: 'result', subtype: 'error_max_budget_usd', total_cost_usd: 2.0, usage: { input_tokens: 1, output_tokens: 1 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'budget-exhausted');
    assert.equal(calls, 1);
  } finally {
    fx.cleanup();
    restore();
  }
});

test('spawn suppression: failed/spawn-suppressed, never a fake review', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    process.env.FORGE_ARCHITECT_NO_SPAWN = '1';
    const { logger, events } = collectLogger(fx.logsRoot);
    const res = await run(fx, undefined, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'spawn-suppressed');
    assert.ok(events.some((e) => e.message === 'review.spawn-suppressed'));
  } finally {
    fx.cleanup();
    restore();
  }
});

test('assertAdversarialReviewDeclaration: the tool fence is an ALLOWLIST — every way to execute is refused, including by delegation', () => {
  const base = {
    budgets: { maxTurns: 10, maxBudgetUsd: 1 },
    allowedTools: ['Read', 'Grep', 'Glob'],
    disallowedTools: ['Bash', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task', 'Agent', 'WebFetch', 'WebSearch'],
  };
  assert.doesNotThrow(() => assertAdversarialReviewDeclaration(base));

  // `Write` on EITHER list breaks the fence in opposite directions: allowed, the
  // SDK pre-approves it and never routes the call through `canUseTool`;
  // disallowed, the reviewer cannot author its findings at all (T1 ruling 249).
  assert.throws(
    () => assertAdversarialReviewDeclaration({ ...base, allowedTools: [...base.allowedTools, 'Write'] }),
    /leave Write off BOTH lists/,
  );
  assert.throws(
    () => assertAdversarialReviewDeclaration({ ...base, disallowedTools: [...base.disallowedTools, 'Write'] }),
    /leave Write off BOTH lists/,
  );
  assert.throws(() => assertAdversarialReviewDeclaration({ ...base, budgets: { maxBudgetUsd: 1 } }), /maxTurns/);
  assert.throws(() => assertAdversarialReviewDeclaration({ ...base, budgets: { maxTurns: 10 } }), /silent-spend/);

  // The three the old DENYLIST named…
  for (const tool of ['Edit', 'MultiEdit', 'Bash']) {
    assert.throws(() => assertAdversarialReviewDeclaration({ ...base, allowedTools: [...base.allowedTools, tool] }), /judges and never runs or edits/);
  }
  // …and the ones it did not, each of which reaches execution: Task and Agent by
  // DELEGATION to a subagent that has Bash, NotebookEdit by running a cell,
  // WebFetch/WebSearch by leaving the machine. A denylist of three names over an
  // open tool vocabulary was decorative; this is the case that proves it.
  for (const tool of ['Task', 'Agent', 'NotebookEdit', 'WebFetch', 'WebSearch', 'SomeToolTheSdkAddsNextYear']) {
    assert.throws(
      () => assertAdversarialReviewDeclaration({ ...base, allowedTools: [...base.allowedTools, tool] }),
      new RegExp(tool),
      `${tool} must be refused by the allowlist`,
    );
  }
  // An empty allow-list is not a fence: each execution tool must ALSO be named
  // in disallowedTools, because that is the list that reaches the SDK.
  for (const tool of ['Bash', 'Task', 'NotebookEdit']) {
    assert.throws(
      () => assertAdversarialReviewDeclaration({ ...base, disallowedTools: base.disallowedTools.filter((t) => t !== tool) }),
      new RegExp(`must DISALLOW ${tool}`),
    );
  }
});

test('gitignored .forge/: an agent write under an ignored .forge tree is still a scope-violation', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    // Make the whole .forge/ tree gitignored (the betterado/trafficGame layout
    // that defeated the porcelain path-set guard — review finding #0).
    writeFileSync(join(fx.worktree, '.gitignore'), '.forge/\n');
    fx.git(['add', '.gitignore']);
    fx.git(['commit', '-q', '-m', 'ignore .forge']);
    const { logger, events } = collectLogger(fx.logsRoot);
    const qf = stubQueryFn([
      (prompt) => {
        writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(prompt));
        writeFileSync(join(fx.worktree, '.forge', 'evil.md'), 'smuggled under the ignored tree');
      },
    ]);
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'scope-violation');
    assert.ok((res as { detail: string }).detail.includes('.forge/evil.md'));
    assert.ok(events.some((e) => e.message === 'review.scope-violation'));
  } finally {
    fx.cleanup();
    restore();
  }
});

test('error_during_execution: spawn-failed, never budget-exhausted misdiagnosis', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger } = collectLogger(fx.logsRoot);
    const qf = ((_p: { prompt: string }) => {
      async function* gen(): AsyncGenerator<unknown> {
        yield { type: 'result', subtype: 'error_during_execution', total_cost_usd: 0.1, usage: { input_tokens: 1, output_tokens: 1 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;
    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'failed');
    assert.equal((res as { reason: string }).reason, 'spawn-failed');
    assert.ok(!/raise the declared budgets/.test((res as { detail: string }).detail));
  } finally {
    fx.cleanup();
    restore();
  }
});
