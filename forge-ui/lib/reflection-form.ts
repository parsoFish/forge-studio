/**
 * Pure form helpers for the reflection human moment (M7-3, ADR-031).
 *
 * Extracted from the ReflectionGate component so the gating + payload-assembly
 * logic is unit-testable under the node-environment vitest harness (the
 * component itself renders JSX and is not in the test include glob).
 */

import type { ArchitectQuestion, ReflectionQuestion } from './bridge-client.ts';

/** Every question must have a recorded choice before submit unlocks. */
export function reflectionAllAnswered(
  questions: ArchitectQuestion[],
  choices: Record<number, string>,
): boolean {
  return questions.length > 0 && questions.every((_, i) => Boolean(choices[i]));
}

/**
 * R4-09-F3: true when this reflection was produced in AUTOMATED mode — every
 * question carries a reflector-inferred answer. The gate then renders the Q&A
 * read-only with provenance badges instead of the operator input form (the
 * cycle already self-answered, so there is nothing to submit).
 */
export function hasInferredAnswers(questions: ReflectionQuestion[]): boolean {
  return questions.length > 0 && questions.every((q) => q.inferred === true);
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
