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

### R6-B5 Agent kickoff panel + standalone run view (R6-04, 2026-08-07)

Four work items closed R6-04's three features. **Materials upload (WI-1,
F2):** `POST /api/agents/:slug/run` accepts `materials: [{filename,
contentBase64}]`; the kind is derived SERVER-side against
`MATERIAL_EXTENSION_TO_KIND` (`orchestrator/studio/materials.ts`) — a
client-supplied kind is never read — and gated against the target agent's
declared `materials:` (`agentAcceptsMaterial`, R2-B11's previously-uncalled
gate — this is its first production caller). Accepted uploads stage under
`_logs/<runId>/materials/` (`cli/materials-staging.ts`, guarded via
`resolveGuardedPath`, check-then-write with zero partial writes on refusal)
and are recorded on the run's own event log as REFERENCES only
(`{path, kind}`, the `agent-run.materials-staged` log event) — contents are
never logged, never rendered, never round-tripped back through any read
surface. **Per-kickoff cost ceiling (WI-2, F2):** `costCeilingUsd` threads
to the SDK's own `maxBudgetUsd` (`orchestrator/run-agent.ts`) — forge does
not enforce it in-process itself. **Enforced ONLY for `loopStrategy:
'one-shot'` agents** (4 of 19 real dispatchable roster agents today:
project-manager, reflector, adversarial-review, demo-agent) and **REFUSED**
(400, three ordered stages — shape, then enforceability, then bounds — before
a runId is ever minted) for every other agent; `costCeilingEnforceable`
(`orchestrator/studio/derive.ts` `agentCapabilityDescriptor()`) is the
server-computed fact both the route and the UI key off, never a client
guess. **Kickoff panel (WI-3, F1+F2 shell):** the existing
`[data-section="agent-run"]` panel (`RunPanel.tsx`) expands IN PLACE — a
real project `<select>` (was free text), the materials-attach section
scoped to the agent's own declared kinds, and an editable ceiling that
disables + explains itself when unenforceable — all nine pre-existing
`data-*` attributes byte-preserved. **F1's interactive-agent routing**
(`SESSION_ENTRY_HREF_BY_SLUG`, `app/agents/[id]/page.tsx`) is built and
unit-pinned but **not demonstrated end-to-end**: zero agents in the live
roster are `surface: interactive` with a real, reachable session-entry
route today (architect itself resolves via a different, pre-existing gate
table, not this mechanism). **R6-04-F2's standing-triggers listing
(R2-08-F4) is NOT shipped** — parked pending that initiative's own read
API. **Standalone run view (WI-4, F3):** new route
`/agents/[id]/run/[runId]`; a shared `RunLog` renderer
(`components/studio/RunLog.tsx`, deliberately reusable for a future
per-node flow log, R6-01-F5) maps the real 11-member `EventType` union onto
a `think | tool | out` display vocabulary; materials render as
path+kind references only (structurally — the component destructures
nothing else); a typed-outputs section renders — **honestly always empty
today**, since no data source exists yet for a generic dispatched agent's
artifact outputs (out of scope for this initiative, tracked as future
work). A runId with no `_logs/<runId>` directory at all (never dispatched)
404s rather than fabricating a `running` state (D22). Journey coverage:
`scripts/journeys/agents.mjs`'s `agents-kickoff-*` arc (8 beats) is the
only proof of the kickoff panel's dispatch wiring and the run view's fetch
wiring — no jsdom in this repo, so no unit test can exercise either click
path — covering the disabled/annotated ceiling on a non-enforceable agent,
an out-of-contract material refused naming the declared kinds, the actual
dispatch request intercepted at the wire (project/ceiling/material) and
cross-checked against the staged file on disk, and the run view rendering
log lines / cost / a material reference while never leaking the material's
real content, checked in both the DOM and the raw API response.
`scripts/e2e-deadpaths.mjs` covers the new route's honest 404 path with an
unknown runId.

### R6-B6 Run-observability depth: live drawer, run-detail page, per-node logs (R6-01 F1+F4+F5, 2026-08-07)

**Partial absorption** — R6-01's F1, F4 and F5 landed in wave 5 batch C; F2
(health/liveness strip) and F3 (activity-view verdict) remain `planned`, so
the initiative entry stays open and this baseline covers only what shipped.

**F1 — the hex drawer's phase log is genuinely live.** `RunPhaseMeta` gains an
additive `lastEventAt`, derived in `orchestrator/run-model-derive.ts` over
EVERY event attributed by the existing `eventToNodeId` — unlike
`lastProgressAt`, which is filtered to `PROGRESS_EVENT_TYPES` and so excludes
**7 of the 11** real `EventType` members. A node narrating only via
`log`/`error` never re-fired the drawer's fetch before this. The client
collapses to `phaseLogRefreshSignal(run, nodeId)`
(`forge-ui/lib/phase-log-refresh.ts`) reading that server-attributed field —
the attribution is NOT re-derived client-side, because only 4 of 12 phase
strings equal their node id. **No new emission path**: the existing 200ms
`events.jsonl` poll-tail + WebSocket broadcast (`cli/ui-bridge.ts`) carries
it, so ADR-025's deferred items stay deferred. A same-render terminal
transition no longer drops a node's final line (its `end`, or for a failed
node its `error` — the one line that says why it failed).

**F4 — `/flows/[id]/run/[runId]`, the run-detail page**, live AND archived
(both flow through the same `listRuns` path; `findRun` IS
`listRuns(...).find(...)`). One timeline row per FLOW-DEFINITION node in
`flow.yaml` order — including gate-only nodes and nodes that never ran —
with per-node status, cost, derived note and honestly-empty artifacts;
trigger provenance on R2-08-F4's reserved vocabulary; findings through the
existing `ReviewFindingsPanel`. Reachable from a `RunRail` row's
`[data-action="open-run-detail"]` anchor. **Derived from the event log,
nothing stored** (ADR-008) — pinned by a test proving two reads create no
file. `parseRun` now carries `run.trigger` instead of silently dropping it at
the last client hop.

**F5 — per-node line-level logs** through the **shared** `RunLog` +
`deriveLogLine` (`think|tool|out`) that `/agents/[id]/run/[runId]` already
uses — one component, two surfaces, extended at the INPUT. That required an
additive **`raw=1`** mode on `GET /api/runs/<id>/phases/<node>/log`
(mirroring its own `stderr=1` convention): the classified response computes
the drawer's separate 6-kind vocabulary server-side and drops the raw
`event_type` that `deriveLogLine` needs. `PhaseDrawer` never passes `raw=1`
and its contract is unchanged, guarded by a regression test.

**Rider:** R6-04's parked WI-6 — the read-only standing-triggers list on the
agent kickoff panel (`RunPanel.tsx`) from `GET /api/triggers` — landed here,
attaching the `[data-standing-trigger]` half of R2-08-F4's reserved
vocabulary. Verified against the live roster rather than assumed: exactly one
real agent (`reflector`, via `forge-develop`'s `on: merged` trigger) is
targeted today, so the surface populates for a real agent and honestly empties
for every other.

**Honest gaps, deliberately shipped as such** (each with no producer behind
it, so rendering one would assert a fact the system cannot know): per-finding
`state` is NOT rendered (`ReviewFinding` has no such field); per-node
artifacts and typed outputs are **always empty** (`artifactsReady` is
run-level and keyed by artifact TYPE); per-node cost undercounts the architect
phase **by construction** (it logs `cost_usd: 0` on completion). R2-05-F2's
composed-output slice was **measured and deferred**, not skipped: no
`composed` artifact kind exists, 7/7 on-disk templates are `file`/`git-state`,
`AgentDefinition` has no output-surface field, and 0/10 real agents declare
one. Journey coverage: `scripts/journeys/flows-run.mjs`'s
`flows-run-detail-reachable` (reachability + the full destination contract +
node expand/collapse) and the extended `flows-run-drawer-live-tail`, plus a
`scripts/e2e-deadpaths.mjs` route for the flow run-detail 404 path.

## Planned initiatives

### R6-01 Run-observability depth

- **Status:** **implemented (F1+F4+F5, 2026-08-07, wave 5 batch C — see
  baseline R6-B6)**; **F2+F3 remain `planned`** (unsequenced — a health/
  liveness strip and the activity-view verdict, neither in batch C's scope)
  ·  **Wave:** unsequenced pre-wave-5; **F1+F4+F5 = wave 5, batch C (module:
  flow-run-detail)** — F1 pulled in as F5's hard precursor (same emission
  substrate); F2/F3 stay unsequenced
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
- **Wave-5 amendment (2026-08-03, module: flow-run-detail).** The
  studio-endstate-v2 mockup concretizes what "observability depth" means for a
  flow run and adds two features:
  - **R6-01-F4 Run-detail page per history row.** Every flow run (live AND
    completed) gets a full detail surface (`#/flows/run/<id>` in the mockup;
    `RUN_DETAILS` in `data.jsx`): node-by-node timeline with per-node status /
    cost / note / artifact list, review findings with severity + state, and
    evidence links. As-built: the monitor shows the live hex topology only;
    completed runs have no dig-in (`as-built-inventory.md` §1/§4). ACs:
    detail reachable from monitor ledger rows for live + archived runs;
    per-node `data-*` contract; derived from the event log (run model derived
    never stored — ADR-008 posture unchanged).
  - **R6-01-F5 Line-level node logs + typed outputs.** A run-detail node
    click-through opens the agent's actual log lines typed `think | tool |
    out` (mockup `NODE_LOGS`), and node outputs render through their
    artifact type (typed outputs — needs R2-05-F2's surface contract where
    the type is `composed`; plain template artifacts render today's way).
    Shares its log-line renderer with the standalone run view (R6-04-F3 —
    one component, two surfaces). **F1 is a hard precursor** (2026-08-03
    review pass: F5 extends F1's drawer streaming — F1 rides wave-5 batch C
    with F4/F5, per the header note). ACs: real captured lines render
    mid-cycle (same emission substrate as F1); no new emission path without
    consulting ADR-025's deferred notes (F-context rule above stands).
  - **Acceptance references:** mockup journeys `run-flow`, `edit-flow` (run
    beats) + the per-OOTB-agent run journeys; surface `views-run.jsx`.
    **Depends (added):** R2-05 (soft — typed-output rendering contract;
    pulled in when F5 reaches typed outputs, per the wave-5 5B order note).
    **Depended on by (added, both-sides):** R6-05 (ledger rows → F4 detail),
    R4-12/R4-13 *(soft — completed-run dig-in links)*.
- **Session sizing:** ~2 sessions (F1; F2+F3) **+ ~2 wave-5 sessions (F4; F5)**.
- **Out of scope:** cost *integrity* (R5-03); harness clip content (R5-06);
  event emission architecture changes (ADR-025's deferred items get their own
  revisit if F1/F2 need them); standalone agent-run kickoff/view (R6-04).

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

- **Status:** planned  ·  **Wave:** unsequenced pre-wave-5; **F3 = wave 5,
  batch E** (sequenced late — after the surfaces it rehomes exist)
- **Depends on:** — (grows as R3/R4 add surfaces). **Depended on by:** R6-07
  (F3's Home pillar precedes the dashboard).
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
- **Wave-5 amendment (2026-08-03).** The mockup fixes the target IA this
  stewardship converges on, adding:
  - **R6-03-F3 Six-pillar navigation + one page shell.** Nav becomes
    **Home / Flows / Agents / Projects / Library / Knowledge Bases** (as-built:
    5 entries, Library squatting `/`, no Home — `as-built-inventory.md` §1);
    every surface adopts the one page-shell pattern (eyebrow / title / actions
    / sub-nav) and builder+monitor section pairs; OOTB-provenance badges render
    on every shipped object (mockup deliberate-evolution items 2-4). Redirects
    preserved for every moved route; dead-path sweep green. Rider: self-host
    the UI font (the mockup's Google-Fonts load is mock-only). ACs: nav
    matches the six pillars; a shared shell component (not per-page copies);
    `ui:deadpaths` green; journey nav beats re-captured.
  - **Acceptance references:** every mockup journey's nav/landing beats;
    surfaces `app.jsx` / `components.jsx` (shell + nav vocabulary).
- **Session sizing:** ~1 session + ongoing stewardship **+ ~1-2 wave-5
  sessions (F3 — after, not before, the wave-5 surfaces it rehomes exist;
  sequence late in 5B)**.
- **Out of scope:** feature UI (owned by feature initiatives + journey-sync).

### R6-04 Run kickoff & consolidation (one Run button)

- **Status:** implemented (2026-08-07 — as-built facts in R6-B5)  ·  **Wave:** 5 (module: agent-kickoff+run)
- **Depends on:** R2-01-F3 (dispatch host, landed), R2-02 (capability
  descriptor drives session-vs-kickoff), R2-09-F1 (`materials:` declaration —
  this surface is its named enforcement point), R2-08-F4 (soft — trigger
  provenance rendered on kickoff/run). **Depended on by:** R6-06 (monitor rows
  link into the standalone run view).
- **Context:** Wave-5 cut. Mockup round-6: **"one Run button everywhere —
  sessions for interactive agents, kickoff for workers."** As-built: four
  interactive agents launch via bespoke pages; non-interactive agents run via
  the `/agents/[id]` RunPanel with `key: value` inputs and aggregate
  status/cost/event-count only — **no line-level log viewer, no typed-output
  viewer, no cost-ceiling field, no materials** (`as-built-inventory.md` §3).
  Round-7 adds: cost ceiling editable on both kickoff screens (per-kickoff
  limit).
- **Features:**
  - **R6-04-F1 One Run entry.** Every agent surface (agent page, library
    cards, project page bindings) exposes exactly one Run affordance; the
    capability descriptor's `interactive` fact routes it — session (R2-10
    shell) or worker kickoff (dispatch). Flows keep their kickoff; the
    affordance vocabulary unifies. ACs: no surface offers two run paths; an
    interactive agent can't reach the worker kickoff (server-refused already —
    R2-B8; the UI now never offers it); `data-*` contract for the Run control.
  - **R6-04-F2 Kickoff screen.** Worker kickoff gains: project select, typed
    inputs (existing), **input-materials upload validated against the
    definition's `materials:` declaration** (undeclared kind refused at the
    boundary — the R2-09-F1 enforcement AC lands here, fail-closed), an
    **editable per-kickoff cost ceiling** (defaults from config; enforced by
    the existing cost-guard path — wire, don't duplicate), and the target's
    standing triggers listed read-only (R2-08-F4). Flow kickoff gains the
    same ceiling + materials treatment (mockup `LIVE_RUN`: ceiling $8.00,
    fanout shown). ACs: an out-of-contract upload is refused with the
    declared kinds named; the ceiling demonstrably stops a seeded runaway
    fixture; ceiling + materials recorded on the run.
  - **R6-04-F3 Standalone run view.** The dispatched-run surface grows from
    aggregate polling to: live log lines (`SessionStart …` through
    `SessionEnd`, the mockup `AGENT_RUN.log` shape), cost, and **typed
    outputs** — output candidates render as cards expanding to their full
    artifact shape (mockup: issue-triage candidates expand to the
    initiative-spec form, `CAND_DETAIL`). Shares the log-line renderer with
    R6-01-F5. ACs: a real dispatch streams lines; outputs render through
    their declared artifact type; run view linkable (monitor rows, R6-06).
- **Session sizing:** ~3 sessions — (1) F1 routing; (2) F2 kickoff; (3) F3
  run view + journey-sync.
- **Acceptance references:** mockup journeys `run-agent` (kickoff → materials
  → live log → typed output), `run-flow` (ceiling), per-OOTB run journeys;
  surfaces `views-run.jsx`, `AGENT_RUN`/`LIVE_RUN`/`CAND_DETAIL` in `data.jsx`.
- **Out of scope:** session INTERNALS (R2-10); trigger authoring (R2-04/R2-08);
  flow run-detail (R6-01-F4/F5).

### R6-05 Flow monitor ledger

- **Status:** planned  ·  **Wave:** 5 (module: flows-home/monitor)
- **Depends on:** R6-01-F4 (run-detail pages to link into). **Depended on
  by:** R6-06 (shared ledger components), R4-12-F2 (vocabulary reuse).
- **Context:** Wave-5 cut. Mockup: the flows home/monitor carries a
  per-flow **history ledger** in one shared vocabulary — `when · what ·
  outcome-narrative · status · cost` (`FLOW_HISTORY` in `data.jsx`; the
  outcome narrative is the run's real arc, e.g. "review found demo gap →
  demo-fix loop ×1 → verdict approved → merged") — with every row linking to
  its run detail, plus the live-run strip. As-built: the flow page's monitor
  tab shows the live topology; history is not a first-class ledger
  (`as-built-inventory.md` §1).
- **Features:**
  - **R6-05-F1 History ledger.** Per-flow run history derived from archived
    run models (derived, never stored), rendered in the shared ledger
    vocabulary; rows link to R6-01-F4 detail. The outcome narrative derives
    from real run events (gate outcomes, findings counts, merge state) —
    never free-typed. ACs: ledger rows for archived real runs; row →
    detail navigation; `data-*` per row (status/cost machine-readable);
    journey beat asserts a row's narrative matches its run's event log.
- **Session sizing:** ~1 session (+ shares vocabulary components with R6-06 —
  build once).
- **Acceptance references:** mockup journeys `run-flow`, `edit-flow`;
  surface `views-flows.jsx`.
- **Out of scope:** the run detail itself (R6-01); agent-side ledger (R6-06).

### R6-06 Agent monitor linkage

- **Status:** planned  ·  **Wave:** 5 (module: agents-home/monitor)
- **Depends on:** R6-05 (shared ledger components), R6-04-F3 (standalone run
  view to link to), R2-10 (session surface to link to).
- **Context:** Wave-5 cut. Mockup round-7: agent monitor history rows link
  **where each run actually happened** — a flow run, a standalone agent run,
  or an interactive session — with standalone runs explicitly marked
  `STANDALONE` (`AGENT_HISTORY` in `data.jsx`: each row carries a typed
  `link` target). As-built: agent pages have no run-history ledger at all;
  RunPanel polls only the current dispatch (`as-built-inventory.md` §3).
- **Features:**
  - **R6-06-F1 Per-agent history ledger with real link targets.** Derive an
    agent's run history across all three execution paths (flow-node
    attribution via the R2-B8 `agent_slug` event mapping; standalone
    dispatches via `_logs/<runId>`; sessions via session records); each row
    links to its actual surface and standalone rows carry the STANDALONE
    mark. **Per-target status must be REAL** (standing lesson) — a row's
    status derives from that run's own events, never attributed from a scan
    of something else. ACs: one agent with runs on all three paths shows
    three correctly-linked rows; ledger vocabulary identical to R6-05;
    `data-*` contract; journey beat covers the three link kinds.
- **Session sizing:** ~1 session.
- **Acceptance references:** mockup per-OOTB run journeys (`run-agent-*`);
  surface `views-agents.jsx` (`AGENT_HISTORY`).
- **Out of scope:** the linked surfaces themselves (R6-01/R6-04/R2-10).

### R6-07 Home dashboard

- **Status:** planned  ·  **Wave:** 5 (module: home-dashboard)
- **Depends on:** R6-03-F3 (the Home pillar exists in nav), R4-11-F4 (the
  attention strip this surfaces feeds on).
- **Context:** Wave-5 cut. Mockup deliberate-evolution item 1: a **new Home
  surface** — hex-constellation live status (every active object as its hex,
  live statuses), the attention list (`ATTENTION` in `data.jsx`: gate
  approaching, KB skew warning — each targeting its owning surface), and
  recent-activity ledger. As-built: no Home dashboard; attention signalling
  is the R4-11-F4 strip on the library surface (`as-built-inventory.md`
  cross-cutting gaps).
- **Features:**
  - **R6-07-F1 Home surface.** The `/` route becomes Home (Library moves to
    its pillar — R6-03-F3 owns the move): hex-constellation of active
    flows/agents/projects/KBs with live status derived from the same
    run-model/bridge reads the monitors use (no new polling paths), the
    attention strip relocated/mirrored here as the primary aggregate, and a
    cross-object recent-activity ledger (R6-05 vocabulary). ACs: with ≥2
    projects active one glance answers "what needs me" from Home (the
    R4-11-F4 AC, re-anchored); every hex/attention item links through to its
    owning surface; `data-*` contract; journey landing beats re-captured.
- **Session sizing:** ~1-2 sessions.
- **Acceptance references:** landing beats across the mockup journey set;
  surface `views-home.jsx`.
- **Out of scope:** notification transport (R6-D1); per-surface monitors
  (R6-05/R6-06).

### R6-08 KB explore (combined graph + reader)

- **Status:** planned  ·  **Wave:** 5 (module: kb-explore)
- **Depends on:** R1-06 *(soft — the Health tab's maintenance-session entry
  links into R1-06-F3; both-sides fix, 2026-08-03 review pass)*.
  KbGraph/NodeArticle as-built are the substrate.
- **Context:** Wave-5 cut. Mockup round-3 (operator request): KB graph and
  reader are **one surface** — graph left, theme list + article right,
  clicking a node opens it in the reader; tabs `Explore | Health |
  Ingest activity`. Round-5: force-directed clusters via hub anchors + edge
  tension, draggable nodes with reactive neighbours, tension presets. Health
  = the **named** lint checks (mockup `LINT_CHECKS`: 9 named checks incl.
  "theme distribution balance"); Ingest activity = a read-only feed of
  reflection-driven ingests. **Operator decision 3 (2026-08-03): NO manual
  ingest button** — ingest stays reflection-only; the mockup's "Kick off
  ingestion" op is rejected and the mockup corrected. As-built: KbGraph +
  NodeArticle + KbHealth + LintResolutionPanel exist as separate panels
  (`as-built-inventory.md` §5) — this is a recomposition, largely not new
  machinery.
- **Features:**
  - **R6-08-F1 Combined explore surface.** One route per KB: graph pane
    (existing KbGraph, + hub-anchored clustering/tension presets where the
    d3-force config allows cheaply) beside the reader pane (theme list +
    NodeArticle); node click → article; deep-linkable
    (`?theme=<slug>`). ACs: graph→reader round-trip; existing graph
    journeys re-anchored not duplicated; `data-*` contract.
  - **R6-08-F2 Health + Ingest-activity tabs.** Health renders the lint
    checks BY NAME with pass/warn/fail (today's aggregate becomes itemized —
    same `forge brain lint` evidence, no new checks) + the existing guided
    lint-resolution; Ingest activity lists reflection-driven ingest events
    from the event log, read-only, with **no ingest affordance** (explicit
    negative AC — decision 3). **Mockup check names are illustrative, the
    real `cli/brain-lint.ts` check list wins** (2026-08-03 review pass: the
    mockup's "theme distribution balance" / "raw evidence archived" names
    don't exist as checks, and the real set is ~10 functions, not 9 — do NOT
    build the invented checks). ACs: named checks match `forge brain lint`
    output 1:1; a seeded ingest event renders; no button/route triggers
    ingest from the UI.
- **Session sizing:** ~2 sessions.
- **Acceptance references:** mockup journeys `create-kb-project`,
  `create-kb-cycle`, `kb-maintain` (explore/health beats); surface
  `views-knowledge.jsx`.
- **Out of scope:** KB creation/binding + maintenance sessions (R1's wave-5
  entry); brain-creation agent content (R4); lint check *content* changes.

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
- 2026-08-03 — **Wave-5 cut (studio-endstate-v2 mockup → modular backlog).**
  R6 becomes the biggest wave-5 home. **R6-01 amended** (+F4 run-detail page
  per history row, +F5 line-level `think|tool|out` node logs + typed outputs;
  module flow-run-detail). **R6-03 amended** (+F3 six-pillar nav + one
  page-shell + provenance badges + font self-host rider; sequenced late in
  5B). **Minted:** R6-04 run kickoff & consolidation (one Run button, kickoff
  ceiling/materials — the R2-09-F1 enforcement point, standalone run view
  with typed outputs), R6-05 flow monitor ledger, R6-06 agent monitor linkage
  (real per-target links: flow run / standalone / session, STANDALONE mark),
  R6-07 home dashboard (hex constellation + attention), R6-08 KB explore
  (combined graph+reader, named-check Health, ingest-activity read-only — NO
  manual ingest per operator decision 3). All entries cite mockup journey ids
  + `as-built-inventory.md` baselines.
- 2026-08-03 — **Adversarial-review corrections (PR #71 review pass).**
  R6-01-F1 pulled into wave-5 batch C as F5's hard precursor; R6-01/R6-03
  headers annotated with their wave-5 features; R6-08 gains the soft R1-06
  edge + the mockup-lint-names-are-illustrative rule (real `brain-lint.ts`
  list wins, ~10 checks not 9); both-sides edges added on R6-01/03/05.
- 2026-08-07 — **R6-04 implemented** (branch `feat/r6-04-run-kickoff`, WI-1
  through WI-4 — as-built facts in new baseline R6-B5). Materials upload +
  per-kickoff cost ceiling (enforced only for `loopStrategy: 'one-shot'`
  agents, refused for the rest) + the expanded kickoff panel + the
  standalone run view all ship; F1's interactive routing is built but not
  demonstrated end-to-end (no interactive agent in the live roster); the
  standing-triggers listing (R2-08-F4) is parked, not shipped; run-view
  typed outputs are honestly empty pending a real data source. Journey
  coverage added: `scripts/journeys/agents.mjs`'s `agents-kickoff-*` arc (8
  beats) + a new `scripts/e2e-deadpaths.mjs` route for the run view's 404
  path.
- 2026-08-07 — **R6-01 F1+F4+F5 implemented** (branch
  `feat/r6-01-run-detail`, wave 5 batch C; WI-1 drawer live-refresh · WI-2
  run-detail page · WI-3 per-node logs · WI-4 the unparked R6-04 standing-
  triggers rider · WI-5 duties — see baseline **R6-B6**). Status →
  `implemented (F1+F4+F5)`; **F2+F3 stay `planned`**, unsequenced.
  Additive API surface, disclosed for batch-C ratification: `RunPhaseMeta.
  lastEventAt` and a `raw=1` mode on the existing per-node phase-log route
  (no new route). `parseRun` now carries `run.trigger` — it was derived,
  served and then dropped at the last client hop. `found` on the run-detail
  page is decided by HTTP **status** in **three** states (found / not-found /
  unresolved), so a bridge outage can never render as "this run never
  existed". Measured-and-deferred rather than skipped: **R2-05-F2**'s
  composed-output slice (no `composed` artifact kind; 7/7 templates
  `file`/`git-state`; no output-surface field; 0/10 agents declare one).
  Shipped honest gaps: no per-finding `state`, per-node artifacts/typed
  outputs always empty, architect per-node cost undercounts by construction.
  Residue filed: `forge-irn` (R6-04's `run-view-client.ts` collapses
  bridge-down into "not found" — the same class this initiative closed for
  flow runs) and `forge-7wc` (`PhaseDrawer` Effect 1 has no `catch`).
  Also corrected here: the DOM-contract doc's trigger-provenance paragraph
  still claimed "no attribute below is attached to any DOM element", stale
  once the first consuming surface landed.
