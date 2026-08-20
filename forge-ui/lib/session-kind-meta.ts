/**
 * session-kind-meta — the ONE client-side mirror of `studio/session-kinds.yaml`
 * (W7-B1: home-sessions-19/20, crosscut-13, community-21).
 *
 * WHY THIS MODULE EXISTS: before it, three surfaces each hand-kept their own
 * copy of "which session kinds exist / what they're called / how to start
 * one" — `SessionsIndex.tsx`'s KICKOFF_LINKS, the kickoff page's
 * KICKOFF_KINDS, and CSS `text-transform: capitalize` standing in for a real
 * title on the index rows. The first two had ALREADY drifted in both
 * directions (home-sessions-19: one list had architect but no
 * community-refresh, the other the reverse) and the third rendered
 * "Kb-Cleanup"/"Community-Refresh" (home-sessions-20, community-21). Every
 * kind-level fact a client surface needs now reads from HERE.
 *
 * DRIFT DISCIPLINE: this is still declared client-side data — the server
 * truth lives in `studio/session-kinds.yaml` (bridge routes resolve kinds
 * against it live). `lib/session-kind-meta.test.ts` reads that REAL yaml off
 * disk and asserts this module mirrors it kind-for-kind (ids, titles,
 * agents), so a registry edit that misses this module turns the suite red
 * instead of silently drifting — the same pin discipline
 * `agent-ledger.test.ts`'s round-8 title check established.
 *
 * Lookups FAIL HONEST: an unknown kind's title is the raw kind id (never a
 * fabricated pretty label), its agent is `null` (never a guessed slug).
 */

export type SessionKindMeta = {
  /** The registry descriptor id (`studio/session-kinds.yaml` `- id:`). */
  id: string;
  /** The descriptor's own authored `title:` — the ONE human name. */
  title: string;
  /** The descriptor's `agent:` — the SKILL slug that drives this kind. */
  agent: string;
  /** Where the operator starts one, or `null` for a kind with no direct
   *  kickoff surface (onboarding starts from project onboarding). Architect
   *  keeps its bespoke native entry (`/architect/new`, ADR-043 amendment §4
   *  — never the generic form). */
  kickoffHref: string | null;
};

export const SESSION_KIND_META: readonly SessionKindMeta[] = [
  { id: 'architect', title: 'Planning session', agent: 'architect', kickoffHref: '/architect/new' },
  { id: 'instructions', title: 'Instructions session', agent: 'instructions-creator', kickoffHref: '/sessions/instructions/new' },
  { id: 'project-brain', title: 'Brain creation session', agent: 'project-brain-builder', kickoffHref: '/sessions/project-brain/new' },
  { id: 'demo', title: 'Demo capability session', agent: 'demo-builder', kickoffHref: '/sessions/demo/new' },
  { id: 'onboarding', title: 'Onboarding session', agent: 'onboarding-agent', kickoffHref: null },
  { id: 'authoring', title: 'Authoring session', agent: 'creation-agent', kickoffHref: '/sessions/authoring/new' },
  { id: 'kb-cleanup', title: 'KB cleanup session', agent: 'brain-maintenance', kickoffHref: '/sessions/kb-cleanup/new' },
  { id: 'community-refresh', title: 'Community refresh session', agent: 'community-refresh', kickoffHref: '/sessions/community-refresh/new' },
];

const META_BY_ID: ReadonlyMap<string, SessionKindMeta> = new Map(SESSION_KIND_META.map((m) => [m.id, m]));

/** The descriptor's authored title, or the raw kind id for an unknown kind —
 *  honest-verbatim, never a fabricated label (home-sessions-20). */
export function sessionKindTitle(kind: string): string {
  return META_BY_ID.get(kind)?.title ?? kind;
}

/** The agent slug behind a kind, or `null` when unknown — never guessed.
 *  Feeds `home-view.ts`'s constellation derivation (home-sessions-14): a
 *  working session lights its agent's hex only through this REAL mapping. */
export function sessionKindAgent(kind: string): string | null {
  return META_BY_ID.get(kind)?.agent ?? null;
}

export type KickoffEntry = { kind: string; label: string; href: string };

/**
 * The ONE kickoff list (home-sessions-19 / crosscut-13): every kind an
 * operator can start directly — the six generic `/sessions/<kind>/new`
 * kinds (community-refresh included) plus architect's bespoke entry.
 * Rendered by `/sessions` in BOTH states (populated AND empty — the CTA row
 * must never vanish just because work is in flight). Labels are the
 * descriptors' own titles, never a second hand-written string.
 */
export const KICKOFF_ENTRIES: readonly KickoffEntry[] = SESSION_KIND_META
  .filter((m): m is SessionKindMeta & { kickoffHref: string } => m.kickoffHref !== null)
  .map((m) => ({ kind: m.id, label: m.title, href: m.kickoffHref }));

/**
 * Per-kind form spec for the generic kickoff page
 * (`app/sessions/[kind]/new/page.tsx`) — moved here from that page so the
 * kind list, titles and agent slugs live in ONE module beside the rest of
 * the kind-level facts (the page previously carried its own KICKOFF_KINDS
 * map, the second half of home-sessions-19's two-list drift).
 *
 * `blurb` (W7-B1, sessions-kinds-05): the operator-facing one-liner the
 * context card LEADS with — what the session does and what it produces, in
 * plain English. The agent slug / SKILL path / session directory remain as
 * a secondary provenance line, never the headline.
 */
export type KickoffKindSpec = {
  /** Plain-English "what this session does" — the context card's lede. */
  blurb: string;
  /** The skill slug this kind's agent runs — resolves the SKILL.md-declared
   *  model envelope via `fetchAgentCapability()` (the unfiltered per-slug
   *  route, W6-B6 fix — NOT `fetchStudioAgents()`'s roster, which drops
   *  every `library:false` kickoff-only agent). Kept in lockstep with the
   *  registry descriptor's own `agent:` by `session-kind-meta.test.ts`. */
  agentSlug: string;
  artifactLabel: string;
  /** 'none' (W6-CR-3): no project/KB selector at all — the kind's `/start`
   *  route takes neither. */
  selector: 'project' | 'kb' | 'none';
  /** Only 'authoring' takes a free-text prompt — its `/start` body requires
   *  one. */
  promptLabel?: string;
  promptPlaceholder?: string;
};

/** The ONE lookup for a kind's kickoff spec — `Object.hasOwn`-guarded
 *  (review round 1): a bare `KICKOFF_SPECS[kind]` resolves Object.prototype
 *  members ('constructor', 'toString', …) to truthy functions, silently
 *  bypassing the unknown-kind guard on `/sessions/<kind>/new`. */
export function kickoffSpecFor(kind: string): KickoffKindSpec | null {
  return Object.hasOwn(KICKOFF_SPECS, kind) ? KICKOFF_SPECS[kind] : null;
}

export const KICKOFF_SPECS: Record<string, KickoffKindSpec> = {
  instructions: {
    blurb: 'Drafts (or refreshes) the project’s AGENTS.md working instructions, interviewing you when it needs answers — you approve the draft before it lands.',
    agentSlug: 'instructions-creator',
    artifactLabel: 'AGENTS.md draft',
    selector: 'project',
  },
  demo: {
    blurb: 'Builds a reviewable demo of the project’s current capability — you give feedback per generation and lock the one worth keeping.',
    agentSlug: 'demo-builder',
    artifactLabel: 'Demo generations',
    selector: 'project',
  },
  'kb-cleanup': {
    blurb: 'Reviews one knowledge base for structural and content problems and drafts a cleanup plan — nothing is applied until you approve it.',
    agentSlug: 'brain-maintenance',
    artifactLabel: 'Cleanup plan',
    selector: 'kb',
  },
  authoring: {
    blurb: 'Turns your description into a working skill or hook package, iterating with you — the package lands in the library once you finalize it.',
    agentSlug: 'creation-agent',
    artifactLabel: 'Package',
    selector: 'project',
    promptLabel: 'Describe what to build',
    promptPlaceholder: 'Describe what it should do…',
  },
  'project-brain': {
    blurb: 'Seeds a per-project brain — explores the repo, stages starter themes, and waits for your review before committing them.',
    agentSlug: 'project-brain-builder',
    artifactLabel: 'Seeded structure',
    selector: 'project',
  },
  'community-refresh': {
    blurb: 'Refreshes the community registry from the hubs (or hunts for something specific) and drafts the changes — you approve before the registry moves.',
    agentSlug: 'community-refresh',
    artifactLabel: 'Registry draft',
    selector: 'none',
  },
};
