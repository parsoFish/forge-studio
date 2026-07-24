/**
 * Characterization (golden) test — pins the EXACT `{prompt, options}` object
 * `runProjectManager` passes into the injected `queryFn` today, so the R4-01
 * generic-runnable-primitive refactor (routing the PM's spawn through the
 * shared runnable) can prove byte-level no-behavioural-delta.
 *
 * Injection: `queryFn` (`RunProjectManagerOptions.queryFn`) — the SAME DI
 * seam project-manager-shared-pipeline.test.ts / pm-turn-economy.test.ts
 * already use. No production code changed for this test.
 *
 * What's pinned: the full captured object — `systemPrompt`, `model`, `cwd`,
 * `permissionMode`, `allowedTools`, `disallowedTools`, `maxTurns`,
 * `maxBudgetUsd`, `abortController`, and the full rendered `prompt` string
 * (manifest inlining, brain context, project context, gate recipe, tree
 * listing — everything `renderPmUserPrompt` produces).
 *
 * Normalized (genuinely volatile, not a behavioural signal):
 *  - the mkdtemp root (appears in `cwd` and inside the prompt's worktree/
 *    manifest path references) -> `<TMP>`.
 *  - the `AbortController` instance PM attaches to `options` -> a fixed
 *    marker (a fresh controller is constructed every call; only ITS
 *    PRESENCE, not its identity, is a behavioural signal).
 *
 * Bootstrap / regenerate:
 *   UPDATE_SNAPSHOT=1 node --experimental-strip-types --test orchestrator/pm-spawn-capture.test.ts
 * (or delete the fixture) rewrites
 * orchestrator/test-fixtures/spawn-capture/pm.json from the current code.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runProjectManager, type PmQueryFn } from './phases/project-manager.ts';
import { createLogger } from './logging.ts';
import type { CycleInput } from './cycle-context.ts';
import { normalizeForSnapshot, assertMatchesJsonSnapshot } from './test-fixtures/spawn-capture/normalize.ts';

const FIXTURE_PATH = resolve(import.meta.dirname, 'test-fixtures', 'spawn-capture', 'pm.json');

const INITIATIVE_ID = 'INIT-2026-01-01-spawn-capture';

const MANIFEST_BODY = `---
initiative_id: ${INITIATIVE_ID}
project: testproj
project_repo_path: ./projects/testproj
created_at: 2026-01-01T00:00:00Z
iteration_budget: 3
cost_budget_usd: 1
phase: in-flight
origin: architect
---

# Spawn-capture fixture initiative

## Acceptance criteria

Given a user is authenticated, when they request /api/health, then the response is 200.
`;

test('runProjectManager: pins the exact {prompt, options} spawn call (characterization)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-pm-spawn-capture-'));
  try {
    const worktree = join(dir, 'projects', 'testproj');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(
      join(worktree, 'package.json'),
      JSON.stringify({ name: 'testproj', version: '0.0.1', scripts: { test: 'node --test' } }, null, 2),
    );
    const manifestPath = join(dir, '_queue', 'in-flight', `${INITIATIVE_ID}.md`);
    mkdirSync(join(dir, '_queue', 'in-flight'), { recursive: true });
    writeFileSync(manifestPath, MANIFEST_BODY);
    const logsDir = join(dir, '_logs');
    mkdirSync(logsDir, { recursive: true });
    const logger = createLogger('TEST-pm-spawn-capture', logsDir);

    const input: CycleInput = {
      initiativeId: INITIATIVE_ID,
      manifestPath,
      projectRepoPath: worktree,
      worktreePath: worktree,
    };

    let captured: { prompt: string; options?: Record<string, unknown> } | null = null;
    const queryFn: PmQueryFn = ({ prompt, options }) => {
      captured = { prompt, options };
      return (async function* () {
        const wiDir = resolve(worktree, '.forge', 'work-items');
        mkdirSync(wiDir, { recursive: true });
        writeFileSync(
          join(wiDir, 'WI-1.md'),
          `---
work_item_id: WI-1
initiative_id: ${INITIATIVE_ID}
status: pending
depends_on: []
acceptance_criteria:
  - given: "a test"
    when: "the function runs"
    then: "it returns a value"
files_in_scope:
  - src/thing.ts
creates:
  - src/thing.ts
quality_gate_cmd: ["node", "--test", "tests/thing.test.ts"]
estimated_iterations: 1
---

Body for WI-1.
`,
        );
        writeFileSync(join(wiDir, '_graph.md'), ['```mermaid', 'graph TD', '  WI-1["WI-1"]', '```'].join('\n'));
        yield { type: 'result', subtype: 'success', duration_ms: 1, total_cost_usd: 0.01 };
      })();
    };

    await runProjectManager(input, logger, { queryFn });

    assert.ok(captured, 'queryFn must have been invoked exactly once with the spawn call');
    const normalized = normalizeForSnapshot(captured, [{ value: dir, placeholder: '<TMP>' }]);
    assertMatchesJsonSnapshot(FIXTURE_PATH, normalized);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
