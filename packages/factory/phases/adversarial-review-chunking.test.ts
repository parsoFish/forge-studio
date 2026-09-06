/**
 * How the adversarial review is CUT and BOUGHT.
 *
 * Three beads, one concern, and each was written from a real run rather than
 * from a design: the review is chunked per WORK ITEM (6.10.24), a work item too
 * large for one pass is re-reviewed per FILE (6.10.26), and every chunk and every
 * part of a split is bought exactly once (6.10.27, `forge-6fvw`).
 *
 * The pipeline itself is `adversarial-review.test.ts`; the fixture both drive is
 * `adversarial-review-fixture.test.ts`.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { reviewFindingsJsonPath, validateReviewFindings } from '@forge/flows/flow-artifacts.ts';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';

import {
  CRITERION, CYCLE_ID, EXPECTED, collectLogger, makeFixture, run, validFindingsJson,
  withoutSpawnSuppressionEnv, type Fixture,
} from './adversarial-review-fixture.test.ts';

// ---------------------------------------------------------------------------
// Bead forge-8vfn.6.10.26 — a work item too large for ONE review pass is
// re-reviewed per FILE.
//
// G2's resume (2026-09-06) measured the premise `review-chunks.ts` was written
// on: "the chunk is the work item, which introduces NO NEW NUMBER — the PM
// already bounded it". `review.agent-pass chunk=WI-1` succeeded and
// `review.budget-exhausted chunk=WI-2` followed on eight files, so a work item
// the developer built at `iters=1` still exceeded the reviewer's 50 turns. The
// PM's bound is developer-shaped (can one agent BUILD it); the reviewer's load
// is diff-shaped (how much must be READ and judged per criterion).
//
// The file is the smallest unit the diff already has — no threshold is invented
// here either, and the work item stays the chunk that owns the criteria.
// ---------------------------------------------------------------------------

/** Count how many of `files` the rendered prompt lists as changed. */
function changedFileCount(prompt: string, files: readonly string[]): number {
  return files.filter((f) => prompt.includes(`- \`${f}\``)).length;
}

const THREE = ['a.ts', 'b.ts'] as const; // + src.ts from the base fixture = three

test('kills "a work item too large for one pass just fails": the chunk is re-reviewed PER FILE and the review completes', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture(THREE);
  const all = ['src.ts', ...THREE];
  try {
    const { logger, events } = collectLogger(fx.logsRoot);
    const prompts: string[] = [];
    // The stub reproduces G2's shape rather than a convenient one: the whole
    // work item exhausts, one file at a time does not.
    const qf = ((params: { prompt: string }) => {
      prompts.push(params.prompt);
      const n = changedFileCount(params.prompt, all);
      async function* gen(): AsyncGenerator<unknown> {
        if (n > 1) {
          yield { type: 'result', subtype: 'error_max_turns', total_cost_usd: 1.5, usage: { input_tokens: 1, output_tokens: 1 } };
          return;
        }
        writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(params.prompt));
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.2, usage: { input_tokens: 5, output_tokens: 7 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;

    const res = await run(fx, qf, logger);
    assert.equal(res.status, 'complete', `the split must rescue the review, got ${JSON.stringify(res)}`);
    // 1 whole-work-item pass that exhausted + 3 per-file passes + the
    // `unattributed` chunk (the branch's seeded `demo/<init>/demo.json`, which
    // no work item claims). The split changes ONE chunk's shape and leaves the
    // partition around it alone — which is the other half of the claim.
    assert.equal(prompts.length, 5, 'one whole-work-item pass that exhausted, then one pass per file, then the unattributed chunk');

    const split = events.find((e) => e.message === 'review.chunk.split');
    assert.ok(split, 'the split is an EVENT — a review that silently changes shape is unauditable');
    assert.equal((split!.metadata as Record<string, unknown>).chunk, 'WI-1');
    assert.equal((split!.metadata as Record<string, unknown>).files, 3);

    const record = JSON.parse(readFileSync(reviewFindingsJsonPath(fx.logsRoot, CYCLE_ID), 'utf8'));
    assert.deepEqual(validateReviewFindings(record, EXPECTED), [], 'the merged record still satisfies the artifact contract');
    // Provenance survives the split: work item AND file, without a new field.
    const splitIds = record.findings.map((f: { id: string }) => f.id).filter((id: string) => id.startsWith('WI-1/'));
    for (const id of splitIds) {
      assert.match(id, /^WI-1\/(src|a|b)\.ts\/RF-1$/, `finding id must name its work item AND its file, got ${id}`);
    }
    assert.equal(splitIds.length, 3, 'one finding per per-file pass, none dropped in the merge');
    assert.ok(
      record.findings.some((f: { id: string }) => f.id === 'unattributed/RF-1'),
      'the chunk that did NOT split keeps its own single-level id — the split is local to the work item that needed it',
    );
    // The criterion is judged ONCE. Three per-file passes each judged it; a
    // merged record repeating it three times, possibly disagreeing, would be a
    // verdict a reader cannot act on.
    assert.deepEqual(record.acEvaluations.map((e: { criterion: string }) => e.criterion), [CRITERION]);
  } finally {
    fx.cleanup();
    restore();
  }
});

test('kills "the split hides an unreviewable file": a SINGLE file that exhausts fails loudly and NAMES the file', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture(THREE);
  try {
    const { logger } = collectLogger(fx.logsRoot);
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
    assert.match(detail, /SINGLE file/, 'the message says the split has bottomed out');
    assert.match(detail, /src\.ts|a\.ts|b\.ts/, 'and it names the file, which is the only actionable fact left');
    assert.doesNotMatch(detail, /raise the declared budgets/, 'widening the budget is still what must not be suggested');
    assert.equal(calls, 2, 'the work item pass, then the FIRST file — a bottomed-out split stops, it does not grind through the rest');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('kills "a sub-chunk is reviewed under a weaker fence": every per-file spawn gets the SAME bag, and the fence is proven by execution', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture(THREE);
  const all = ['src.ts', ...THREE];
  try {
    const { logger } = collectLogger(fx.logsRoot);
    const bags: Array<Record<string, unknown>> = [];
    const qf = ((params: { prompt: string; options?: Record<string, unknown> }) => {
      bags.push(params.options ?? {});
      const n = changedFileCount(params.prompt, all);
      async function* gen(): AsyncGenerator<unknown> {
        if (n > 1) {
          yield { type: 'result', subtype: 'error_max_turns', total_cost_usd: 1.5, usage: { input_tokens: 1, output_tokens: 1 } };
          return;
        }
        writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(params.prompt));
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.2, usage: { input_tokens: 5, output_tokens: 7 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;

    assert.equal((await run(fx, qf, logger)).status, 'complete');
    assert.equal(bags.length, 5, 'the exhausted pass, three per-file passes, and the unattributed chunk');

    // The three settings that ARE the fence, on every bag the SDK received —
    // compared across bags, not against a literal, so a change that weakens all
    // four at once still cannot pass this by agreeing with itself.
    const fenceOf = (o: Record<string, unknown>): string =>
      JSON.stringify({
        permissionMode: o.permissionMode,
        allowedTools: o.allowedTools,
        disallowedTools: o.disallowedTools,
        hasHandler: typeof o.canUseTool === 'function',
      });
    for (const bag of bags) assert.equal(fenceOf(bag), fenceOf(bags[0]!), 'a sub-chunk was spawned under a different fence');
    assert.equal((bags[0]! as { permissionMode?: string }).permissionMode, 'default');
    assert.ok(!((bags[0]!.allowedTools as string[]) ?? []).includes('Write'), 'a pre-approved Write skips the fence');
    assert.ok(!((bags[0]!.disallowedTools as string[]) ?? []).includes('Write'), 'a forbidden Write cannot author the findings');

    // Executed, not read (§15.194) — the LAST sub-chunk's own handler.
    const canUseTool = bags[bags.length - 1]!.canUseTool as
      | ((tool: string, input: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ behavior: string }>)
      | undefined;
    assert.equal(typeof canUseTool, 'function');
    assert.equal((await canUseTool!('Write', { file_path: join(fx.worktree, '.forge', 'review-findings.json') }, {})).behavior, 'allow');
    assert.equal((await canUseTool!('Write', { file_path: join(fx.worktree, 'src.ts') }, {})).behavior, 'deny');
    assert.equal((await canUseTool!('Write', { file_path: join(fx.root, 'escape.txt') }, {})).behavior, 'deny');
  } finally {
    fx.cleanup();
    restore();
  }
});

// ---------------------------------------------------------------------------
// Bead forge-8vfn.6.10.27 — a completed chunk's review is bought ONCE.
//
// G2's resume paid for `WI-1`, `WI-2` exhausted, and the pipeline returned a
// failure — so `WI-1`'s finished record died with it. The cycle already solves
// exactly this one level up (`resume_from: demo` reuses the six finished work
// items); the review solved it for nothing one level down.
// ---------------------------------------------------------------------------

/** A stub that always authors a valid record, counting its spawns. */
function countingStub(fx: Fixture, calls: { n: number }): StreamQueryFn {
  return ((params: { prompt: string }) => {
    calls.n += 1;
    async function* gen(): AsyncGenerator<unknown> {
      writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(params.prompt));
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.2, usage: { input_tokens: 5, output_tokens: 7 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

test('kills "a failed pass throws away the chunks that passed": the completed chunk is persisted and the next pass reuses it', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    // Pass 1: the work-item chunk succeeds, the `unattributed` chunk (the
    // seeded demo.json) exhausts on its single file — G2's shape exactly.
    const { logger: l1, events: e1 } = collectLogger(fx.logsRoot);
    let seen = 0;
    const failing = ((params: { prompt: string }) => {
      seen += 1;
      const first = seen === 1;
      async function* gen(): AsyncGenerator<unknown> {
        if (!first) {
          yield { type: 'result', subtype: 'error_max_turns', total_cost_usd: 1.0, usage: { input_tokens: 1, output_tokens: 1 } };
          return;
        }
        writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(params.prompt));
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.2, usage: { input_tokens: 5, output_tokens: 7 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;

    assert.equal((await run(fx, failing, l1)).status, 'failed', 'the second chunk must still fail the pass');
    assert.equal(seen, 2);
    const persisted = e1.find((e) => e.message === 'review.chunk.persisted');
    assert.ok(persisted, 'the chunk that COMPLETED is persisted before the next one is attempted');
    assert.equal((persisted!.metadata as Record<string, unknown>).index, '0');
    assert.ok(existsSync(join(fx.logsRoot, CYCLE_ID, 'artifacts', 'review-chunks', 'chunk-0.json')));

    // Pass 2: nothing fails now. The first chunk must NOT be spawned again.
    const { logger: l2, events: e2 } = collectLogger(fx.logsRoot);
    const calls = { n: 0 };
    assert.equal((await run(fx, countingStub(fx, calls), l2)).status, 'complete');
    assert.equal(calls.n, 1, 'only the chunk without a persisted result is bought — the resume problem, solved one level down');
    const reused = e2.find((e) => e.message === 'review.chunk.reused');
    assert.ok(reused, 'and the reuse is an EVENT, so a review assembled from parts is auditable');
    assert.equal((reused!.metadata as Record<string, unknown>).index, '0');

    // The merged artifact assembles from the parts and is validated ONCE.
    const record = JSON.parse(readFileSync(reviewFindingsJsonPath(fx.logsRoot, CYCLE_ID), 'utf8'));
    assert.deepEqual(validateReviewFindings(record, EXPECTED), []);
  } finally {
    fx.cleanup();
    restore();
  }
});

test('kills "a record whose CONTENT changed is reused": a chunk whose diff moved is re-reviewed, and one whose diff did not is not', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger: l1 } = collectLogger(fx.logsRoot);
    const first = { n: 0 };
    assert.equal((await run(fx, countingStub(fx, first), l1)).status, 'complete');
    assert.equal(first.n, 2, 'both chunks bought on a cold store');

    // A REAL content change to the file WI-1 owns. Its diff moves, so its record
    // is worthless — that is what the staleness guard is for. The unattributed
    // chunk's diff is untouched, so its record is still exactly true.
    writeFileSync(join(fx.worktree, 'src.ts'), 'export const v = 3;\n');
    fx.git(['add', '-A']);
    fx.git(['commit', '-q', '-m', 'a real change to the reviewed file']);

    const { logger: l2, events: e2 } = collectLogger(fx.logsRoot);
    const second = { n: 0 };
    assert.equal((await run(fx, countingStub(fx, second), l2)).status, 'complete');
    assert.equal(second.n, 1, 'the changed chunk is re-reviewed; the unchanged one is not bought twice');
    const reused = e2.filter((e) => e.message === 'review.chunk.reused');
    assert.equal(reused.length, 1);
    assert.equal((reused[0]!.metadata as Record<string, unknown>).chunk, 'unattributed');
  } finally {
    fx.cleanup();
    restore();
  }
});

test('kills "a bookkeeping commit discards the review": the orchestrator\'s OWN commits move the head, and a review keyed on the head dies with them', async () => {
  // MEASURED on G2 (ledger, 2026-09-06): the integrate band commits twice on
  // every run — `chore(developer-loop): pre-review boundary snapshot` and
  // `chore(demo): demo artifacts` — so `headSha` differed on every attempt and
  // every persisted record was rejected as stale. The store worked perfectly
  // within one pass and was dead across the only boundary that matters.
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger: l1 } = collectLogger(fx.logsRoot);
    const first = { n: 0 };
    assert.equal((await run(fx, countingStub(fx, first), l1)).status, 'complete');
    assert.equal(first.n, 2);
    const headBefore = fx.git(['rev-parse', 'HEAD']).trim();

    // The orchestrator's own bookkeeping: a commit that touches NOTHING any work
    // item declared. WI-1's diff is byte-identical afterwards.
    writeFileSync(join(fx.worktree, 'bookkeeping.md'), 'demo artifacts\n');
    fx.git(['add', '-A']);
    fx.git(['commit', '-q', '-m', 'chore(demo): demo artifacts']);
    const headAfter = fx.git(['rev-parse', 'HEAD']).trim();
    assert.notEqual(headAfter, headBefore, 'the fixture must actually move the head, or it proves nothing');

    const { logger: l2, events: e2 } = collectLogger(fx.logsRoot);
    const second = { n: 0 };
    assert.equal((await run(fx, countingStub(fx, second), l2)).status, 'complete');
    // WI-1 is reused: its diff did not move. The unattributed chunk IS re-bought,
    // and correctly — the bookkeeping file is now part of its diff.
    assert.equal(second.n, 1, 'a review must survive the orchestrator writing its own artifacts');
    const reused = e2.filter((e) => e.message === 'review.chunk.reused');
    assert.equal(reused.length, 1);
    assert.equal((reused[0]!.metadata as Record<string, unknown>).chunk, 'WI-1');

    // And the reused record is RE-STAMPED: `mergeChunkRecords` takes the identity
    // from the first record, so a reused one carrying its old head would publish
    // a review of a head nobody is merging.
    const record = JSON.parse(readFileSync(reviewFindingsJsonPath(fx.logsRoot, CYCLE_ID), 'utf8'));
    assert.equal(record.headSha, headAfter, 'the merged artifact must name THIS run head, not the head the reused chunk was reviewed at');
    assert.deepEqual(validateReviewFindings(record, EXPECTED), []);
  } finally {
    fx.cleanup();
    restore();
  }
});

test('kills "the index alone decides": a record whose stored LABEL is not this chunk is a miss', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger } = collectLogger(fx.logsRoot);
    const calls = { n: 0 };
    assert.equal((await run(fx, countingStub(fx, calls), logger)).status, 'complete');
    assert.equal(calls.n, 2);

    // Rewrite chunk-0 with a label that is not WI-1 — the shape a reordered
    // partition would leave behind.
    const p = join(fx.logsRoot, CYCLE_ID, 'artifacts', 'review-chunks', 'chunk-0.json');
    const stored = JSON.parse(readFileSync(p, 'utf8'));
    writeFileSync(p, JSON.stringify({ ...stored, label: 'WI-99' }, null, 2) + '\n');

    const { logger: l2, events: e2 } = collectLogger(fx.logsRoot);
    const again = { n: 0 };
    assert.equal((await run(fx, countingStub(fx, again), l2)).status, 'complete');
    // ONE spawn, not two: the mislabelled index is a miss and is re-bought, and
    // the chunk beside it — untouched, correctly labelled — is still reused. The
    // miss is scoped to the record that lied about itself.
    assert.equal(again.n, 1, 'the mislabelled record is ignored — an index that means something else is a miss, never a wrong answer');
    const stillReused = e2.filter((e) => e.message === 'review.chunk.reused');
    assert.equal(stillReused.length, 1);
    assert.equal((stillReused[0]!.metadata as Record<string, unknown>).index, '1');
  } finally {
    fx.cleanup();
    restore();
  }
});

// ---------------------------------------------------------------------------
// Bead forge-6fvw — the split's own parts are bought once too.
//
// Found by watching 6.10.26 and 6.10.27 run together on G2's second resume:
// persistence is per CHUNK, the split happens INSIDE a chunk, so a run stopped
// mid-split discards every per-file review already paid for. Measured: WI-2's
// first per-file review cost $0.9142 and would have been lost.
// ---------------------------------------------------------------------------

test('kills "a stopped split is paid for twice": each per-file record persists, and the next pass skips both it and the doomed whole-work-item attempt', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture(THREE);
  const all = ['src.ts', ...THREE];
  try {
    // Pass 1: the work item exhausts, splits into three; the FIRST file is
    // reviewed and the second bottoms out — G2 resume 2's shape exactly.
    const { logger: l1, events: e1 } = collectLogger(fx.logsRoot);
    let perFile = 0;
    const stopMidSplit = ((params: { prompt: string }) => {
      const n = changedFileCount(params.prompt, all);
      const isSub = n === 1;
      if (isSub) perFile += 1;
      const bottomOut = isSub && perFile === 2;
      async function* gen(): AsyncGenerator<unknown> {
        if (!isSub || bottomOut) {
          yield { type: 'result', subtype: 'error_max_turns', total_cost_usd: 0.9, usage: { input_tokens: 1, output_tokens: 1 } };
          return;
        }
        writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(params.prompt));
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.9, usage: { input_tokens: 5, output_tokens: 7 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;

    assert.equal((await run(fx, stopMidSplit, l1)).status, 'failed');
    const persisted = e1.filter((e) => e.message === 'review.chunk.persisted');
    assert.equal(persisted.length, 1, 'the ONE per-file review that completed is persisted, on its own, before the next is attempted');
    assert.equal((persisted[0]!.metadata as Record<string, unknown>).index, '0.0');
    assert.ok(existsSync(join(fx.logsRoot, CYCLE_ID, 'artifacts', 'review-chunks', 'chunk-0.0.json')));

    // Pass 2: nothing fails. The persisted per-file record is REUSED, and the
    // whole-work-item attempt — which can only exhaust again, at full price —
    // is not made at all.
    const { logger: l2, events: e2 } = collectLogger(fx.logsRoot);
    const calls = { n: 0 };
    assert.equal((await run(fx, countingStub(fx, calls), l2)).status, 'complete');
    assert.equal(calls.n, 3, 'two remaining files and the unattributed chunk — NOT the reused file, and NOT the work-item attempt that is known to exhaust at this head');
    const reused = e2.filter((e) => e.message === 'review.chunk.reused');
    assert.equal(reused.length, 1);
    assert.equal((reused[0]!.metadata as Record<string, unknown>).index, '0.0');
    // The split is re-entered without re-deriving it from a failure.
    assert.equal(e2.filter((e) => e.message === 'review.chunk.split').length, 1);
    assert.equal(e2.filter((e) => e.message === 'review.budget-exhausted').length, 0, 'no spawn was made whose only possible outcome was the exhaustion already recorded');

    const record = JSON.parse(readFileSync(reviewFindingsJsonPath(fx.logsRoot, CYCLE_ID), 'utf8'));
    assert.deepEqual(validateReviewFindings(record, EXPECTED), []);
  } finally {
    fx.cleanup();
    restore();
  }
});
