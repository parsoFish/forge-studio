# Skill Model (cross-cutting seam)

> **Intent (north star).** Forge is built around a **skill-based model** (ADR 024) with a
> clean three-layer seam: the **orchestrator coordinates only**; at each phase boundary it
> picks a **phase agent + a model tier** and spawns it with a fresh context; the **phase
> agent is the single home of phase intent** (persona + tier + tool allow-list); and the
> agent **composes reusable skills** (brain-query, demo, gate-running, review) shared across
> phases rather than restating them. The end state: the **SKILL.md *is* the runnable source
> of intent** — and new capabilities arrive as **skills-as-plugins** for any phase agent,
> the path to forge's future extensibility.
>
> **Type:** architectural pattern. **Realized via:**
> [orchestrator/phase-agent.ts](orchestrator/phase-agent.ts) (`PhaseAgentSpec` +
> `MODEL_BY_TIER`) + the `skills/` catalog. Aligns with Anthropic's own multi-phase
> orchestration + Agent Skills guidance.

## The three layers

1. **Orchestrator** — scheduler, queue, worktrees, state transitions, crash recovery; picks
   agent + tier; owns no phase prompt. (See [Orchestrator.md](docs/architecture/refocus-architecture/Orchestrator.md).)
2. **Phase agent** — a `PhaseAgentSpec {phase, skill, tier, allowedTools}`; fresh context per
   phase; the actor that holds intent.
3. **Skills** — composable capabilities (three-level progressive disclosure: ~100-token
   metadata always-on, full SKILL.md on trigger, bundled resources on demand), shared across
   phases, not copied per phase.

## Why it matters

- **Intent has one home** (no SKILL.md-vs-TS-builder split) → less drift, smaller capped
  orchestrator surface.
- **Per-phase model routing** → cheap models for mechanical phases, strong models for deep
  reasoning, declared in one place.
- **Skills-as-plugins** → forge gains capabilities by adding skills, not orchestrator code —
  the extensibility story.

## State today

Realized for **1 of 5 agent phases** (the unifier composes `developer-unifier` at the sonnet
tier via `unifierAgentSpec`). PM, dev-loop, reflector still hard-code their model and
assemble prompts inline in `*-invocation.ts`; the architect-runner sets no tier. ~1544 LOC of
prompt assembly sits in `orchestrator/` — the work ADR 024 wants moved out.

## Scope of this refocus (operator-directed)

The **full SKILL-as-single-source migration is the direction, not this pass.** This
refinement does the **cheap, safe alignment** only; the heavy migration (move discipline
prose into the SKILL.md files; turn every phase into a spec-driven agent) is a **separate,
harness-gated effort** scheduled later. See the memory note on the skill-based-model direction.

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- **[SKL-1 · med]** Dead bench scaffolding in all four `*-invocation.ts` headers ("both the
  bench harness and the live orchestrator call this… single source of truth") — `benchmarks/`
  is gone. Strip it + the `_brainCwd` "bench-compat" param + the ~37 lines of S8/C23
  prompt-caching prose for an SDK feature that "does not (yet) consume" the flag.
- **[SKL-2 · med]** Dead `model:` frontmatter — no runtime parses it, and values drifted
  (`claude-opus-4-7` doesn't exist in `MODEL_BY_TIER`). Either make it the live tier source
  (skill self-describing) or delete it everywhere; pick one before any migration.
- **[SKL-3 · med]** Collapse the **demo capability duplication**: the unifier re-bakes
  `skills/demo/SKILL.md`'s per-shape guidance inline as `demoInstructionsForShape()`
  ("keep the two in sync") — compose the skill instead. This is the concrete "shared
  capability, not restated per phase" move on the one capability already declared shared.
- **[SKL-4 · low]** `skills/README.md` inventory is stale (lists a deleted `reviewer` skill;
  omits demo/architect-llm-council/brain-graph/developer-unifier; says "register in
  cycle.ts"). Rewrite to the as-built catalog.
- **[SKL-5 · direction, not this pass]** Migrate PM / dev-loop / reflector / architect to
  `PhaseAgentSpec` and move discipline prose into the SKILL.md files (the heavy ADR-024
  migration). Tracked as the north-star effort; **do not execute in this refinement pass**.
