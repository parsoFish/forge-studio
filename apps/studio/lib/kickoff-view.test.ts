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
 *  - `sessionDirPreview` — the context card must show an honest placeholder
 *    for every kind, never the literal `<forge-anchor>` string. W8-B5b WI-3
 *    retired community-refresh, the one kind that used to key a REAL anchor
 *    (`projects/.community-registry/_community-refresh/…`) off its own kind
 *    id (community-12) — `sessionDirPreview` is purely generic now (selector
 *    shape only), so this file no longer pins a kind-specific real-anchor
 *    case, only the honest-placeholder one every kind gets.
 *
 * `briefFromPrompt` (community-08's optional focus brief) was removed from
 * `kickoff-view.ts` along with it: community-refresh's kickoff branch
 * (`app/sessions/[kind]/new/page.tsx`) was its one caller anywhere in the
 * codebase.
 */
import { test, expect } from 'vitest';

import { defaultKickoffTier, sessionDirPreview } from './kickoff-view';

// ---- defaultKickoffTier -----------------------------------------------------

test('defaultKickoffTier picks the first (cheapest) allowed tier', () => {
  expect(defaultKickoffTier(['sonnet', 'opus'])).toBe('sonnet');
});

test('defaultKickoffTier is empty for a fixed-strategy agent (no operator choice exists)', () => {
  expect(defaultKickoffTier([])).toBe('');
});

// ---- sessionDirPreview ------------------------------------------------------

// W7-B3 review F9, generalized after W8-B5b WI-3 retired community-refresh
// (the one kind that used to key a REAL anchor off its own kind id): every
// selector:'none' kind now gets the SAME honest generic placeholder, never a
// real-looking path under an anchor it does not use (the community-12
// fabricated-context-card class this guards against).
test('selector:none previews an honest generic placeholder, never the literal <forge-anchor> string', () => {
  const preview = sessionDirPreview('some-future-kind', 'none', '');
  expect(preview).toBe('projects/<anchor>/_some-future-kind/<sessionId>');
  expect(preview).not.toContain('<forge-anchor>');
});

test('selector:project previews the typed project (placeholder until typed)', () => {
  expect(sessionDirPreview('demo', 'project', 'gitpulse')).toBe('projects/gitpulse/_demo/<sessionId>');
  expect(sessionDirPreview('demo', 'project', '')).toBe('projects/<project>/_demo/<sessionId>');
});

test('selector:kb previews the kb-project placeholder', () => {
  expect(sessionDirPreview('kb-cleanup', 'kb', '')).toBe('projects/<kb-project>/_kb-cleanup/<sessionId>');
});
