# Architecture Overview

> The canonical narrative is at the repo-root [`ARCHITECTURE.md`](../../ARCHITECTURE.md). This file holds the diagram **convention** and short notes about each layer.

## Two layers, kept in sync

Forge is visualised in **two layers**, by design (operator decision 2026-05-31):

1. **The high-level picture** — a single, hand-curated, one-glance diagram of forge
   for humans (the operator, and anyone trying to understand forge). It shows the
   six phases as **agents that compose skills** ([ADR 024](../decisions/024-phases-as-subagents-invoking-skills.md):
   thin orchestrator → clean model-tiered phase agent → the skills/tools it
   composes), the brain-read policy, the three human moments on the UI, and the
   contract families.
   The **technology doesn't matter** — it is chosen for the nicest result, not
   bound to any one tool. **As of 2026-05-31 this is the Mermaid diagram embedded
   at the top of [`ARCHITECTURE.md`](../../ARCHITECTURE.md)** — text, so it renders
   natively in GitHub + the Obsidian brain, diffs cleanly, and carries no binary.
   It **supersedes** the legacy `forge2.0.drawio` swimlane (kept as prior art).

2. **The C4 drill-down** — the [`c4/`](./c4/) model is the **structural system of
   record**: Context → Containers → Components + dynamic flows, generated from one
   [`c4/workspace.dsl`](./c4/workspace.dsl) source. This is where you go for
   component-level detail (the skill catalog, the engine components, the cycle flow).

### The sync contract

These two layers must not drift. On any load-bearing architecture change:

- **Update `c4/workspace.dsl`** and regenerate (`/c4`, or the by-hand commands in
  [`c4/README.md`](./c4/README.md)) — it is the structural truth.
- **Update the high-level picture** so it still agrees with the C4 model on the
  *load-bearing facts*: the phase set, the orchestrator → phase-agent → composed-skills
  seam, the brain-read policy, the three human moments, and the contract families. It is a
  curated abstraction *over* the C4 model, never a contradiction of it.
- The honest, code-grounded reference remains
  [`as-built-snapshot-2026-05-17.md`](./as-built-snapshot-2026-05-17.md) — when any
  diagram and the code disagree, **the code (and the snapshot tracking it) wins.**
  A diagram is a communication artifact, not the source of truth about behaviour.

## Source artifacts

- [`forge2.0.drawio`](./forge2.0.drawio) / [`.png`](./forge2.0.drawio.png) — the legacy swimlane diagram (six swimlanes: Brain, Architect, PM, Developer Loop, Review Loop, Reflection; an artifact-flow row Roadmap → Initiative → Feature → Work item; a branch-flow row main ← initiative branch ← feature branches). Prior art for the Phase-H revamp.
- [`c4/workspace.dsl`](./c4/workspace.dsl) — the C4 structural source; everything under [`c4/diagrams/`](./c4/diagrams/) is generated from it.
