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

import { runAdversarialReview, REVIEW_ALLOWED_TOOLS, REVIEW_EXECUTION_TOOLS } from './adversarial-review.ts';
import { createLogger } from '@forge/kernel';
import { serializeWorkItem, type WorkItem } from '@forge/flows/work-item.ts';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';
import { normalizeForSnapshot, assertMatchesJsonSnapshot } from '../../../orchestrator/test-fixtures/spawn-capture/normalize.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..', '..');
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
    lenses: ['correctness', 'containment', 'test-strength', 'boundary'],
    acEvaluations: [
      ...[...prompt.matchAll(/^\d+\. (\(WI-[^)]+\) GIVEN .+)$/gm)].map((m) => ({
        criterion: m[1]!, verdict: 'partial' as const, evidence: 'the handler returns 200 only on the happy path',
      })),
    ],
    whyWhatHow: {
      why: 'the caller needs a 200 on a handled request',
      what: 'a handler and its router registration',
      how: 'a slice bound the caller reads as inclusive',
    },
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

    // EVERY spawn is captured, not just the last. The pipeline reviews per work
    // item (bead forge-8vfn.6.10.24), and ruling 290 requires each chunk to run
    // under the SAME fence and the SAME class lenses — a property this test
    // proves by comparing the captured option bags rather than by asserting it
    // about the one spawn that happened to be recorded.
    const spawns: Array<{ prompt: string; options?: Record<string, unknown> }> = [];
    const queryFn: StreamQueryFn = ((params: { prompt: string; options?: Record<string, unknown> }) => {
      spawns.push({ prompt: params.prompt, options: params.options });
      async function* gen(): AsyncGenerator<unknown> {
        writeFileSync(join(fx.worktree, '.forge', 'review-findings.json'), validFindingsJson(params.prompt));
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.2, usage: { input_tokens: 5, output_tokens: 7 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;

    const res = await runAdversarialReview(
      { initiativeId: INIT_ID, worktreePath: fx.worktree, cycleId: CYCLE_ID, logsRoot: fx.logsRoot, projectName: 'fix', changeClass: 'code' },
      logger,
      { queryFn },
    );

    assert.equal(res.status, 'complete', 'sanity: the fixture must drive the pipeline to a clean completion');
    assert.ok(spawns.length >= 1, 'queryFn must have been invoked');
    // Ruling 290, proved by EXECUTION: every chunk's spawn carries a byte-identical
    // option bag — same tool set, same fence, same turn cap. Only the evidence
    // each one is shown differs, which is the whole point of chunking.
    const optionsOf = (sp: { options?: Record<string, unknown> }): string =>
      JSON.stringify({ ...sp.options, canUseTool: 'canUseTool' in (sp.options ?? {}) ? '<fn>' : undefined });
    for (const sp of spawns.slice(1)) {
      assert.equal(optionsOf(sp), optionsOf(spawns[0]!), 'a chunk reviewed under different options is a second, weaker reviewer');
    }
    assert.ok(spawns.every((sp) => sp.prompt.includes('correctness')), 'every chunk carries the class lenses');
    // The golden pins the FIRST chunk — the one that reviews a work item.
    const captured: { prompt: string; options?: Record<string, unknown> } = spawns[0]!;
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fx.worktree, encoding: 'utf8' }).trim();
    // `canUseTool` is a FUNCTION, and `JSON.stringify` drops a function silently
    // — a golden written straight from this bag would record the fence's ABSENCE
    // and match forever afterwards, which is the blind-ratchet shape. Rendered
    // as a marker here (in the test, never in the shared normalizer) so the
    // golden states that a handler was installed; the handler's BEHAVIOUR is
    // executed below rather than snapshotted.
    const capturedOptions = (captured as { options: Record<string, unknown> }).options;
    const forSnapshot = {
      ...(captured as Record<string, unknown>),
      options: { ...capturedOptions, ...('canUseTool' in capturedOptions ? { canUseTool: '<canUseTool>' } : {}) },
    };
    const normalized = normalizeForSnapshot(forSnapshot, [
      { value: fx.root, placeholder: '<TMP>' },
      { value: headSha, placeholder: '<HEAD_SHA>' },
    ]);
    assertMatchesJsonSnapshot(FIXTURE_PATH, normalized);

    // ── The tool fence, proven BY EXECUTION (ADR 036, spec §5 item 5) ────────
    //
    // Not by reading `skills/adversarial-review/SKILL.md`, and not by calling
    // the declaration guard: both answer "what does the file say". This asserts
    // what the SPAWN ACTUALLY RECEIVED — `captured.options` is the object
    // `runAgent` handed the SDK on this real pipeline run, after every layer of
    // spec resolution between the frontmatter and the query.
    //
    // Containment review, 2026-09-05: the interesting escapes are not `Bash`.
    // They are `Task`/`Agent` (execution by DELEGATION to a subagent that has
    // Bash), `NotebookEdit` (execution in a cell) and `WebFetch`/`WebSearch`
    // (egress). A fence asserted as "no Bash" passes all four, which is why the
    // assertion below is an ALLOWLIST — anything not named is refused, including
    // a tool that does not exist yet.
    const opts = (captured as { options?: Record<string, unknown> }).options as { allowedTools?: unknown; disallowedTools?: unknown; permissionMode?: unknown };
    assert.deepEqual(opts.allowedTools, REVIEW_ALLOWED_TOOLS, 'the SDK received exactly the read-only tool set');
    for (const tool of REVIEW_EXECUTION_TOOLS) {
      assert.ok(
        (opts.disallowedTools as string[]).includes(tool),
        `${tool} must reach the SDK on the DISALLOWED list — an absent name is a granted tool when the runtime default set is not empty`,
      );
    }
    // ── The write fence, also proven BY EXECUTION (T1 ruling 249) ───────────
    //
    // A fence is three settings, not one. All three are asserted on the bag the
    // SDK actually received, and then the handler itself is RUN:
    //   1. `permissionMode: 'default'` — `acceptEdits` auto-accepts a Write
    //      before any handler sees it;
    //   2. `Write` is NOT on `allowedTools` — a pre-approved tool is never
    //      routed through `canUseTool`;
    //   3. `Write` is NOT on `disallowedTools` either — it stays callable, gated.
    assert.equal(opts.permissionMode, 'default');
    assert.ok(!(opts.allowedTools as string[]).includes('Write'), 'a pre-approved Write skips the fence');
    assert.ok(!(opts.disallowedTools as string[]).includes('Write'), 'a forbidden Write cannot author the findings');
    const canUseTool = (captured as { options?: Record<string, unknown> }).options!['canUseTool'] as
      | ((tool: string, input: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ behavior: string; message?: string }>)
      | undefined;
    assert.equal(typeof canUseTool, 'function', 'the SDK received a permission handler, not a promise of one');

    // Executed, not read: the same handler the SDK holds, asked about two real
    // paths. The findings file is the reviewer's one legal write; the source it
    // is reviewing is the write this fence exists to refuse.
    const allow = await canUseTool!('Write', { file_path: join(fx.worktree, '.forge', 'review-findings.json') }, {});
    assert.equal(allow.behavior, 'allow', 'the reviewer can still author its findings file');
    const denySource = await canUseTool!('Write', { file_path: join(fx.worktree, 'src.ts') }, {});
    assert.equal(denySource.behavior, 'deny', 'the ONE agent that judges this initiative cannot write the source it judges');
    const denyEscape = await canUseTool!('Write', { file_path: join(fx.root, 'escape.txt') }, {});
    assert.equal(denyEscape.behavior, 'deny', 'nor anything outside the worktree');
  } finally {
    fx.cleanup();
  }
});
