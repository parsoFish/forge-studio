/**
 * PM turn economy (plan 2.11) — tests.
 *
 * Evidence (brain/cycles/themes/2026-07-10-pm-error-max-turns-new-api-exploration.md
 * + 2026-07-03-pm-max-turns-large-initiative-decomp.md): the PM burned its turn
 * budget re-discovering context the orchestrator already knew (manifest, profile,
 * always-relevant themes, tree shape) before writing ANY work item, then
 * error_max_turns left an empty decomposition.
 *
 * Three parts under test:
 *  1. Env-pin at the SDK seam — manifest content + brain context + tree listing
 *     are injected INTO the prompt; injected brain files satisfy the brain-first
 *     gate structurally.
 *  2. Write-WIs-incrementally — a capped run that left a partial-but-usable WI
 *     set emits `pm.partial-decomposition` (classified transient), distinct from
 *     `pm.empty-decomposition` (terminal).
 *  3. Near-exhaustion — the orchestrator counts streamed assistant turns and
 *     emits `pm.turn-budget-warning` at the threshold; the `_decomposition-state.md`
 *     checkbox checkpoint is parsed for planned-vs-emitted classification.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runProjectManager, type PmQueryFn } from './phases/project-manager.ts';
import { createLogger, type EventLogEntry } from './logging.ts';
import type { CycleInput } from './cycle-context.ts';
import { classifyCycleFailure } from './failure-classifier.ts';
import {
  renderPmUserPrompt,
  parseDecompositionState,
  PM_ALWAYS_RELEVANT_THEMES,
  MANIFEST_SECTION_HEADER,
  BRAIN_CONTEXT_SECTION_HEADER,
  DECOMPOSITION_STATE_FILENAME,
} from './pm-invocation.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..');

// ---------------------------------------------------------------------------
// 1a. renderPmUserPrompt — injected manifest + brain context blocks
// ---------------------------------------------------------------------------

const BASE_INPUT = {
  initiativeId: 'INIT-2026-07-10-turn-economy',
  manifestRelPath: '_queue/in-flight/INIT-2026-07-10-turn-economy.md',
  worktreeRelPath: '/tmp/projects/myproject',
  projectName: 'myproject',
};

test('renderPmUserPrompt: inlines manifest content when provided (single source of intent, zero re-read turns)', () => {
  const prompt = renderPmUserPrompt({
    ...BASE_INPUT,
    manifestContent: '---\ninitiative_id: INIT-x\n---\n\n# The initiative body\n\nGiven A, when B, then C.',
  });
  assert.ok(prompt.includes(MANIFEST_SECTION_HEADER), 'should carry the manifest section header');
  assert.ok(prompt.includes('# The initiative body'), 'should carry the manifest body verbatim');
  assert.match(prompt, /do NOT spend a turn re-reading/i);
});

test('renderPmUserPrompt: omits the manifest block when manifestContent absent (byte-stable for existing callers)', () => {
  const prompt = renderPmUserPrompt(BASE_INPUT);
  assert.ok(!prompt.includes(MANIFEST_SECTION_HEADER));
  // The read-it-yourself bullet stays for the non-inlined path.
  assert.match(prompt, /read this/i);
});

test('renderPmUserPrompt: inlines pre-fetched brain context with per-file paths', () => {
  const prompt = renderPmUserPrompt({
    ...BASE_INPUT,
    brainContext: [
      { path: 'brain/projects/myproject/profile.md', content: '# Profile\ntaste signals here' },
      { path: 'brain/cycles/themes/spec-driven-work-items.md', content: '# Spec-driven WIs' },
    ],
  });
  assert.ok(prompt.includes(BRAIN_CONTEXT_SECTION_HEADER), 'should carry the brain-context section header');
  assert.ok(prompt.includes('brain/projects/myproject/profile.md'));
  assert.ok(prompt.includes('taste signals here'));
  assert.ok(prompt.includes('brain/cycles/themes/spec-driven-work-items.md'));
  // The block must tell the PM these count as consulted (cite, don't re-read).
  assert.match(prompt, /already been read for you|pre-fetched/i);
});

test('renderPmUserPrompt: omits the brain-context block when absent or empty', () => {
  assert.ok(!renderPmUserPrompt(BASE_INPUT).includes(BRAIN_CONTEXT_SECTION_HEADER));
  assert.ok(!renderPmUserPrompt({ ...BASE_INPUT, brainContext: [] }).includes(BRAIN_CONTEXT_SECTION_HEADER));
});

// ---------------------------------------------------------------------------
// 1b. PM_ALWAYS_RELEVANT_THEMES — stays in sync with disk + SKILL.md
// ---------------------------------------------------------------------------

test('PM_ALWAYS_RELEVANT_THEMES: every theme exists on disk and is cited in SKILL.md', () => {
  const skill = readFileSync(resolve(FORGE_ROOT, 'skills', 'project-manager', 'SKILL.md'), 'utf8');
  assert.ok(PM_ALWAYS_RELEVANT_THEMES.length >= 4, 'expected the four always-relevant themes');
  for (const rel of PM_ALWAYS_RELEVANT_THEMES) {
    assert.ok(existsSync(resolve(FORGE_ROOT, rel)), `theme missing on disk: ${rel}`);
    const basename = rel.split('/').pop()!;
    assert.ok(skill.includes(basename), `SKILL.md no longer cites ${basename} — update PM_ALWAYS_RELEVANT_THEMES`);
  }
});

// ---------------------------------------------------------------------------
// 3a. parseDecompositionState — checkbox checkpoint parsing
// ---------------------------------------------------------------------------

test('parseDecompositionState: counts planned + emitted checkboxes', () => {
  const state = parseDecompositionState(
    [
      '# Decomposition state — INIT-x',
      '',
      '- [x] WI-1 — token introspection client',
      '- [x] WI-2 — session store',
      '- [ ] WI-3 — middleware',
      '- [ ] WI-4 — wire routes',
    ].join('\n'),
  );
  assert.deepEqual(state, { planned: 4, emitted: 2 });
});

test('parseDecompositionState: tolerates uppercase X and asterisk bullets', () => {
  const state = parseDecompositionState('* [X] WI-1\n* [ ] WI-2');
  assert.deepEqual(state, { planned: 2, emitted: 1 });
});

test('parseDecompositionState: returns null when no checkboxes present', () => {
  assert.equal(parseDecompositionState('# just prose\nno checklist here'), null);
  assert.equal(parseDecompositionState(''), null);
});

// ---------------------------------------------------------------------------
// Phase-level harness (pattern from cycle-pm-hallucination.test.ts)
// ---------------------------------------------------------------------------

const INITIATIVE_ID = 'INIT-2026-07-10-turn-economy';

const MANIFEST_BODY = `---
initiative_id: ${INITIATIVE_ID}
project: testproj
project_repo_path: ./projects/testproj
created_at: 2026-07-10T00:00:00Z
iteration_budget: 3
cost_budget_usd: 1
phase: in-flight
origin: architect
---

# Turn-economy test initiative

## Acceptance criteria

Given a user is authenticated, when they request /api/health, then the response is 200.
`;

function makeWi(wiId: string): string {
  const fname = `src/${wiId.toLowerCase()}.ts`;
  return `---
work_item_id: ${wiId}
initiative_id: ${INITIATIVE_ID}
status: pending
depends_on: []
acceptance_criteria:
  - given: "a test"
    when: "the function runs"
    then: "it returns a value"
files_in_scope:
  - ${fname}
creates:
  - ${fname}
quality_gate_cmd: ['node', '--test', 'tests/${wiId.toLowerCase()}.test.ts']
estimated_iterations: 1
---

Body for ${wiId}.
`;
}

function makeGraph(wiIds: readonly string[]): string {
  return ['```mermaid', 'graph TD', ...wiIds.map((id) => `  ${id}["${id}"]`), '```'].join('\n');
}

type StubPass = {
  /** WI ids whose files the stub writes. */
  wis: string[];
  /** Checkpoint file content (written verbatim when set). */
  decompositionState?: string;
  /** Result subtype the stub's terminal message carries. */
  resultSubtype: string;
  /** Number of plain assistant messages to stream before writing (turn burn). */
  filerTurns?: number;
  /** Emit a brain-read tool_use assistant message first. Default false. */
  brainRead?: boolean;
};

function makeStubQueryFn(pass: StubPass): {
  queryFn: PmQueryFn;
  capturedPrompt: () => string;
} {
  let captured = '';
  const fn: PmQueryFn = ({ prompt, options }) => {
    captured = prompt;
    const cwd = (options as { cwd: string }).cwd;
    return (async function* () {
      if (pass.brainRead) {
        yield {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: 'brain/cycles/themes/spec-driven-work-items.md' } },
            ],
          },
        };
      }
      for (let i = 0; i < (pass.filerTurns ?? 0); i++) {
        yield { type: 'assistant', message: { content: [{ type: 'text', text: `thinking ${i}` }] } };
      }
      const wiDir = resolve(cwd, '.forge', 'work-items');
      mkdirSync(wiDir, { recursive: true });
      for (const wiId of pass.wis) {
        writeFileSync(join(wiDir, `${wiId}.md`), makeWi(wiId));
      }
      if (pass.wis.length > 0) {
        writeFileSync(join(wiDir, '_graph.md'), makeGraph(pass.wis));
      }
      if (pass.decompositionState !== undefined) {
        writeFileSync(join(wiDir, DECOMPOSITION_STATE_FILENAME), pass.decompositionState);
      }
      yield { type: 'result', subtype: pass.resultSubtype, duration_ms: 1234, total_cost_usd: 0.05 };
    })();
  };
  return { queryFn: fn, capturedPrompt: () => captured };
}

type Harness = {
  dir: string;
  worktree: string;
  logger: ReturnType<typeof createLogger>;
  input: CycleInput;
};

function setupHarness(): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'forge-pm-turn-economy-'));
  const worktree = join(dir, 'projects', 'testproj');
  mkdirSync(worktree, { recursive: true });
  writeFileSync(
    join(worktree, 'package.json'),
    JSON.stringify({ name: 'testproj', version: '0.0.1', scripts: { test: 'echo no tests' } }, null, 2),
  );
  const manifestPath = join(dir, '_queue', 'in-flight', `${INITIATIVE_ID}.md`);
  mkdirSync(join(dir, '_queue', 'in-flight'), { recursive: true });
  writeFileSync(manifestPath, MANIFEST_BODY);
  const logsDir = join(dir, '_logs');
  mkdirSync(logsDir, { recursive: true });
  const logger = createLogger('TEST-pm-turn-economy', logsDir);
  const input: CycleInput = {
    initiativeId: INITIATIVE_ID,
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

// ---------------------------------------------------------------------------
// 1c. Injection at the live seam: prompt carries the known context; injected
//     brain files satisfy the brain-first gate without any agent brain read.
// ---------------------------------------------------------------------------

test('runProjectManager: prompt carries inlined manifest + brain context + tree listing; injection satisfies the brain gate', async () => {
  const h = setupHarness();
  try {
    const { queryFn, capturedPrompt } = makeStubQueryFn({
      wis: ['WI-1', 'WI-2'],
      resultSubtype: 'success',
      brainRead: false, // agent reads NO brain files — injection must carry the gate
    });

    await runProjectManager(h.input, h.logger, { queryFn });

    const prompt = capturedPrompt();
    assert.ok(prompt.includes(MANIFEST_SECTION_HEADER), 'prompt should inline the manifest');
    assert.ok(prompt.includes('Turn-economy test initiative'), 'prompt should carry the manifest body');
    assert.ok(prompt.includes(BRAIN_CONTEXT_SECTION_HEADER), 'prompt should inline pre-fetched brain context');
    assert.ok(
      prompt.includes('brain/cycles/themes/spec-driven-work-items.md'),
      'prompt should carry the always-relevant themes',
    );
    assert.ok(prompt.includes('Directory listing'), 'prompt should carry the worktree tree listing');
    assert.ok(prompt.includes('package.json'), 'tree listing should name real worktree files');

    const events = readEvents(h.logger);
    assert.equal(
      events.filter((e) => (e.message ?? '').includes('brain-skipped')).length,
      0,
      'injected brain context must satisfy the brain-first gate',
    );
    const injected = events.find((e) => e.message === 'pm.context-injected');
    assert.ok(injected, 'expected a pm.context-injected observability event');
    const md = injected.metadata as { brain_files: string[]; manifest_inlined: boolean };
    assert.ok(md.brain_files.length >= 4, 'expected the always-relevant themes injected');
    assert.equal(md.manifest_inlined, true);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. Partial-but-usable classification
// ---------------------------------------------------------------------------

test('runProjectManager: capped mid-decomposition with a partial usable WI set → pm.partial-decomposition, classified transient', async () => {
  const h = setupHarness();
  try {
    const { queryFn } = makeStubQueryFn({
      wis: ['WI-1', 'WI-2'], // 2 of 4 planned written before the cap
      decompositionState: [
        '# Decomposition state — ' + INITIATIVE_ID,
        '',
        '- [x] WI-1 — first slice',
        '- [x] WI-2 — second slice',
        '- [ ] WI-3 — third slice',
        '- [ ] WI-4 — fourth slice',
      ].join('\n'),
      resultSubtype: 'error_max_turns',
      brainRead: true,
    });

    await assert.rejects(() => runProjectManager(h.input, h.logger, { queryFn }), /project-manager phase failed/);

    const events = readEvents(h.logger);
    const partial = events.find((e) => e.message === 'pm.partial-decomposition');
    assert.ok(partial, 'expected pm.partial-decomposition event');
    assert.equal(partial.event_type, 'error');
    const md = partial.metadata as Record<string, unknown>;
    assert.equal(md.result_subtype, 'error_max_turns');
    assert.equal(md.work_item_count, 2);
    assert.equal(md.valid_count, 2);
    assert.equal(md.planned_count, 4);
    assert.equal(md.usable, true);
    // NOT the empty-decomposition path.
    assert.equal(events.filter((e) => e.message === 'pm.empty-decomposition').length, 0);

    const c = classifyCycleFailure(events);
    assert.equal(c.kind, 'transient', 'partial-but-usable must be recoverable (re-queue succeeds per 07-10 evidence)');
    assert.equal(c.recoverable, true);
    assert.match(c.reason, /partial/i);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('runProjectManager: capped but checkpoint-complete valid set still succeeds (no partial event)', async () => {
  const h = setupHarness();
  try {
    const { queryFn } = makeStubQueryFn({
      wis: ['WI-1', 'WI-2'],
      decompositionState: '- [x] WI-1 — first\n- [x] WI-2 — second',
      resultSubtype: 'error_max_turns', // capped AFTER finishing everything
      brainRead: true,
    });

    await runProjectManager(h.input, h.logger, { queryFn });

    const events = readEvents(h.logger);
    assert.equal(events.filter((e) => e.message === 'pm.partial-decomposition').length, 0);
    const end = events.find((e) => e.event_type === 'end' && e.phase === 'project-manager');
    assert.ok(end, 'expected a clean end event');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('runProjectManager: capped with zero WIs stays pm.empty-decomposition (terminal)', async () => {
  const h = setupHarness();
  try {
    const { queryFn } = makeStubQueryFn({ wis: [], resultSubtype: 'error_max_turns', brainRead: true });

    await assert.rejects(() => runProjectManager(h.input, h.logger, { queryFn }));

    const events = readEvents(h.logger);
    assert.ok(events.find((e) => e.message === 'pm.empty-decomposition'));
    assert.equal(events.filter((e) => e.message === 'pm.partial-decomposition').length, 0);
    const c = classifyCycleFailure(events);
    assert.equal(c.kind, 'terminal');
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3b. Near-exhaustion warning — orchestrator-side turn counting
// ---------------------------------------------------------------------------

test('runProjectManager: emits pm.turn-budget-warning once when streamed turns cross the threshold', async () => {
  const h = setupHarness();
  try {
    const { queryFn } = makeStubQueryFn({
      wis: ['WI-1'],
      resultSubtype: 'success',
      brainRead: true,
      filerTurns: 65, // > 80% of the 70-turn live cap
    });

    await runProjectManager(h.input, h.logger, { queryFn });

    const events = readEvents(h.logger);
    const warnings = events.filter((e) => e.message === 'pm.turn-budget-warning');
    assert.equal(warnings.length, 1, 'expected exactly one warning (not one per turn past the threshold)');
    const md = warnings[0]!.metadata as { observed_turns: number; max_turns: number };
    assert.ok(md.observed_turns >= Math.ceil(md.max_turns * 0.8));
    assert.equal(md.max_turns, 70);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});

test('runProjectManager: no turn-budget warning on a short run', async () => {
  const h = setupHarness();
  try {
    const { queryFn } = makeStubQueryFn({
      wis: ['WI-1'],
      resultSubtype: 'success',
      brainRead: true,
      filerTurns: 5,
    });

    await runProjectManager(h.input, h.logger, { queryFn });

    const events = readEvents(h.logger);
    assert.equal(events.filter((e) => e.message === 'pm.turn-budget-warning').length, 0);
  } finally {
    rmSync(h.dir, { recursive: true, force: true });
  }
});
