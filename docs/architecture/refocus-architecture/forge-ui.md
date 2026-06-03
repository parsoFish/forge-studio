# Forge UI

> **Intent.** The **single operator interaction surface** (ADR 023). Two *conceptual* page
> types: a **monitoring dashboard** and an **interactive-moment** family (architect, review,
> reflect) that share chrome. The dashboard carries idea submission, a per-project
> **roadmap-timeline view** (the dependency chain of planned initiatives), and a live,
> space-aware **hex view** of the selected initiative hooked into live agent tool usage;
> every hex is clickable for refined detail + a full activity log.
>
> **Type:** operator surface. **Realized via:** a Next.js app launched by `forge watch`,
> talking to a Node **bridge** ([cli/ui-bridge.ts](cli/ui-bridge.ts)) over HTTP+WS that
> surfaces forge's filesystem artifacts and writes the handoff files the phases consume.

## Responsibilities

- Be the only place the operator works: submit ideas, answer the architect interview,
  approve/revise the PLAN gate, approve/send-back review, answer reflection — all in-UI.
- Visualise the per-project roadmap (topological dependency spine) and the **live hex
  pipeline** (phase → feature → WI hexes with status/cost/tokens, tool bursts, reasoning
  bubbles) from the event stream; drill into any hex for definition + scoped activity log.
- Drive scheduler lifecycle (start/pause/resume/stop) from the dashboard.
- Mirror every load-bearing state to `data-*` attributes (**DOM-as-metrics**) so headless
  automation drives the page by structured state, not scraped text.

## Inputs → Outputs

**Consumes (via bridge):** `_logs/<id>/events.jsonl`, the `_queue/` manifests + heartbeats,
WI snapshots, phase artifacts (PLAN.html, demo.json), architect session state.
**Produces (via bridge):** architect handoff writes, the review verdict, reflection
feedback, scheduler process control. **Hard boundary:** forge-ui cannot import orchestrator
code — the bridge is the only runtime channel.

## Relationships

- **Operator ↔ UI ↔ bridge ↔ files ↔ phases** — the UI never calls a phase directly; it
  reads artifacts and writes handoff files the phases already consume.
- Hosts the three human moments ([Architect](docs/architecture/refocus-architecture/Architect.md), [Review](docs/architecture/refocus-architecture/Review-Loop.md),
  [Reflection](docs/architecture/refocus-architecture/Reflection.md)) as distinct screens sharing `ScreenShell`/`MomentHex`.

## Boundaries (what this is NOT)

- **Not one literal template** — N concrete screens that share chrome (ADR 023 kept).
  "Two page types" is conceptual (monitor + interactive), not a single parameterized form.
- Not a second source of orchestration truth — it renders artifacts; it does not own state.

## Divergences to resolve → [backlog](docs/architecture/refocus-architecture/REFINEMENT-BACKLOG.md)

- **[UI-1 · med]** Dead code: `ActivityPanel`'s full-tab chip-bar mode is unreachable
  (only the scoped-hex form is used) — ~130+ lines + the `selectedWiId` prop. Cull.
- **[UI-2 · med]** The **bridge has outgrown "read-only artefact surface"** (1137 lines: spawns
  architect turns, reruns the reflector, controls the daemon, writes verdicts). Either accept
  + re-document its scope, or move orchestration concerns back into `orchestrator/` and keep
  the bridge thin.
- **[UI-3 · med]** Three hand-maintained **mirrors of orchestrator logic** (`dep-layout.ts`
  byte-copies `dep-levels.ts`; `phases.ts` + `hex-detail.ts` re-implement phase routing
  twice). Extract a shared pure-TS module to kill the sync-drift risk.
- **[UI-4 · low]** `AgentGraphCanvas` (726 lines) hand-rolls Kahn sort + burst trig + hex
  SVG on top of ReactFlow — lean on the library / a shared topo helper. Stale comments
  ("hand-rolled hex `<canvas>`", `EventTail`, bridge "read-only M2-A") mislead readers.
- **[UI-5 · low]** Roadmap is per-project groups, not the single **cross-project** timeline
  the intent describes, and not-yet-queued architect sessions show only in the launcher,
  not on the roadmap. Decide whether to unify.
