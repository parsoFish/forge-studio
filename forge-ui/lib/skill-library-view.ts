/**
 * Pure view-state derivation for the /skills library page (R3-01-F3/F4, WI-3).
 *
 * Mirrors the cycle-grouping.ts / flow-view-state.ts testability convention:
 * no DOM, no React, no network — the page component stays thin and calls
 * these directly off the fetched `SkillLibraryEntry[]`. Immutability: every
 * function here returns NEW arrays/objects, never mutates its input.
 */

import type { SkillLibraryEntry } from './skill-client';

// ---------------------------------------------------------------------------
// Grouping + counts
// ---------------------------------------------------------------------------

export interface GroupedSkillLibrary {
  local: SkillLibraryEntry[];
  community: SkillLibraryEntry[];
  total: number;
  localCount: number;
  communityCount: number;
}

/** Split the library into local + community, preserving each group's order.
 *  Counts are derived from the resulting arrays' own lengths — never an
 *  independently-set field that could drift from reality. */
export function groupSkillLibrary(entries: readonly SkillLibraryEntry[]): GroupedSkillLibrary {
  const local = entries.filter((e) => e.source === 'local');
  const community = entries.filter((e) => e.source === 'community');
  return {
    local,
    community,
    total: local.length + community.length,
    localCount: local.length,
    communityCount: community.length,
  };
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

/**
 * Badge tokens derived from real, verifiable fields only.
 *
 * `SkillLibraryEntry` carries no field that reliably tells an OOTB
 * hand-authored skill apart from an operator-authored one (both are
 * `source: 'local'` with `provenance: null`) — inventing that distinction
 * would be exactly the "declared data enforced nowhere" antipattern this
 * initiative exists to fix, so this deliberately emits only the three
 * badges backed by a real field: `community` (source, or a local entry
 * whose `provenance` proves it arrived via the install pipeline),
 * `draft` and `needs-review` (trust).
 */
export type SkillBadge = 'community' | 'draft' | 'needs-review';

export function skillBadges(entry: SkillLibraryEntry): SkillBadge[] {
  const badges: SkillBadge[] = [];
  if (entry.source === 'community' || entry.provenance !== null) badges.push('community');
  if (entry.trust === 'draft') badges.push('draft');
  if (entry.trust === 'needs-review') badges.push('needs-review');
  return badges;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

/** Case-insensitive match on name + description. Empty query returns a NEW
 *  array of every entry (never the same reference, never mutates input). */
export function filterSkills(entries: readonly SkillLibraryEntry[], query: string): SkillLibraryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter((e) => {
    const name = e.name.toLowerCase();
    const description = (e.description ?? '').toLowerCase();
    return name.includes(q) || description.includes(q);
  });
}

// ---------------------------------------------------------------------------
// Install state
// ---------------------------------------------------------------------------

export type SkillInstallState = 'installed' | 'not-installed';

/** Derived from `entry.installed` ONLY — never a free-text field, even one
 *  that happens to mention "installed". */
export function installStateOf(entry: SkillLibraryEntry): SkillInstallState {
  return entry.installed ? 'installed' : 'not-installed';
}
