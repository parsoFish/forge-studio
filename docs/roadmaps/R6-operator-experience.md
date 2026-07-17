# R6 — Operator experience & observability

> Mission: the Studio operator surface as a **platform** — information
> architecture, the DOM-as-metrics convention, and observability of running
> work (what is forge doing, is it healthy, where is my attention needed) —
> distinct from feature-owned UI changes, which stay with their owning
> initiatives under the journey-sync contract. Scope: `docs/repo-map.md`
> Scope 1 (`forge-ui/`, the bridge read surfaces, event/log presentation).
> Minted 2026-07-17 by the coverage review: ADR-031 made Studio THE product,
> but no roadmap owned the UI pillar itself — R4-11 owns *this round's*
> roadmap-surface work; R6 owns the pillar going forward.

**Status vocabulary:** implemented | in-progress | planned | deferred. All
initiatives in this file are planned/deferred as of 2026-07-17. **Unwaved** —
R6 items are opportunistic until the operator prioritizes them against the
R1–R5 driving order (index §4).

## As-built baseline (implemented)

### R6-B1 Route inventory + DOM-as-metrics convention
Every load-bearing UI state mirrors to `data-*` attributes (per-route
inventory in `CLAUDE.md`'s forge-ui section; pattern from anthropics
cwc-workshops). The convention is load-bearing: journeys drive the page by
structured DOM state, and any UI change must sync its journey in the same PR
(`journey-sync` skill).

### R6-B2 Status vocabularies, one palette
Pipeline/WI 5-state + `RunStatus` + roadmap statuses share
`forge-ui/lib/status-colors.ts` (`STATUS_COLOR`/`WI_STATUS_GLOW`) — colour
semantics change in exactly one place (yellow = retrying/transient, red =
terminal only; operator feedback 2026-05-30 honored). R4-11-F1 extends this
table with `merged`.

### R6-B3 Run observability (as-is)
Flow monitor hex topology (`FlowTopology.tsx`: `data-mon-node`,
`data-status`, `data-phase-cost-usd`, `data-wi-cost-usd`, fanout aggregates);
JSONL event log (`_logs/<cycleId>/events.jsonl`, ADR-008) with run model
derived never stored; ADR-025 live observability (hook-emission +
`/hook-events` channel DEFERRED there). Known soft spots (operator notes,
unresolved): the hex detail drawer shows no streaming logs (known-gaps
§4b.14 covers the *harness* side only); the 2026-05-30 activity-view rework
note ("floating callouts don't fade, render behind hexes — essentially
unusable") has no recorded resolution across two UI rebuilds; no durable
platform monitor exists (betterado-run lesson: "a cost-ceiling stop sat 8.4h
unnoticed before the heartbeat poll loop existed" — monitors were per-session
rebuilds).

### R6-B4 Operator affordances (as-is)
Attention signalling is per-surface (gates at `/artifact`, stuck initiatives
at `/recovery` until R4-11-F3 folds it in); R4-11-F4 ships the cross-project
attention strip; architect re-run lands as R4-11-F5. Raw `events.jsonl` is
the only mid-cycle log surface — "painful mid-cycle" (standing
iteration-refinement target 1).

## Planned initiatives

### R6-01 Run-observability depth
- **Status:** planned  ·  **Wave:** unsequenced (operator to prioritize)
- **Depends on:** —
- **Context:** The three recorded observability gaps in R6-B3: silent hex
  drawers, the unresolved activity-view rework, and no durable health
  monitor. Sources: known-gaps §4b.14 (UI half); memory
  `feedback_forge_ui_activity_view` (2026-05-30, verify against current
  Studio before building — two rebuilds since); memory
  `project_betterado_roadmap_execution` (durable-monitor lesson); memory
  `project_architect_observability` (live log/output tracking, crash/stderr/
  liveness visibility). ADR-025's deferred hook-emission unification is the
  natural substrate if this initiative needs richer event granularity —
  consult it before adding new emission paths.
- **Features:**
  - **R6-01-F1 Live log streaming in the hex drawer.** Phase/WI drawer
    streams recent event-log lines (and agent stderr where captured) for the
    selected node. ACs: drawer shows real lines mid-cycle; `data-*` contract
    added; journey beat (feeds the §4b.14 clip).
  - **R6-01-F2 Health/liveness surface.** A durable in-Studio health strip
    for the daemon + in-flight runs: heartbeat freshness, stall/wedge
    warnings, cost-ceiling stops surfaced the moment they happen (never
    8.4h-unnoticed again). Verify-first: check what today's Studio already
    shows before building (the 2026-05-30 notes predate two rebuilds). ACs:
    a seeded stalled run surfaces a warning within one poll interval;
    ceiling-stop events render as attention items (R4-11-F4 strip
    integration).
  - **R6-01-F3 Activity-view verdict.** Audit the current activity/tool-use
    presentation against the 2026-05-30 complaints; fix or formally retire
    the surface (one decision, recorded — no zombie tab). ACs: dated
    disposition in this file's change log + the surface matches it.
- **Session sizing:** ~2 sessions (F1; F2+F3).
- **Out of scope:** cost *integrity* (R5-03); harness clip content (R5-06);
  event emission architecture changes (ADR-025's deferred items get their own
  revisit if F1/F2 need them).

### R6-02 Human-readable operations
- **Status:** planned  ·  **Wave:** unsequenced (small; opportunistic)
- **Depends on:** —
- **Context:** Standing iteration-refinement targets 1–2 (memory, 2026-05-23
  — "apply opportunistically, smallest intervention wins, never sub-systems"),
  relocated here from R5-06-F5 as operator-facing operability (R5-06 keeps
  the harness/demo half; cross-referenced there).
- **Features:**
  - **R6-02-F1 Readable logs.** Pair event types with pretty formatter lines
    (`pino-pretty` or equivalent); `forge log <id> --pretty` (or the Studio
    drawer, if R6-01-F1 makes the CLI form moot — decide, don't build both).
    ACs: a mid-cycle log is scannable without jq.
  - **R6-02-F2 Initiative-handle ergonomics.** Handles (`bett#1`) flow to log
    paths: symlink `_logs/<handle>/ → _logs/<cycleId>/` at cycle start. ACs:
    handle-addressed logs resolve.
- **Session sizing:** ≤1 session; ride alongside any orchestrator-adjacent work.
- **Out of scope:** PLAN.html richness (stays R5-06-F5 — it's a fixture/
  artifact concern feeding R2-05's dynamic surfaces).

### R6-03 IA & convention stewardship
- **Status:** planned  ·  **Wave:** unsequenced
- **Depends on:** — (grows as R3/R4 add surfaces)
- **Context:** The set adds routes and pillars (skills library R3-01-F3, KB
  scope chips R1-01, merged states R4-11) — the conventions that keep Studio
  coherent need an owner: the DOM-as-metrics contract, the status-vocabulary
  data table, navigation as the surface count grows, and dead-path hygiene
  cadence (`npm run ui:deadpaths`).
- **Features:**
  - **R6-03-F1 DOM-convention contract doc.** The CLAUDE.md route inventory
    becomes a maintained contract page (per-route `data-*` registry) that
    journey-sync consumes — one place a new surface registers its states.
    ACs: every route in the inventory; journey-sync skill points at it.
  - **R6-03-F2 Navigation/IA pass.** Once R3/R4 surfaces land: library
    pillar ordering, cross-linking (roadmap ↔ artifact ↔ KB), and a
    dead-path sweep gate in CI cadence. ACs: deadpaths green in CI; IA
    decisions recorded here.
- **Session sizing:** ~1 session + ongoing stewardship.
- **Out of scope:** feature UI (owned by feature initiatives + journey-sync).

## Deferred

### R6-D1 Notification transport beyond the in-Studio blade
Email/push/webhook-out notifications. **Deliberately not built** (R4-11's
out-of-scope: "no email/push — YAGNI until asked"). **Re-entry condition:**
the operator asks for out-of-Studio signalling after living with the
R4-11-F4 attention strip during real multi-project operation.

## Change log

- 2026-07-17 — Roadmap minted by the coverage review (operator request:
  align the set to the whole architecture; `forge-ui/`-as-pillar had no
  owner). Seeded exclusively from recorded material: known-gaps §4b.14,
  activity-view + architect-observability + durable-monitor memory notes,
  iteration-refinement targets 1–2 (relocated from R5-06-F5 with cross-ref).
  Unwaved pending operator prioritization.
