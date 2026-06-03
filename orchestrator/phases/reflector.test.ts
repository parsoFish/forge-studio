/**
 * Tests for orchestrator/phases/reflector.ts.
 *
 * Covers:
 *   - S6A: brain-lint trigger + retention tagging.
 *   - REF-1: user-questions.json derivation from user-questions.md (post-exit).
 *   - REF-4: brain index regeneration after agent exits.
 *   - S6B: recap.md written on successful close.
 *
 * The agent SDK is stubbed via the `deps.sdkQuery` injectable. The brain-lint
 * runner is stubbed via `deps.brainLint`. The cycle log dir + manifest are
 * pre-seeded in a tempdir so the reflector reads a manifest that resolves
 * cleanly.
 *
 * IMPORTANT: the reflector uses `import.meta.dirname` to resolve the forge root
 * for writes (brain/, _logs/). Tests use unique cycle ids and clean up after
 * each run. The stub agent never writes themes — it just streams a `result`
 * message, so brain-write side-effects are minimal.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runReflector } from './reflector.ts';
import { createLogger, type EventLogEntry } from '../logging.ts';
import type { CycleInput } from '../cycle-context.ts';
import type { RunBrainLintResult, Finding } from '../../cli/brain-lint.ts';

// The forge root the reflector code resolves to (orchestrator/phases/ ⇒ ..)
const FORGE_ROOT = resolve(import.meta.dirname, '..', '..');

type Harness = {
  cycleId: string;
  manifestPath: string;
  cycleLogDir: string;
  events: () => EventLogEntry[];
  logger: ReturnType<typeof createLogger>;
  cleanup: () => void;
};

function uniqueCycleId(suffix: string): string {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  return `S6A-TEST-${ts}-${rnd}-${suffix}`;
}

function setupHarness(opts: { suffix: string }): Harness {
  const cycleId = uniqueCycleId(opts.suffix);
  const tmp = mkdtempSync(join(tmpdir(), 'forge-reflector-test-'));
  // Write a minimal valid manifest into the tempdir. parseManifest needs
  // initiative_id, project, created_at, iteration_budget, cost_budget_usd.
  const manifestPath = join(tmp, 'manifest.md');
  writeFileSync(
    manifestPath,
    [
      '---',
      'initiative_id: INIT-2026-05-23-s6a',
      'project: slugifier',
      'created_at: 2026-05-23T12:00:00Z',
      'iteration_budget: 3',
      'cost_budget_usd: 1.0',
      'phase: done',
      'origin: architect',
      'features: []',
      '---',
      '',
      'body',
      '',
    ].join('\n'),
  );

  // Logger writes to <FORGE_ROOT>/_logs/<cycleId>/events.jsonl.
  const cycleLogDir = resolve(FORGE_ROOT, '_logs', cycleId);
  const logger = createLogger(cycleId, resolve(FORGE_ROOT, '_logs'));

  return {
    cycleId,
    manifestPath,
    cycleLogDir,
    logger,
    events: () => {
      if (!existsSync(logger.logFilePath)) return [];
      const raw = readFileSync(logger.logFilePath, 'utf8');
      const lines: EventLogEntry[] = [];
      for (const l of raw.split('\n')) {
        if (!l.trim()) continue;
        try {
          lines.push(JSON.parse(l));
        } catch {
          /* skip */
        }
      }
      return lines;
    },
    cleanup: () => {
      try {
        rmSync(tmp, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
      try {
        rmSync(cycleLogDir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    },
  };
}

function makeInput(h: Harness): CycleInput {
  return {
    initiativeId: 'INIT-2026-05-23-s6a',
    manifestPath: h.manifestPath,
    projectRepoPath: FORGE_ROOT,
    worktreePath: FORGE_ROOT,
    cycleId: h.cycleId,
  };
}

/**
 * Stub SDK query that streams an assistant block with one brain Read and
 * a successful result message. brainReads >= 1 is required to clear the
 * F-13 brain-gate.
 */
async function* fakeSdkQueryClean(_: {
  prompt: string;
  options: Record<string, unknown>;
}): AsyncIterable<unknown> {
  yield {
    type: 'assistant',
    message: {
      content: [
        { type: 'tool_use', name: 'Read', input: { file_path: 'brain/INDEX.md' } },
      ],
    },
  };
  yield {
    type: 'result',
    subtype: 'success',
    total_cost_usd: 0.05,
    duration_ms: 1234,
  };
}

function makeCleanLintStub(): (opts: { cwd: string; cycleId: string }) => RunBrainLintResult {
  return () => ({ findings: [], exitCode: 0 });
}

function makeFlaggedLintStub(): (opts: { cwd: string; cycleId: string }) => RunBrainLintResult {
  const findings: Finding[] = [
    {
      category: 'error',
      file: '/fake/brain/projects/slugifier/themes/broken.md',
      message: 'missing required frontmatter field: category',
      check: 'checkFrontmatter',
    },
    {
      category: 'error',
      file: '/fake/brain/projects/slugifier/themes/orphan.md',
      message: 'broken link: ./nonexistent.md',
      check: 'checkSourceLinks',
    },
  ];
  return () => ({ findings, exitCode: 1 });
}

function makeMissingLintStub(): (opts: { cwd: string; cycleId: string }) => RunBrainLintResult {
  return () => {
    const e = new Error("Cannot find module './brain-lint.ts'");
    // Tag the error so the reflector's regex matches.
    (e as { code?: string }).code = 'MODULE_NOT_FOUND';
    throw e;
  };
}

// ---------- tests ----------

test('runReflector: clean lint run → lint_status:clean + lint-invoked event', async () => {
  const h = setupHarness({ suffix: 'clean' });
  try {
    const result = await runReflector(makeInput(h), h.logger, {
      sdkQuery: fakeSdkQueryClean,
      brainLint: makeCleanLintStub(),
    });

    assert.equal(result.reflection_status, 'closed');
    assert.equal(result.lint_status, 'clean');

    const events = h.events();
    const lintEvent = events.find((e) => e.message === 'reflector.lint-invoked');
    assert.ok(lintEvent, 'expected reflector.lint-invoked event');
    assert.equal(lintEvent!.metadata?.['result'], 'clean');
    assert.equal(lintEvent!.metadata?.['findings_count'], 0);

    // Brain-lint report written even on clean.
    const reportPath = resolve(h.cycleLogDir, 'brain-lint.md');
    assert.ok(existsSync(reportPath), 'expected brain-lint.md report');
    const body = readFileSync(reportPath, 'utf8');
    assert.match(body, /no findings/);
  } finally {
    h.cleanup();
  }
});

test('runReflector: missing brain-lint executable → lint_status:skipped + lint-skipped event', async () => {
  const h = setupHarness({ suffix: 'missing' });
  try {
    const result = await runReflector(makeInput(h), h.logger, {
      sdkQuery: fakeSdkQueryClean,
      brainLint: makeMissingLintStub(),
    });

    assert.equal(result.reflection_status, 'closed', 'reflection should still close');
    assert.equal(result.lint_status, 'skipped');

    const events = h.events();
    const skippedEvent = events.find((e) => e.message === 'reflector.lint-skipped');
    assert.ok(skippedEvent, 'expected reflector.lint-skipped event');
    assert.equal(skippedEvent!.metadata?.['reason'], 'executable-missing');

    // No `lint-invoked` event when skipped.
    assert.equal(
      events.find((e) => e.message === 'reflector.lint-invoked'),
      undefined,
    );
  } finally {
    h.cleanup();
  }
});

test('runReflector: lint exits with findings → lint_status:flagged + lint-flagged event + report written', async () => {
  const h = setupHarness({ suffix: 'flagged' });
  try {
    const result = await runReflector(makeInput(h), h.logger, {
      sdkQuery: fakeSdkQueryClean,
      brainLint: makeFlaggedLintStub(),
    });

    assert.equal(result.reflection_status, 'closed', 'flagged lint must NOT block close');
    assert.equal(result.lint_status, 'flagged');

    const events = h.events();
    const flaggedEvent = events.find((e) => e.message === 'reflector.lint-flagged');
    assert.ok(flaggedEvent, 'expected reflector.lint-flagged event');
    assert.equal(flaggedEvent!.metadata?.['findings_count'], 2);

    // Report file present + non-empty.
    const reportPath = resolve(h.cycleLogDir, 'brain-lint.md');
    assert.ok(existsSync(reportPath), 'expected brain-lint.md report on flagged run');
    const body = readFileSync(reportPath, 'utf8');
    assert.match(body, /Errors/);
    assert.match(body, /missing required frontmatter/);
  } finally {
    h.cleanup();
  }
});

test('runReflector: reflection_status stays closed regardless of lint outcome', async () => {
  // Combined sweep — ensures the three lint outcomes do NOT change the
  // reflection close gate. Lint is informational only (per C8 + plan 06 +
  // feedback_reflection_close_criterion).
  const cases: Array<{
    suffix: string;
    stub: (opts: { cwd: string; cycleId: string }) => RunBrainLintResult;
    expectLint: 'clean' | 'flagged' | 'skipped';
  }> = [
    { suffix: 'sweep-clean', stub: makeCleanLintStub(), expectLint: 'clean' },
    { suffix: 'sweep-flagged', stub: makeFlaggedLintStub(), expectLint: 'flagged' },
    { suffix: 'sweep-missing', stub: makeMissingLintStub(), expectLint: 'skipped' },
  ];
  for (const c of cases) {
    const h = setupHarness({ suffix: c.suffix });
    try {
      const result = await runReflector(makeInput(h), h.logger, {
        sdkQuery: fakeSdkQueryClean,
        brainLint: c.stub,
      });
      assert.equal(
        result.reflection_status,
        'closed',
        `case ${c.suffix} should close`,
      );
      assert.equal(result.lint_status, c.expectLint);
    } finally {
      h.cleanup();
    }
  }
});

test('runReflector: brain-gate failure → reflection_status:failed + lint_status:skipped', async () => {
  // Sanity check: when the F-13 brain-first gate fails (zero brain reads),
  // reflection fails BEFORE lint runs. This confirms lint is gated on the
  // brain-gate, not the other way around.
  const h = setupHarness({ suffix: 'brain-gate-fail' });
  try {
    async function* fakeSdkQueryNoBrain(): AsyncIterable<unknown> {
      yield {
        type: 'assistant',
        message: {
          content: [
            // No brain reads at all.
            { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      };
      yield {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.01,
        duration_ms: 100,
      };
    }
    const result = await runReflector(makeInput(h), h.logger, {
      sdkQuery: fakeSdkQueryNoBrain,
      brainLint: makeCleanLintStub(),
    });
    assert.equal(result.reflection_status, 'failed');
    assert.equal(result.lint_status, 'skipped');
    // brain-skipped should be emitted; lint-invoked should NOT.
    const events = h.events();
    assert.ok(events.find((e) => e.message === 'reflector.brain-skipped'));
    assert.equal(events.find((e) => e.message === 'reflector.lint-invoked'), undefined);
  } finally {
    h.cleanup();
  }
});

test('runReflector: REF-1 — derives user-questions.json from agent-written user-questions.md', async () => {
  // The agent writes user-questions.md with numbered ## headings; the
  // orchestrator post-exit derives user-questions.json as an
  // AskUserQuestion-shaped array so the /reflect screen can render it.
  const h = setupHarness({ suffix: 'uq-derive' });
  try {
    mkdirSync(h.cycleLogDir, { recursive: true });
    const mdPath = resolve(h.cycleLogDir, 'user-questions.md');
    writeFileSync(
      mdPath,
      [
        '## 1. Was the WI decomposition the right size?',
        '',
        'We had 5 WIs. Were they too granular?',
        '',
        '## 2. Should we add a retry policy?',
        '',
        'The dev-loop hit 3 transient failures.',
        '',
      ].join('\n'),
    );

    const result = await runReflector(makeInput(h), h.logger, {
      sdkQuery: fakeSdkQueryClean,
      brainLint: makeCleanLintStub(),
    });
    assert.equal(result.reflection_status, 'closed');

    const jsonPath = resolve(h.cycleLogDir, 'user-questions.json');
    assert.ok(existsSync(jsonPath), 'expected user-questions.json to be derived');
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as Array<{
      question: string;
      header: string;
      options: Array<{ label: string }>;
    }>;
    assert.equal(parsed.length, 2, 'expected 2 questions derived from 2 headings');
    // headers must be ≤12 chars
    for (const q of parsed) {
      assert.ok(q.header.length <= 12, `header "${q.header}" exceeds 12 chars`);
      assert.ok(Array.isArray(q.options) && q.options.length >= 2, 'expected ≥2 options per question');
    }
    assert.ok(
      parsed[0].question.includes('WI') || parsed[0].question.includes('decomposition'),
      'first question body should reference WI/decomposition content',
    );
  } finally {
    h.cleanup();
  }
});

test('runReflector: REF-1 — absent user-questions.md → user-questions.json is empty array', async () => {
  // When the agent writes no questions (no warranted questions this cycle),
  // user-questions.md is absent. The orchestrator must write [] so the UI
  // shows "no questions" rather than a stale value or missing file.
  const h = setupHarness({ suffix: 'uq-absent' });
  try {
    const result = await runReflector(makeInput(h), h.logger, {
      sdkQuery: fakeSdkQueryClean,
      brainLint: makeCleanLintStub(),
    });
    assert.equal(result.reflection_status, 'closed');

    const jsonPath = resolve(h.cycleLogDir, 'user-questions.json');
    assert.ok(existsSync(jsonPath), 'expected user-questions.json even when .md absent');
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
    assert.deepEqual(parsed, [], 'expected empty array when no user-questions.md');
  } finally {
    h.cleanup();
  }
});

test('runReflector: REF-4 — brain-index-regenerated event emitted on successful close', async () => {
  // After the agent exits and themes are written, the orchestrator calls
  // regenerateBrainIndex and emits reflector.brain-index-regenerated.
  const h = setupHarness({ suffix: 'brain-idx' });
  try {
    const result = await runReflector(makeInput(h), h.logger, {
      sdkQuery: fakeSdkQueryClean,
      brainLint: makeCleanLintStub(),
    });
    assert.equal(result.reflection_status, 'closed');

    const events = h.events();
    const idxEvent = events.find((e) => e.message === 'reflector.brain-index-regenerated');
    assert.ok(idxEvent, 'expected reflector.brain-index-regenerated event on successful close');
  } finally {
    h.cleanup();
  }
});

test('runReflector: writes _logs/<id>/recap.md on successful close (S6B)', async () => {
  // S6B — the orchestrator writes a one-page recap after retention + lint,
  // before reflector.end. The file must exist and contain the six sections.
  const h = setupHarness({ suffix: 'recap' });
  try {
    const result = await runReflector(makeInput(h), h.logger, {
      sdkQuery: fakeSdkQueryClean,
      brainLint: makeCleanLintStub(),
    });
    assert.equal(result.reflection_status, 'closed');

    const recapPath = resolve(h.cycleLogDir, 'recap.md');
    assert.ok(existsSync(recapPath), 'expected _logs/<id>/recap.md');
    const body = readFileSync(recapPath, 'utf8');
    assert.match(body, /# Cycle recap/);
    assert.match(body, /## Outcome/);
    assert.match(body, /## Stats/);
    assert.match(body, /## Themes written/);
    assert.match(body, /## Brain gaps/);
    assert.match(body, /## Lint/);
    assert.match(body, /## Links/);

    // reflector.recap-emitted event surfaced.
    const events = h.events();
    const recapEvent = events.find((e) => e.message === 'reflector.recap-emitted');
    assert.ok(recapEvent, 'expected reflector.recap-emitted event');
    assert.equal(recapEvent!.metadata?.['lint_status'], 'clean');
  } finally {
    h.cleanup();
  }
});

test('runReflector: emits retention-assigned event on successful close', async () => {
  // Even when no themes are written by the stub agent, the retention
  // heuristic still runs and emits an event (defaults to 'routine' with
  // an empty cited_by — confirms the wiring fires).
  const h = setupHarness({ suffix: 'retention-evt' });
  try {
    const result = await runReflector(makeInput(h), h.logger, {
      sdkQuery: fakeSdkQueryClean,
      brainLint: makeCleanLintStub(),
    });
    assert.equal(result.reflection_status, 'closed');
    const events = h.events();
    const retentionEvent = events.find(
      (e) => e.message === 'reflector.retention-assigned',
    );
    assert.ok(retentionEvent, 'expected reflector.retention-assigned event');
    assert.ok(
      ['load-bearing', 'interesting', 'routine'].includes(
        String(retentionEvent!.metadata?.['retention']),
      ),
    );
  } finally {
    h.cleanup();
  }
});
