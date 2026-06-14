/**
 * Pure form helpers for the reflection human moment (M7-3, ADR-031).
 *
 * Extracted from the ReflectionGate component so the gating + payload-assembly
 * logic is unit-testable under the node-environment vitest harness (the
 * component itself renders JSX and is not in the test include glob).
 */

import type { ArchitectQuestion } from './bridge-client.ts';

/** Every question must have a recorded choice before submit unlocks. */
export function reflectionAllAnswered(
  questions: ArchitectQuestion[],
  choices: Record<number, string>,
): boolean {
  return questions.length > 0 && questions.every((_, i) => Boolean(choices[i]));
}

/** Assemble the answer payload from questions + choices; unanswered → skipped marker. */
export function buildReflectionAnswers(
  questions: ArchitectQuestion[],
  choices: Record<number, string>,
): { question: string; answer: string }[] {
  return questions.map((q, i) => ({
    question: q.question,
    answer: choices[i] ?? '[operator skipped]',
  }));
}
