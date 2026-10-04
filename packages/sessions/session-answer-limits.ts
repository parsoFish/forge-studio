/**
 * session-answer-limits.ts — the per-field cap on an interview answer.
 *
 * One constant, its own module, so every write path that caps an answer field
 * imports the SAME number rather than hand-keeping its own copy:
 * `kinds/instructions.ts`'s `handleInstructionsAnswer` (the generic
 * question-form/verdict affordance route, `bridge-studio-sessions-affordances.ts`)
 * and the generic revise dispatch in `bridge-studio-sessions-affordance-shell.ts`
 * — the two call sites this constant exists to hold honestly in sync. (Row
 * 206, forge-8vfn.8.5.56: no forge-ui caller reaches a bespoke
 * `/api/instructions/{brief,answer,verdict}` arm with a second, hand-kept
 * copy of this cap.)
 */
export const MAX_ANSWER_FIELD_BYTES = 8 * 1024;
