# Architecture Overview

> The canonical narrative is at the repo-root [`ARCHITECTURE.md`](../../ARCHITECTURE.md). This file holds the source diagram and short notes about it.

## Source diagram

- [`forge2.0.drawio`](./forge2.0.drawio) — editable diagram (open in [draw.io](https://app.diagrams.net))
- [`forge2.0.drawio.png`](./forge2.0.drawio.png) — exported PNG embedded in the root ARCHITECTURE.md

## Notes on the diagram

The diagram has six swimlanes (Brain, Architect, Project Manager, Developer Loop, Review Loop, Reflection). Each swimlane contains the responsibilities and design notes for that phase. The artifact-flow row beneath the swimlanes (Roadmap → Initiative → Feature → Work item) and the branch-flow row (main ← initiative branch ← feature branches) describe the data and version-control models the phases coordinate over.

User actor figures appear next to the Architect (start of cycle) and the Review Loop (end of cycle) — these are the human interaction points. Reflection includes a third user touch (feedback channel) but its primary output is the brain ingest.

If the diagram and the narrative ever disagree, the **diagram is the source of truth**; the narrative is the English translation.
