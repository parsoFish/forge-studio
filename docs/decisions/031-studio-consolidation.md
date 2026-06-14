# ADR 031 — Forge Studio is the one product (consolidation + productionisation)

- **Status:** accepted
- **Date:** 2026-06-14
- **Amends / completes:** [ADR 023](./023-ui-sole-operator-surface.md) (UI sole
  operator surface) — 023 made the UI the only *interaction* surface but left the
  pre-Studio `/dashboard`, the three moment-routes (`/architect`, `/review`,
  `/reflect`), and a CLI/bridge dual surface co-existing. This ADR collapses them
  into a single product. Touches [ADR 020](./020-architect-in-ui.md) (architect
  moves from its own screen into Studio) and [ADR 021](./021-local-review-and-unified-demo.md)
  (review/reflect fully fold into the unified `/artifact` viewer). Closes the
  `forge review --approve` deferral recorded at ADR 023 §"Still deferred".

## Context

The Forge Studio roadmap (M0–M6, ADRs 027–030) shipped to `main`: definitions as
data → run model + read UI → builders → flow engine → flow builder + unified
artifact viewer → KBs as objects → runtime adapters. But the build was a
strangler: the new Studio surfaces landed *alongside* the surfaces they were
replacing, deferring the rip-out. The result is **dual-surface debt**:

1. **Two UIs.** The pre-Studio `/dashboard` (its own `AgentGraphCanvas` /
   `HexDetailDrawer` / cycles-tab, ~2.6k LOC of components + lib) is still fully
   reachable next to the Studio library + per-flow monitor.
2. **Two operator APIs.** ~21 `forge` CLI subcommands, many now duplicated by
   bridge HTTP routes the UI already drives (`/api/scheduler/*`, `/api/runs`,
   `/api/verdict`).
3. **A brittle launcher.** `forge watch` spawns the bridge + `next dev`, scrapes
   stdout for ready-URLs, opens the browser on a hardcoded 2 s timer with no UI
   readiness probe.

The operator's direction: **Forge Studio (UI + bridge) is the one product.** Rip
out the legacy UI, consolidate the operator surface onto the bridge, and replace
the fragile launcher with a canonical, deterministic command.

## Decision

**1. `/dashboard` is deleted; the Studio per-flow monitor is the sole run view.**
The dashboard's cycle-monitoring invariants (≥5 phase nodes, unifier on its own
node, per-phase cost, work-item granularity, drawer open/close) are re-homed onto
`/flows/forge-cycle` (`FlowTopology` / `RunRail` / `PhaseDrawer`). The dashboard
page, its exclusive components (`AgentGraphCanvas`, `HexDetailDrawer`,
`ActivityPanel`, `FileHeatmap`, `ArchitectLauncher`, `SchedulerBanner`,
`CyclesTab`/`CycleCard`/`RoadmapTrack`/`ConnectionBadge`), and its exclusive lib
(`wi-status`, `wi-graph`, `live-activity`, `use-graph-model`, `use-batched-events`,
`hex-detail`) are removed. `phases.ts`, `dep-layout.ts`, `status-colors.ts` are
**kept** — they are Studio-shared.

**2. The cross-project roadmap view is dropped, not rebuilt.** The dashboard's
`[data-project-group]` cross-project pane has no Studio equivalent (Studio
monitors are per-flow). The Studio library (`/`) already lists flows / projects /
agents / KBs with live "needs-you" state; per-flow monitors cover cycle detail.
The cross-project roadmap is the one capability intentionally retired. The harness
`[data-project-group]` assertion is dropped with operator sign-off.

**3. The architect interview + PLAN gate is rebuilt inside Studio.** Rather than
keep `/architect/[sessionId]` as a standalone moment-screen, the interview and the
PLAN gate become native Studio surfaces: a library "new run / drop an idea" entry
→ interview panel → PLAN gate rendered through the unified `/artifact` viewer
(`PlanRenderer` already embeds `PlanGate`). The bridge is unchanged
(`/api/architect/{sessions,start,answer,file}`, `forge architect run` spawned per
turn). The architect-observability assertions (stale-session, free-text answer
override, activity panel, real architect cost) are preserved on the new surface.
`/review` and `/reflect` fully fold into `/artifact` (the wrappers redirect; the
live Studio "Open gate →" links repoint to `/artifact?...&mode=review`).

**4. The bridge is the operator API; the CLI keeps only the runtime spine.**
- **Removed** (the UI/bridge covers them): `start`, `stop`, `pause`, `resume`,
  `status` (the bridge `/api/scheduler/*` routes), and `review --approve` (the
  bridge `POST /api/verdict 'approve'`, a strict superset that also merges).
  `architect run` is internalised (bridge-spawned, hidden from `--help`).
- The bridge stops *spawning* `forge start` for `POST /api/scheduler/start`; it
  calls the shared daemon helpers (`daemonState` / `setPaused` / `daemonPaths` /
  pid-file) directly, removing the bridge→CLI coupling that previously blocked
  removal.
- `verify-cycle.mjs` migrates off `forge review --approve` onto the bridge
  verdict POST **before** the command is removed (this closes the ADR 023
  deferral).
- **Kept as the runtime spine** (no operator-UI equivalent, or recovery/CI only):
  `serve`, `cycle`, `enqueue`, `preflight`, `brain index|lint`, `studio lint`,
  `demo render|capture`, `log`, `review --inspect|--abandon`, `requeue`.

**5. `forge studio` replaces `forge watch` as the canonical launcher.** It brings
up the bridge + UI with **deterministic readiness**: poll the bridge
`GET /api/health` until ready, then the UI port, *then* open the browser and emit
a structured ready signal (a `forge-studio-ready {bridgeUrl,uiUrl}` line / a
`--ready-file`) so automation no longer scrapes log wording. The WSL2 multi-tool
port-takeover (`lsof`/`ss`/`fuser`) is retained. `forge watch` stays as a
deprecated alias for one milestone.

> **Amended (M8-E):** that one-milestone grace is over — the `forge watch`
> alias was removed. `forge studio` is the sole launcher; the bridge is the
> operator API.

## Consequences

- **One product to reason about, operate, and secure.** A single run view, a
  single operator API (the CSRF-/origin-/path-guarded bridge), one launch command.
- **~3.4k LOC of legacy UI removed** + ~6 redundant CLI commands; the bridge↔CLI
  coupling on the daemon lifecycle is severed.
- **One capability retired:** the cross-project roadmap pane. Accepted by the
  operator as not daily-driver; revisitable as a slim Studio-library strip if
  needed.
- **Architect rebuild is genuine feature work** (the one non-pure-consolidation
  item) — guarded by preserving the P1–P4 architect-observability assertions on
  the new surface and the full `ui:journey` regression run.
- **Safety ordering is load-bearing:** the e2e-journey harness migrates onto
  Studio selectors and stays green *before* any deletion — the green harness on
  the new surface is the proof the old surface is redundant.

## Alternatives considered

- **Keep `/architect` as a route reachable from Studio nav** (pure consolidation,
  zero feature work). Rejected by the operator in favour of a native Studio
  surface — one product, not "Studio plus a bolted-on moment screen."
- **Conservative CLI (keep lifecycle commands as thin bridge-coupled wrappers).**
  Rejected: full removal + bridge-calls-helpers-directly is the cleaner end-state
  and the operator wants the CLI minimal.
- **Rebuild the cross-project roadmap in Studio.** Deferred — not daily-driver;
  rebuilding now would be speculative feature work in a consolidation pass.
- **Harden `forge watch` in place (same name).** Rejected: a new `forge studio`
  name signals the "Studio is the product" shift; `watch` kept as a one-milestone
  deprecated alias.
