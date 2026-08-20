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
 * initiative exists to fix.
 *
 * W7-B3 (library-21): `provenance !== null` alone is NOT proof of community
 * origin — the authoring finalizer stamps `provenance.source =
 * 'forge-authoring'` on locally-authored skills too, which made a skill the
 * operator had just authored render COMMUNITY under the LOCAL heading. The
 * badge keys on WHERE the provenance says it came from: `forge-authoring`
 * earns its own honest `authored` badge; anything else provenance-stamped
 * (an upstream URL from the install pipeline) or `source: 'community'` is
 * `community`. `reference` marks a browse-only registry row (W7-B3,
 * community-25 — no local bytes at all).
 */
export type SkillBadge = 'community' | 'authored' | 'reference' | 'draft' | 'needs-review';

/** The exact provenance.source stamp cli/bridge-studio-authoring.ts's
 *  copyStagingToLibrary writes for locally-authored packages. */
export const AUTHORING_PROVENANCE_SOURCE = 'forge-authoring';

export function skillBadges(entry: SkillLibraryEntry): SkillBadge[] {
  const badges: SkillBadge[] = [];
  const authored = entry.provenance !== null && entry.provenance.source === AUTHORING_PROVENANCE_SOURCE;
  if (authored) badges.push('authored');
  else if (entry.source === 'community' || entry.provenance !== null) badges.push('community');
  if (entry.reference === true) badges.push('reference');
  if (entry.trust === 'draft') badges.push('draft');
  if (entry.trust === 'needs-review') badges.push('needs-review');
  return badges;
}

// ---------------------------------------------------------------------------
// Shelf preview — W7-B3 (library-27)
// ---------------------------------------------------------------------------

/**
 * The Library Skills shelf's preview cards. The old concatenate-then-slice
 * let local entries fill every slot, so a community entry could NEVER
 * surface even though the shelf's count included them. Rule: when community
 * entries exist, at least one preview slot is theirs — locals fill the rest.
 * Pure; returns a NEW array.
 */
export function shelfSkillPreview(groups: GroupedSkillLibrary, limit: number): SkillLibraryEntry[] {
  if (groups.community.length === 0) return groups.local.slice(0, limit);
  if (groups.local.length === 0) return groups.community.slice(0, limit);
  // Community gets up to a third of the slots (at least one); locals fill
  // the rest; any shortfall on either side flows back to the other.
  const communityShare = Math.min(groups.community.length, Math.max(1, Math.floor(limit / 3)));
  const localShare = Math.min(groups.local.length, limit - communityShare);
  const community = groups.community.slice(0, limit - localShare);
  return [...groups.local.slice(0, localShare), ...community].slice(0, limit);
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
