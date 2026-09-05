/**
 * Tests for the R4-08-F1 adversarial-review pipeline — input assembly (real
 * git fixtures), spawn (stubbed queryFn), harvest/validate (+ bounded retry,
 * identity-echo verification), the mechanical scope guard, budget-exhaustion,
 * suppression, and worktree scrubbing (no untracked leftovers).
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  runAdversarialReview,
  assertAdversarialReviewDeclaration,
  type AdversarialReviewResult,
} from './adversarial-review.ts';
import { createLogger, type EventLogEntry } from '@forge/kernel';
import { serializeWorkItem, type WorkItem } from '@forge/flows/work-item.ts';
import { reviewFindingsJsonPath, validateReviewFindings } from '@forge/flows/flow-artifacts.ts';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';

const INIT_ID = 'INIT-2026-07-24-rev';
const CYCLE_ID = 'CY-rev-1';

function withoutSpawnSuppressionEnv(): () => void {
  const priorNoSpawn = process.env.FORGE_ARCHITECT_NO_SPAWN;
  const priorDryBridge = process.env.FORGE_DRY_BRIDGE;
  delete process.env.FORGE_ARCHITECT_NO_SPAWN;
  delete process.env.FORGE_DRY_BRIDGE;
  return () => {
    if (priorNoSpawn === undefined) delete process.env.FORGE_ARCHITECT_NO_SPAWN;
    else process.env.FORGE_ARCHITECT_NO_SPAWN = priorNoSpawn;
    if (priorDryBridge === undefined) delete process.env.FORGE_DRY_BRIDGE;
    else process.env.FORGE_DRY_BRIDGE = priorDryBridge;
  };
}

function wiFixture(extraFiles: readonly string[] = []): WorkItem {
  return {
    work_item_id: 'WI-1',
    initiative_id: INIT_ID,
    status: 'complete',
    depends_on: [],
    acceptance_criteria: [{ given: 'a request', when: 'handled', then: 'it returns 200' }],
    files_in_scope: ['src.ts', ...extraFiles],
    estimated_iterations: 1,
    quality_gate_cmd: ['echo', 'gate-ok'],
    body: 'Build the handler.',
  };
}

type Fixture = {
  root: string;
  worktree: string;
  logsRoot: string;
  git: (args: string[]) => string;
  cleanup: () => void;
};

/**
 * `extraFiles` puts MORE THAN ONE file in WI-1's chunk — the only shape in which
 * the per-file re-review can be observed at all, since a one-file chunk has
 * nothing to split. Every existing caller passes nothing and gets exactly the
 * one-file fixture it had.
 */
function makeFixture(extraFiles: readonly string[] = []): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'adv-review-'));
  const bare = join(root, 'origin.git');
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' });
  const worktree = join(root, 'wt');
  execFileSync('git', ['clone', bare, worktree], { stdio: 'pipe' });
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: worktree, stdio: 'pipe', encoding: 'utf8' });
  git(['config', 'user.email', 'test@forge']);
  git(['config', 'user.name', 'forge-test']);
  git(['checkout', '-b', 'main']);
  mkdirSync(join(worktree, '.forge', 'work-items'), { recursive: true });
  writeFileSync(
    join(worktree, '.forge', 'project.json'),
    JSON.stringify({ testProcess: { local: { cmd: ['echo', 'gate-ok'] } } }),
  );
  writeFileSync(join(worktree, '.forge', 'work-items', 'WI-1.md'), serializeWorkItem(wiFixture(extraFiles)));
  writeFileSync(join(worktree, 'src.ts'), 'export const v = 1;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'main baseline']);
  git(['push', '-q', 'origin', 'main']);
  git(['checkout', '-q', '-b', `feat/${INIT_ID}`]);
  writeFileSync(join(worktree, 'src.ts'), 'export const v = 2;\n');
  for (const f of extraFiles) writeFileSync(join(worktree, f), `export const ${f.replace(/\W/g, '_')} = 2;\n`);
  // Seed the demo's AC-proof so the briefing inlines acEvaluations.
  mkdirSync(join(worktree, 'demo', INIT_ID), { recursive: true });
  writeFileSync(
    join(worktree, 'demo', INIT_ID, 'demo.json'),
    JSON.stringify({
      title: 't', essence: 'e', project: 'fix', initiativeId: INIT_ID, diffStat: '1 file changed',
      checkpoints: [{ label: 'l', caption: 'c', beforeNote: 'b', afterNote: 'a' }],
      acEvaluations: [{ criterion: '(WI-1) GIVEN a request WHEN handled THEN it returns 200', verdict: 'met', evidence: 'the checkpoint shows 200' }],
    }),
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: the change + demo']);
  git(['push', '-q', '-u', 'origin', `feat/${INIT_ID}`]);
  return { root, worktree, logsRoot: join(root, '_logs'), git, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Pull the injected identity back out of the rendered prompt (the stub echoes it). */
function identityFromPrompt(prompt: string): { initiative_id: string; cycleId: string; baseRef: string; headSha: string } {
  const grab = (k: string): string => {
    const m = new RegExp(`- ${k}: \`([^\`]+)\``).exec(prompt);
    assert.ok(m, `prompt carries ${k}`);
    return m![1]!;
  };
  return { initiative_id: grab('initiative_id'), cycleId: grab('cycleId'), baseRef: grab('baseRef'), headSha: grab('headSha') };
}

/** The `code` class's lenses and the fixture's one criterion, verbatim — the
 *  review record is now checked against BOTH by exact membership. */
const CODE_LENSES = ['correctness', 'containment', 'test-strength', 'boundary'];
const CRITERION = '(WI-1) GIVEN a request WHEN handled THEN it returns 200';

/** What every record in this file is validated against (the run's own facts). */
const EXPECTED = { lenses: CODE_LENSES, criteria: [CRITERION] };

/**
 * The acceptance criteria THIS prompt injected, verbatim. The pipeline reviews
 * per work item (bead forge-8vfn.6.10.24), so each spawn is shown only its own
 * chunk's criteria and a stub that always echoed a fixed one would be judging a
 * criterion its prompt never declared — which the validator rejects, correctly.
 */
function criteriaFromPrompt(prompt: string): string[] {
  return [...prompt.matchAll(/^\d+\. (\(WI-[^)]+\) GIVEN .+)$/gm)].map((m) => m[1]!);
}

function validFindingsJson(prompt: string, overrides: Record<string, unknown> = {}): string {
  const id = identityFromPrompt(prompt);
  return JSON.stringify({
    ...id,
    reviewedAt: '2026-07-24T00:00:00.000Z',
    summary: 'one major correctness finding',
    lenses: CODE_LENSES,
    acEvaluations: criteriaFromPrompt(prompt).map((criterion) => ({
      criterion, verdict: 'partial', evidence: 'the handler returns 200 only on the happy path',
    })),
    whyWhatHow: { why: 'the caller needs a 200', what: 'a handler', how: 'a slice bound' },
    findings: [
      {
        id: 'RF-1',
        severity: 'major',
        category: 'correctness',
        title: 'handler drops the last byte',
        detail: 'slice bound is exclusive where the caller expects inclusive',
        evidence: [{ file: 'src.ts', line: 1, excerpt: 'export const v = 2;' }],
      },
    ],
    ...overrides,
  });
}

function stubQueryFn(writers: Array<(prompt: string) => void>, calls: string[] = []): StreamQueryFn {
  let n = 0;
  return ((params: { prompt: string }) => {
    const i = n;
    n += 1;
    calls.push(params.prompt);
    const writer = writers[Math.min(i, writers.length - 1)]!;
    async function* gen(): AsyncGenerator<unknown> {
      writer(params.prompt);
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.2, usage: { input_tokens: 5, output_tokens: 7 } };
    }
    return gen();
  }) as unknown as StreamQueryFn;
}

function collectLogger(logsRoot: string): { logger: ReturnType<typeof createLogger>; events: EventLogEntry[] } {
  const events: EventLogEntry[] = [];
  const logger = createLogger(CYCLE_ID, logsRoot, { tee: (e) => events.push(e) });
  return { logger, events };
}

async function run(
  fx: Fixture,
  queryFn: StreamQueryFn | undefined,
  logger: ReturnType<typeof createLogger>,
): Promise<AdversarialReviewResult> {
  return runAdversarialReview(
    { initiativeId: INIT_ID, worktreePath: fx.worktree, cycleId: CYCLE_ID, logsRoot: fx.logsRoot, projectName: 'fix', changeClass: 'code' },
    logger,
    { queryFn },
  );
}

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
    assert.equal((persisted!.metadata as Record<string, unknown>).index, 0);
    assert.ok(existsSync(join(fx.logsRoot, CYCLE_ID, 'artifacts', 'review-chunks', 'chunk-0.json')));

    // Pass 2: nothing fails now. The first chunk must NOT be spawned again.
    const { logger: l2, events: e2 } = collectLogger(fx.logsRoot);
    const calls = { n: 0 };
    assert.equal((await run(fx, countingStub(fx, calls), l2)).status, 'complete');
    assert.equal(calls.n, 1, 'only the chunk without a persisted result is bought — the resume problem, solved one level down');
    const reused = e2.find((e) => e.message === 'review.chunk.reused');
    assert.ok(reused, 'and the reuse is an EVENT, so a review assembled from parts is auditable');
    assert.equal((reused!.metadata as Record<string, unknown>).index, 0);

    // The merged artifact assembles from the parts and is validated ONCE.
    const record = JSON.parse(readFileSync(reviewFindingsJsonPath(fx.logsRoot, CYCLE_ID), 'utf8'));
    assert.deepEqual(validateReviewFindings(record, EXPECTED), []);
  } finally {
    fx.cleanup();
    restore();
  }
});

test('kills "a stale record is reused": a chunk record authored against a DIFFERENT head is a miss, not an answer', async () => {
  const restore = withoutSpawnSuppressionEnv();
  const fx = makeFixture();
  try {
    const { logger: l1 } = collectLogger(fx.logsRoot);
    const first = { n: 0 };
    assert.equal((await run(fx, countingStub(fx, first), l1)).status, 'complete');
    assert.equal(first.n, 2, 'both chunks bought on a cold store');

    // The branch moves. Same files, same chunk indexes, different head — so a
    // reuse here would be a review of code nobody is merging.
    writeFileSync(join(fx.worktree, 'src.ts'), 'export const v = 3;\n');
    fx.git(['add', '-A']);
    fx.git(['commit', '-q', '-m', 'a later commit']);

    const { logger: l2, events: e2 } = collectLogger(fx.logsRoot);
    const second = { n: 0 };
    assert.equal((await run(fx, countingStub(fx, second), l2)).status, 'complete');
    assert.equal(second.n, 2, 'every chunk is re-reviewed against the new head');
    assert.equal(e2.filter((e) => e.message === 'review.chunk.reused').length, 0);
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
    assert.equal((stillReused[0]!.metadata as Record<string, unknown>).index, 1);
  } finally {
    fx.cleanup();
    restore();
  }
});
