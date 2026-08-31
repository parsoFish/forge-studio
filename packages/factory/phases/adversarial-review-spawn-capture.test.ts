/**
 * Characterization (golden) test — pins the EXACT `{prompt, options}` object
 * `runAdversarialReview` (`orchestrator/phases/adversarial-review.ts`) passes
 * into its injected `queryFn` today (via `runAgent`, `lifecycle: 'caller'`),
 * so the R4-01 `composition.hooks` → `composition.guards` vocabulary
 * migration can prove byte-level no-behavioural-delta.
 *
 * Injection: `opts.queryFn` (`AdversarialReviewInput`'s sibling `opts` param
 * on `runAdversarialReview`) — the SAME DI seam `adversarial-review.test.ts`
 * already uses (`stubQueryFn`). No production code changed for this test.
 *
 * Fixture setup mirrors `adversarial-review.test.ts`'s `makeFixture()` (bare
 * origin + clone, main baseline commit + a feature-branch commit carrying a
 * seeded `demo/<initiative>/demo.json` AC-proof, one work item) exactly, then
 * drives the "happy path" shape — a valid `.forge/review-findings.json` with
 * one finding, echoing the injected identity verbatim — so the pipeline
 * completes in ONE agent pass with no authoring retry. The FIRST (only)
 * `queryFn` call is what's captured.
 *
 * What's pinned: the full captured `{prompt, options}` — `cwd`, `systemPrompt`,
 * `model`, `permissionMode`, `allowedTools`, `disallowedTools`, `maxTurns`,
 * `maxBudgetUsd`, `abortController`, and the full rendered user prompt
 * (`renderAdversarialReviewUserPrompt`'s output — injected identity, ACs,
 * work items, changed files, the demo's acEvaluations, brain-3 context).
 *
 * Normalized (genuinely volatile, not a behavioural signal):
 *  - the mkdtemp root (appears in `cwd` and inside the prompt's changed-files
 *    references) -> `<TMP>`.
 *  - the `AbortController` instance the pipeline attaches to `options` (via
 *    its `streamGuard`) -> a fixed marker (a fresh controller is constructed
 *    every call; only its PRESENCE, not its identity, is a behavioural
 *    signal).
 *  - the real git commit SHA (`headSha`, embedded verbatim in the prompt's
 *    identity block) -> `<HEAD_SHA>`. Unlike the fixed literal `CYCLE_ID` the
 *    reflector fixture uses, a git commit SHA folds in wall-clock commit time
 *    (this fixture's two commits carry no frozen `GIT_AUTHOR_DATE`), so it is
 *    NOT stable across separate bootstrap runs and must be normalized for the
 *    fixture to compare equal on every re-run.
 *
 * Fixture-move note (ADR-027 R3-03 amendment, `composition.hooks` →
 * `composition.guards`, 2026-08-04): `adversarial-review.json` moved by
 * exactly one byte — `hook` → `guard` at a single site — because
 * `adversarial-review-binding.ts` reads the canonical `adversarial-review`
 * agent's RAW `skills/adversarial-review/SKILL.md` text and embeds it
 * verbatim into the rendered system prompt. Renaming the frontmatter key
 * changes those embedded prompt bytes even though nothing about the review
 * pipeline's own logic changed — a one-token diff here is expected and
 * should be trusted; a diff touching anything else in the fixture is not.
 *
 * Bootstrap / regenerate:
 *   UPDATE_SNAPSHOT=1 node --experimental-strip-types --test orchestrator/phases/adversarial-review-spawn-capture.test.ts
 * (or delete the fixture) rewrites
 * orchestrator/test-fixtures/spawn-capture/adversarial-review.json from current code.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { runAdversarialReview } from './adversarial-review.ts';
import { createLogger } from '../logging.ts';
import { serializeWorkItem, type WorkItem } from '../work-item.ts';
import type { StreamQueryFn } from '../pinned-sdk-query.ts';
import { normalizeForSnapshot, assertMatchesJsonSnapshot } from '../test-fixtures/spawn-capture/normalize.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');
const FIXTURE_PATH = resolve(FORGE_ROOT, 'orchestrator', 'test-fixtures', 'spawn-capture', 'adversarial-review.json');

const INIT_ID = 'INIT-2026-01-01-spawn-capture';
const CYCLE_ID = 'SPAWN-CAPTURE-TEST-adversarial-review-fixture';

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

type Fixture = { root: string; worktree: string; logsRoot: string; cleanup: () => void };

/** Bare origin + clone, main baseline + a feature-branch commit carrying a
 * seeded demo AC-proof — same shape as adversarial-review.test.ts's makeFixture(). */
function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'adv-review-spawn-capture-'));
  const bare = join(root, 'origin.git');
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' });
  const worktree = join(root, 'wt');
  execFileSync('git', ['clone', bare, worktree], { stdio: 'pipe' });
  const git = (args: string[]): string => execFileSync('git', args, { cwd: worktree, stdio: 'pipe', encoding: 'utf8' });
  git(['config', 'user.email', 'test@forge']);
  git(['config', 'user.name', 'forge-test']);
  git(['checkout', '-b', 'main']);
  mkdirSync(join(worktree, '.forge', 'work-items'), { recursive: true });
  writeFileSync(join(worktree, '.forge', 'project.json'), JSON.stringify({ testProcess: { local: { cmd: ['echo', 'gate-ok'] } } }));
  writeFileSync(join(worktree, '.forge', 'work-items', 'WI-1.md'), serializeWorkItem(wiFixture()));
  writeFileSync(join(worktree, 'src.ts'), 'export const v = 1;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'main baseline']);
  git(['push', '-q', 'origin', 'main']);
  git(['checkout', '-q', '-b', `feat/${INIT_ID}`]);
  writeFileSync(join(worktree, 'src.ts'), 'export const v = 2;\n');
  mkdirSync(join(worktree, 'demo', INIT_ID), { recursive: true });
  writeFileSync(
    join(worktree, 'demo', INIT_ID, 'demo.json'),
    JSON.stringify({
      title: 't',
      essence: 'e',
      project: 'fix',
      initiativeId: INIT_ID,
      diffStat: '1 file changed',
      checkpoints: [{ label: 'l', caption: 'c', beforeNote: 'b', afterNote: 'a' }],
      acEvaluations: [{ criterion: '(WI-1) GIVEN a request WHEN handled THEN it returns 200', verdict: 'met', evidence: 'the checkpoint shows 200' }],
    }),
  );
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'feat: the change + demo']);
  git(['push', '-q', '-u', 'origin', `feat/${INIT_ID}`]);
  return { root, worktree, logsRoot: join(root, '_logs'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Pull the injected identity back out of the rendered prompt (the same
 * technique adversarial-review.test.ts's identityFromPrompt uses). */
function identityFromPrompt(prompt: string): { initiative_id: string; cycleId: string; baseRef: string; headSha: string } {
  const grab = (k: string): string => {
    const m = new RegExp(`- ${k}: \`([^\`]+)\``).exec(prompt);
    assert.ok(m, `prompt carries ${k}`);
    return m![1]!;
  };
  return { initiative_id: grab('initiative_id'), cycleId: grab('cycleId'), baseRef: grab('baseRef'), headSha: grab('headSha') };
}

function validFindingsJson(prompt: string): string {
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
  });
}

test('runAdversarialReview: pins the exact {prompt, options} spawn call (characterization)', async () => {
  const fx = makeFixture();
  try {
    const logger = createLogger(CYCLE_ID, fx.logsRoot);

    let captured: { prompt: string; options?: Record<string, unknown> } | null = null;
    const queryFn: StreamQueryFn = ((params: { prompt: string; options?: Record<string, unknown> }) => {
      captured = { prompt: params.prompt, options: params.options };
      async function* gen(): AsyncGenerator<unknown> {
        writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(params.prompt));
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.2, usage: { input_tokens: 5, output_tokens: 7 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;

    const res = await runAdversarialReview(
      { initiativeId: INIT_ID, worktreePath: fx.worktree, cycleId: CYCLE_ID, logsRoot: fx.logsRoot, projectName: 'fix' },
      logger,
      { queryFn },
    );

    assert.equal(res.status, 'complete', 'sanity: the fixture must drive the pipeline to a clean single-pass completion');
    assert.ok(captured, 'queryFn must have been invoked exactly once with the spawn call');
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fx.worktree, encoding: 'utf8' }).trim();
    const normalized = normalizeForSnapshot(captured, [
      { value: fx.root, placeholder: '<TMP>' },
      { value: headSha, placeholder: '<HEAD_SHA>' },
    ]);
    assertMatchesJsonSnapshot(FIXTURE_PATH, normalized);
  } finally {
    fx.cleanup();
  }
});
