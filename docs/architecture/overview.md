# Architecture Overview

> The canonical narrative is at the repo-root [`ARCHITECTURE.md`](../../ARCHITECTURE.md). This file holds the diagram **convention** and short notes about each layer.

## Structural source of truth

The **canonical current architecture** is captured in [`docs/phases/`](../phases/),
[`docs/decisions/`](../decisions/), and [`docs/forge-project-contract.md`](../forge-project-contract.md).
On any load-bearing architecture change, update the relevant phase doc or ADR first.

The high-level picture (the Mermaid diagram at the top of
[`ARCHITECTURE.md`](../../ARCHITECTURE.md)) is a curated abstraction — update it to agree
with the load-bearing facts: the phase set, the orchestrator → phase-agent → composed-skills
seam, the brain-read policy, and the three human moments on the UI.

## Historical prior art (removed 2026-06-07)

The following files were archived and removed (git history: wave 4 cull):

- **`docs/_archive/architecture/as-built-snapshot-2026-05-17.md`** — code-grounded as-built from 2026-05-17.
- **`docs/_archive/architecture/forge2.0.drawio`** / `.png` — legacy six-swimlane diagram. Superseded by the Mermaid diagram in `ARCHITECTURE.md`.
- **`docs/_archive/architecture/c4/`** — C4 Context → Containers → Components model. Superseded by `docs/phases/` + `docs/decisions/`.
- **`docs/architecture/refocus-architecture/`** — pre-simplification design docs (16 files). Superseded by `docs/phases/`, `docs/decisions/`, and `docs/forge-project-contract.md`.
