# Changelog

All notable changes to Forge are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres (loosely, pre-1.0) to [Semantic Versioning](https://semver.org/).

## [Unreleased] — 0.x (Studio era)

This entry covers the **M7 consolidation** (Forge Studio became the one product)
and the **M8 seams** (modularity-as-subsumption: every extension point now has a
real data-table dispatch and a second, gated implementation behind it).

### Added

#### M8 — extension seams (modularity-as-subsumption)

- **Node-executor registry for the flow engine** ([ADR-028](docs/decisions/028-flow-engine.md)).
  Flow nodes are dispatched through a data-table + node-executor registry. The old
  hard-coded `classifyNode` switch is gone; adding a node type is a registry entry,
  not a code branch.
- **Runtime adapter registry** ([ADR-029](docs/decisions/029-runtime-adapters.md)).
  The dev-loop builds agents via `getAdapter(sdkId).createAgent` through the
  `RuntimeAdapter` registry instead of calling `createClaudeAgent` directly, so the
  underlying coding agent is swappable.
- **Swappable brain store (`KbBackend` seam)** ([ADR-027](docs/decisions/027-studio-object-model.md)).
  The brain's store sits behind a `KbBackend` interface dispatched from `kb.yaml`
  (`orchestrator/kb-backend.ts`), making the knowledge-base backend pluggable.
- **Unifier as a first-class flow node.** `runUnifierPhase`
  (`orchestrator/phases/developer-loop.ts`) is now an independently-dispatchable
  flow node rather than logic buried inside the cycle runner.
- **Second implementation behind every seam (subsumption proof)**
  ([ADR-032](docs/decisions/032-subsumption-proof.md)). Each seam now resolves a
  real drop-in alternative, all registered but **dependency- and credential-gated**
  (`available: false` until provisioned):
  - **Gemini** `RuntimeAdapter` — `loops/_adapters/gemini` (needs `@google/genai` + `GEMINI_API_KEY`).
  - **Aider** dev-loop `RuntimeAdapter` — `loops/_adapters/aider` (needs the Aider CLI + a model key).
  - **Zep** `KbBackend` — `orchestrator/kb-backends/zep.ts` (needs `@getzep/zep-cloud` + Zep credentials).
  - Adapters are wired in `loops/_adapters/registry.ts` and surfaced in `studio/catalog.yaml`.

#### M7 — Studio consolidation (Forge Studio is the one product)

- **Forge Studio is the single product surface** ([ADR-031](docs/decisions/031-studio-consolidation.md)).
- **`forge studio` launches the operator UI** — a deterministic launcher; harnesses
  no longer scrape stdout to find the UI.
- **Native architect in Studio** — the architect interview and the PLAN gate were
  rebuilt natively inside Studio.
- **Unified `/artifact` viewer** — the `/review` and `/reflect` human moments now
  render on the single `/artifact` viewer ([ADR-020](docs/decisions/020-in-ui-architect.md)).
- **Cycle-monitor regression guards** on the Studio flow monitor.

### Changed

- **Orchestrator internals refactored for the seams.** `cycle.ts` helpers were
  extracted to `cycle-helpers.ts` to break the flow-runner → cycle inside-out
  dependency, and node dispatch moved from a switch to the executor registry.
- **CLI collapsed to a runtime spine.** The CLI is now the runtime spine plus the
  Studio launcher; the bridge is the operator API.

### Removed

- **The pre-Studio `/dashboard`** and its exclusive component cluster were deleted
  (Studio fully replaces it).
- **The deprecated `forge watch` alias** was retired in M8-E. Use `forge studio`.
  (The shared launcher implementation in `cli/forge-watch.ts` remains; only the CLI
  alias was removed.)

### Licensing

- Forge is distributed under **AGPL-3.0-or-later**. See
  [docs/licensing-and-dependencies.md](docs/licensing-and-dependencies.md) for what
  that means for self-hosting operators and contributors, plus a dependency license
  audit.

[Unreleased]: https://github.com/Parso/forge/compare/main...HEAD
