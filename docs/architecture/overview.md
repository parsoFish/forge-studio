# Architecture Overview

> The canonical narrative is at the repo-root [`ARCHITECTURE.md`](../../ARCHITECTURE.md). This file holds the diagram **convention** and short notes about each layer.

## Structural source of truth

The **canonical current architecture** is
[`refocus-architecture/`](./refocus-architecture/) — the north-star
this code is aligned to. On any load-bearing architecture change, update
`refocus-architecture/` first so it stays the structural truth.

The high-level picture (the Mermaid diagram at the top of
[`ARCHITECTURE.md`](../../ARCHITECTURE.md)) is a curated abstraction over
`refocus-architecture/`; update it to agree with the load-bearing facts:
the phase set, the orchestrator → phase-agent → composed-skills seam, the
brain-read policy, and the three human moments on the UI.

## Archived prior art

- **`docs/_archive/architecture/as-built-snapshot-2026-05-17.md`** — the
  honest code-grounded as-built from 2026-05-17. When any diagram and the
  code disagree, the code wins; this snapshot tracks the code at that point
  in time and is kept as reference.
- **`docs/_archive/architecture/forge2.0.drawio`** / `.png` — the legacy
  swimlane diagram (six swimlanes: Brain, Architect, PM, Developer Loop,
  Review Loop, Reflection). Prior art.
- **`docs/_archive/architecture/c4/`** — the C4 Context → Containers →
  Components model (workspace.dsl + generated diagrams). Prior art;
  superseded by `refocus-architecture/` as the structural reference.
