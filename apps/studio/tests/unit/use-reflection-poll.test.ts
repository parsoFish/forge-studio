/**
 * Pure-logic tests for `needsReflectionPoll` (`lib/use-reflection-poll.ts`) —
 * forge-8vfn.8.1.42, ruling 1849. Effect-free, mirrors
 * `use-studio-home-data.test.ts`'s technique of proving the DECISION by
 * execution before the render-level wiring test
 * (`tests/regression/reflection-poll-render.test.ts`) proves the hook fires it.
 *
 * `needsReflectionPoll` is the single place that decides "keep polling":
 *   - `null` (a 404 — the reflector hasn't filed anything yet) → keep polling.
 *   - `answered: true` → stop, regardless of question count (an automated
 *     cycle can self-answer with an empty question list).
 *   - `questions: []` and not answered → keep polling (the "not yet" case
 *     real S10 run 39 got stuck in forever).
 *   - `questions.length > 0` and not answered → stop; the operator now has
 *     something to answer.
 */
import { test, expect } from 'vitest';
import { needsReflectionPoll } from '../../lib/use-reflection-poll.ts';
import type { ReflectionData } from '../../lib/bridge-client.ts';

function data(partial: Partial<ReflectionData>): ReflectionData {
  return { cycleId: 'demo-cycle', questions: [], answered: false, ...partial };
}

test('null (404 — nothing filed yet) needs a poll', () => {
  expect(needsReflectionPoll(null)).toBe(true);
});

test('no questions, not answered — the real S10 run 39 stuck state — needs a poll', () => {
  expect(needsReflectionPoll(data({ questions: [], answered: false }))).toBe(true);
});

const ONE_QUESTION = [{ question: 'q', header: 'q' }];

test('questions have arrived — stop polling', () => {
  expect(needsReflectionPoll(data({ questions: ONE_QUESTION, answered: false }))).toBe(false);
});

test('answered, even with no questions (automated, self-answered) — stop polling', () => {
  expect(needsReflectionPoll(data({ questions: [], answered: true }))).toBe(false);
});

test('answered with questions present — stop polling', () => {
  expect(needsReflectionPoll(data({ questions: ONE_QUESTION, answered: true }))).toBe(false);
});
