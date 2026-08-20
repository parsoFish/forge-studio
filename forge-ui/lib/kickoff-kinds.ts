/**
 * kickoff-kinds — the ONE client-side table of generic session-kickoff kinds
 * (W7-B4, agents-22). Extracted from app/sessions/[kind]/new/page.tsx so the
 * agent builder's "open a session" affordance DERIVES its href from the same
 * table the kickoff page itself is driven by — the frozen one-entry
 * SESSION_ENTRY_HREF_BY_SLUG map (which rendered "no reachable session entry
 * point yet" for every real interactive agent) is deleted.
 *
 * `architect` deliberately stays OUT of this table — it keeps its bespoke
 * end-to-end entry `/architect/new` (ADR-043 amendment §4); the derivation
 * below carries that one exception explicitly.
 */

export type KickoffKindId =
  | 'instructions'
  | 'demo'
  | 'kb-cleanup'
  | 'authoring'
  | 'project-brain'
  | 'community-refresh';

export type KickoffKindSpec = {
  title: string;
  /** The skill slug this kind's agent runs — resolves the SKILL.md-declared
   *  model envelope via `fetchAgentCapability()` (the unfiltered per-slug
   *  route, W6-B6 fix — NOT `fetchStudioAgents()`'s roster, which drops
   *  every `library:false` kickoff-only agent). */
  agentSlug: string;
  artifactLabel: string;
  /** 'none' (W6-CR-3): no project/KB selector at all — the kind's `/start`
   *  route takes neither, and the context card renders the fixed session
   *  home directly rather than an operator-filled path. */
  selector: 'project' | 'kb' | 'none';
  /** Only 'authoring' takes a free-text prompt — its `/start` body requires
   *  one (every other kind's `/start` route needs no operator prose at
   *  kickoff; instructions/demo take their brief on a LATER turn, via their
   *  own bespoke panel's briefing step). */
  promptLabel?: string;
  promptPlaceholder?: string;
};

export const KICKOFF_KINDS: Record<KickoffKindId, KickoffKindSpec> = {
  instructions: { title: 'Instructions session', agentSlug: 'instructions-creator', artifactLabel: 'AGENTS.md draft', selector: 'project' },
  demo: { title: 'Demo capability session', agentSlug: 'demo-builder', artifactLabel: 'Demo generations', selector: 'project' },
  'kb-cleanup': { title: 'KB cleanup session', agentSlug: 'brain-maintenance', artifactLabel: 'Cleanup plan', selector: 'kb' },
  authoring: { title: 'Authoring session', agentSlug: 'creation-agent', artifactLabel: 'Package', selector: 'project', promptLabel: 'Describe what to build', promptPlaceholder: 'Describe what it should do…' },
  'project-brain': { title: 'Brain creation session', agentSlug: 'project-brain-builder', artifactLabel: 'Seeded structure', selector: 'project' },
  'community-refresh': { title: 'Community refresh session', agentSlug: 'community-refresh', artifactLabel: 'Registry draft', selector: 'none' },
};

export function isKickoffKind(kind: string): kind is KickoffKindId {
  return kind in KICKOFF_KINDS;
}

/**
 * Resolve an agent slug to its reachable session ENTRY route, or null when
 * the agent genuinely has none (a fabricated href to a route that doesn't
 * exist is the dead-path failure mode this replaces). Derived by INVERTING
 * the kickoff table (one entry per kind ⇒ first match wins; no two kinds
 * share an agentSlug today and the render pin asserts the round-trip), plus
 * the one bespoke exception: architect → /architect/new.
 */
export function sessionEntryHrefForAgent(slug: string): string | null {
  if (slug === 'architect') return '/architect/new';
  for (const [kind, spec] of Object.entries(KICKOFF_KINDS)) {
    if (spec.agentSlug === slug) return `/sessions/${kind}/new`;
  }
  return null;
}
