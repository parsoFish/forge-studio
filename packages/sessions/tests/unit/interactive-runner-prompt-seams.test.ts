/**
 * Bead forge-8vfn.6.6 item 5 — prompt seams for kind-specific context,
 * WITHOUT adding per-kind fields on turnSpec (the authored yaml data).
 *
 * Both seams live on `RunInteractiveTurnCtx` (interactive-agent-step.ts) —
 * call-time functions the caller of `runInteractiveTurn` supplies, mirroring
 * the existing `queryFn`/`logger` seams on the same type:
 *
 *   - `ctx.turnId` — mode-conditional turn-id selection, the same branch the
 *     real instructions runner makes by hand today
 *     (`status.mode === 'edit' ? 'interview-edit' : 'interview'`,
 *     `packages/sessions/kinds/instructions.ts`). Proven here against the REAL
 *     `skills/instructions-creator/SKILL.md` turn sections via
 *     `loadSkillTurnPrompt` — not a fixture skill.
 *   - `ctx.promptContext` — extra prompt lines a caller injects (the shape
 *     seed matching + its provenance footer need — `renderSeedPromptSection`
 *     in instructions.ts), appended to the generic spine's prompt.
 *
 * Both are ABSENT from every real turnSpec-bearing kind today (only
 * `authoring` carries one) — these are positive controls on the SEAM itself,
 * proven through the real `runInteractiveTurn` dispatch, not a hand call to
 * an internal helper.
 */
import { loadFixtureDescriptor, logger, setup } from './test-fixtures/interactive-runner-fixtures.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInteractiveTurn } from '../../interactive-runner.ts';
import { writeSessionStatus, type QueryFn } from '../../interactive-session.ts';

type Status = { session_id: string; phase: string; updated_at: string; mode?: string };

function captureQueryFn(): { queryFn: QueryFn; captured: () => { prompt: string } | undefined } {
  let captured: { prompt: string } | undefined;
  const queryFn: QueryFn = (params) => {
    captured = params;
    async function* gen(): AsyncGenerator<unknown> {
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };
  return { queryFn, captured: () => captured };
}

/** `test-kind`'s `analyzing` phase declares `writes: [staging]` — the
 *  generic spine's own P1 refusal fires if nothing lands there, unrelated
 *  to the seam under test. Writes a real file so that refusal never fires. */
function stagingQueryFn(sessionDir: string): { queryFn: QueryFn; captured: () => { prompt: string } | undefined } {
  let captured: { prompt: string } | undefined;
  const queryFn: QueryFn = (params) => {
    captured = params;
    async function* gen(): AsyncGenerator<unknown> {
      mkdirSync(join(sessionDir, 'staging'), { recursive: true });
      writeFileSync(join(sessionDir, 'staging', 'output.md'), '# staged output\n');
      yield { type: 'result', total_cost_usd: 0.01 };
    }
    return gen();
  };
  return { queryFn, captured: () => captured };
}

test('ctx.turnId (mode:"edit") selects the loadSkillTurnPrompt "interview-edit" SECTION — the edit-only paragraph reaches the model', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionId = '2026-09-25T00-00-00';
  const sessionDir = join(projectRoot, '_interactivetest-turnid', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<Status>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString(), mode: 'edit' });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-turnid');
  const { queryFn, captured } = captureQueryFn();

  await runInteractiveTurn(descriptor, {
    sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId),
    turnId: ({ status }) => ((status as Status).mode === 'edit' ? 'interview-edit' : 'interview'),
  });

  assert.ok(captured(), 'queryFn must have been invoked');
  // skills/instructions-creator/SKILL.md's "interview-edit" section carries
  // this paragraph; the plain "interview" section does not — proves the
  // SELECTED section reached the model, not the whole file / wrong section.
  assert.ok(
    captured()!.prompt.includes('You are UPDATING the existing AGENTS.md'),
    `expected the "interview-edit" turn section in the prompt — got ${JSON.stringify(captured()!.prompt)}`,
  );
});

test('ctx.turnId (mode absent) selects the loadSkillTurnPrompt "interview" SECTION — the edit-only paragraph is ABSENT', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionId = '2026-09-25T00-00-01';
  const sessionDir = join(projectRoot, '_interactivetest-turnid', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<Status>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-turnid');
  const { queryFn, captured } = captureQueryFn();

  await runInteractiveTurn(descriptor, {
    sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId),
    turnId: ({ status }) => ((status as Status).mode === 'edit' ? 'interview-edit' : 'interview'),
  });

  assert.ok(captured(), 'queryFn must have been invoked');
  assert.ok(
    !captured()!.prompt.includes('You are UPDATING the existing AGENTS.md'),
    'the "interview" section must NOT carry the edit-only paragraph — a mode-conditional bug would leak it in',
  );
});

test('ctx.turnId ABSENT keeps the unchanged whole-SKILL.md read (both turn sections\' text present)', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionId = '2026-09-25T00-00-02';
  const sessionDir = join(projectRoot, '_interactivetest-turnid', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus<Status>(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind-turnid');
  const { queryFn, captured } = captureQueryFn();

  // No turnId callback supplied at all — the pre-existing behaviour.
  await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.ok(captured(), 'queryFn must have been invoked');
  assert.ok(captured()!.prompt.includes('You are UPDATING the existing AGENTS.md'), 'whole-file read must still include the edit section');
  assert.ok(captured()!.prompt.includes('## Your task this turn: draft AGENTS.md'), 'whole-file read must still include the draft section');
});

test('ctx.promptContext lines (seed matching + provenance footer instruction) reach the prompt verbatim', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionId = '2026-09-25T00-00-03';
  const sessionDir = join(projectRoot, '_interactivetest', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  const { queryFn, captured } = stagingQueryFn(sessionDir);
  const SEED_LINE = 'Matched library seed: node-cli-seed-4f0a1 (tags: node, cli)';
  const FOOTER_LINE = 'List every matched seed id you actually composed from, as a provenance footer.';

  await runInteractiveTurn(descriptor, {
    sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId),
    promptContext: () => [SEED_LINE, FOOTER_LINE],
  });

  assert.ok(captured(), 'queryFn must have been invoked');
  assert.ok(captured()!.prompt.includes(SEED_LINE), 'the seed-matching line must reach the prompt verbatim');
  assert.ok(captured()!.prompt.includes(FOOTER_LINE), 'the provenance-footer instruction must reach the prompt verbatim');
});

test('ctx.promptContext ABSENT leaves the prompt unchanged (no stray blank section)', async () => {
  const { forgeRoot, projectRoot, logsRoot } = setup();
  const sessionId = '2026-09-25T00-00-04';
  const sessionDir = join(projectRoot, '_interactivetest', sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeSessionStatus(sessionDir, { session_id: sessionId, phase: 'analyzing', updated_at: new Date().toISOString() });

  const descriptor = loadFixtureDescriptor(forgeRoot, 'test-kind');
  const { queryFn, captured } = stagingQueryFn(sessionDir);

  await runInteractiveTurn(descriptor, { sessionId, projectRoot, forgeRoot, logsRoot, queryFn, logger: logger(logsRoot, sessionId) });

  assert.ok(captured(), 'queryFn must have been invoked');
  assert.ok(!captured()!.prompt.includes('undefined'), 'an absent promptContext must never leak a stray "undefined" into the prompt');
});
