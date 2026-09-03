/**
 * session-answer-limits.ts — the per-field cap on an interview answer.
 *
 * One constant, its own module, for a reason. The cap is enforced in two places
 * that must agree: the instructions kind's `/api/instructions/answer` route
 * (carved into this package) and the generic session-affordance revise/answer
 * dispatch (`cli/bridge-studio-affordances.ts`, still a host arm until this
 * carve reaches row 37). Duplicating the number would let the two drift, and the
 * one that drifts low silently truncates an operator's answer while the other
 * accepts it.
 *
 * It lives on the package side because that is where the routes are going;
 * the host imports it from here, which is the direction `cli/` already takes
 * from `@forge/sessions` elsewhere in that same file.
 */
export const MAX_ANSWER_FIELD_BYTES = 8 * 1024;
