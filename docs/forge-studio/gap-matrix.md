# Gap Matrix — every mock feature, categorised

Categories:

- **EXISTS** — implemented and production-proven (betterADO release cycles,
  2026-06). Studio reuses it; at most a thin read/adapter layer.
- **MODIFY** — the mechanism exists but is hardcoded to the six-phase cycle or
  to one surface; must be generalised to definition-driven.
- **NEW** — no equivalent exists in forge today.
- *(cosmetic)* — mock-only polish (CSS animation, stagger-in) that needs no
  backend; carried by the UI port itself and not tracked separately.

Source inventories: full-page feature extraction of all 6 mock pages +
`shared/data.js` data model (2026-06-13). As-built reference:
`ARCHITECTURE.md`, ADRs 010–026, `orchestrator/`, `cli/ui-bridge.ts`,
`forge-ui/`.

---

## 1. Shared substrate (all pages)

| Mock feature | Today | Category | Plan |
|---|---|---|---|
| Entity store (agents/projects/flows/kbs), CRUD via `AFB.store` | No definition store; six phases hardcoded in `cycle.ts`; projects in `.forge/project.json`; brain on disk | **NEW** | Filesystem registries (`studio/` + in-repo files), markdown/YAML + canonical serializer (M0) |
| Catalog: skills, tools, MCPs, hooks, SDKs, models, artifacts | Skills exist (`skills/*/SKILL.md`); tools/MCPs implicit in `allowedTools`; hooks exist as orchestrator behaviours (event-log, stall-watch, merge-gate…), not objects; models in `MODEL_BY_TIER` (1 SDK) | **MODIFY** | Catalog API derived from filesystem + a `catalog.yaml` for tools/MCPs/hooks/SDKs/models (M0); hooks map to existing orchestrator behaviours, not new code |
| ID prefix convention (`ag-`, `fl-`, `pj-`, `kb-`, …) | Initiative/cycle ids exist; no entity id scheme | **NEW** | Slug-based ids in registry frontmatter (M0) |
| Nav shell, 5 sections, active-page state | forge-ui has dashboard/architect/review/reflect screens, different shell | **MODIFY** | Studio shell in forge-ui App Router; existing screens fold in (M1, M4) |
| Toast host | `Toasts.tsx` exists | **EXISTS** | Reuse |
| `data-*` DOM-as-metrics on every load-bearing state | Established convention + harness | **EXISTS** | Extend convention to new pages; e2e-journey asserts |
| Reset-to-seed (mock) | n/a — real data | n/a | Replaced by real registries; seed = forge cycle objects |

## 2. index.html — Library

| Mock feature | Today | Category | Plan |
|---|---|---|---|
| Operator pulse (needs-you / active / counts) | Bridge has `/api/cycles`, scheduler status, live counts on dashboard | **MODIFY** | Aggregate endpoint over run model (M1) |
| Project cards (north star, skill count, KB badge) | `.forge/project.json` + preflight contract; no north-star/skills/kb fields | **MODIFY** | Extend project config schema (M2) |
| Agent cards (purpose, composition counts, runtime label) | Skills + `PhaseAgentSpec` (tier, allowedTools) — no purpose/runtime-label surface | **MODIFY** | AgentDefinition = extended SKILL.md frontmatter (M2) |
| Flow cards (goal, node/edge counts, project badge, trigger count) | One implicit flow; no flow entity | **NEW** | FlowDefinition registry (M0 schema, M1 cards) |
| Flow card live strip (active run, cost) + gated/failed chips | Dashboard shows live cycles, cost badges per cycle | **MODIFY** | Run-model API keyed by flow (M1) |
| Gated chip deep-link → flow monitor tab | `?tab=monitor` not even consumed by mock | **NEW** | URL-driven tab activation in real UI (M4) |
| KB cards (layer tally index/theme/raw, scope badge) | Brains exist with exactly these layers; no per-KB descriptor/scope object | **MODIFY** | `kb.yaml` descriptor + layer counts from filesystem (M5) |
| + New {Project, Agent, Flow, KB} CTAs | No creation surfaces (projects via onboard skill, agents/flows not creatable) | **NEW** | Builder pages (M2, M4, M5) |

## 3. agent-builder.html — Agents

| Mock feature | Today | Category | Plan |
|---|---|---|---|
| Component library: searchable, collapsible groups (skills/tools/MCPs/hooks), used-state dimming | Skills on disk; no registry API or picker UI | **MODIFY** | Catalog API (M0) + builder UI (M2) |
| Drag-drop composition into 4 typed zones, kind-rejection, dedupe | Composition exists as hand-edited `allowedTools` arrays + SKILL.md prose | **MODIFY** | Builder writes frontmatter `skills/tools/mcps/hooks` lists (M2) |
| Agent name/purpose/process/interactivity fields | SKILL.md body holds process intent; purpose/interactivity implicit | **MODIFY** | Frontmatter fields + body sections; SKILL.md stays single source (ADR-024) (M2) |
| SDK picker (Claude/Codex/OpenLlama/Gemini) | Claude Agent SDK only (`createClaudeAgent`) | **NEW** | Runtime adapter seam `loops/_adapters/` (ADR-029, M6); UI ships earlier with only Claude selectable |
| Model strategy: fixed | `MODEL_BY_TIER` via `tier` field | **MODIFY** | `runtime.model` explicit per agent (M2) |
| Model strategy: range (route to cheapest capable) | Not implemented (tier is fixed per phase) | **NEW** | Router in adapter layer (M6) |
| Sub-agent model picker | Convention only (CLAUDE.md guidance) | **DEFERRED** | `runtime.subagentModel` de-cargoed 2026-06-16 (ADR-027) — no SDK sub-spawn consumer exists yet; reintroduce with the first sub-spawning flow |
| Knowledge access (mandatory/advisory/none) | Exactly ADR-010 brain-read policy, enforced for PM (0-reads abort) | **MODIFY** | Promote to `brainAccess` frontmatter field; orchestrator enforcement keyed off it (M2) |
| Live YAML definition preview | n/a | **NEW** | Render from frontmatter (M2) |
| Readiness checklist (6 checks) + ready badge | Preflight exists for projects only | **NEW** | Agent-level validation (M2) |
| Used-in-flows reverse index | n/a | **NEW** | Registry scan (M2) |
| Dirty tracking, discard, unsaved guard, URL `?id=` | n/a | **NEW** | Builder UI state (M2) |
| Save → persist + URL update | n/a | **NEW** | PUT via bridge → file write through canonical serializer (M2) |

## 4. project-builder.html — Projects

| Mock feature | Today | Category | Plan |
|---|---|---|---|
| North star (≤140 chars, judged-against line) | Initiative manifests carry goals; project north star absent | **NEW** | `northStar` in project config (M2) |
| Standing instructions + "what agents see" readback | `standing_work_item_acs` injected into every WI — same mechanism, narrower | **MODIFY** | Generalise to `instructions` injected into agent context (M2) |
| Demo process: typed step timeline (capture/verify/present), drag-reorder, presets | Demo contract + `demo.json` schema + capture CLI exist; project-side demo skill discovery is an open known-gap (`demo.skill` unimplemented) | **MODIFY** | Structured `demoProcess[]` in project config; closes known-gap §2026-05-31 (M2) |
| Relevant skills binding (search, drag, dedupe) | Project skills live in project repo `.claude/skills/`; not declared to forge | **MODIFY** | `skills[]` in project config; PM/dev compose them (M2) |
| KB binding + "create project brain" | Brain 3 per project exists (C4 preflight requires it) | **MODIFY** | Bind by id; create = scaffold `brain/` + `kb.yaml` (M2/M5) |
| Contract readiness (5 checks, flow-ready badge) | `forge preflight` C1–C8 — richer than mock | **EXISTS** | Surface preflight through builder UI (M2) |
| Used-by-flows reverse index | n/a | **NEW** | Registry scan (M2) |
| Ctrl+S save, dirty tracking, `?id=` routing | n/a | **NEW** | Builder UI (M2) |

## 5. flow-builder.html — BUILD tab

| Mock feature | Today | Category | Plan |
|---|---|---|---|
| Flow entity: name, goal (+warning), project binding, KB binding | Implicit: the six-phase cycle + initiative manifests | **NEW** | FlowDefinition schema (M0) |
| Node canvas: drag-create from agent palette, reposition, select, delete | Pipeline hexes render read-only (`AgentGraphCanvas`) | **MODIFY** read-path / **NEW** authoring | Canvas authoring UI (M4); evaluate library (react-flow) vs extending hex canvas — ADR-027 decision |
| Port-to-port edge drawing, bezier edges, edge delete | Edges derived from hardcoded phase order today | **NEW** | Flow editor (M4) |
| Artifact labels on edges + artifact picker | Artifacts flow between phases as files (PLAN.md, WIs, demo.json) — real but implicit | **MODIFY** | Edge `artifact` field references artifact catalog (M0 schema, M4 UI) |
| Parallel lane (fn-dev-1/2/3, `lane: parallel`) | Real: per-WI Ralph fan-out, dependency DAG, worktrees | **MODIFY** | Fan-out node type — multiplicity resolved at runtime from upstream artifact (ADR-028, M3) |
| Auto-layout (BFS levels) | `dep-layout.ts` does topological levels for roadmap spine | **EXISTS** | Reuse (M4) |
| Flow triggers (`on complete → flow`) | Reflection→ingest is implicit; `depends_on_initiatives` orders initiatives | **NEW** | Trigger = on-terminal-state enqueue of target flow run (M3) |
| Cost ceiling per flow (`costCeilingUsd`) | No hard ceiling in code (harness-only $25 gate) | **NEW** | Enforced ceiling in flow runner: warn 70%, stop-at-boundary 100% (M3) |
| Save flow / new flow / flow selector | n/a | **NEW** | Flow CRUD via bridge (M1 read, M4 write) |
| Clear canvas, keyboard shortcuts, mini-panel (open agent, remove node) | n/a | **NEW** | Editor UX (M4) |

## 6. flow-builder.html — MONITOR tab

| Mock feature | Today | Category | Plan |
|---|---|---|---|
| Run rail grouped by status (needs-you/active/failed/queued/complete) | Dashboard groups cycles per project with status tally | **MODIFY** | Run model API: queue dirs + events.jsonl → mock's Run shape (M1) |
| Run card: initiative, cost, gate note, fail note, merged badge | All real data exists (manifest, events, verdict) | **MODIFY** | Run aggregator (M1) |
| "Open gate →" deep link to artifact gate | `/review/[cycleId]` + PLAN gate exist as separate screens | **MODIFY** | Unified artifact viewer routes (M4) |
| Gated-runs banner | Dashboard surfaces pending plans / review moments | **MODIFY** | Port (M1) |
| Summary strip: cost, elapsed, phase tally, cost gauge vs ceiling | Cost live via `onUsageDelta`; elapsed/tally derivable; no ceiling | **MODIFY** (+gauge **NEW** with M3 ceiling) | M1 strip, M3 gauge |
| Monitor topology: scaled replica, status-coloured hexes, flowing edges on active boundary | `AgentGraphCanvas` + `phases.ts` + `wi-status.ts` — same 5-state vocabulary | **EXISTS** | Re-skin to flow-definition-driven topology (M1) |
| Phase drawer: status/model/cost/retries | `HexDetailDrawer` + hex-detail.ts | **EXISTS** | Port + extend (M1) |
| Drawer liveness (last tool progress, wedged banner ≥30m) | Heartbeats + tool counters exist (`agent_heartbeat`, liveness API); no wedge threshold/kill | **MODIFY** UI / **NEW** kill | Surface `lastProgress` (M1); `since_ms` ceiling kill in runner (M3) — closes 33h-wedge gap |
| Drawer iteration pips (iter n of budget) + brain-reads line | Iteration events + `tallyToolUse` brain-read counts exist | **MODIFY** | Run aggregator exposes per-phase meta (M1) |
| Drawer delivered stats (files/insertions/commits) | `dev-loop.delivered` event + diffstat exist | **MODIFY** | Aggregator (M1) |
| Gate sub-checks (5 named checks, which-one-stuck) | Composed 5-gate IS real (branches_in_sync, quality, demo_structured, pr_body, ci); per-sub-check events partially emitted | **MODIFY** | Emit structured per-sub-check events; drawer renders (M1) |
| Resume-from-phase button | `forge requeue --resume-from=unifier` (CLI only, unifier only) | **MODIFY** | Bridge endpoint + button; phase set = resumable boundaries the engine defines (M3) |
| Phase log tail + stderr-only filter + transient badges | events.jsonl has everything; ActivityPanel tails events | **MODIFY** | Per-phase log endpoint + filter (M1) |
| Live events tail | WS bridge pushes events live | **EXISTS** | Port (M1) |
| Start-run CTA on planned run | `forge enqueue` / architect promote — no UI run-trigger | **MODIFY** | Bridge `POST /runs` honouring human-gate + origin tagging (M3) |

## 7. knowledge-base.html — Knowledge

| Mock feature | Today | Category | Plan |
|---|---|---|---|
| KB selector grouped by scope (project/flow/agent-integration) | Three-brain model is exactly this scoping (forge-dev≈agent-integration, cycles≈flow, project) | **MODIFY** | `kb.yaml` descriptors over existing brains (M5) |
| Force-directed graph (index hex / theme circle / raw dot), pan/zoom/drag | `brain/*/graphify-out/graph.json` exists; `cli/visualise.ts` exists; no interactive UI | **MODIFY** | Graph viewer over graphify output (M5); adopt library (d3-force) per battle-tested rule |
| Node article panel (touched-by, inbound/outbound links, body) | Theme/raw pages with wiki-links + frontmatter ARE the articles | **MODIFY** | Serve rendered node content via bridge (M5) |
| Wiki-link + chip navigation between nodes | Links exist in markdown | **MODIFY** | Resolve `[[link]]` → node nav (M5) |
| Human guidance pin (attach note to node, awaiting ingest) | `brain-gaps.jsonl` feedback loop — same shape, agent-originated only | **MODIFY** | `_guidance/` pending notes consumed by brain-ingest (M5) |
| Agent-managed pill (last ingest time) | Ingest runs post-cycle; timestamp derivable | **MODIFY** | Real timestamps (M5) |
| KB health: layer balance, orphans, link density | `forge brain lint` checks orphans/staleness/structure | **EXISTS** | Lint-as-API (M5) |
| Staleness + suggested-ingest action | Lint staleness check exists; suggestion/queue UI new | **MODIFY** | Surface + "queue ingest" action (M5) |

## 8. artifact.html — Artifact viewer

| Mock feature | Today | Category | Plan |
|---|---|---|---|
| Generic viewer routed by run+type+mode | Split today: PLAN gate on architect screen, demo verdict on review screen, others raw files | **MODIFY** | One `/artifact` route, type-renderer registry (M4) |
| Breadcrumb + back-to-monitor | Per-screen nav exists | **MODIFY** | M4 |
| Artifact trail (6 chips: present/current/absent) | `artifactsReady` derivable from `_logs/<id>/artifacts/` + events | **MODIFY** | Run aggregator exposes trail (M1 data, M4 UI) |
| PLAN renderer: goal/scope/non-goals/ACs/decomposition diagram | PLAN.html generated by architect (sandboxed iframe today) | **MODIFY** | Structured plan doc rendered natively; decomposition view reuses dep-layout (M4) |
| Design decisions: resolve-all-before-approve | PLAN gate escalations with per-decision resolution — exactly this | **EXISTS** | Port `PlanGate.tsx` into viewer (M4) |
| Work-items renderer (per-WI card: branch, deps, ACs, status) | WI files + `/api/work-item` endpoint exist | **EXISTS** | Renderer (M4) |
| PR renderer (number/state/commits/±/checks/body) | PR opened via `gh`; metadata fetchable | **MODIFY** | PR snapshot in run model (M4) |
| Demo renderer (api/terminal/screenshot/video evidence + assertions) | `DemoComparison.tsx` renders demo.json with checkpoints/media | **EXISTS** | Port; mock's kinds map onto demo.json schema (M4) |
| Verdict renderer (stamp, by/at, reasons) | verdict.json written on approve/send-back | **EXISTS** | Renderer (M4) |
| Reflection renderer (went-well/friction/lessons→KB links, inconsistencies) | Reflector writes exactly this to brain + archive | **MODIFY** | Structured reflection doc in run artifacts; lessons link to KB nodes (M4/M5) |
| Gate bar: approve / send-back-with-notes (state machine idle→approved/sent-back) | Real: `/api/plan-verdict` + `/api/verdict` (approve=merge, send-back→typed UWIs, ADR-026) | **EXISTS** | Generalise endpoint to `POST /runs/:id/gates/:gateId` (M4) |
| Approval stamp strip on viewed artifacts | Verdict data exists | **MODIFY** | M4 |
| Empty state (artifact not yet produced) | n/a | **NEW** | M4 |

## 9. Simulated-in-mock → real-mechanism map

Everything the mock fakes already has a real counterpart or a planned home:

| Mock simulation | Real mechanism |
|---|---|
| `startMockRun` 3s phase ticker | scheduler claim → flow runner → live WS events |
| `MOCK_EVENTS` / canned drawer logs | `_logs/<cycleId>/events.jsonl` tail per phase |
| Hardcoded `run-0040` resume / `run-0041` merged | failure classifier + `resume_from` + merge confirmation |
| Hardcoded `gateArtifactType` / `nodeArtifacts` maps | flow definition: per-node `produces[]`, per-edge `artifact` |
| Client-side ids (`uid()`, `Date.now()`) | registry slugs validated at save |
| localStorage persistence | filesystem registries via bridge, git-versioned |
| Client-only readiness/contract checks | server-side validation + `forge preflight` |
| Fake screenshot/video frames | demo contract media (real capture CLI exists) |

## 10. Mock features intentionally NOT carried forward

- **Project chips draggable onto flow canvas** — no-op even in the mock; a
  flow binds one project via the header selector. Dropped.
- **`tab=monitor` URL param ignored by mock** — bug in mock; real UI consumes
  it (listed in §2 as NEW).
- **Trigger picker always choosing first flow** — mock shortcut; real UI gets
  a proper flow picker.
- Decorative animations carry over only as CSS in the UI port.
