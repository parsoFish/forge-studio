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
 *    (`brain/...`, the PR description) is normalized to `<REPO_ROOT>`,
 *    keeping the fixture portable across machines/CI checkouts.
 *  - The manifest AND `_logs/` both live under the SAME mkdtemp dir ->
 *    normalized to `<TMP>` (row 212 follow-up 3, bead forge-8vfn.8.5.48 —
 *    `_logs/` moved out from under the real checkout into `CycleInput
 *    .logsRoot`, which `runReflector`/`cycle-recap.ts` now honour, so this
 *    test leaves no transient write in the real tree for a PARALLEL
 *    `node --test` file's residue guard to misattribute to itself).
 *  - The cycle id is a FIXED literal (not the `uniqueCycleId()` helper
 *    reflector.test.ts uses elsewhere) precisely so the prompt — which
 *    embeds it verbatim in prose, not only inside resolved paths — is
 *    deterministic without further normalization. It's distinct + greppable
 *    so it can never collide with a real cycle, and the whole `tmp` dir
 *    (manifest + `_logs/`) is removed in `finally` regardless of outcome.
 *
 * Brain masked (the live repo brain is NOT part of the pin): the reflector's
 * forge root is `import.meta.dirname`-derived (no injectable root), so the
 * system prompt's "Brain navigation index" embeds every `brain/**` index of the
 * checkout — bytes any real forge run rewrites. That block is masked to
 * `<BRAIN-CONTEXT>` between the prompt's own markers (the intro's last sentence
 * and the `# reflector skill contract` heading); the framing, the block's
 * presence and its position stay pinned. The user prompt embeds no brain text.
 *
 * Fixture-move note (SPEC §1 R3-03 amendment, `composition.hooks` →
 * `composition.guards`, 2026-08-04): `reflector.json` moved by exactly one
 * byte — `hook` → `guard` at a single site — because `renderReflectorUserPrompt`
 * (via `reflector-binding.ts`) reads the canonical `reflector` agent's RAW
 * `skills/reflector/SKILL.md` text and embeds it verbatim into the rendered
 * prompt. Renaming the frontmatter key changes those embedded prompt bytes
 * even though nothing about the reflector's own logic changed — a one-token
 * diff here is expected and should be trusted; a diff touching anything
 * else in the fixture is not.
 *
 * Bootstrap / regenerate:
 *   UPDATE_SNAPSHOT=1 node --experimental-strip-types --test packages/stations/tests/contract/reflector-spawn-capture.test.ts
 * (or delete the fixture) rewrites
 * packages/kernel/tests/test-fixtures/spawn-capture/reflector.json from current code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runReflector } from '../../phases/reflector.ts';
import { createLogger } from '@forge/kernel';
import type { CycleInput } from '@forge/flows';
import type { RunBrainLintResult } from '@forge/knowledge';
import { acquireIsolatedReflectorLease } from '../test-fixtures/reflector-lease-test-fixture.ts';
import { canonicalDef } from '../test-fixtures/canonical-def-fixture.ts';
import { normalizeForSnapshot, assertMatchesJsonSnapshot, maskBetween } from '../../../kernel/tests/test-fixtures/spawn-capture/normalize.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const FIXTURE_PATH = resolve(FORGE_ROOT, 'packages', 'kernel', 'tests', 'test-fixtures', 'spawn-capture', 'reflector.json');

// forge-ler4 cross-file flake fix (mechanism: reflector-lease-test-fixture.ts).

// Fixed (see file header) — distinct + greppable, never a real cycle id.
const CYCLE_ID = 'SPAWN-CAPTURE-TEST-reflector-fixture';
const INITIATIVE_ID = 'INIT-2026-01-01-spawn-capture';

test('runReflector: pins the exact {prompt, options} spawn call (characterization)', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'reflector-spawn-capture-'));
  // Row 212 follow-up 3 (bead forge-8vfn.8.5.48): a tmp `logsRoot` (inside
  // `tmp`, already normalized to `<TMP>` below), threaded through
  // `CycleInput.logsRoot` — which `runReflector`/`cycle-recap.ts` now honour
  // for every `_logs/<cycleId>/*` path — instead of the real checkout's
  // `_logs/`. `node --test` runs files in parallel, and each one's
  // generalised residue guard diffs the SAME shared repo `_logs/` over its
  // own lifetime: this test's FIXED (not random) `CYCLE_ID` made its
  // transient real-tree write especially likely to collide with a sibling
  // file's window. The embedded `_logs/...` prompt paths below now normalize
  // to `<TMP>/_logs/...` rather than `<REPO_ROOT>/_logs/...` — an expected,
  // reviewed fixture shift from `UPDATE_SNAPSHOT=1`, not a behaviour change.
  const logsRoot = join(tmp, '_logs');
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
        'class: code',
        'phase: done',
        'origin: architect',
        '---',
        '',
        'body',
        '',
      ].join('\n'),
    );

    const logger = createLogger(CYCLE_ID, logsRoot);
    const input: CycleInput = {
      initiativeId: INITIATIVE_ID,
      manifestPath,
      projectRepoPath: FORGE_ROOT,
      worktreePath: FORGE_ROOT,
      cycleId: CYCLE_ID,
      logsRoot,
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
      acquireBrainWriteLease: acquireIsolatedReflectorLease,
      agentDef: canonicalDef('reflector'),
    });
    assert.equal(result.reflection_status, 'closed', 'sanity: the stubbed pass must close cleanly');

    assert.ok(captured, 'sdkQuery must have been invoked exactly once with the spawn call');
    const normalized = normalizeForSnapshot(captured, [
      { value: FORGE_ROOT, placeholder: '<REPO_ROOT>' },
      { value: tmp, placeholder: '<TMP>' },
    ]);
    const shaped = normalized as { options: { systemPrompt: string } };
    assertMatchesJsonSnapshot(FIXTURE_PATH, {
      ...shaped,
      options: {
        ...shaped.options,
        systemPrompt: maskBetween(
          shaped.options.systemPrompt,
          // Last sentence of the navigation-index intro (reflector-binding.ts buildReflectorSystemPrompt).
          'you should rarely need grep.',
          '\n\n---\n\n# reflector skill contract',
          '\n\n<BRAIN-CONTEXT>',
        ),
      },
    });
  } finally {
    // runReflector's own cycleLogDir lives inside tmp (both rooted at the
    // same mkdtemp logsRoot above), so this one rmSync is the whole cleanup.
    rmSync(tmp, { recursive: true, force: true });
  }
});
