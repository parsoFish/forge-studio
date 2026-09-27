/**
 * `parseUserQuestionsMd` — the reflector's `user-questions.md` →
 * `user-questions.json` parse (bead forge-8vfn.8.1.35, ruling 1736).
 *
 * S10 proof run 36's `user-questions.json` began with the file's own H1 title
 * as question 0 (`header: "# User quest"`, no options): the split on
 * `^(?=## )` kept everything before the first `## ` heading as a section. The
 * fixture below has the real file's shape — an H1 title line, then numbered
 * `## ` sections, one with a bullet option list and two without.
 *
 * Its own file, not `reflector.test.ts`, which is at its size exemption.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  parseUserQuestionsMd,
  runReflector as runReflectorReal,
  type ReflectorDeps,
} from '../../phases/reflector.ts';
import { createLogger } from '@forge/kernel';
import type { CycleInput } from '@forge/flows';
import type { RunBrainLintResult } from '@forge/knowledge';
import { acquireIsolatedReflectorLease } from '../test-fixtures/reflector-lease-test-fixture.ts';
import { canonicalDef } from '../test-fixtures/canonical-def-fixture.ts';

const RUN_36_SHAPE = [
  '# User questions — INIT-2026-09-27-exclude-author-filter',
  '',
  '## 1. Was the work-item decomposition the right size?',
  '',
  'WI-2 was the largest: all CLI wiring in a single WI. It completed cleanly but was wide.',
  '',
  '- too-few WIs (WI-2 was too large; should split by output-format)',
  '- right-sized (4 WIs for this scope is appropriate)',
  '- too-many WIs',
  '',
  '## 2. Did the implementation match the design intent?',
  '',
  'The PR description states it explicitly as a fix, not scope drift.',
  '',
  '## 3. Any other notes on this initiative?',
  '',
  '_(freeform — precedence semantics, annotation UX, cost, anything)_',
  '',
].join('\n');

test('parseUserQuestionsMd: the H1 title and preamble are not a question', () => {
  const questions = parseUserQuestionsMd(RUN_36_SHAPE);
  assert.equal(questions.length, 3, 'one question per ## section, and nothing else');
  for (const q of questions) {
    assert.ok(!/^#\s/.test(q.header), `a heading leaked in as a question: "${q.header}"`);
  }
});

test('parseUserQuestionsMd: the ## sections keep their order and their options', () => {
  const questions = parseUserQuestionsMd(RUN_36_SHAPE);
  assert.match(questions[0].question, /WI-2 was the largest/);
  assert.equal(questions[0].options?.length, 3);
  assert.match(questions[2].question, /freeform/);
  assert.deepEqual(questions[2].options, []);
});

// SHOULD-FIX 2 (forge-8vfn.8.1.34): a file with NO `## ` heading at all names no
// numbered question — `[]`, never the whole body read as one bogus question (the
// pre-fix behaviour this same bead's H1-preamble door already covers for a
// heading-BEFORE-the-first-`## ` prefix). Both shapes share one rule: only
// content that starts a `## ` section is ever read as a question.
test('parseUserQuestionsMd: a file with no ## heading at all yields [], never a placeholder question', () => {
  const questions = parseUserQuestionsMd('_(no open questions — prior feedback covers this cycle)_');
  assert.deepEqual(questions, []);
});

// ---------------------------------------------------------------------------
// forge-8vfn.8.1.37 / ruling 1770 (row 147) — a lost reflection (SDK result
// subtype `error_max_budget_usd`) must not also lose an already-written
// user-questions.md. S10 run 37: the reflector wrote a well-formed .md, then
// hit `error_max_budget_usd`; `runReflector` returned before ever reaching
// the REF-1 derivation call, so `user-questions.json` was never produced and
// the /reflect screen (which reads only the .json) rendered no questions.
//
// Harness mirrors reflector.test.ts's (that file is at its size exemption —
// this fix's tests live here instead, per forge-8vfn.8.1.37's own
// instruction). The stub agent SDK and lease/def fixtures are the same ones
// `reflector.test.ts` uses for its own `error_max_budget_usd` coverage.
// ---------------------------------------------------------------------------

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');

const runReflector = (
  input: CycleInput, logger: Parameters<typeof runReflectorReal>[1], deps: Partial<ReflectorDeps> = {},
): ReturnType<typeof runReflectorReal> =>
  runReflectorReal(input, logger, {
    acquireBrainWriteLease: acquireIsolatedReflectorLease,
    agentDef: canonicalDef('reflector'),
    ...deps,
  });

type LostQuestionsEvent = { message?: string; event_type?: string; metadata?: Record<string, unknown> };

type LostQuestionsHarness = {
  cycleId: string;
  manifestPath: string;
  cycleLogDir: string;
  logger: ReturnType<typeof createLogger>;
  events: () => LostQuestionsEvent[];
  cleanup: () => void;
};

function setupLostQuestionsHarness(suffix: string): LostQuestionsHarness {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 8);
  const cycleId = `UQ-LOST-TEST-${ts}-${rnd}-${suffix}`;
  const tmp = mkdtempSync(join(tmpdir(), 'reflector-uq-lost-test-'));
  const manifestPath = join(tmp, 'manifest.md');
  writeFileSync(
    manifestPath,
    [
      '---',
      'initiative_id: INIT-2026-05-23-uq-lost',
      'project: demo-project',
      'created_at: 2026-05-23T12:00:00Z',
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
  const cycleLogDir = resolve(FORGE_ROOT, '_logs', cycleId);
  const logger = createLogger(cycleId, resolve(FORGE_ROOT, '_logs'));
  return {
    cycleId,
    manifestPath,
    cycleLogDir,
    logger,
    events: (): LostQuestionsEvent[] => {
      if (!existsSync(logger.logFilePath)) return [];
      const raw = readFileSync(logger.logFilePath, 'utf8');
      const out: LostQuestionsEvent[] = [];
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line));
        } catch {
          /* skip malformed line */
        }
      }
      return out;
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

function makeLostQuestionsInput(h: LostQuestionsHarness): CycleInput {
  return {
    initiativeId: 'INIT-2026-05-23-uq-lost',
    manifestPath: h.manifestPath,
    projectRepoPath: FORGE_ROOT,
    worktreePath: FORGE_ROOT,
    cycleId: h.cycleId,
  };
}

function makeCleanLintStubForLostQuestions(): (opts: { cwd: string; cycleId: string }) => RunBrainLintResult {
  return () => ({ findings: [], exitCode: 0 });
}

/** Streams one brain Read (clears F-13) then ends with `error_max_budget_usd`. */
async function* fakeSdkQueryBudgetExhausted(): AsyncIterable<unknown> {
  yield {
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/INDEX.md' } }] },
  };
  yield { type: 'result', subtype: 'error_max_budget_usd', total_cost_usd: 1.5376, duration_ms: 90_000 };
}

const RUN_37_QUESTIONS_MD = [
  '## 1. Was the exclude-author filter scoped correctly?',
  '',
  'The filter only applies to the commit-log view, not the diff view.',
  '',
  '- correct — commit-log only is the right scope',
  '- too narrow — should also cover the diff view',
  '',
  '## 2. Any other notes on this initiative?',
  '',
  '_(freeform — anything else worth recording)_',
  '',
].join('\n');

test('runReflector: budget-exhausted derives .json from an already-written .md, still reports failed',
  async () => {
  const h = setupLostQuestionsHarness('budget-with-md');
  try {
    mkdirSync(h.cycleLogDir, { recursive: true });
    const mdPath = resolve(h.cycleLogDir, 'user-questions.md');
    writeFileSync(mdPath, RUN_37_QUESTIONS_MD);

    const result = await runReflector(makeLostQuestionsInput(h), h.logger, {
      sdkQuery: fakeSdkQueryBudgetExhausted,
      brainLint: makeCleanLintStubForLostQuestions(),
    });

    // The reflection must still be reported lost — deriving the questions
    // must never mask the budget-exhaustion outcome.
    assert.equal(result.reflection_status, 'failed', 'a budget-exhausted reflector must not close silently');
    const events = h.events();
    const lost = events.find((e) => e.message === 'cycle.reflection-lost');
    assert.ok(lost, 'expected cycle.reflection-lost event');
    assert.equal(lost!.metadata?.['cause'], 'budget-exhausted');

    // But the operator must still be able to answer via /reflect — the
    // already-written .md must have been derived into .json.
    const jsonPath = resolve(h.cycleLogDir, 'user-questions.json');
    assert.ok(existsSync(jsonPath), 'expected .json to be derived even though the reflection was lost');
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as Array<{
      question: string;
      header: string;
      options: Array<{ label: string }>;
    }>;
    assert.equal(parsed.length, 2, 'expected 2 questions derived from the 2 ## headings');
    assert.match(parsed[0].question, /commit-log view/);
    assert.equal(parsed[0].options.length, 2, 'expected the bullet option list to be parsed');
  } finally {
    h.cleanup();
  }
});

test('runReflector: budget-exhausted, no .md written, writes nothing (lost path unchanged)', async () => {
  const h = setupLostQuestionsHarness('budget-no-md');
  try {
    const result = await runReflector(makeLostQuestionsInput(h), h.logger, {
      sdkQuery: fakeSdkQueryBudgetExhausted,
      brainLint: makeCleanLintStubForLostQuestions(),
    });
    assert.equal(result.reflection_status, 'failed');
    const jsonPath = resolve(h.cycleLogDir, 'user-questions.json');
    assert.ok(!existsSync(jsonPath), 'no .md was ever written, so the lost path must not synthesize a .json');
  } finally {
    h.cleanup();
  }
});
