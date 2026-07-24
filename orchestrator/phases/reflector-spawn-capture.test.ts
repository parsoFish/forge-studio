/**
 * Characterization (golden) test — pins the EXACT `{prompt, options}` object
 * `runReflector` passes into the injected `sdkQuery` today, so the R4-01
 * generic-runnable-primitive refactor (routing the reflector's spawn through
 * the shared runnable) can prove byte-level no-behavioural-delta.
 *
 * Injection: `deps.sdkQuery` (`ReflectorDeps.sdkQuery`) — the SAME DI seam
 * reflector.test.ts already uses. No production code changed for this test.
 *
 * What's pinned: the full captured object — `systemPrompt`, `model`, `cwd`,
 * `permissionMode`, `allowedTools`, `disallowedTools`, `maxTurns`,
 * `maxBudgetUsd`, and the full rendered `prompt` string (every resolved
 * input/output path + the four-stage brief `renderReflectorUserPrompt`
 * produces).
 *
 * Normalized (genuinely volatile, not a behavioural signal):
 *  - The reflector resolves its own forge root via `import.meta.dirname` —
 *    NOT injectable (unlike the PM's worktree, this is always the real repo
 *    checkout) — so `cwd` and every forgeRoot-derived path the prompt embeds
 *    (`_logs/...`, `brain/...`) is normalized to `<REPO_ROOT>`, keeping the
 *    fixture portable across machines/CI checkouts.
 *  - The manifest lives in a mkdtemp dir (as in reflector.test.ts) ->
 *    normalized to `<TMP>`.
 *  - The cycle id is a FIXED literal (not the `uniqueCycleId()` helper
 *    reflector.test.ts uses elsewhere) precisely so the prompt — which
 *    embeds it verbatim in prose, not only inside resolved paths — is
 *    deterministic without further normalization. It's distinct + greppable
 *    so it can never collide with a real cycle, and its `_logs/` dir is
 *    removed in `finally` regardless of outcome.
 *
 * Bootstrap / regenerate:
 *   UPDATE_SNAPSHOT=1 node --experimental-strip-types --test orchestrator/phases/reflector-spawn-capture.test.ts
 * (or delete the fixture) rewrites
 * orchestrator/test-fixtures/spawn-capture/reflector.json from current code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runReflector } from './reflector.ts';
import { createLogger } from '../logging.ts';
import type { CycleInput } from '../cycle-context.ts';
import type { RunBrainLintResult } from '../../cli/brain-lint.ts';
import { normalizeForSnapshot, assertMatchesJsonSnapshot } from '../test-fixtures/spawn-capture/normalize.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');
const FIXTURE_PATH = resolve(FORGE_ROOT, 'orchestrator', 'test-fixtures', 'spawn-capture', 'reflector.json');

// Fixed (see file header) — distinct + greppable, never a real cycle id.
const CYCLE_ID = 'SPAWN-CAPTURE-TEST-reflector-fixture';
const INITIATIVE_ID = 'INIT-2026-01-01-spawn-capture';

test('runReflector: pins the exact {prompt, options} spawn call (characterization)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'forge-reflector-spawn-capture-'));
  const cycleLogDir = resolve(FORGE_ROOT, '_logs', CYCLE_ID);
  try {
    const manifestPath = join(tmp, 'manifest.md');
    writeFileSync(
      manifestPath,
      [
        '---',
        `initiative_id: ${INITIATIVE_ID}`,
        // Reuses the pre-existing, already-committed brain/projects/demo-project
        // dir (the same project name reflector.test.ts's harness uses) so this
        // test creates no new brain-tree pollution.
        'project: demo-project',
        'created_at: 2026-01-01T00:00:00Z',
        'iteration_budget: 3',
        'cost_budget_usd: 1.0',
        'phase: done',
        'origin: architect',
        '---',
        '',
        'body',
        '',
      ].join('\n'),
    );

    const logger = createLogger(CYCLE_ID, resolve(FORGE_ROOT, '_logs'));
    const input: CycleInput = {
      initiativeId: INITIATIVE_ID,
      manifestPath,
      projectRepoPath: FORGE_ROOT,
      worktreePath: FORGE_ROOT,
      cycleId: CYCLE_ID,
    };

    let captured: { prompt: string; options: Record<string, unknown> } | null = null;
    async function* capturingSdkQuery(args: {
      prompt: string;
      options: Record<string, unknown>;
    }): AsyncIterable<unknown> {
      captured = { prompt: args.prompt, options: args.options };
      // One brain-read tool_use so the F-13 brain-first gate clears (mirrors
      // reflector.test.ts's fakeSdkQueryClean), then a clean result message.
      yield {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/INDEX.md' } }],
        },
      };
      yield { type: 'result', subtype: 'success', total_cost_usd: 0.05, duration_ms: 1234 };
    }
    const cleanLint = (): RunBrainLintResult => ({ findings: [], exitCode: 0 });

    const result = await runReflector(input, logger, {
      sdkQuery: capturingSdkQuery,
      brainLint: cleanLint,
    });
    assert.equal(result.reflection_status, 'closed', 'sanity: the stubbed pass must close cleanly');

    assert.ok(captured, 'sdkQuery must have been invoked exactly once with the spawn call');
    const normalized = normalizeForSnapshot(captured, [
      { value: FORGE_ROOT, placeholder: '<REPO_ROOT>' },
      { value: tmp, placeholder: '<TMP>' },
    ]);
    assertMatchesJsonSnapshot(FIXTURE_PATH, normalized);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(cycleLogDir, { recursive: true, force: true });
  }
});
