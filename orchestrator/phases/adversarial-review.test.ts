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
import { createLogger, type EventLogEntry } from '../logging.ts';
import { serializeWorkItem, type WorkItem } from '../work-item.ts';
import { reviewFindingsJsonPath, validateReviewFindings } from '../flow-artifacts.ts';
import type { StreamQueryFn } from '../pinned-sdk-query.ts';

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

function wiFixture(): WorkItem {
  return {
    work_item_id: 'WI-1',
    initiative_id: INIT_ID,
    status: 'complete',
    depends_on: [],
    acceptance_criteria: [{ given: 'a request', when: 'handled', then: 'it returns 200' }],
    files_in_scope: ['src.ts'],
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

function makeFixture(): Fixture {
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
  writeFileSync(join(worktree, '.forge', 'work-items', 'WI-1.md'), serializeWorkItem(wiFixture()));
  writeFileSync(join(worktree, 'src.ts'), 'export const v = 1;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'main baseline']);
  git(['push', '-q', 'origin', 'main']);
  git(['checkout', '-q', '-b', `feat/${INIT_ID}`]);
  writeFileSync(join(worktree, 'src.ts'), 'export const v = 2;\n');
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

function validFindingsJson(prompt: string, overrides: Record<string, unknown> = {}): string {
  const id = identityFromPrompt(prompt);
  return JSON.stringify({
    ...id,
    reviewedAt: '2026-07-24T00:00:00.000Z',
    summary: 'one major correctness finding',
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
    { initiativeId: INIT_ID, worktreePath: fx.worktree, cycleId: CYCLE_ID, logsRoot: fx.logsRoot, projectName: 'fix' },
    logger,
    { queryFn },
  );
}

test('happy path: findings harvested + persisted, worktree scrubbed, briefing carries diff/ACs/demo-proof', async () => {
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
    assert.deepEqual(validateReviewFindings(rec), []);
    assert.equal(rec.findings[0].id, 'RF-1');
    // Worktree scrubbed — nothing untracked left to block a later merge.
    assert.ok(!existsSync(join(fx.worktree, '.forge', 'review-findings.json')), 'findings worktree copy deleted');
    assert.ok(!existsSync(join(fx.worktree, '.forge', 'review-input')), 'review-input dir deleted');
    // Briefing content.
    assert.ok(prompts[0]!.includes('.forge/review-input/diff.patch'));
    assert.ok(prompts[0]!.includes('(WI-1) GIVEN a request WHEN handled THEN it returns 200'));
    assert.ok(prompts[0]!.includes('the checkpoint shows 200'), 'demo acEvaluations inlined');
    // The assembled diff really contains the change.
    assert.ok(events.some((e) => e.message === 'review.input.assembled'));
    const authored = events.find((e) => e.message === 'review.findings.authored');
    assert.ok(authored);
    assert.equal((authored!.metadata as Record<string, unknown>).major, 1);
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
    assert.equal(prompts.length, 2);
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

test('assertAdversarialReviewDeclaration: budget guards + no-Edit guard throw with vectors named', () => {
  const base = { budgets: { maxTurns: 10, maxBudgetUsd: 1 }, allowedTools: ['Read', 'Grep', 'Glob', 'Write'] };
  assert.doesNotThrow(() => assertAdversarialReviewDeclaration(base));
  assert.throws(() => assertAdversarialReviewDeclaration({ ...base, budgets: { maxBudgetUsd: 1 } }), /maxTurns/);
  assert.throws(() => assertAdversarialReviewDeclaration({ ...base, budgets: { maxTurns: 10 } }), /silent-spend/);
  assert.throws(
    () => assertAdversarialReviewDeclaration({ ...base, allowedTools: ['Read', 'Edit', 'Write'] }),
    /never edits/,
  );
});
