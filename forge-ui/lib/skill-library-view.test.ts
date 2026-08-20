/**
 * Acceptance tests for forge-ui/lib/skill-library-view.ts (R3-01-F3/F4, WI-0).
 *
 * The module under test does not exist yet — vitest cannot even collect this
 * file until it lands (module-not-found is the expected red).
 *
 * Pure view-state derivation for the /skills library page — mirrors the
 * cycle-grouping.ts / flow-view-state.ts testability convention: no DOM, no
 * React, no network.
 *
 * AT numbers map 1:1 onto _wave5/specs/R3-01-F3F4.md's
 * "AT set — forge-ui/lib/skill-library-view.test.ts".
 */
import { test, expect } from 'vitest';
import {
  groupSkillLibrary,
  skillBadges,
  filterSkills,
  installStateOf,
  shelfSkillPreview,
} from './skill-library-view.ts';
import type { SkillLibraryEntry } from './skill-client.ts';

function entry(overrides: Partial<SkillLibraryEntry> & { id: string }): SkillLibraryEntry {
  return {
    name: overrides.id,
    description: '',
    source: 'local',
    installed: true,
    trust: 'ready',
    paletteVisible: true,
    usedBy: [],
    provenance: null,
    ...overrides,
  };
}

// AT-61 -------------------------------------------------------------------

test('AT-61: groupSkillLibrary(entries) splits into local + community, preserving order', () => {
  const entries = [
    entry({ id: 'zeta-local', source: 'local' }),
    entry({ id: 'handoff', source: 'community' }),
    entry({ id: 'alpha-local', source: 'local' }),
    entry({ id: 'security-review', source: 'community' }),
  ];

  const grouped = groupSkillLibrary(entries);

  expect(grouped.local.map((e) => e.id)).toEqual(['zeta-local', 'alpha-local']);
  expect(grouped.community.map((e) => e.id)).toEqual(['handoff', 'security-review']);
});

// AT-62 -------------------------------------------------------------------

test('AT-62: counts (total, localCount, communityCount) are derived from the arrays, never passed in', () => {
  const entries = [
    entry({ id: 'a', source: 'local' }),
    entry({ id: 'b', source: 'local' }),
    entry({ id: 'c', source: 'community' }),
  ];

  const grouped = groupSkillLibrary(entries);

  expect(grouped.total).toBe(3);
  expect(grouped.localCount).toBe(2);
  expect(grouped.communityCount).toBe(1);
  // Consistency invariant: the counts must always match the arrays' own
  // lengths (never independently-set fields that could drift from reality).
  expect(grouped.localCount).toBe(grouped.local.length);
  expect(grouped.communityCount).toBe(grouped.community.length);
  expect(grouped.total).toBe(grouped.local.length + grouped.community.length);
});

// AT-63 -------------------------------------------------------------------

test('AT-63: skillBadges(entry) derives badge tokens from real fields; a draft entry always yields the draft token', () => {
  const draft = entry({ id: 'a-draft', trust: 'draft', paletteVisible: false });
  expect(skillBadges(draft)).toContain('draft');

  const needsReview = entry({ id: 'a-drift', trust: 'needs-review', paletteVisible: false });
  expect(skillBadges(needsReview)).toContain('needs-review');

  const community = entry({ id: 'a-community', source: 'community' });
  expect(skillBadges(community)).toContain('community');

  const local = entry({ id: 'a-local', source: 'local' });
  expect(skillBadges(local)).not.toContain('community');
  expect(skillBadges(local)).not.toContain('draft');
  expect(skillBadges(local)).not.toContain('needs-review');
});

// AT-64 -------------------------------------------------------------------

test('AT-64: filterSkills(entries, q) matches on name + description, case-insensitive; empty query returns all (new array, input untouched)', () => {
  const entries = [
    entry({ id: 'brain-query', name: 'Brain Query', description: 'Query the forge brain.' }),
    entry({ id: 'tdd-workflow', name: 'TDD Workflow', description: 'Red-green-refactor loop.' }),
    entry({ id: 'handoff', name: 'Handoff', description: 'Compress the session into a transfer doc.' }),
  ];

  expect(filterSkills(entries, 'brain').map((e) => e.id)).toEqual(['brain-query']);
  expect(filterSkills(entries, 'BRAIN').map((e) => e.id), 'case-insensitive on name').toEqual(['brain-query']);
  expect(filterSkills(entries, 'refactor').map((e) => e.id), 'matches on description too').toEqual(['tdd-workflow']);

  const all = filterSkills(entries, '');
  expect(all).toEqual(entries);
  expect(all).not.toBe(entries); // new array

  const snapshot = [...entries];
  filterSkills(entries, 'brain');
  expect(entries).toEqual(snapshot); // input array untouched
});

// AT-65 -------------------------------------------------------------------

test('AT-65: installStateOf(entry) derives installed/not-installed from entry.installed only, never a free-text field', () => {
  expect(installStateOf(entry({ id: 'a', installed: true }))).toBe('installed');
  expect(installStateOf(entry({ id: 'b', installed: false }))).toBe('not-installed');

  // A free-text/description field must never influence the derivation — even
  // one that LOOKS like it claims installation status.
  expect(
    installStateOf(entry({ id: 'c', installed: false, description: 'This skill is installed and ready.' })),
  ).toBe('not-installed');
});

// ---------------------------------------------------------------------------
// W7-B3 (library-21): the COMMUNITY badge was keyed on `provenance !== null`,
// but the authoring finalizer stamps provenance.source='forge-authoring' on
// locally-authored skills too — a skill the operator just authored rendered
// COMMUNITY under the LOCAL heading. The badge is keyed on WHERE the
// provenance says it came from; forge-authoring gets its own honest badge.
// ---------------------------------------------------------------------------

const COMMUNITY_PROV = { source: 'https://github.com/obra/superpowers', contentHash: 'h', installedAt: '2026-08-01T00:00:00Z' };
const AUTHORED_PROV = { source: 'forge-authoring', contentHash: 'h', installedAt: '2026-08-01T00:00:00Z' };

test('W7-B3: an authored skill (provenance.source=forge-authoring) is badged authored, NEVER community', () => {
  const badges = skillBadges(entry({ id: 'a', source: 'local', provenance: AUTHORED_PROV }));
  expect(badges).toContain('authored');
  expect(badges).not.toContain('community');
});

test('W7-B3: a community-installed skill (upstream provenance) keeps the community badge', () => {
  expect(skillBadges(entry({ id: 'a', source: 'local', provenance: COMMUNITY_PROV }))).toContain('community');
  expect(skillBadges(entry({ id: 'b', source: 'community', provenance: null }))).toContain('community');
});

test('W7-B3: a plain local skill (no provenance) gets neither community nor authored', () => {
  const badges = skillBadges(entry({ id: 'a', source: 'local', provenance: null }));
  expect(badges).not.toContain('community');
  expect(badges).not.toContain('authored');
});

test('W7-B3: a browse-only registry reference is badged reference', () => {
  expect(skillBadges(entry({ id: 'a', source: 'community', provenance: null, reference: true }))).toContain('reference');
});

// ---------------------------------------------------------------------------
// W7-B3 (library-27): the Library Skills shelf preview — concatenate-then-
// slice always filled all six slots with local skills, so a community entry
// could never appear even though the count included them.
// ---------------------------------------------------------------------------

test('W7-B3 shelfSkillPreview: with more locals than the limit, at least one community card still appears', () => {
  const locals = Array.from({ length: 10 }, (_, i) => entry({ id: `local-${String(i).padStart(2, '0')}`, source: 'local' }));
  const community = [entry({ id: 'handoff', source: 'community' }), entry({ id: 'sec', source: 'community' })];
  const preview = shelfSkillPreview(groupSkillLibrary([...locals, ...community]), 6);
  expect(preview.length).toBe(6);
  expect(preview.some((e) => e.source === 'community')).toBe(true);
  expect(preview.filter((e) => e.source === 'local').length).toBeGreaterThan(0);
});

test('W7-B3 shelfSkillPreview: with no community entries the limit is all locals (unchanged)', () => {
  const locals = Array.from({ length: 8 }, (_, i) => entry({ id: `local-${i}`, source: 'local' }));
  const preview = shelfSkillPreview(groupSkillLibrary(locals), 6);
  expect(preview.length).toBe(6);
  expect(preview.every((e) => e.source === 'local')).toBe(true);
});

test('W7-B3 shelfSkillPreview: fewer entries than the limit returns them all', () => {
  const preview = shelfSkillPreview(groupSkillLibrary([entry({ id: 'a', source: 'local' }), entry({ id: 'b', source: 'community' })]), 6);
  expect(preview.map((e) => e.id)).toEqual(['a', 'b']);
});
