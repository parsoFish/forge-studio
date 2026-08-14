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
