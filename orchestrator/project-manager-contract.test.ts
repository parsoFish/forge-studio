/**
 * PM testing-contract tests (A2, 2026-06-06).
 *
 * Covers the two project-config-driven contract enforcements added to the PM
 * phase:
 *   - A2a: `acceptance_gate.required` ⇒ the decomposition MUST include ≥1 WI
 *     whose `quality_gate_cmd` targets the live acceptance suite, else the PM
 *     pass fails.
 *   - A2b: `standing_work_item_acs` ⇒ every emitted WI body gets a fixed
 *     "## Standing acceptance criteria (project contract)" section, idempotently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runProjectManager, type PmQueryFn } from './phases/project-manager.ts';
import { createLogger, type EventLogEntry } from './logging.ts';
import type { CycleInput } from './cycle-context.ts';

const MANIFEST_BODY = `---
initiative_id: INIT-2026-06-06-pm-contract-test
project: testproj
project_repo_path: ./projects/testproj
created_at: 2026-06-06T00:00:00Z
iteration_budget: 3
cost_budget_usd: 1
phase: in-flight
origin: architect
---

# Test initiative

## Acceptance criteria

Given the resource, when applied, then it persists in the external system.
`;

type StubWi = { wiId: string; filename?: string; gate?: string[] };

/** A WI fixture with a configurable quality_gate_cmd. */
function makeWi(initiativeId: string, wi: StubWi): string {
  const fname = wi.filename ?? `azuredevops/internal/service/release/${wi.wiId.toLowerCase()}.go`;
  const gate = wi.gate ?? ['node', '--test', `tests/${wi.wiId.toLowerCase()}.test.ts`];
  return `---
work_item_id: ${wi.wiId}
initiative_id: ${initiativeId}
status: pending
depends_on: []
acceptance_criteria:
  - given: "a test"
    when: "the function runs"
    then: "it returns a value"
files_in_scope:
  - ${fname}
quality_gate_cmd: ${JSON.stringify(gate)}
estimated_iterations: 1
---

Body for ${wi.wiId}.
`;
}

function makeStubQueryFn(initiativeId: string, wis: StubWi[]): PmQueryFn {
  return ({ options }) => {
    const cwd = (options as { cwd: string }).cwd;
    return (async function* () {
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Read',
              input: { file_path: 'brain/cycles/themes/work-item-completion-by-domain.md' },
            },
          ],
        },
      };
      const wiDir = resolve(cwd, '.forge', 'work-items');
      mkdirSync(wiDir, { recursive: true });
      for (const wi of wis) writeFileSync(join(wiDir, `${wi.wiId}.md`), makeWi(initiativeId, wi));
      writeFileSync(
        join(wiDir, '_graph.md'),
        ['```mermaid', 'graph TD', ...wis.map((w) => `  ${w.wiId}["${w.wiId}"]`), '```'].join('\n'),
      );
      yield { type: 'result', subtype: 'success', duration_ms: 1, total_cost_usd: 0.01 };
    })();
  };
}

function setupHarness(projectConfig?: Record<string, unknown>): {
  dir: string;
  worktree: string;
  logger: ReturnType<typeof createLogger>;
  input: CycleInput;
} {
  const dir = mkdtempSync(join(tmpdir(), 'forge-pm-contract-'));
  const worktree = join(dir, 'projects', 'testproj');
  mkdirSync(worktree, { recursive: true });
  writeFileSync(
    join(worktree, 'package.json'),
    JSON.stringify({ name: 'testproj', version: '0.0.1', scripts: { test: 'echo no tests' } }),
  );
  if (projectConfig) {
    mkdirSync(join(worktree, '.forge'), { recursive: true });
    writeFileSync(join(worktree, '.forge', 'project.json'), JSON.stringify(projectConfig, null, 2));
  }
  const manifestPath = join(dir, '_queue', 'in-flight', 'INIT-2026-06-06-pm-contract-test.md');
  mkdirSync(join(dir, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(manifestPath, MANIFEST_BODY);
  const logsDir = join(dir, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger('TEST-pm-contract', logsDir);
  const input: CycleInput = {
    initiativeId: 'INIT-2026-06-06-pm-contract-test',
    manifestPath,
    projectRepoPath: worktree,
    worktreePath: worktree,
  };
  return { dir, worktree, logger, input };
}

function readEvents(logger: ReturnType<typeof createLogger>): EventLogEntry[] {
  const text = readFileSync(logger.logFilePath, 'utf8');
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as EventLogEntry);
}

const BASE_CONFIG = {
  demo: { shape: 'harness', command: ['go', 'test', './...'] },
  quality_gate_cmd: ['go', 'test', './...'],
};

const ACC_GATE = [
  'go', 'test', '-tags', 'all', '-run', 'TestAccFoo',
  '-timeout', '30m', './azuredevops/internal/acceptancetests/...',
];

test('A2a: acceptance_gate.required + no live-acc WI → PM pass fails', async () => {
  const h = setupHarness({
    ...BASE_CONFIG,
    acceptance_gate: { match: 'acceptancetests', required: true },
  });
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }, { wiId: 'WI-2' }]);
    await assert.rejects(
      () => runProjectManager(h.input, h.logger, { queryFn }),
      /live-acceptance work item/,
    );
    const events = readEvents(h.logger);
    const end = events.find(
      (e) =>
        e.phase === 'project-manager' &&
        e.event_type === 'error' &&
        (e.metadata as { acceptance_gate_violation?: string })?.acceptance_gate_violation,
    );
    assert.ok(end, 'expected an error end event carrying acceptance_gate_violation');
    assert.match(
      (end.metadata as { acceptance_gate_violation?: string }).acceptance_gate_violation ?? '',
      /acceptancetests/,
    );
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('A2a: acceptance_gate.required + a matching live-acc WI → PM pass succeeds', async () => {
  const h = setupHarness({
    ...BASE_CONFIG,
    acceptance_gate: { match: 'acceptancetests', required: true },
  });
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [
      { wiId: 'WI-1' },
      { wiId: 'WI-2', filename: 'azuredevops/internal/acceptancetests/resource_foo_test.go', gate: ACC_GATE },
    ]);
    await runProjectManager(h.input, h.logger, { queryFn });
    const events = readEvents(h.logger);
    const end = events.find((e) => e.phase === 'project-manager' && e.event_type === 'end');
    assert.ok(end, 'expected a successful pm.end event');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('A2a: no acceptance_gate config → no live-acc requirement (other projects unaffected)', async () => {
  const h = setupHarness({ ...BASE_CONFIG });
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }]);
    await runProjectManager(h.input, h.logger, { queryFn }); // no throw
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('A2b: standing_work_item_acs are appended to every WI body, exactly once', async () => {
  const h = setupHarness({
    ...BASE_CONFIG,
    standing_work_item_acs: ['Live acceptance: TF_ACC test proves it.', 'CI-equivalent: make test green.'],
  });
  try {
    const queryFn = makeStubQueryFn(h.input.initiativeId, [{ wiId: 'WI-1' }, { wiId: 'WI-2' }]);
    await runProjectManager(h.input, h.logger, { queryFn });
    for (const wi of ['WI-1', 'WI-2']) {
      const body = readFileSync(resolve(h.worktree, '.forge', 'work-items', `${wi}.md`), 'utf8');
      assert.match(body, /## Standing acceptance criteria \(project contract\)/);
      assert.match(body, /Live acceptance: TF_ACC test proves it\./);
      assert.match(body, /CI-equivalent: make test green\./);
      // idempotent: header appears exactly once.
      const count = body.split('## Standing acceptance criteria (project contract)').length - 1;
      assert.equal(count, 1, `${wi}: standing-AC header should appear exactly once`);
    }
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});
