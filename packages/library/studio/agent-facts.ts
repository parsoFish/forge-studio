/**
 * agent-facts.ts — the agent facts library needs, as library's OWN port.
 *
 * Library is rank 2 and `@forge/agents` is rank 3, so library may not read
 * agent files; the answers arrive by injection from `apps/forge`. Nothing here
 * imports `@forge/agents`, types included — `check-boundaries` reads the import
 * graph, so a type-only edge is still a row.
 *
 * `design.md` §"Agent facts arrive by injection" carries the rest: why there
 * are two members, which paths take which, and why no path takes both.
 */
import type { AgentComposition } from '@forge/contracts/studio/types.ts';

/** The library object kinds an agent composes. Deliberately no `guard`. */
export type ComposableKind = 'skill' | 'hook' | 'connection';

/** Who composes each id, and how many agents were read. `scanned` is what the
 *  surfaces report as `derivation.scanned`. */
export type AgentUsage = {
  readonly byId: ReadonlyMap<string, readonly string[]>;
  readonly scanned: number;
};

/** One well-formed studio agent, as the lint paths consume it. */
export type ComposingAgent = {
  readonly slug: string;
  readonly composition: AgentComposition;
};

/** The port. Supplied at `apps/forge`; no default and no module-level setter. */
export type AgentFacts = {
  readonly usage: (kind: ComposableKind, forgeRoot: string) => AgentUsage;
  readonly compositions: (forgeRoot: string) => readonly ComposingAgent[];
  /** True when a SKILL.md declares a studio AGENT rather than a plain skill. */
  readonly isAgentSkillMd: (mdPath: string) => boolean;
};
