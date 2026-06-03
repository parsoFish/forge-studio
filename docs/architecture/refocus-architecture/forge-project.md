# Forge↔Project Contract

> **Intent.** The set of structural guarantees a project must expose so forge can develop
> it **unattended** — mapped onto whatever form the project takes (UI app, HTTP API,
> library, CLI, monorepo, infra provider). In short: a truthful done-signal, hermetic
> commits, decomposable source, faithful planning inputs, a mergeable result, an
> external-resource model, and a **prescribed demo format**.
>
> **Type:** boundary spec. **Realized via:** the contract doc
> ([docs/forge-project-contract.md](docs/forge-project-contract.md), ADR 017), a
> machine-checker ([cli/preflight.ts](cli/preflight.ts) → `forge preflight`), the runtime
> config validator ([orchestrator/project-config.ts](orchestrator/project-config.ts)), and
> the [forge-onboard-project](skills/forge-onboard-project/SKILL.md) skill.

## The clauses

- **C1 — truthful done-signal:** a quality gate that fails on a clean tree and passes only
  when the work exists; it must **be, or strictly cover, the project's own CI**.
- **C2 — hermetic commits:** `git status` after a clean build shows only intended source
  (scratch + build output + dep caches gitignored, *and not already tracked*).
- **C3 — decomposable source · C4 — faithful planning inputs (brain + roadmap-view) ·
  C5 — locked core · C6 — mergeable result (GitHub remote) · C7 — external-resource model.**
- **Demo:** a declared `demo.shape` + `demo.command` (+ `preview_command` for UI) so the
  review loop can show real before/after behaviour, not a test-name table.

## Responsibilities

- Decline (non-zero exit) before any SDK cost when a **hard** clause fails, naming it.
- Validate + load the per-project runtime config (`.forge/project.json`), fail-closed.
- Operationalise onboarding: map each invariant onto the project's form, prime the project
  brain + roadmap-view, and hand off a roadmap-scale initiative.

## Relationships

- **Consumed by:** the [Orchestrator](docs/architecture/refocus-architecture/Orchestrator.md) (pre-cycle decline gate) + every phase that reads
  `.forge/project.json` (PM, dev-loop, unifier, closure).
- **Pairs with:** [skills/demo/SKILL.md](skills/demo/SKILL.md) (forge half of the demo contract).

## Boundaries (what this is NOT)

- Not a project-type-specific recipe — it is a set of **form-agnostic invariants** the
  onboarding maps onto each project's shape.
- Not a full assurance — roughly half the clauses (C1-discrimination, C2-git-reality,
  demo-fidelity, all of C7) are honour-system today; preflight green overstates assurance.

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- **[CON-1 · high]** C2 is a **false pass**: it greps `.gitignore` text, but git ignores are
  no-ops on already-tracked files — betterado's `AGENT.md` is committed yet C2 reports PASS.
  Use `git check-ignore` + `git ls-files` (the onboarding skill already does).
- **[CON-2 · high]** **Two divergent `.forge/project.json` validators** (`preflight.checkDemo`
  vs runtime `validateProjectConfig`); `DEMO_SHAPES` declared three times. Collapse to one
  validator, two severities.
- **[CON-3 · med]** Resolve **AGENT.md lifecycle**: it is both "scratch to ignore" (C2) and
  the unifier's committed per-initiative memory — pick one (e.g. move unifier memory to an
  already-ignored `.forge/` path) so C2 stays honest.
- **[CON-4 · med]** `docs/schemas/project-config.schema.json` references phantom clauses
  (C26-C28, CONTRACTS.md) and forbids real fields (`logging`) — regenerate from the types or
  delete; `demo.skill` is declared but inert (wire it or drop it); ADR 017 cites stale paths.
- **[CON-5 · med]** Preflight emits **zero JSONL events** (violates the standing event rule)
  — a decline leaves no trace in `_logs/`/the UI.
- **[CON-6 · med]** Add a **C8 — agent-instruction file** clause: require a human-authored
  `AGENTS.md`/`CLAUDE.md` at the project root (commands before line 50). *(Research: a
  human-curated file is ~4pp task-success uplift; auto-generated files hurt — author, don't
  generate.)*
