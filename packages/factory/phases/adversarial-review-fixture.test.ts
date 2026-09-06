/**
 * The adversarial-review pipeline's TEST HARNESS, shared by the two suites that
 * drive it: `adversarial-review.test.ts` (the pipeline itself) and
 * `adversarial-review-chunking.test.ts` (how the review is cut and bought).
 *
 * It lives in one file because both suites must drive the SAME fixture: a real
 * bare origin + clone, a work item, a branch commit and a seeded demo AC-proof.
 * Two copies of a harness are two harnesses the day one of them is edited, and
 * the split that made this file necessary was a size cap, not a difference of
 * intent (ruling 150 — split by concern, never baseline).
 *
 * Named `*.test.ts` deliberately: `check-owner`'s `NOT_PRODUCTION` rule keys on
 * that suffix, so the harness is test code by the repo's own definition rather
 * than by a comment. It declares no tests, and a test file with none passes.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runAdversarialReview, type AdversarialReviewResult } from './adversarial-review.ts';
import { createLogger, type EventLogEntry } from '@forge/kernel';
import { serializeWorkItem, type WorkItem } from '@forge/flows/work-item.ts';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';

export const INIT_ID = 'INIT-2026-07-24-rev';
export const CYCLE_ID = 'CY-rev-1';

export function withoutSpawnSuppressionEnv(): () => void {
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

export type Fixture = {
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
export function makeFixture(extraFiles: readonly string[] = []): Fixture {
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
export function identityFromPrompt(prompt: string): { initiative_id: string; cycleId: string; baseRef: string; headSha: string } {
  const grab = (k: string): string => {
    const m = new RegExp(`- ${k}: \`([^\`]+)\``).exec(prompt);
    assert.ok(m, `prompt carries ${k}`);
    return m![1]!;
  };
  return { initiative_id: grab('initiative_id'), cycleId: grab('cycleId'), baseRef: grab('baseRef'), headSha: grab('headSha') };
}

/** The `code` class's lenses and the fixture's one criterion, verbatim — the
 *  review record is now checked against BOTH by exact membership. */
export const CODE_LENSES = ['correctness', 'containment', 'test-strength', 'boundary'];
export const CRITERION = '(WI-1) GIVEN a request WHEN handled THEN it returns 200';

/** What every record in this file is validated against (the run's own facts). */
export const EXPECTED = { lenses: CODE_LENSES, criteria: [CRITERION] };

/**
 * The acceptance criteria THIS prompt injected, verbatim. The pipeline reviews
 * per work item (bead forge-8vfn.6.10.24), so each spawn is shown only its own
 * chunk's criteria and a stub that always echoed a fixed one would be judging a
 * criterion its prompt never declared — which the validator rejects, correctly.
 */
export function criteriaFromPrompt(prompt: string): string[] {
  return [...prompt.matchAll(/^\d+\. (\(WI-[^)]+\) GIVEN .+)$/gm)].map((m) => m[1]!);
}

export function validFindingsJson(prompt: string, overrides: Record<string, unknown> = {}): string {
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

export function stubQueryFn(writers: Array<(prompt: string) => void>, calls: string[] = []): StreamQueryFn {
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

export function collectLogger(logsRoot: string): { logger: ReturnType<typeof createLogger>; events: EventLogEntry[] } {
  const events: EventLogEntry[] = [];
  const logger = createLogger(CYCLE_ID, logsRoot, { tee: (e) => events.push(e) });
  return { logger, events };
}

export async function run(
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
