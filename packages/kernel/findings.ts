/**
 * The `Finding` shape every Forge Studio validator returns, plus the two
 * constructors every validator builds one with.
 *
 * MOVED VERBATIM from `orchestrator/studio/validate.ts:37-42` (`Finding`) and
 * `:107-113` (`err`/`flag`) — M4 library-by-kind carve, Part 1. `validate.ts`
 * re-exports `Finding` so its 20+ existing importers (type-only, across
 * `packages/library`, `packages/sessions` and others) need no edit; that
 * re-export is deliberate and stays until another milestone retires the
 * file. `err`/`flag` were never exported from `validate.ts` — they are
 * re-declared here as the one definition, and both `validate.ts` and the new
 * `packages/library/studio/library-validate.ts` import them from here rather
 * than duplicating them, since neither faces a cycle risk importing kernel
 * (rank 1, below every other package).
 *
 * NOT THE SAME TYPE AS `ClauseResult` (`packages/kernel/project-contract.ts`).
 * `ClauseResult` is a project-contract preflight clause verdict (`clause`,
 * `title`, `hard`, `pass`, `detail`) — a different shape for a different
 * purpose (the `ProjectGate` port). This was checked before this module was
 * written: the two types are not the same thing wearing two names, and both
 * stay. Do not re-litigate it or try to unify them.
 */

export type Finding = {
  level: 'error' | 'flag';
  object: string; // e.g. 'agent:developer-ralph', 'flow:forge-develop', 'kb:cycles', 'catalog', 'projects'
  check: string;  // e.g. 'readiness/purpose', 'acyclic', 'zero-gate', 'slug'
  message: string;
};

export function err(object: string, check: string, message: string): Finding {
  return { level: 'error', object, check, message };
}

export function flag(object: string, check: string, message: string): Finding {
  return { level: 'flag', object, check, message };
}
