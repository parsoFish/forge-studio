# Repository map — the three scopes

> Forge's tree is organised around **three scopes**. Knowing which scope a path is in
> tells you the rule that governs changes there. This is the contributor's orientation
> map; the deeper narrative is [ARCHITECTURE.md](../ARCHITECTURE.md). The same grouping
> is machine-readable in [`.github/CODEOWNERS`](../.github/CODEOWNERS).

Forge separates three concerns so effort lands in the right place and one never leaks
into another.

## Scope 1 — Framework / seams / orchestration (the hot path)

The engine that runs **any agentic flow** — the example develop factory (Scope 2 OOTB)
is one instance of it, SWE-focused for now by explicit operator choice (2026-07-17,
[ADR 038](./decisions/038-north-star-platform-and-ootb.md)). **Rule: never special-case a
particular project or a specific cycle-agent here.** Cross-scope concerns belong here.

| Path | What lives here |
|---|---|
| `packages/contracts/` | Shared types only — the bottom of the allow-graph |
| `packages/kernel/` | HTTP envelope, ids, the dry-bridge gate, logger, config, route entries — what every package may reach |
| `packages/library/` · `packages/knowledge/` · `packages/projects/` | The objects a factory is built from · the Brain (Knowledge outward, the three scoped graphs, `KbBackend`) · the project seam and its contract preflight |
| `packages/agents/` | Runs **one agent** under a pinned SDK seam; the runtime-adapter registry (`packages/agents/_adapters/`) |
| `packages/sessions/` | The ADR 043 interactive spine — session kinds, turnSpec, transcript, lifecycle, finalizers |
| `packages/flows/` | Runs **one flow** — walks a `FlowDefinition` node by node; runs, recovery, hooks, review loops |
| `packages/factory/` | The shipped develop factory — phase executors and their deps seam |
| `apps/forge/` | The **assembly**: the `forge` CLI entry, the UI bridge and its route tables, and every assembly-side binding (dry-bridge route classification, session-kind and authoring-port deps) |
| `apps/studio/` | Forge Studio — the Next.js operator UI (launched by `forge studio`); imports `contracts` only |
| `orchestrator/` | Legacy residue still being quarried (`phases/`, `studio/validate.ts`, spawn-capture fixtures) — no package may import it |
| `bin/`, `scripts/` | Entry point + build / test / harness tooling, including the `check-*.mjs` guards CI runs |

Allow-graph (enforced by `scripts/check-boundaries.mjs` against `scripts/baselines/boundaries.json`):
`contracts ← kernel ← {library, knowledge, projects} ← agents ← sessions ← flows ← factory ← apps/{forge, studio}`.
A lower-rank package never imports a higher one; what a package needs from above arrives by
injection at `apps/forge`. Per-package production-line caps are ratified in [`QUARRY.md`](../QUARRY.md)
and enforced by `scripts/check-package-caps.mjs`.

## Scope 2 — Cycles / agents / flows (OOTB + authoring new ones)

The composable content the framework runs — as **data**, not code. **Rule: never assume
a particular managed project.**

| Path | What lives here |
|---|---|
| `skills/` | Claude Code skills — the agent surface (all phase agents) |
| `studio/` | Studio **definitions** as data — flows, agents, catalog, KBs, starters |
| `brain/forge-dev/` | Brain 1 — forge engineering knowledge |
| `brain/cycles/` | Brain 2 — cross-cycle patterns + archives |

## Scope 3 — Projects forge develops

The managed projects and their per-project knowledge. **Rule: respect the forge↔project
contract; never edit `packages/`, `apps/` or `orchestrator/` from here.**

| Path | What lives here |
|---|---|
| `projects/` | Managed projects (gitignored; auto-discovered by `.forge/project.json`) |
| `brain/projects/<name>/` | Brain 3 — per-project themes (forge-owned central, [ADR 035](./decisions/035-forge-owned-central-artifacts.md)) |
| `docs/forge-project-contract.md` | The contract every managed repo must satisfy (SSOT) |
| `skills/forge-onboard-project/` | The skill that brings a project up to the contract |

## Cross-cutting (not a scope)

| Path | What lives here |
|---|---|
| `docs/` | Documentation — this map, ADRs, phase docs, guides |
| `_queue/`, `_logs/` | Runtime state (contents gitignored) |

## The cross-scope rule (one sentence)

**The framework (Scope 1) never special-cases a project or a specific cycle-agent;
cycle/agent content (Scope 2) never assumes a particular project; projects (Scope 3)
respect the contract and never reach into the framework.** The clean seam between
Scope 1 and Scope 2 is the `PhaseAgentSpec` harness-overlay injection point; the seam
between Scope 1 and Scope 3 is the forge↔project contract.

Every scope directory carries a `README.md` header restating its scope and rule. Start
there, then read [ARCHITECTURE.md](../ARCHITECTURE.md).
