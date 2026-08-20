/**
 * W7-B3 pins for the kickoff screen's pure view helpers (community-08 /
 * community-12 / community-22):
 *
 *  - `defaultKickoffTier` — the picker must pre-select the tier the agent
 *    will ACTUALLY run on when the operator chooses nothing: the cheapest
 *    tier of the SKILL-declared envelope (the same `allowedTiers[0]` default
 *    `resolveSessionModel` applies server-side). community-12: neither radio
 *    was checked yet Start was enabled — the operator could not tell what
 *    would run.
 *  - `sessionDirPreview` — the context card must show the REAL anchor for a
 *    selector-less kind (`projects/.community-registry/_community-refresh/…`),
 *    never the literal placeholder `<forge-anchor>`.
 *  - `briefFromPrompt` — an optional brief is sent only when the operator
 *    typed one; whitespace is never a brief.
 */
import { test, expect } from 'vitest';

import { defaultKickoffTier, sessionDirPreview, briefFromPrompt } from './kickoff-view';
import { COMMUNITY_REGISTRY_ANCHOR } from './session-shell-view';

// ---- defaultKickoffTier -----------------------------------------------------

test('defaultKickoffTier picks the first (cheapest) allowed tier', () => {
  expect(defaultKickoffTier(['sonnet', 'opus'])).toBe('sonnet');
});

test('defaultKickoffTier is empty for a fixed-strategy agent (no operator choice exists)', () => {
  expect(defaultKickoffTier([])).toBe('');
});

// ---- sessionDirPreview ------------------------------------------------------

test('selector:none previews the real community anchor, never a placeholder', () => {
  const preview = sessionDirPreview('community-refresh', 'none', '');
  expect(preview).toBe(`projects/${COMMUNITY_REGISTRY_ANCHOR}/_community-refresh/<sessionId>`);
  expect(preview).not.toContain('<forge-anchor>');
});

// W7-B3 review F9: the community anchor is keyed on the KIND — it is
// community-refresh's OWN pseudo-project. A FUTURE selector-less kind must
// get an honest generic placeholder, never a real-looking path under an
// anchor it does not use (the community-12 fabricated-context-card class).
test('a future selector:none kind does NOT inherit the community anchor — honest placeholder instead', () => {
  const preview = sessionDirPreview('some-future-kind', 'none', '');
  expect(preview).not.toContain(COMMUNITY_REGISTRY_ANCHOR);
  expect(preview).toBe('projects/<anchor>/_some-future-kind/<sessionId>');
});

test('selector:project previews the typed project (placeholder until typed)', () => {
  expect(sessionDirPreview('demo', 'project', 'gitpulse')).toBe('projects/gitpulse/_demo/<sessionId>');
  expect(sessionDirPreview('demo', 'project', '')).toBe('projects/<project>/_demo/<sessionId>');
});

test('selector:kb previews the kb-project placeholder', () => {
  expect(sessionDirPreview('kb-cleanup', 'kb', '')).toBe('projects/<kb-project>/_kb-cleanup/<sessionId>');
});

// ---- briefFromPrompt --------------------------------------------------------

test('briefFromPrompt trims and drops empty/whitespace briefs', () => {
  expect(briefFromPrompt('  find me skills for X  ')).toBe('find me skills for X');
  expect(briefFromPrompt('   ')).toBeUndefined();
  expect(briefFromPrompt('')).toBeUndefined();
});
