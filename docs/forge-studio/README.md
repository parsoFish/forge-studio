# Forge Studio — Master Plan

> From today's single hardcoded six-phase cycle to a modular agent flow builder:
> Projects, Agents, Flows, Knowledge Bases as first-class composable objects.
> The mocks at [`mockups/agent-flow-builder/`](../../mockups/agent-flow-builder/)
> are the product spec; this plan works backwards from them to a polished,
> production-ready system without ever breaking the forge that ships betterADO
> cycles today.

**Status:** PROPOSED 2026-06-13 · grounded in the full mock inventory, the
as-built capability map, and a Brain 1+2 read (planner brain-first, ADR-010).

## Reading order

| Doc | What it holds |
|---|---|
| [`gap-matrix.md`](./gap-matrix.md) | Every piece of functionality in the 6 mock pages, mapped to one of three categories: **EXISTS** (implemented + production-proven), **MODIFY** (exists, must generalise), **NEW** (does not exist). This is the completeness contract — if a mock feature isn't in the matrix, the plan missed it. |
| [`architecture.md`](./architecture.md) | Target architecture: object model, storage, flow engine, run model, API surface, UI shell, runtime adapters. Designed against duplication/bloat — every Studio object is a thin declarative layer over a mechanism forge already proved. |
| [`roadmap.md`](./roadmap.md) | Phased milestones M0–M6 with workstreams, exit criteria, and the regression gate each milestone must pass. Strangler pattern: the forge cycle keeps running through every milestone. |

## The one-paragraph thesis

Forge today is **one flow definition compiled by hand into TypeScript**
(`orchestrator/cycle.ts`). Everything underneath it — Ralph loops,
orchestrator-verified gates, the queue state machine, worktree isolation, JSONL
events, human gates, the three-layer brain, the demo contract, the WS bridge —
is production-proven and *already generic in shape*. Studio does not rebuild
any of that. It adds the missing meta-layer: **definitions as data** (agents,
flows, projects, KBs as markdown/YAML files), **a flow engine** that interprets
those definitions instead of hardcoding one, **builder UIs** ported from the
mocks into forge-ui, and **registries/CRUD** over the bridge. The forge cycle
becomes seed data — the first flow in the library — and `verify-cycle` becomes
the oracle proving the engine reproduces it exactly.

## Non-negotiables inherited from the brain (bind every milestone)

1. **Human gates are structural, not configurable.** Exactly the gates a flow
   declares; no auto-approve path can exist in production code
   (v1 review-spin: 70+ iterations, $200+). A flow with zero human gates is
   rejected at save unless flagged `disposable`.
2. **The orchestrator verifies gates; agents cannot self-certify.** Every flow
   edge that transitions on agent say-so is unsafe by construction.
3. **Quality gates must assert NEW work** (no iter-0 hollow pass, no
   exit-0-with-no-tests false pass).
4. **Studio never self-modifies while running.** Flow definitions are locked
   while a run of that flow is in flight; edits create a new version.
5. **Resume-don't-discard.** Every flow has resumable phase boundaries;
   partial work survives failure.
6. **Done ≠ merged.** Flow completion state is distinct from outcome
   confirmation; outcome requires external verification.
7. **One canonical YAML writer** (`serializeManifest` pattern) for every new
   definition format — no raw-regex frontmatter editors.
8. **Iteration/time budgets are first-class fields on every agent node**, and
   the 33h-wedge gap closes: heartbeat-without-tool-progress beyond a
   configurable ceiling kills the node.
9. **Cost-aware model routing per agent** (declared tier, never a global
   default); rate-limit `resetsAt` gates all spawns.
10. **Every run is origin-tagged** (`architect | human-directed`) so autonomy
    metrics stay answerable.
11. **Brain-read policy is per-agent and explicit** (`mandatory | advisory |
    none`) — the mock's knowledge-access setting is exactly today's ADR-010
    policy, promoted to a field.
12. **Battle-tested tools over hand-rolling** (PRINCIPLES.md): the flow canvas,
    force graph, and any new infra prefer adopted libraries; ADRs 011–013 hold.

## What stays true throughout

- `npm test`, `forge brain lint`, `npm run ui:journey` green at every merge.
- `npm run verify:cycle` (operator-gated, real $) passes at every milestone
  that touches the execution path (M3 mandatory, M5/M6 if they touch runtime).
- ADR-first: each milestone's load-bearing choices land as ADRs before code
  (ADR-027 object model, ADR-028 flow engine, ADR-029 runtime adapters —
  drafted inside the milestones that need them).
- One concern per PR; initiatives sized as large bundles (feature + tests),
  decomposed by the existing architect→PM machinery where forge builds itself.
