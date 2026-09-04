# ADR 048 — The example factory is a deletable package (amends ADR 038)

**Status:** Accepted (operator decision 2026-09-05, seam (a)).
**Date:** 2026-09-05
**Amends:** [ADR 038](./038-north-star-platform-and-ootb.md) (Scope 1 platform vs Scope 2 OOTB content).
**References:** spec §3 (`packages/factory` row), §5, §7 clause 2; `docs/roadmaps/1.0.md` §4 M5 Lane A; ADR 046 (package layout + boundary lint); ADR 028 (flow engine); ADR 024 (phases as subagents).

## Context

ADR 038 made the mission two-level — Scope 1 the platform, Scope 2 the shipped example — but it recorded the split as a
*north star for judgement*, enforced by nothing. Since then the split has been asserted in prose and contradicted in code.
Measured on `parsoFish/main` `b442e079`:

- `packages/flows/finalize-merged.ts:31` statically imports `@forge/factory/phases/reflector.ts` — a rank-7 package
  importing a rank-8 one. It is a baselined `package-layer-order` violation (handoff F2), not a permitted edge.
- `apps/forge` reaches factory five ways: four **static** imports (`ui-bridge.ts:56,93,101`, `band-agent-deps.ts:18,19`)
  and three dynamic ones (`cli.ts:770,823,824`).

So today, deleting `packages/factory` does not degrade the platform to "no example installed" — it fails to resolve, in
flows and in the assembly. Spec §7 clause 2 makes the opposite a definition-of-1.0 clause: *"deleting the example package
leaves the platform running"*. An unenforced clause of that kind is decoration (1.0.md §2.2).

## Decision

**`@forge/factory` is a deletable package, and deletability is a CI test, not a claim.**

1. **No package may import `@forge/factory`, statically or dynamically.** Factory is the terminal rank of the allow-graph.
   Where a lower-ranked package needs behaviour the example supplies, it declares a **port** in its own vocabulary and the
   assembly binds it — the `SessionStatusIoPort` / `SdkAvailabilityFn` shape already ratified in M4 (rulings 99, 137).
   `finalize-merged.ts`'s reflector call becomes `ReflectorPort`, bound at `apps/forge`. This closes handoff F2's three
   `package-layer-order` rows by construction rather than by baseline.
2. **`apps/forge` reaches factory only through one resolution seam**, and that seam treats absence as a supported state,
   not an error: an example package that is not installed yields no develop flow, no phase executors and no factory routes,
   and every other surface — Studio, projects, library, knowledge, sessions, the daemon — boots and serves.
3. **The clause is proven by execution.** A CI job removes `packages/factory` in a scratch worktree and boots `forge studio`;
   the job fails if the boot fails, and it fails if any non-factory package acquires a factory import. It is paid for, under
   the guardrail budget (1.0.md §2.3), by the retirement of the `demo-fix` loop in the same milestone.
4. **What "the example" means is fixed by this ADR:** the six phase agents and their SKILL.mds, the develop `FlowDef`, the
   artifact templates, and the class → gate-profile table (ADR 051). Anything in `packages/factory` that a second, unrelated
   factory would also need is misplaced and belongs in `flows`, `agents` or `kernel`.

## Consequences

- **Enforced:** the deletable-factory CI test (row 5 of the M5-A exit table) and `check-boundaries` — a `→ @forge/factory`
  edge from any package is a new violation, never a baseline row.
- G3 (spec §7 / 1.0.md §3: a second factory built from data only) becomes reachable, because the seam a second factory
  plugs into is the same one deletion exercises.
- ADR 038's Scope 1 / Scope 2 language stands; this ADR supplies the mechanism it lacked. ADR 038 gains an amendment note.
- **Cost:** one port on `finalize-merged.ts`, one resolution seam in `apps/forge`, one CI job. No new dependency.

## Alternatives considered

- **Keep the static imports, and test deletability by mocking the module.** Rejected: it tests the mock. The claim is about
  a checkout with the directory gone; only that checkout can prove it.
- **Move the reflector into `flows`.** Rejected: the reflector is example content (it writes the develop flow's brain themes
  under the develop flow's contract). Moving it makes `flows` carry an opinion the platform must not have.
- **A feature flag for "no example installed".** Rejected by CLAUDE.md: no feature flags, no fallback paths.

## The seam, as accepted

The operator chose **(a)**: the assembly's factory wiring lives in one module — `apps/forge/factory-wiring.ts` — which
resolves the package and hands back a `PhaseWiring`. It is a static import and a total function today; when the
deletable-factory test lands (M5-A exit row 5) the resolution becomes dynamic and the function returns `null` when
`@forge/factory` does not resolve. **Only that module changes.** Keeping the seam in one file before it is needed is the
whole point: a dozen scattered factory imports cannot be made optional later, which is the state this ADR was written
against.

Option (b) — factory self-registering through the existing `FlowDef` and band-executor registries, with no
factory-shaped code in the assembly at all — is cleaner in principle and was rejected for 1.0 on cost: it makes
registration order load-bearing and is a larger change to `apps/forge` than the milestone's repo-net budget allows. G3
(a second factory built from data only) is where it earns its place, if it does.
