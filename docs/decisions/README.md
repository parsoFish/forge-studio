# Architecture Decision Records

One ADR per load-bearing choice. If a change conflicts with an ADR, **update
the ADR first** (with rationale) before changing the code. New definitions
land through the canonical serializer rule (ADR 027); new ADRs take the next
number (next free: **039**).

## Active

| # | Title | Role today |
|---|---|---|
| [001](./001-claude-agent-sdk.md) | Claude Agent SDK as the agent runtime | The reference runtime adapter (ADR 029) |
| [002](./002-ralph-loop-pattern.md) | Ralph loop pattern | The loop-node execution primitive (ADR 028) |
| [003](./003-skills-not-self-baked-agents.md) | All agents are Claude Code skills | Realised by ADR 024 / 027 |
| [004](./004-obsidian-wiki.md) | Karpathy three-layer wiki brain | The KB substrate (ADR 018 is the structure authority) |
| [006](./006-gh-cli-and-worktrees.md) | gh CLI + git worktrees + Actions | In force |
| [007](./007-markdown-artifact-flow.md) | Markdown artifacts phase-to-phase | The edge contract of flows; holds phase isolation |
| [008](./008-jsonl-event-log.md) | JSONL event log per cycle | The run-model source of truth (`phase` widens to node id) |
| [009](./009-minimal-config.md) | Minimal forge.config.json | In force |
| [010](./010-brain-first.md) | Brain-read policy (planners read, executors don't) | The per-agent `brainAccess` field (ADR 027) |
| [011](./011-unattended-scheduler.md) | Unattended scheduler + file queue | Serves flow runs (ADR 028) |
| [012](./012-crash-recovery.md) | Crash recovery (heartbeat + atomic claim) | In force |
| [013](./013-notifications.md) | Notifications | Drives flow gate events |
| [015](./015-work-item-format.md) | Work-item schema + `_graph.md` | The fanOut artifact contract (ADR 028) |
| [017](./017-forge-project-contract.md) | forge↔project contract (preflight) | The claim-time gate for flow runs |
| [018](./018-three-brain-model.md) | Three-brain structural model | Maps onto the KB scopes (ADR 027) |
| [019](./019-cycle-resume-from-unifier.md) | Resume-from-phase | The contract `resumable` node flags (ADR 028) |
| [020](./020-architect-in-ui.md) | Architect in the UI (file-checkpointed runner) | The seed-flow gate; spec from the agent definition |
| [021](./021-local-review-and-unified-demo.md) | In-UI review + structured demo | The unified artifact viewer |
| [022](./022-real-capability-harness.md) | Real-capability regression harness | The cutover oracle for ADR 028 |
| [024](./024-phases-as-subagents-invoking-skills.md) | Phases are agents composing skills | The foundation of ADR 027/028 |
| [025](./025-live-observability.md) | Live cost/tokens via SDK stream | Adapter-uniform under ADR 029 |
| [026](./026-review-unifier-wi-list.md) | Review feedback as unifier WIs (one cycle) | The general gate send-back |
| [027](./027-studio-object-model.md) | Studio object model: definitions as data | The object-model authority |
| [028](./028-flow-engine.md) | Definition-driven flow engine | The flow execution engine |
| [029](./029-runtime-adapters.md) | Runtime adapter seam (multi-SDK) | The runtime swap seam |
| [030](./030-canvas-tech.md) | Flow-canvas library choice | The flow-canvas tech |
| [031](./031-studio-consolidation.md) | Studio is the one product (rip-out + productionise) | The sole-product + sole-operator-surface decision (folds the former ADR 023) |
| [032](./032-subsumption-proof.md) | Runtime-adapter swap surface | The as-built record of the runtime seam |
| [033](./033-studio-first-flow-ux.md) | Studio first-flow UX (install → first flow) | The first-flow UX |
| [034](./034-studio-aligned-contract.md) | Studio-aligned project contract (unified readiness + artifactRoot) | The unified project contract |
| [035](./035-forge-owned-central-artifacts.md) | Brain 3 lives in the forge repo (forge-owned central artifacts) | Where per-project knowledge lives |
| [036](./036-orchestrator-owned-gate-execution.md) | Orchestrator-owned gate execution (gates + demo capture run by forge, timeout = environment failure) | The anti-fabrication execution model |
| [037](./037-compiled-wi-contracts.md) | Compiled work-item contracts (wi-spec-compiler) | Proposed — deterministic-first compiler stage at the PM seam, closing ADR 010's brain-encoding gap |
| [038](./038-north-star-platform-and-ootb.md) | North-star reframe: platform (Scope 1) vs. shipped ideas machine (Scope 2 OOTB) | The mission statement every orientation doc points at |

## Retired / folded (numbers stay reserved)

| # | Was | Where the surviving intent lives |
|---|---|---|
| 005 | Phase isolation with per-phase benchmarks | Isolation principle: ADR 007/008. Quality gate: ADR 022 (which records the absorption). Bench history: `brain/_raw/docs/adr-005-phase-isolation.docs.md` |
| 014 | Project `roadmap.md` schema | Superseded 2026-06-03 — the roadmap is a derived view of `_queue/` manifests + `depends_on_initiatives`; nothing writes the old format |
| 016 | Demo recording tooling (VHS/Playwright) | ADR 021 status block + `skills/demo/SKILL.md` |
| 023 | UI is the sole operator surface | Folded into [ADR 031](./031-studio-consolidation.md) "Surviving principle" — the UI/bridge is the sole operator interaction surface, each human moment explicit + impossible to auto-satisfy |
