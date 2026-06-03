# Forge — Refocus Architecture

> The **clear, simple statement** of what each forge component is for, what it
> consumes and produces, how they relate, and where the current build has drifted
> from that intent. This folder is the **north star** the holistic refinement is
> aligned to. Where a spec and the code disagree, the spec is the target and the gap
> is logged in [REFINEMENT-BACKLOG.md](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md).

## Forge in one paragraph

Forge is a **local, unattended, multi-phase agent orchestrator** that turns one
operator's ideas into merged PRs across many side projects. The operator works at
exactly **three human moments** — *architect* (idea → plan), *review* (read the demo,
approve/merge), *reflect* (feedback) — all on the **forge UI**. Between those moments a
**thin orchestrator** drives each initiative through five autonomous-or-assisted phases
in its own git worktree: **project-manager → developer-loop → unifier → review → reflect**.
Each phase is a **clean, model-tiered agent that composes skills** (ADR 024). Phases
flow over **greppable markdown artifacts + a JSONL event log**; durable knowledge lives
in a **three-scope markdown brain**.

## Design principles (what every component is judged against)

1. **Unattended-first** — every component must preserve arbitrary-duration autonomous
   operation. The three human moments are explicit, operator-initiated, and impossible
   to silently auto-satisfy.
2. **Clarity of goal** — each component does **one** thing with a stated input and
   output. If you cannot say its job in two sentences, it is doing too much.
3. **Simplest thing that works** — battle-tested tools over hand-rolled ones; cull
   accumulated bloat aggressively while preserving intent.
4. **Intent has one home** — a phase's intent lives in its **skill**, not split between
   a SKILL.md and a TypeScript prompt-builder (ADR 024 north star, see
   [Skill-Model.md](docs/architecture/refocus-architecture/Skill-Model.md)).
5. **Truth is in artifacts + git, not status flags** — the diff is the source of
   completion truth; `done/` must mean *merged*.

## The components

| # | Component | Type | Spec |
|---|-----------|------|------|
| 1 | Architect | interactive human-moment | [Architect.md](docs/architecture/refocus-architecture/Architect.md) |
| 2 | Project Manager | autonomous phase | [Project-Manager.md](docs/architecture/refocus-architecture/Project-Manager.md) |
| 3 | Developer Loop | autonomous phase (Ralph) | [Developer-Loop.md](docs/architecture/refocus-architecture/Developer-Loop.md) |
| 4 | Review Loop (unifier · demo · review · closure) | assisted human-moment | [Review-Loop.md](docs/architecture/refocus-architecture/Review-Loop.md) |
| 5 | Reflection | assisted human-moment | [Reflection.md](docs/architecture/refocus-architecture/Reflection.md) |
| 6 | Brains (forge-dev · cycle · project-dev) | knowledge stores | [forge-dev-brain.md](docs/architecture/refocus-architecture/forge-dev-brain.md) · [forge-cycle-brain.md](docs/architecture/refocus-architecture/forge-cycle-brain.md) · [project-dev-brain.md](docs/architecture/refocus-architecture/project-dev-brain.md) |
| 7 | Forge UI | operator surface | [forge-ui.md](docs/architecture/refocus-architecture/forge-ui.md) |
| 8 | Orchestrator | engine substrate | [Orchestrator.md](docs/architecture/refocus-architecture/Orchestrator.md) |
| 9 | Forge↔Project Contract | boundary spec | [forge-project.md](docs/architecture/refocus-architecture/forge-project.md) |
| — | Skill model (cross-cutting seam) | architectural pattern | [Skill-Model.md](docs/architecture/refocus-architecture/Skill-Model.md) |

How they connect: [Component-Relationships.md](docs/architecture/refocus-architecture/Component-Relationships.md) (with diagrams).

## Decisions locked for this refocus (2026-06-03)

- **Decomposition happens once.** The **architect emits coarse capability-features**
  (no per-feature quality gates); the **project-manager owns all work-item sizing and
  gate selection**. (Resolves the double-decomposition antipattern.)
- **The roadmap is a derived view**, not a stored artifact. The queue of initiatives +
  their `depends_on_initiatives` chain *is* the roadmap; the UI renders it. The
  architect does **not** write `roadmap.md`.
- **The skill model is the north star** ([Skill-Model.md](docs/architecture/refocus-architecture/Skill-Model.md)): all five
  agent phases become `PhaseAgentSpec`s and ultimately the SKILL.md is the single
  runnable source of intent, opening the door to **skills-as-plugins** per phase. The
  *heavy* prose-migration is a separate effort, not part of this refinement pass.
- **The UI keeps N concrete screens** (ADR 023). "Two page types" means two *conceptual*
  types — a monitoring dashboard and an interactive-moment family that shares chrome —
  not one literal template.

## What forge is *not* (held boundaries)

- Not a job queue / worker pool / resource controller / process isolator (ADRs 011-013).
- Not a self-modifying system — forge does not run forge cycles against itself.
- Not a per-project agent personality — skills are shared; per-project taste lives in
  that project's own brain.
- Not an auto-merger — the GitHub PR is the operator's merge surface; forge confirms.
