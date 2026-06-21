# Changelog

All notable changes to Forge are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres (loosely, pre-1.0) to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Demo + artifact polish (post-S9 refinements)

- **Demos show REAL captured CLI output, not prose.** `forge demo capture` now runs
  a checkpoint's `command` argv in both the before (main) and after (branch HEAD)
  worktrees and back-fills the actual terminal stdout/stderr, rendered side-by-side
  in the demo — replacing hand-written "before/after" notes for CLI tools.
- **PR artifact "Why/What/How" renders as markdown.** The PR-description body on the
  artifact page is now rendered (markdown-it + DOMPurify) instead of shown as literal
  `##`/`**` text. A bare `## Why` section heading is no longer mis-parsed as the PR title.
- **Demo evidence de-duplicated from the PR view.** The `DemoComparison` block was
  removed from the `type=pr` artifact view — the same evidence already lives on the
  `type=demo` and verdict-gate views, so the PR page now carries only the PR itself.
- **"Back to monitor" no longer 404s on retired flows.** The artifact page's
  breadcrumb + back link now validate the run's `flow_id` against the live flow set
  (`/api/studio/flows`); an old cycle on a retired flow (`release-refine`,
  `forge-cycle-with-review`) degrades to the dashboard cascade `/` instead of
  linking to a now-deleted `/flows/<id>`.
- **The PLAN artifact actually renders.** Only the rendered `PLAN.html` is
  snapshotted into a cycle's `artifacts/` (no `plan.json` / `PLAN.md`), so the
  `type=plan` view always fell through to "Artifact not yet produced". It now
  falls back to showing `PLAN.html` in a locked-down (`sandbox=""`) iframe, and
  the plan chip/badge is relabeled `PLAN.html` to match the real artifact.

## [0.2.0] - 2026-06-21

S9 — **the 3-stage spine is the REAL runtime + the CLI is retired as the operator
surface**. (Reconciles the stray 0.1.1 self-release back into a clean lockstep bump.)

### Added
- **Spine as the runtime.** The `forge-architect → [plan gate] → forge-develop →
  [verdict gate] → merge → forge-reflect` spine now runs end-to-end on real cycles
  (proven on the gitpulse verify ground). `scripts/verify-cycle.mjs` drives the spine
  via the bridge API as three gated runs threading one cycle_id (DEC-2), and now WAITS
  for `reflector.end` so reflect-writes-central-brain is asserted.
- **Per-flow spine observability (Model B).** Each flow's monitor renders its OWN slice;
  a threaded run surfaces under all three flows via a derived `flowLineage` (keyed off
  globally-unique nodes). WI fan-out on the develop `dev` node is now run-driven.
- **DEC-6 recovery surface.** Bridge routes `GET /api/recovery/:id`,
  `POST /api/recovery/:id/{abandon,requeue}`, `POST /api/initiatives` + a `/recovery`
  UI screen replace the retired `forge review --inspect/--abandon` + `forge requeue`.

### Changed / Fixed
- The architect→develop hand-off reuses the preserved worktree (work-items survive);
  a closure-less `ready-for-review` cycle is moved out of in-flight by the scheduler.

### Removed
- The `release-refine` + `forge-cycle-with-review` legacy flows; the flow-less
  `web-scraper` + `security-auditor` agents.
- The operator CLI surface (cycle / enqueue / metrics / review / report / log / requeue) —
  `forge studio` is the sole operator surface. `serve` / `architect` / `brain` / `demo` /
  `preflight` stay dispatchable but hidden (internal spawn targets + agent/dev tools).

## [0.1.1] - 2026-06-21

## [0.1.0] - 2026-06-21

Forge Studio adopts **0.x pre-release versioning**: minor/patch bumps land as work
ships; **v1.0.0 is reserved for the first releasable cut** (operator-gated). This
0.1.0 line consolidates the Studio-era pre-release work — S8 (the Forge Reflect
flow + retirement of the forge-cycle monolith), M7/M8 (Studio consolidation +
extension seams), and the productionisation pass.

### S8 — Forge Reflect flow + monolith retirement

- **Forge Reflect** — the third seed flow (`studio/flows/forge-reflect`): a deep
  retrospective (repeated actions, roadblocks, operator notes) that writes the
  central forge-owned project brain post-merge (via `finalize-merged`).
- **forge-cycle monolith retired** ([DEC-3]). The 3-flow set
  (forge-architect → forge-develop → forge-reflect) replaces it; there is no
  default flow and no fallback — every manifest names its flow.

### Productionisation pass

This covers the **productionisation pass**: a release final-loop, disk-based
project auto-discovery, a creds-free reference project, and a hard cull of removed
seams (Zep, graphify) and stale framing (forge-v2).

### Added

- **Release final-loop.** An in-cycle drafted changelog → operator **Approve** →
  `release-finalize` (commits the changelog + docs) → forge merges the PR → CI
  tags + publishes the release. Codified as contract clause **C10**, with the
  `release-finalizer`, `doc-updater`, and `changelog-semver` skills.
- **Disk-based project auto-discovery + first-run onramp.** Managed projects are
  discovered from disk — any directory under `projects/` (or `$FORGE_PROJECTS_DIR`)
  carrying a `.forge/project.json` is a managed project. No central registry file.
- **`projects/mdtoc`** — a neutral, creds-free reference project (the default
  `verify:cycle` ground; betterado remains the live tier).
- **Getting-started guide + onboarding scaffolding** —
  [`docs/getting-started.md`](docs/getting-started.md),
  [`studio/starters/project.json.example`](studio/starters/project.json.example),
  and the per-project `secrets.env` convention.
- **Runtime-adapter `runtime.sdk` threading** — the resolved SDK id flows through
  to `getAdapter(sdkId)`, with Gemini/Aider conformance.

### Removed

- **Zep KB backend** — `orchestrator/kb-backends/` and `@getzep/zep-cloud`. The KB
  seam is now filesystem-only (`FilesystemKbBackend`).
- **graphify** — tooling, config, and generated artifacts.
- **`studio/projects.yaml`** project registry — replaced by disk auto-discovery.
- **ADRs 005, 014, 016, 023** — superseded/consolidated (023 → ADR 031).
- **forge-v2 / v1-vs-v2 framing** — the product is "Forge Studio".
- **Dead dependencies** — `blessed-contrib`, `globby`, `@getzep/zep-cloud`, `dagre`.

### Changed

- **KB simplified to filesystem-only.** The `KbBackend` seam stays; the second
  (Zep) implementation is gone.
- **ADRs consolidated to current state.**
- **Docs split into public (operators) vs internal (contributors).**

### Studio era (M7 consolidation + M8 seams)

This covers the **M7 consolidation** (Forge Studio became the one product)
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
- **`KbBackend` seam** ([ADR-027](docs/decisions/027-studio-object-model.md)).
  The brain's store sits behind a `KbBackend` interface dispatched from `kb.yaml`
  (`orchestrator/kb-backend.ts`). Filesystem-only today (`FilesystemKbBackend`); the
  seam is present for a future second backend.
- **Unifier as a first-class flow node.** `runUnifierPhase`
  (`orchestrator/phases/developer-loop.ts`) is now an independently-dispatchable
  flow node rather than logic buried inside the cycle runner.
- **Second implementation behind the runtime-adapter seam (subsumption proof)**
  ([ADR-032](docs/decisions/032-subsumption-proof.md)). The runtime seam resolves
  real drop-in alternatives, registered but **dependency- and credential-gated**
  (`available: false` until provisioned):
  - **Gemini** `RuntimeAdapter` — `loops/_adapters/gemini` (needs `@google/genai` + `GEMINI_API_KEY`).
  - **Aider** dev-loop `RuntimeAdapter` — `loops/_adapters/aider` (needs the Aider CLI + a model key).
  - Adapters are wired in `loops/_adapters/registry.ts` and surfaced in `studio/catalog.yaml`.

#### M7 — Studio consolidation (Forge Studio is the one product)

- **Forge Studio is the single product surface** ([ADR-031](docs/decisions/031-studio-consolidation.md)).
- **`forge studio` launches the operator UI** — a deterministic launcher; harnesses
  no longer scrape stdout to find the UI.
- **Native architect in Studio** — the architect interview and the PLAN gate were
  rebuilt natively inside Studio.
- **Unified `/artifact` viewer** — the `/review` and `/reflect` human moments now
  render on the single `/artifact` viewer ([ADR-020](docs/decisions/020-architect-in-ui.md)).
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

[Unreleased]: https://github.com/Parso/forge/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/Parso/forge/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Parso/forge/releases/tag/v0.1.0
[DEC-3]: docs/decisions/
