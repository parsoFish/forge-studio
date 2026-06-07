# ADR 024 — Phases are agents that compose skills; the orchestrator spawns them clean and model-tiered

- **Status:** accepted
- **Date:** 2026-05-31
- **Supersedes / amends:** **refines** [ADR 003](./003-skills-not-self-baked-agents.md)
  ("all agents are Claude Code skills") — splits the conflated term into the SDK's
  two real primitives (a phase is an *agent*; the things it knows how to do are
  *skills*) without reversing ADR 003's intent (use the SDK's machinery, don't
  hand-bake subprocesses). Holds the line of [ADR 011](./011-unattended-scheduler.md)–[013](./013-notifications.md)
  (the orchestrator is coordination, not a re-invented runtime). Records the
  north star the 2026-05-31 hardening round is organised around.

## Context

ADR 003 settled *what* a phase is — a Claude Code skill, not a hand-baked agent
subprocess. It did not settle *how the orchestrator invokes one*. As-built, the
answer drifted: each in-cycle phase has a hand-rolled `orchestrator/<phase>-invocation.ts`
(`pm-invocation.ts`, `dev-invocation.ts`, `unifier-invocation.ts`,
`reflector-invocation.ts`) that **builds the system prompt itself** — loading the
`SKILL.md` text from disk, composing it with brain context and a per-cycle
briefing — and then calls `query()` (or drives Ralph with a `createClaudeAgent`)
**directly from orchestrator code**. The skill markdown exists, but the
orchestrator owns prompt assembly.

Three costs follow:

1. **The skill is not the single source of intent.** Intent is split between
   `SKILL.md` and the `*-invocation.ts` prompt builder, so "what does this phase
   actually tell the agent" is two files, and the skill alone is not runnable.
2. **Coordination and intent are coupled in the capped surface.** Prompt
   assembly lives in `orchestrator/`, the one directory CLAUDE.md explicitly caps.
   Every phase prompt tweak grows the hot path it should stay out of.
3. **One context, one model per cycle stretch.** Driving `query()` inline means a
   phase inherits the ambient context and a single model choice. Small, mechanical
   phases can't cheaply run on a smaller model, and a phase's context carries
   whatever orchestration-shaped reasoning preceded it.

The operator's framing (2026-05-31): **skills are the ultimate driver, but the
orchestrator still has a place, and spinning up sub-agents for the work is a
feature, not a workaround.** A fresh sub-agent per phase (a) lets different model
tiers serve different-sized work, and (b) gives the work a *clean context* that
invokes the skill without inheriting prior orchestration scope — so orchestration
reasoning never pollutes phase work, and the orchestrator surface need not grow to
host the prompt.

Not every phase is agent work. The **reviewer** (open a PR from the unifier's
output) and **closure** (confirm a GitHub merge, move the manifest) are pure
coordination — deterministic, non-LLM — and correctly have no skill. This ADR is
about the phases that *are* agent work: architect, project-manager, developer
(Ralph), unifier, reflector.

## Decision

Forge's phase execution is a **three-layer seam**:

```
orchestrator   — coordination only: scheduler · queue · worktrees ·
                 state transitions · crash recovery. Picks the phase agent +
                 model tier and spawns it. Owns no phase prompt.
     │  spawns, per phase
     ▼
phase agent    — the actor and the home of phase intent: persona / system
                 prompt, model tier (Haiku / Sonnet / Opus), and the allow-list
                 of skills + tools it may use. Fresh context per phase.
     │  composes
     ▼
skills (+ CLIs / MCP / tools) — the reusable capabilities the agent invokes to
                 do the work: brain-query, the demo skill, gate-running,
                 code-review, … Shared across agents, not duplicated per phase.
     │  read / write
     ▼
markdown artifacts + the JSONL event log — the inter-phase protocol (ADR 007/008).
```

**1. A phase is an agent; skills are the capabilities it composes.** The phase
intent lives in the **agent definition** — its persona / system prompt, its model
tier, and the allow-list of skills + tools it may use. The reusable capabilities
(brain-query, the demo skill, gate-running, review, …) are **skills** the agent
invokes, shared across phases rather than restated in each. This is the SDK's two
distinct primitives used for what they are — a subagent (the *actor*) and a skill
(a *capability*) — and it is the picture
[PRINCIPLES.md §2](../../PRINCIPLES.md) already paints: "a handful of skills, agent
personas, and tools those agents use well." A phase-specific procedure can still
be a skill the agent's prompt mandates (e.g. a planner agent **must** invoke
`brain-query` first, per [ADR 010](./010-brain-first.md)); what changes is that
shared capabilities are no longer trapped inside one monolithic per-phase skill.

**2. The orchestrator selects the agent + tier and spawns it with a clean
context.** Its job at a phase boundary is: pick the phase agent and its model
tier, spawn it fresh, collect the structured result. It composes **no** phase
prompt; the `*-invocation.ts` files shrink to *binding the run* (which worktree,
which cycle id, which artifacts) to the agent — not authoring intent. The agent's
context is fresh: it inherits neither the orchestrator's nor a prior phase's
reasoning.

**3. The orchestrator keeps its place — it is not dissolved into skills.** ADR
011–013's coordination work (atomic claim, heartbeat recovery, the `_queue/`
state machine, worktree lifecycle) is real and stays in `orchestrator/`. The seam
*moves prompt assembly out*, it does not move coordination in. Pure-coordination
phases (reviewer PR-open, closure merge-check) stay non-agentic; they need no skill.

**4. Migrate incrementally; document now.** This ADR sets the direction. The
2026-05-31 round proves the seam on **one** phase (the unifier — it owns the demo
the round centres on) and leaves the others on their current `*-invocation.ts`
path until later rounds. Every migration must pass the two standing harnesses
(`npm run ui:journey`, `npm run verify:cycle`) with no regression before the next
phase is migrated.

> **Landed 2026-05-31 (first concrete instance).** The seam is now a real
> primitive: `orchestrator/phase-agent.ts` defines `PhaseAgentSpec` (phase +
> the skill it composes + a model **tier** + tool policy) and `modelForSpec`
> (tier → concrete model id, one place). The **unifier** is migrated:
> `unifierAgentSpec` declares it (composes `skills/developer-unifier/SKILL.md` at
> the `sonnet` tier), the orchestrator spawns it from the spec
> (`developer-loop.ts: runUnifier`), and `UNIFIER_MODEL` now *derives* from the
> spec's tier. Behaviour-preserving (still Sonnet, same tools) + unit-tested
> (`phase-agent.test.ts`); landed verified by `tsc` + the unit suite, with the
> full real-cycle / browser harness run **staged** for a dedicated authorized
> session. The other phases (PM, dev-loop, reflector) adopt `PhaseAgentSpec`
> next, one at a time behind the harness gate.
>
> **Landed 2026-06-07 (project-manager migrated).** The **project-manager** phase
> adopts `PhaseAgentSpec`: `pmAgentSpec` in `pm-invocation.ts` declares it
> (composes `skills/project-manager/SKILL.md` at the `sonnet` tier), and
> `PM_MODEL` now *derives* from the spec's tier via `modelForSpec`. `SKILL.md`
> is now the single source of PM intent: the static operational prose (non-interactive
> framing, brain-first enforcement wording, Step-0.5 Glob/Read enumeration,
> sharp-gate examples, demo_hook placement, and the itemised self-check checklist)
> was relocated from `renderPmUserPrompt` into `SKILL.md`. `renderPmUserPrompt`
> is now dynamic-only (initiative id, project name, paths, project context block,
> gate recipe). Behaviour-preserving — all enforcement (brain-skip abort,
> `validateWorkItem`, `detectHiddenCoupling`, `tallyToolUse`) stays
> orchestrator-side and is unchanged. Unit-tested in `pm-invocation.test.ts`.

## Consequences

- **Intent has one home; capabilities are shared.** A phase's intent is its agent
  definition — "what does this phase tell the agent" is one place, not a split
  between `SKILL.md` and a TS prompt builder. Cross-cutting capabilities
  (brain-query, the demo skill, gate-running, review) become skills reused across
  agents instead of duplicated per phase.
- **The orchestrator stays thin without losing its job.** Prompt assembly leaves
  the capped surface; coordination + crash recovery stay. The surface-area cap
  (CLAUDE.md "Ask first") is defended by *moving work out*, not by refusing it.
- **Model-tiering becomes a per-phase knob.** A mechanical phase can run on Haiku,
  a reasoning-heavy one on Opus, set where the orchestrator spawns the sub-agent
  (consistent with the model-selection strategy in the operator's global rules).
- **Clean context per phase.** No orchestration-shaped reasoning leaks into phase
  work; each phase starts from the skill + its artifacts only.
- **Incremental, low-risk.** One phase migrates this round behind the harness gate;
  a bad seam is caught before it spreads. The other phases keep working unchanged.

## Alternatives considered

- **Model each phase as one monolithic skill (no agent layer).** Rejected — it
  overloads a single `SKILL.md` to be both the actor *and* every procedure, and
  forces shared capabilities (brain-query, demo, review, gate-running) to be
  restated or cross-referenced inside each per-phase skill. The SDK already gives
  the actor/capability split (subagent vs skill); using both for what they are is
  simpler at the *system* level even though it names two primitives, and matches
  PRINCIPLES.md §2. (This was the framing's first draft; revised on operator
  review 2026-05-31.)
- **Big-bang: migrate all phase invocations at once.** Rejected — high churn
  across the capped surface with no harness coverage between steps; a regression in
  the seam would hit every phase simultaneously. Proven on one phase first.
- **Dissolve the orchestrator entirely into skills.** Rejected — the scheduler,
  atomic claim, heartbeat recovery, and `_queue/` state machine (ADR 011–013) are
  coordination the SDK does not provide; deleting the orchestrator would re-grow
  this work *inside* skills, which is exactly the re-invention CLAUDE.md forbids.
  The operator was explicit: the orchestrator keeps its place.
- **Keep hand-rolled inline invocation (status quo).** Rejected — it couples intent
  with coordination in the hot path, leaves the skill un-runnable on its own, and
  pins one model + one inherited context per phase.
- **Inline `query()` but in a fresh context, no sub-agent.** Rejected — a fresh
  context alone doesn't buy the per-phase model tier or the clean spawn boundary;
  the sub-agent is the unit that carries both.

## References

- [ADR 003 — All "agents" are Claude Code skills](./003-skills-not-self-baked-agents.md) — settled that phases use the SDK's machinery (not hand-baked subprocesses); this ADR splits its "agents = skills" into **agent** (actor) + **skills** (capabilities).
- [ADR 011 — Unattended scheduler](./011-unattended-scheduler.md), [012](./012-crash-recovery.md), [013](./013-notifications.md) — the coordination the orchestrator keeps.
- [ADR 007 — Markdown artifact flow](./007-markdown-artifact-flow.md), [ADR 008 — JSONL event log](./008-jsonl-event-log.md) — the inter-phase protocol the seam writes to.
- `orchestrator/pm-invocation.ts`, `orchestrator/dev-invocation.ts`, `orchestrator/unifier-invocation.ts`, `orchestrator/reflector-invocation.ts` — the current hand-rolled invocations the seam shrinks.
- `orchestrator/architect-runner.ts` — the in-UI architect runner (ADR 020), an early instance of "a runner spawns turns that invoke a skill."
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md), [`docs/architecture/c4/`](../_archive/architecture/c4/) — to be revamped (Phase H) to render this seam.
