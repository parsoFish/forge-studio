/**
 * forge-nk1y.27 + forge-nk1y.26 — the operator's reflection answers reach the themes, and a
 * multi-answer question is asked as one.
 *
 * gitweave I1 (2026-10-10): the interactive reflector wrote its themes, THEN asked four questions.
 * The operator's answers carried corrections ("the gaps were caught by the OPERATOR, NOT by the
 * adversarial review"), and the answer POST re-ran the reflector — but nothing told that rerun to
 * amend the themes it had written, and nothing checked whether it did. Q3 ("which roadblock is
 * worth a forge fix") wanted several picks and rendered as a single-choice radio; the operator wrote
 * "the form allows one choice" into the freeform box.
 *
 * Fixtures are the I1 cycle's own files, copied: `user-questions.md`, `user-feedback.md`, and one
 * theme that cites the cycle (`../test-fixtures/gitweave-i1-reflection/`). The theme is planted in
 * a throwaway project brain under the real forge root (forgeRoot is not injectable by design) and
 * removed after each test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { parseUserQuestionsMd, runReflector, type ReflectorDeps } from '../../phases/reflector.ts';
import { createLogger } from '@forge/kernel';
import type { CycleInput } from '@forge/flows';
import { acquireIsolatedReflectorLease } from '../test-fixtures/reflector-lease-test-fixture.ts';
import { canonicalDef } from '../test-fixtures/canonical-def-fixture.ts';

const FORGE_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..');
const FIX = resolve(import.meta.dirname, '..', 'test-fixtures', 'gitweave-i1-reflection');
const I1_CYCLE = '2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline';
const QUESTIONS_MD = readFileSync(join(FIX, 'user-questions.fixture.txt'), 'utf8');
const FEEDBACK_MD = readFileSync(join(FIX, 'user-feedback.fixture.txt'), 'utf8');
const THEME_MD = readFileSync(join(FIX, 'theme-review-stale-findings.fixture.txt'), 'utf8');
const CORRECTION = 'the gaps were caught by the OPERATOR';

type Ev = { message?: string; event_type?: string; metadata?: Record<string, unknown> };

function setup(withFeedback: boolean) {
  const tag = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const cycleId = `${I1_CYCLE}-fold-${tag}`;
  const project = `fold-test-${tag}`;
  const tmp = mkdtempSync(join(tmpdir(), 'reflector-fold-test-'));
  const manifestPath = join(tmp, 'manifest.md');
  writeFileSync(manifestPath, ['---', 'initiative_id: INIT-2026-10-10-i1-honest-baseline', `project: ${project}`, 'created_at: 2026-10-10T01:55:59Z',
    'iteration_budget: 3', 'cost_budget_usd: 1.0', 'class: code', 'phase: done', 'origin: architect', '---', '', 'body', ''].join('\n'));
  const logsRoot = join(tmp, '_logs');
  const cycleLogDir = resolve(logsRoot, cycleId);
  mkdirSync(cycleLogDir, { recursive: true });
  writeFileSync(resolve(cycleLogDir, 'user-questions.md'), QUESTIONS_MD);
  if (withFeedback) writeFileSync(resolve(cycleLogDir, 'user-feedback.md'), FEEDBACK_MD.replaceAll(I1_CYCLE, cycleId));
  const projectBrain = resolve(FORGE_ROOT, 'brain', 'projects', project);
  const themePath = resolve(projectBrain, 'themes', '2026-10-10-adversarial-review-stale-findings-after-send-back.md');
  mkdirSync(resolve(projectBrain, 'themes'), { recursive: true });
  writeFileSync(themePath, THEME_MD.replaceAll(I1_CYCLE, cycleId));
  const logger = createLogger(cycleId, logsRoot);
  const input: CycleInput = { initiativeId: 'INIT-2026-10-10-i1-honest-baseline', manifestPath, projectRepoPath: FORGE_ROOT, worktreePath: FORGE_ROOT, cycleId, logsRoot, mode: 'interactive' };
  return {
    cycleId, cycleLogDir, themePath, input, logger,
    events: (): Ev[] => existsSync(logger.logFilePath) ? readFileSync(logger.logFilePath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Ev) : [],
    cleanup: () => { rmSync(tmp, { recursive: true, force: true }); rmSync(projectBrain, { recursive: true, force: true }); },
  };
}

/** A fake reflector: one brain Read (the F-13 gate), optionally an edit to the theme, then success. Records its prompt. */
function fakeAgent(seen: { prompt?: string }, edit?: () => void) {
  return async function* (params: { prompt: string }): AsyncIterable<unknown> {
    seen.prompt = params.prompt;
    yield { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'brain/INDEX.md' } }] } };
    edit?.();
    yield { type: 'result', subtype: 'success', total_cost_usd: 0.05, duration_ms: 1000 };
  };
}

const deps = (sdkQuery: ReflectorDeps['sdkQuery']): ReflectorDeps => ({
  acquireBrainWriteLease: acquireIsolatedReflectorLease,
  agentDef: canonicalDef('reflector'),
  brainLint: () => ({ findings: [], exitCode: 0 }),
  sdkQuery,
});
const named = (evs: Ev[], m: string) => evs.filter((e) => e.message === m);

test('a rerun after the operator answered is a FOLD: its prompt names the cycle\'s themes and says to amend them', async () => {
  const h = setup(true);
  try {
    const seen: { prompt?: string } = {};
    await runReflector(h.input, h.logger, deps(fakeAgent(seen)));
    assert.match(seen.prompt ?? '', /## Fold the operator's answers/);
    assert.ok((seen.prompt ?? '').includes(h.themePath), 'the theme that cites this cycle is named');
    assert.match(seen.prompt ?? '', /operator correction overrides/i);
  } finally { h.cleanup(); }
});

test('answers folded: an amended theme → reflector.feedback-folded naming it; brain lint runs after', async () => {
  const h = setup(true);
  try {
    const amend = () => writeFileSync(h.themePath, `${readFileSync(h.themePath, 'utf8')}\n## Operator answers\n\n> Q2 — ${CORRECTION} (send-backs + fresh-clone measurement), NOT by the adversarial review.\n`);
    await runReflector(h.input, h.logger, deps(fakeAgent({}, amend)));
    const evs = h.events();
    const folded = named(evs, 'reflector.feedback-folded');
    assert.equal(folded.length, 1);
    assert.deepEqual(folded[0].metadata?.['themes_amended'], [h.themePath]);
    assert.match(readFileSync(h.themePath, 'utf8'), new RegExp(CORRECTION));
    const order = evs.map((e) => e.message);
    assert.ok(order.indexOf('reflector.feedback-folded') < order.indexOf('reflector.lint-invoked'), 'brain lint runs after the fold');
  } finally { h.cleanup(); }
});

test('refusal path: a fold turn that amends no theme is named reflector.feedback-not-folded (error), never a silent close', async () => {
  const h = setup(true);
  try {
    await runReflector(h.input, h.logger, deps(fakeAgent({})));
    const notFolded = named(h.events(), 'reflector.feedback-not-folded');
    assert.equal(notFolded.length, 1);
    assert.equal(notFolded[0].event_type, 'error');
    assert.equal(notFolded[0].metadata?.['themes_considered'], 1);
    assert.equal(notFolded[0].metadata?.['reason'], 'no theme changed');
  } finally { h.cleanup(); }
});

test('a first run (no answers yet) is not a fold: no fold section, no fold event', async () => {
  const h = setup(false);
  try {
    const seen: { prompt?: string } = {};
    await runReflector(h.input, h.logger, deps(fakeAgent(seen)));
    assert.doesNotMatch(seen.prompt ?? '', /## Fold the operator's answers/);
    const evs = h.events();
    assert.equal(named(evs, 'reflector.feedback-folded').length + named(evs, 'reflector.feedback-not-folded').length, 0);
  } finally { h.cleanup(); }
});

test('a question marked "Choose any:" parses as multi; I1\'s unmarked questions stay single-choice', () => {
  const plain = parseUserQuestionsMd(QUESTIONS_MD);
  assert.equal(plain.length, 4);
  assert.equal(plain.some((q) => q.multi === true), false);
  const marked = QUESTIONS_MD.replace('\n- (a) Skip already-green WIs', '\nChoose any:\n- (a) Skip already-green WIs');
  const q3 = parseUserQuestionsMd(marked)[2];
  assert.equal(q3.multi, true);
  assert.equal(q3.options.length, 4);
  assert.doesNotMatch(q3.question, /Choose any/);
});

test('the interactive stage-2 prompt tells the reflector how to ask a multi-answer question', async () => {
  const h = setup(false);
  try {
    const seen: { prompt?: string } = {};
    await runReflector(h.input, h.logger, deps(fakeAgent(seen)));
    assert.match(seen.prompt ?? '', /`Choose any:`/);
  } finally { h.cleanup(); }
});
