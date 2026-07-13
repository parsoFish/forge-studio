# Repository map — the three scopes

> Forge's tree is organised around **three scopes**. Knowing which scope a path is in
> tells you the rule that governs changes there. This is the contributor's orientation
> map; the deeper narrative is [ARCHITECTURE.md](../ARCHITECTURE.md). The same grouping
> is machine-readable in [`.github/CODEOWNERS`](../.github/CODEOWNERS).

Forge separates three concerns so effort lands in the right place and one never leaks
into another.

## Scope 1 — Framework / seams / orchestration (the hot path)

The engine that runs any cycle for any project. **Rule: never special-case a particular
project or a specific cycle-agent here.** Cross-scope concerns belong here.

| Path | What lives here |
|---|---|
| `orchestrator/` | Scheduler, cycle runner, flow engine, KB-backend seam, logging |
| `orchestrator/studio/` | Studio **engine** code (definition loading, lint, registry) — not the definitions |
| `cli/` | Operator utilities, `forge` subcommand handlers, the UI bridge |
| `loops/` (+ `loops/_adapters/`) | Agentic loop runtimes + the runtime-adapter seam |
| `forge-ui/` | Forge Studio — the Next.js operator UI (launched by `forge studio`) |
| `bin/`, `scripts/` | Entry point + build / test / harness tooling |

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
contract; never edit `orchestrator`/`cli`/`loops` from here.**

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
