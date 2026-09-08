/**
 * The one question onboarding asks before it spends anything (ruling 441).
 *
 * It is duplicated from `packages/sessions/bridge-studio-kickoff.ts`'s
 * `ONBOARDING_BRIEF_QUESTION` rather than imported, because forge-ui is a
 * separate build that does not import the bridge packages — the same reason
 * every other shared string in `apps/studio/lib` is re-declared. The route
 * does not READ this value (it renders `questions.json`, which the route
 * itself wrote), so a drift here changes only the label the project page posts
 * beside the operator's answer; it cannot desynchronise the two sides into
 * accepting different briefs.
 */
export const ONBOARDING_BRIEF_QUESTION =
  'What is this project for, and what command decides whether a change is good?';
