# Forge operator-surface inventory (as-built, 2026-08-03)

Recon snapshot taken at main after PR #64 (R4-10 F1–F6). Companion to the
end-state mockup in this directory — the backlog cut diffs the mockup
against THIS.

## 1. forge-ui routes

| Route | Purpose |
|---|---|
| `app/page.tsx` | Library (home) — landing/nav root (`/`) |
| `app/agents/[id]/page.tsx` | Agent builder — 3-col workbench (CatalogPalette / definition / Preview+Readiness+Flows+RunPanel); `[id]`="new" for fresh |
| `app/architect/new/page.tsx` | New idea / start-a-run entry (NewIdeaBox → `/api/architect/start`) |
| `app/architect/[sessionId]/interview/page.tsx` | Architect interview (StudioArchitectShell + question form + activity log) |
| `app/artifact/page.tsx` | Unified artifact viewer/gate — `?run=&type=plan\|workitems\|pr\|demo\|verdict\|reflection&mode=gate\|view` |
| `app/flows/[id]/page.tsx` | Flow builder/monitor (BUILD tab canvas + run monitor) |
| `app/instructions/[sessionId]/page.tsx` | Instructions-creator session |
| `app/knowledge/page.tsx` + `knowledge/new` | KB browser (graph, health, lint-resolution) + KB creation (binding to flow/project) |
| `app/project-brain/[sessionId]/page.tsx` | Project-brain-builder session |
| `app/projects/page.tsx` + `projects/[id]` | Projects list + project builder (NorthStar, Instructions, roadmap SerpentineTimeline, cycles, contract readiness, demo timeline/builder, skills bind, KB bind, used-by-flows, recovery) |
| `app/skills/[id]/page.tsx` | Skill builder — writes `skills/<slug>/SKILL.md` |
| legacy redirects | `architect/[sid]`, `demo/[sid]`, `recovery`, `reflect/[cid]`, `review/[cid]` |

Nav: 5 entries — Library(`/`), Flows, Agents, Projects, Knowledge. No Home
dashboard; no top-level Hooks/Tools/Templates.

## 2. Studio definitions

- `studio/catalog.yaml` (sdks/models/tools/mcps/hooks/community-skills),
  `studio/flows/*/flow.yaml` (3 seeds: forge-architect, forge-develop,
  forge-reflect), `studio/artifact-templates/`, `studio/starters/`.
- Agent defs = `skills/<slug>/SKILL.md` (~20 dirs; runtime-visible ones carry
  a `runtime:` block).
- **forge-develop topology (v2)**: dev(developer-ralph) —wi-branches→
  demo(demo-agent, resumable) —pr→ adversarial-review —review-findings→
  verdict gate. Trigger `{on: merged → agent: reflector}`.

## 3. Standalone agent runs

- `cli/agent-run.ts` (interactive runners: architect/instructions/
  demo-builder/project-brain) + agent-builder `RunPanel` for non-interactive
  agents: project + `key: value` inputs → dispatch → poll status/cost/event
  COUNT. **No line-level log viewer, no typed-output viewer, no cost-ceiling
  field, no materials.** Banded agents run standalone via
  `orchestrator/band-agent-run.ts`.

## 4. Flow builder

- ReactFlow canvas, hex nodes, palette drag-drop, port→port connect opens
  ArtifactPicker (typed edge labels), Kahn auto-layout, positions persisted.
- NodeMiniPanel: open-in-builder / remove / gate + fan-out toggles (fan-out
  capability-gated per agent descriptor).
- Triggers (FlowHeader): 4 kinds — flow-complete / merged / cron / webhook
  (R2-04 implemented; cron via croner staging a claimable run request).
- **No parallel-branch/join canvas semantics.** R2-D1 (parallel-work
  merge-resolution) is a NO-GO spike / deferred-rejected.

## 5. Knowledge

- KbGraph (d3-force, drag, layout presets), NodeArticle, KbHealth,
  LintResolutionPanel, KbSelector; per-project KbBind.
- UI ops: Lint + Index-refresh (+delete). Ingest + agentic review are
  DELIBERATELY reflection-only (not a manual button). CLI: `forge brain
  lint`, `forge brain index --write`.

## 6. Triggers/scheduling

- `orchestrator/flow-trigger.ts` (declaration-driven registry),
  `cron-triggers.ts` (scheduler-only, stages claimable requests), webhook via
  bridge `/api/hooks`. All 4 kinds surfaced in FlowHeader.

## 7. Library concepts

- Skills: first-class (builder page + catalog community showcase w/
  provenance/stars/composedBy — reference-only, no install flow).
- Hooks: catalog reference list of FORGE-INFRA hooks (event-log, cost-guard,
  stall-watchdog, merge-gate, scratch-strip, wi-contract, reflection-close,
  demo-band, review-band) — composition items in agent builder only; no
  standalone hooks page/CRUD (R3-03 planned).
- Templates: `studio/artifact-templates/*.md` + starters — filesystem only,
  no management UI.
- R3 (skills mgmt, skill-generator, hooks, tools/MCPs, instructions
  libraries): all 5 initiatives still planned.

## 8. Projects surface

- Everything listed in §1; roadmap viz = `SerpentineTimeline.tsx` (SVG
  boustrophedon, status-coloured nodes, dotted dependency arcs,
  click-to-pop detail). Initiative ids are `INIT-YYYY-MM-DD-*`. No
  cross-project portfolio/attention view (R4-11-F4 aspirational).

## 9. Sessions

- Architect interview is the canonical interactive UX; on awaiting-verdict
  routes to the unified `/artifact?...mode=gate` surface.

## 10. Roadmap register (docs/roadmaps/)

R1 contract (5 planned, 1 def) · R2 runnable (6 planned, 1 def — R2-D1
NO-GO) · R3 library (5 planned) · R4 ootb (11 planned, R4-10 DONE F1-F6,
1 def) · R5 hardening (7 planned) · R6 operator-experience (3 planned,
1 def) · R7 verification (4 planned) · R8 distribution (3 planned, 1 def).

## Cross-cutting gaps flagged

- No Hooks/Tools-MCPs/Templates managed libraries or community install flow.
- No parallel-branch/join in flow canvas (decided-against for WORK merge;
  the mockup's plan-band read-only parallelism is a different question).
- RunPanel = aggregate status/cost/event-count only (no logs/output).
- Single serpentine roadmap viz; no full-page roadmap tab, no cross-project
  attention strip.
- No Home dashboard.
