/**
 * File-based human-feedback simulator for the reflection bench.
 *
 * The reflector's stages 2 + 3 are interactive in production: the agent writes
 * structured questions to `_logs/<cycle-id>/user-questions.md`, then reads
 * `_logs/<cycle-id>/user-feedback.md` for answers + free-form feedback. In
 * production a human fills the feedback file before the next cycle. In the
 * bench, *this module* fills it from the fixture's pre-canned content.
 *
 * Why file-based and not a turn-by-turn agent simulator (like benchmarks/e2e/
 * simulator.ts):
 *
 *   1. The reflector is one-shot. It writes questions, then reads feedback.
 *      No multi-turn conversation; a turn-aware simulator would never get
 *      called.
 *   2. The agent doesn't know in advance what to ask. A real conversation
 *      simulator would have to plausibly answer arbitrary questions, which
 *      is high-variance and expensive. File-based handoff lets the fixture
 *      pre-cane *both* anticipated answers and free-form feedback in a
 *      single payload.
 *   3. Matches the production transport (live reflection also reads a
 *      human-written file), so bench and live converge.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type PrepareUserFeedbackInput = {
  /**
   * Directory the reflector treats as its cycle log dir. The simulator writes
   * `user-feedback.md` into this directory; the reflector reads it from here.
   */
  cycleLogDir: string;
  /**
   * The fixture's canned content for `user-feedback.md`. Convention: a short
   * "## Answers" section addressing anticipated reflector questions, plus a
   * "## Free-form" paragraph for stage 3. Empty/whitespace-only content is
   * accepted and signals "no feedback this cycle".
   */
  cannedFeedback: string;
};

export type PrepareUserFeedbackOutput = {
  /** Absolute path of the file the simulator wrote. */
  feedbackPath: string;
  /** Bytes written. */
  bytes: number;
};

/**
 * Pre-populate the cycle's `user-feedback.md` with the fixture's canned text.
 * Called by the bench harness BEFORE invoking the reflector. Idempotent: if
 * the file already exists with the same content, no-op.
 */
export function prepareUserFeedback(input: PrepareUserFeedbackInput): PrepareUserFeedbackOutput {
  const feedbackPath = resolve(input.cycleLogDir, 'user-feedback.md');
  mkdirSync(dirname(feedbackPath), { recursive: true });
  const desired = input.cannedFeedback;

  if (existsSync(feedbackPath)) {
    const current = readFileSync(feedbackPath, 'utf8');
    if (current === desired) {
      return { feedbackPath, bytes: statSync(feedbackPath).size };
    }
  }
  writeFileSync(feedbackPath, desired);
  return { feedbackPath, bytes: Buffer.byteLength(desired, 'utf8') };
}

/**
 * Read the structured questions the reflector emitted (stage 2). Returns the
 * top-level headings as a string array. If the file doesn't exist, returns
 * an empty array — the reflector legitimately may skip stage 2 (no question
 * worth asking).
 *
 * Diagnostic telemetry only — not used in scoring.
 */
export function readUserQuestions(cycleLogDir: string): string[] {
  const questionsPath = resolve(cycleLogDir, 'user-questions.md');
  if (!existsSync(questionsPath)) return [];
  const body = readFileSync(questionsPath, 'utf8');
  // Match top-level h1/h2/h3 headings, return their trimmed text.
  const headings: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (m) headings.push(m[1]);
  }
  return headings;
}

export type SimulatorReport = {
  feedbackWritten: boolean;
  feedbackPath: string;
  feedbackBytes: number;
  questionsObserved: string[];
};

/**
 * Convenience wrapper that runs prepareUserFeedback() + readUserQuestions()
 * and packages the results into a single record. Used by `score.ts` to print
 * per-fixture summaries; equivalent to calling both directly.
 */
export function runSimulator(opts: {
  cycleLogDir: string;
  cannedFeedback: string;
}): SimulatorReport {
  const prep = prepareUserFeedback({
    cycleLogDir: opts.cycleLogDir,
    cannedFeedback: opts.cannedFeedback,
  });
  return {
    feedbackWritten: prep.bytes > 0,
    feedbackPath: prep.feedbackPath,
    feedbackBytes: prep.bytes,
    // Note: this returns whatever was in user-questions.md when called.
    // For the canonical "after-the-agent-runs" reading, call this AFTER the
    // SDK invocation completes.
    questionsObserved: readUserQuestions(opts.cycleLogDir),
  };
}
