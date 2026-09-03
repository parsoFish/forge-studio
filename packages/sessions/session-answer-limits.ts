/**
 * session-answer-limits.ts — the per-field cap on an interview answer.
 *
 * One constant, its own module, for a reason. The cap is enforced in two places
 * that must agree: the instructions kind's `/api/instructions/answer` route and
 * the generic session-affordance revise/answer dispatch. While the second was a
 * host arm the number was DUPLICATED there, and a source-reading test held the
 * two honest. M4 row 37 carved that dispatch into this package, so both now
 * import this one declaration — which is why that test is gone rather than
 * relaxed: it existed to make a duplicate tolerable, and there is no duplicate.
 */
export const MAX_ANSWER_FIELD_BYTES = 8 * 1024;
