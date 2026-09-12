/**
 * S1's operator inputs — the answers, the idea, the gate command, the ceiling.
 *
 * SPLIT OUT OF `S1.story.mjs`, `forge-8vfn.7.6.75`, T1 ruling 955. That file was
 * at exactly 800/800 — the hard cap — so beat 11's per-transition amend
 * (`forge-8vfn.7.6.77`) could not be written at all until something moved. The
 * thing that moved is deliberately NOT prose: every paragraph in that story is a
 * measurement or a ruling, and trimming one to make room would delete the record
 * to fit a line count. These constants are the story's INPUTS and they belong
 * beside it either way — the same shape `S10.story.mjs` already uses with
 * `S10.constants.mjs`, `S10.act2.mjs` and `S10.review.mjs`.
 *
 * NOTHING HERE IS EDITED IN THE MOVE. The validated story hashes identically
 * before and after (`aa8286a76a597e1d`, 11 beats), which is the whole claim this
 * split makes and the only one it is allowed to make.
 */
/** The gate command GitWeave's own repo answers to — `tests/` is pytest. */
export const GATE = 'python -m pytest tests/';

/** GitWeave's own README, first line — the north star is the project's, not the story's. */
export const NORTH_STAR =
  'A single control repository that configures and weaves together a GitHub organisation using in-repo modules, overlays and provider-native tooling.';

/** The one instruction the story used to have to drop. Beat 6's re-authoring
 *  recorded it leaving — "no surface on the onboarding path asks for it" — and
 *  named bead `forge-8vfn.7.2.5` as the reason. Ruling 441 closed that bead
 *  (#557), so `[data-field="constraints"]` now exists on the brief form and
 *  travels with the north star and the gate through the generic question-form
 *  affordance. The story supplies it again without inventing a field. */
export const UNTOUCHABLE_PATHS = 'Never touch infra/ state or config/orgs/*.yaml.';

/** The first piece of work the operator asks the Architect to plan. */
export const IDEA =
  'Add an overlay lint that fails the plan when a repo overlay names a team that no module in the org actually grants, so a broken grant is caught before it reaches GitHub.';

/** This run's ceiling, in dollars — the same figure the ground declares. */
export const CEILING = '25';
/** C1b is operator-tier and only OPEN when the onboarding agent left it so. */
export const C1B_DECISION = "GitWeave's CI mirror is the same command the per-WI gate runs — declare testProcess.ci as python -m pytest tests/. There is no separate build step, so C1b is satisfied by making the mirror explicit rather than by inventing a second command.";

/**
 * What the operator tells the architect when it interviews. It names a scope
 * and a constraint — an answer, not a restatement of the idea — because the
 * architect asks what to build, and S4 run 4 measured what happens when the
 * reply is a constraint alone: the architect asks again.
 */
export const ANSWER =
  'Keep it to the onboarding path only — no changes to the existing scan commands. ' +
  'The quality gate stays `python -m pytest tests/`, and the human-readable output must not change.';
