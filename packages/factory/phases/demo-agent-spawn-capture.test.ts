/**
 * Characterization (golden) test — pins the EXACT `{prompt, options}` object
 * `runDemoAgentPipeline` (`orchestrator/phases/demo-agent.ts`) passes into its
 * injected `queryFn` today (via `runAgent`, `lifecycle: 'caller'`), so the
 * R4-01 `composition.hooks` → `composition.guards` vocabulary migration can
 * prove byte-level no-behavioural-delta.
 *
 * Injection: `opts.queryFn` (`DemoAgentPipelineInput`'s sibling `opts` param
 * on `runDemoAgentPipeline`) — the SAME DI seam `demo-agent.test.ts` already
 * uses (`stubQueryFn`). No production code changed for this test.
 *
 * Fixture setup mirrors `demo-agent.test.ts`'s `makeFixture()` (bare origin +
 * clone, main baseline commit + a feature-branch commit, `.forge/project.json`
 * + one work item) exactly, then drives the "happy path, no capture wanted"
 * shape — a `demo.json` whose checkpoint has no `command` (so band 6's
 * orchestrated capture never runs) plus a valid relocated PR body — so the
 * pipeline completes in ONE agent pass with no authoring retry. The FIRST
 * (only) `queryFn` call is what's captured.
 *
 * What's pinned: the full captured `{prompt, options}` — `cwd`, `systemPrompt`,
 * `model`, `permissionMode`, `allowedTools`, `disallowedTools`, `maxTurns`,
 * `maxBudgetUsd`, `abortController`, and the full rendered user prompt
 * (`renderDemoAgentUserPrompt`'s output — injected ACs, work items, diffStat,
 * head SHA, changed files, demo-process/elements).
 *
 * Normalized (genuinely volatile, not a behavioural signal):
 *  - the mkdtemp root (appears in `cwd` and inside the prompt's demo-dir /
 *    changed-files references) -> `<TMP>`.
 *  - the `AbortController` instance the demo-agent pipeline attaches to
 *    `options` (via its `streamGuard`) -> a fixed marker (a fresh controller
 *    is constructed every call; only its PRESENCE, not its identity, is a
 *    behavioural signal).
 *  - the real git commit SHA (`diffStat`/`headSha` are DERIVED, not fixed
 *    literals like the PM/reflector fixtures' manifest fields) is NOT itself
 *    volatile across runs of the SAME fixture commits — the bare-origin +
 *    two-commit fixture is rebuilt identically every run, so the sha is
 *    deterministic given fixed commit content/author/timestamps... except git
 *    commit SHAs also fold in wall-clock commit time, which IS volatile. The
 *    real head SHA is therefore normalized too (see `<HEAD_SHA>` below).
 *
 * Fixture-move note (ADR-027 R3-03 amendment, `composition.hooks` →
 * `composition.guards`, 2026-08-04): `demo-agent.json` moved by exactly one
 * byte — `hook` → `guard` at a single site — because `demo-agent-binding.ts`
 * reads the canonical `demo-agent` agent's RAW `skills/demo-agent/SKILL.md`
 * text and embeds it verbatim into the rendered system prompt. Renaming the
 * frontmatter key changes those embedded prompt bytes even though nothing
 * about the demo-agent pipeline's own logic changed — a one-token diff here
 * is expected and should be trusted; a diff touching anything else in the
 * fixture is not.
 *
 * Bootstrap / regenerate:
 *   UPDATE_SNAPSHOT=1 node --experimental-strip-types --test orchestrator/phases/demo-agent-spawn-capture.test.ts
 * (or delete the fixture) rewrites
 * orchestrator/test-fixtures/spawn-capture/demo-agent.json from current code.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { runDemoAgentPipeline } from './demo-agent.ts';
import { createLogger } from '@forge/kernel';
import { serializeWorkItem, type WorkItem } from '@forge/flows/work-item.ts';
import type { StreamQueryFn } from '@forge/agents/pinned-sdk-query.ts';
import { normalizeForSnapshot, assertMatchesJsonSnapshot } from '../../../orchestrator/test-fixtures/spawn-capture/normalize.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..', '..');
const FIXTURE_PATH = resolve(FORGE_ROOT, 'orchestrator', 'test-fixtures', 'spawn-capture', 'demo-agent.json');

const INIT_ID = 'INIT-2026-01-01-spawn-capture';

function wiFixture(): WorkItem {
  return {
    work_item_id: 'WI-1',
    initiative_id: INIT_ID,
    status: 'complete',
    depends_on: [],
    acceptance_criteria: [{ given: 'the CLI is built', when: 'it runs bare', then: 'usage prints' }],
    files_in_scope: ['src/cli.ts'],
    estimated_iterations: 1,
    quality_gate_cmd: ['echo', 'gate-ok'],
    body: 'Build the CLI.',
  };
}

type Fixture = { root: string; worktree: string; logsRoot: string; cleanup: () => void };

/** Bare origin + clone with main (project files + WI) and a feature branch
 * commit — same shape as demo-agent.test.ts's makeFixture(). */
function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'demo-agent-spawn-capture-'));
  const bare = join(root, 'origin.git');
  execFileSync('git', ['init', '--bare', '-b', 'main', bare], { stdio: 'pipe' });
  const worktree = join(root, 'wt');
  execFileSync('git', ['clone', bare, worktree], { stdio: 'pipe' });
  const git = (args: string[]): string => execFileSync('git', args, { cwd: worktree, stdio: 'pipe', encoding: 'utf8' });
  git(['config', 'user.email', 'test@forge']);
  git(['config', 'user.name', 'forge-test']);
  git(['checkout', '-b', 'main']);

  writeFileSync(join(worktree, 'package.json'), JSON.stringify({ name: 'fix', scripts: { ok: 'echo ok' } }));
  mkdirSync(join(worktree, '.forge', 'work-items'), { recursive: true });
  writeFileSync(
    join(worktree, '.forge', 'project.json'),
    JSON.stringify({
      testProcess: { local: { cmd: ['echo', 'gate-ok'] } },
      demoProcess: [
        { kind: 'capture', text: 'record the CLI before/after' },
        { kind: 'verify', text: 'assert the gate passes' },
      ],
    }),
  );
  writeFileSync(join(worktree, '.forge', 'work-items', 'WI-1.md'), serializeWorkItem(wiFixture()));
  writeFileSync(join(worktree, 'src.ts'), 'export const v = 1;\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'main baseline']);
  git(['push', '-q', 'origin', 'main']);

  git(['checkout', '-q', '-b', `feat/${INIT_ID}`]);
  writeFileSync(join(worktree, 'src.ts'), 'export const v = 2;\n');
  git(['add', 'src.ts']);
  git(['commit', '-q', '-m', 'feat: the change']);
  git(['push', '-q', '-u', 'origin', `feat/${INIT_ID}`]);

  return { root, worktree, logsRoot: join(root, '_logs'), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function demoDirAbs(worktree: string): string {
  return join(worktree, 'demo', INIT_ID);
}

/** Extract the injected diffStat from the rendered user prompt (the demo
 * agent's own source of truth) — mirrors demo-agent.test.ts. */
function diffStatFromPrompt(prompt: string): string {
  const m = /- diffStat: `([^`]*)`/.exec(prompt);
  assert.ok(m, 'prompt must carry the injected diffStat');
  return m![1]!;
}

const INJECTED_CRITERION = '(WI-1) GIVEN the CLI is built WHEN it runs bare THEN usage prints';

function validDemoJson(diffStat: string): Record<string, unknown> {
  return {
    title: 'CLI usage demo',
    essence: 'the CLI now prints usage',
    project: 'fix',
    initiativeId: INIT_ID,
    diffStat,
    checkpoints: [{ label: 'cli-run', caption: 'bare CLI invocation', beforeNote: 'no usage', afterNote: 'usage printed' }],
    acceptanceCriteria: [INJECTED_CRITERION],
    acEvaluations: [{ criterion: INJECTED_CRITERION, verdict: 'met', evidence: 'checkpoint cli-run shows the usage text' }],
  };
}

function writeValidPrDescription(worktree: string): void {
  writeFileSync(
    join(worktree, '.forge', 'pr-description.md'),
    '## Why\n\nThe initiative intent.\n\n## What\n\nThe behavioural change delivered.\n\n## How\n\nHow the diff achieves it.\n',
  );
}

test('runDemoAgentPipeline: pins the exact {prompt, options} spawn call (characterization)', async () => {
  const fx = makeFixture();
  try {
    // Captured BEFORE the pipeline runs — band 6 (no-capture path) commits the
    // demo artifacts, moving HEAD; the prompt's embedded headSha is the branch
    // tip AT SPAWN TIME, which is this one, not whatever HEAD becomes after.
    const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: fx.worktree, encoding: 'utf8' }).trim();
    const logger = createLogger(INIT_ID, fx.logsRoot);

    let captured: { prompt: string; options?: Record<string, unknown> } | null = null;
    const queryFn: StreamQueryFn = ((params: { prompt: string; options?: Record<string, unknown> }) => {
      captured = { prompt: params.prompt, options: params.options };
      async function* gen(): AsyncGenerator<unknown> {
        mkdirSync(demoDirAbs(fx.worktree), { recursive: true });
        writeFileSync(join(demoDirAbs(fx.worktree), 'demo.json'), JSON.stringify(validDemoJson(diffStatFromPrompt(params.prompt)), null, 2));
        writeValidPrDescription(fx.worktree);
        yield { type: 'result', subtype: 'success', total_cost_usd: 0.1, usage: { input_tokens: 5, output_tokens: 7 } };
      }
      return gen();
    }) as unknown as StreamQueryFn;

    const res = await runDemoAgentPipeline({ initiativeId: INIT_ID, worktreePath: fx.worktree, cycleId: INIT_ID, logsRoot: fx.logsRoot }, logger, {
      queryFn,
    });

    assert.equal(res.status, 'complete', 'sanity: the fixture must drive the pipeline to a clean single-pass completion');
    assert.ok(captured, 'queryFn must have been invoked exactly once with the spawn call');
    const normalized = normalizeForSnapshot(captured, [
      { value: fx.root, placeholder: '<TMP>' },
      { value: headSha, placeholder: '<HEAD_SHA>' },
    ]);
    assertMatchesJsonSnapshot(FIXTURE_PATH, normalized);
  } finally {
    fx.cleanup();
  }
});
