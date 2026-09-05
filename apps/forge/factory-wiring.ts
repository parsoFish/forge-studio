/**
 * factory-wiring.ts — the ONE place the assembly names the installed example
 * factory (ADR 048, clause 2's seam).
 *
 * `packages/flows` declares the `PhaseWiring` port and imports no factory, so
 * something has to bind it. That something is the assembly, and it is this file
 * alone: when the deletable-factory work lands (M5-A exit row 5), only this
 * module changes — the resolution becomes dynamic and `phaseWiring()` returns
 * `null` when `@forge/factory` does not resolve, which is what makes
 * `packages/factory` removable with `forge studio` still booting.
 *
 * Until then the import is static and the function total. Keeping the seam in
 * one file now is the point: a dozen scattered factory imports cannot be made
 * optional later, and that is exactly the state ADR 048 was written against.
 */
import { createPhaseExecutor } from '@forge/factory/phases/executor-table.ts';
import { createProjectGate, defaultRunClosure } from '@forge/factory/phases/executor-deps.ts';
import { runReflector } from '@forge/factory/phases/reflector.ts';
import { CLASS_PROFILES } from '@forge/factory/class-profiles.ts';
import type { PhaseWiring } from '@forge/flows/phase-wiring.ts';

/** The shipped example factory's phase wiring. */
export function factoryPhaseWiring(): PhaseWiring {
  return {
    executor: createPhaseExecutor(),
    projectGate: createProjectGate(),
    runClosure: defaultRunClosure,
    runReflector,
  };
}

/**
 * The example factory's class → gate-profile answer for the plan gate (ADR 051,
 * ruling 229 half B), bound HERE for the same reason as the phase wiring above:
 * `packages/flows` may not import the deletable package, and this file is the
 * one place the assembly names it.
 *
 * `null` for a class the installed table does not know, so an unknown class
 * cannot be silently treated as permissive OR as forbidden — the plan gate
 * simply has no opinion, which is the honest answer when the table cannot speak
 * to it. When the deletable-factory work lands (exit row 5) and `@forge/factory`
 * does not resolve, this whole binding is absent and the plan gate enforces no
 * example's policy at all.
 */
export function factorySingleWiAllowed(changeClass: string): boolean | null {
  const profile = (CLASS_PROFILES as Record<string, { singleWiAllowed: boolean } | undefined>)[changeClass];
  return profile === undefined ? null : profile.singleWiAllowed;
}
