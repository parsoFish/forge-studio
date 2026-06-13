# Forge Studio M4 — Flow Builder Canvas + Unified Artifact Viewer: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Flows become authorable in the UI (the BUILD tab — drag agents onto a canvas, draw edges, label artifacts, save with versioning + edit-lock), and every artifact type gets ONE viewer (`/artifact?run&type&mode`) with a gate bar that runs both human gates. The remaining mock UI lands; the legacy `/review` + PLAN-gate screens fold into the viewer.

**Architecture:** ADR-030 decides the canvas: **extend ReactFlow** (already a dep, already used in `AgentGraphCanvas` with custom node types + the Handle/port connection system) rather than hand-roll drag math (PRINCIPLES: battle-tested over hand-rolled). New `PUT/GET /api/studio/flows/:id` over the M0 `serializeFlowDefinition` canonical writer, with version-bump + edit-lock (reject writes while a run of that flow is active — the M3-6 `checkFlowVersionSeam` already detects mid-run version drift). The unified `/artifact` viewer composes the existing renderers (PlanGate, DemoComparison, ReviewVerdictForm) + new ones (work-items, PR, reflection), driven by the M1 run-model artifact trail, with the gate bar POSTing to the M3-4 generalised gate endpoint.

**Tech Stack:** Existing — Next 14, ReactFlow 11 (already installed), the M0 registry, the M1 run-model + artifact route, the M3-4 gate endpoints, the M2 PUT/CSRF seam. No new deps (ReactFlow already present).

---

## Ground-truth facts (verified 2026-06-13 — do NOT re-derive)

**ADR-030 canvas decision = ReactFlow (already in use):** `forge-ui/package.json:18` `reactflow ^11.11.4`. `AgentGraphCanvas.tsx` (672 LOC) uses ReactFlow with `NODE_TYPES = {hex, tool, bubble}`, `Handle`/`Position`, custom nodes, `nodesConnectable={false}` (read-only there). `FlowTopology.tsx` (395 LOC, M1 monitor) is deliberately hand-rolled SVG (read-only display). For the BUILD tab (drag-create, port-to-port edges, bezier, mini-panel, autolayout, pan/zoom) ReactFlow's connection mode (`nodesConnectable`, `onConnect`, custom node `Handle`s, `applyNodeChanges`) is the natural extension — the mock's port-drag-to-port maps 1:1 to ReactFlow connections. The ADR records this; no separate spike PR needed (the existing usage IS the evidence).

**Mock BUILD tab (`flow-builder.html`, the M4 UI spec — READ IT):** palette (Agents/Projects/Artifact-Reference chips, draggable), canvas with dot-grid, drag-agent-to-canvas creates a `.flow-node` (hex + in/out ports), port-out→port-in drag creates an edge (bezier, `{from,to,artifact:null}`) then immediately opens the artifact picker, edge label = artifact name (amber), node mini-panel (agent name + purpose + "open in agent builder" + remove), toolbar (Clear, Layout=Kahn autolayout COL_W 200/ROW_H 120), goal field + `data-goal-set` warning, project/kb selects, trigger chips (`on complete → flow`), flow selector + name, save. data-*: `data-page="flows"`, `data-flow-id`, `data-goal-set`, canvas `data-node-count`/`data-edge-count`, `data-flow-node`/`data-node-id`/`data-agent-ref` per node. NOTE: the mock saves to localStorage; M4 saves via `PUT /api/studio/flows/:id`. The mock has NO per-node gate/fanOut/resumable editor — but the FlowDefinition supports them; M4 BUILD tab edits node `agent` + edges + triggers + goal + project/kb; gate/fanOut/resumable on a node are shown read-only (authored in YAML) OR add a minimal node-inspector toggle (decide in M4-2 — minimal: read-only, full node-property editing deferred).

**Mock artifact viewer (`artifact.html`, READ IT):** `/artifact?run={runId}&type={plan|workitems|pr|demo|verdict|reflection}&mode={gate|view}`. `<main data-run data-artifact-type data-mode data-gate-state>`. Breadcrumb, artifact-trail (6 ordered chips: plan/workitems/pr/demo/verdict/reflection — `.present`/`.current`/`.absent` from `run.artifactsReady`), 6 renderers (plan: goal/scope/non-goals/ACs/decomposition/decisions; workitems grid; PR hero; demo evidence+assertions; verdict stamp; reflection 3-col), gate bar (`data-gate-state` idle→approved/sent-back; approve disabled until decisions resolved; send-back textarea), view-mode approval stamp, empty state. The mock does pure DOM mutation — M4 wires the gate bar to the M3-4 POST endpoint.

**Existing renderers to compose (don't rebuild):** `PlanGate.tsx` (164 LOC — PLAN.html iframe + 3 verdict buttons, `data-section="plan-gate"` `data-decisions-resolved`), `DemoComparison.tsx` (389 LOC — full DemoModel renderer, `data-section="demo-evaluation"` `data-ac-verdict`), `ReviewVerdictForm.tsx` (170 LOC — `data-component="verdict-form"` `data-form-state` `data-action="approve-and-merge"|"send-back"`, the harness depends on these). NEW renderers needed: work-items (lift from `HexDetailDrawer`'s `fetchWorkItem` AC/files render), PR snapshot (today just a chip link to `pr-description.md`), reflection (today only `/reflect` screen).

**Backend gaps (verified absent):**
- `PUT /api/studio/flows/:id` — does NOT exist (M2 added agents+projects only). Slots into `handleStudioWriteRoutes` (`bridge-studio.ts:589`, between the projectMatch block ~729 and the `return false` ~833) — same load-merge-validate-write pattern. Path `studio/flows/<id>/flow.yaml`, guard `startsWith(resolve(forgeRoot,'studio','flows')+sep)`. `validateFlow(flow, agentsMap)` needs `listAgentDefinitions('skills')`. Bump `version` on write. **Edit-lock**: reject the PUT (409/423) when a run of that flowId is currently `active` (check the run-model / queue for an in-flight run; `checkFlowVersionSeam` already warns mid-run). CSRF + origin (M2 pattern) auto-applies.
- `GET /api/studio/flows/:id` — does NOT exist (only the list GET). Add it (match `/^\/api\/studio\/flows\/([^/]+)$/`, loadFlowDefinition the resolved path, 404 unknown).
- `saveFlow(id, body)` client helper — does NOT exist in studio-client.ts (only saveAgent/saveProject). Add via `studioPut('/api/studio/flows/<id>', body)`.

**Canonical flow writer (M0):** `serializeFlowDefinition` (`registry.ts:370`, yaml.dump fixed key order, strips path), `loadFlowDefinition` (`registry.ts:318`). `validateFlow` (`validate.ts:134`: slug/version≥1/dup-ids/node-shape/agent-ref/edge-ref/acyclic/fanOut/zero-gate).

**Artifact serving + trail (M1):** `GET /api/artifact/<cycleId>/<filename>` (`ui-bridge.ts:620`, serves `_logs/<cycleId>/artifacts/` ONLY — PLAN.html + demo.json land there; pr-description.md + work-items-snapshot/ + verdict are at the logDir level, fetched via other routes). `run-model.artifactsReady` (`run-model.ts:72`, 6 slots, 'view'|'gate'). `deriveArtifacts` (`run-model-derive.ts:406-440` — the per-type file paths). The viewer fetches each artifact type via the appropriate route (artifact route for PLAN/demo; a new or existing route for work-items/pr/reflection — reuse `/api/work-item/`, `/api/artifact/.../pr-description.md`, the reflection events).

**Gate endpoints (M3-4):** `POST /api/runs/:id/gates/:gateId` (`bridge-studio-runs.ts:427` — gateId `verdict`→applyReviewVerdict, `plan`→applyPlanVerdict). `postGate(runId, gateId, verdict, options)` client helper (`bridge-client.ts:427`). applyReviewVerdict body `{initiativeId, kind:'approve'|'send-back', rationale, acceptanceCriteria?, concernKind?, qualityGateCmd?}` (send-back needs ≥1 AC {given,when,then}). decisions-resolved-before-approve is UI-only today (no server guard) — the viewer's gate bar enforces it client-side (approve disabled until resolved), matching the mock.

**Fold-in targets:** `/review/[cycleId]/page.tsx` (104 LOC — ReviewStageHex + DemoComparison + ReviewVerdictForm; `data-page="review-cycle"`). `/architect/[sessionId]/page.tsx` (184 LOC — PlanGate fullPage on `awaiting-verdict`). `/reflect/[cycleId]` (135 LOC). The harness (e2e-journey.mjs) asserts on these: `[data-page="review-cycle"]`, `[data-component="verdict-form"][data-form-state="submitted"]`, `[data-section="plan-gate"][data-decisions-resolved="true"]`, `[data-action="approve-and-merge"|"send-back"|"open-review"]`. Fold-in must PRESERVE these data-* (the viewer renders them) and redirect the old routes to the viewer.

**Flow monitor BUILD tab (`/flows/[id]/page.tsx:217`):** BUILD is a disabled `<button title="M4">`. No tab-state. M4 adds `useState<'monitor'|'build'>` + renders the builder canvas when `build`. The MONITOR block (lines 239-393) becomes tab-conditional.

---

## Design decisions locked for M4

1. **ADR-030 = ReactFlow.** Write the ADR recording: ReactFlow already installed + used (AgentGraphCanvas); the flow-builder canvas extends it (custom node with in/out `Handle`s, `nodesConnectable`, `onConnect` → edge with artifact picker, `applyNodeChanges` for drag, `fitView`); the mock's interaction spec is the acceptance bar. Hand-rolled SVG (FlowTopology) stays the read-only monitor renderer.
2. **BUILD-tab node editing scope (M4):** edit the flow's structure — add/remove agent nodes (drag from palette), draw/delete edges, set edge artifact labels, edit goal/name/project/kb/triggers. Node `gate`/`fanOut`/`resumable` flags are shown read-only on the node (badge) in M4 (they're authored in the seed YAML; full per-node-property editing is a small follow-up, noted). The forge-cycle flow stays the seed; M4 proves authoring a NEW flow + saving it.
3. **Edit-lock is load-bearing (ADR-028 D6):** `PUT /api/studio/flows/:id` REJECTS (423 Locked) when a run of that flowId is `active` (in-flight) — the flow can't self-modify mid-run. Saving bumps `version` to n+1; new runs use the new version. The M3-6 `checkFlowVersionSeam` warns if an in-flight runner sees a version change (defence in depth).
4. **The unified viewer composes existing renderers** (PlanGate/DemoComparison/ReviewVerdictForm) — does NOT rebuild them — plus 3 new (work-items/PR/reflection). The gate bar is a state machine (idle→approved/sent-back) POSTing to `postGate`; decisions-resolved-before-approve enforced client-side (mock parity). Approve/send-back route through the M3-4 generalised endpoint.
5. **Fold-in preserves the harness contract:** the viewer's gate-mode for `verdict` renders the `verdict-form` data-* the harness asserts; for `plan` renders the `plan-gate` data-*. `/review/[cycleId]` + the architect PLAN-gate redirect to `/artifact?run=<cycleId>&type=verdict&mode=gate` (and `...&type=plan&mode=gate`). e2e-journey updated to the new routes. Old screens become redirects (keep until e2e fully migrated, then thin redirect).

---

## Tasks

### Task 1: ADR-030 + flow write/read backend (PUT/GET flows + saveFlow + edit-lock)
**Files:** `docs/decisions/030-canvas-tech.md` (new), `cli/bridge-studio.ts` (PUT+GET flows), `forge-ui/lib/studio-client.ts` (saveFlow + fetchFlow), tests.
- [ ] ADR-030: record ReactFlow as the canvas tech (already installed + used in AgentGraphCanvas; flow-builder extends it; FlowTopology stays read-only monitor). Status Accepted.
- [ ] `GET /api/studio/flows/:id` in handleStudioRoutes — match `/^\/api\/studio\/flows\/([^/]+)$/`, slug-guard the id, loadFlowDefinition(resolve(forgeRoot,'studio','flows',id,'flow.yaml')), 404 unknown, sanitizeError on 500.
- [ ] `PUT /api/studio/flows/:id` in handleStudioWriteRoutes — slug-guard + path-guard; load existing → merge UI-editable fields (nodes/edges/triggers/goal/name/project/kb) → BUMP version (n+1) → validateFlow(merged, listAgentDefinitions('skills') map) → reject 400 + findings on error → **edit-lock: 423 if a run of this flowId is `active`** (check listRuns/queue for an in-flight run of the flow) → serializeFlowDefinition → write. CSRF auto-applies.
- [ ] `saveFlow(id, body)` + `fetchFlow(id)` in studio-client.ts (studioPut/studioGet pattern).
- [ ] TDD: PUT a flow edits nodes/edges + bumps version + preserves unedited fields; invalid flow (cycle / bad agent-ref / zero-gate) → 400 + findings; edit-lock → 423 when a run is active; path traversal id `../x` → 400; GET single flow + 404 unknown. **security self-audit** (write surface — id traversal, no command-field injection [flows have none], version monotonic).
- [ ] Spine green; commit `feat(studio): ADR-030 ReactFlow canvas; PUT/GET flows with version-bump + edit-lock (M4-1)`.

### Task 2: Flow builder canvas (BUILD tab)
**Files:** `forge-ui/app/flows/[id]/page.tsx` (tab state), `forge-ui/components/studio/flow-builder/{FlowBuilderCanvas,AgentPalette,ArtifactPicker,NodeMiniPanel,FlowHeader}.tsx` (ReactFlow), `lib/studio-client.ts` (already has saveFlow), tests.
- [ ] Tab state in /flows/[id]/page.tsx: `useState<'monitor'|'build'>('monitor')`, enable the BUILD button, render the builder when `build` (MONITOR block becomes conditional).
- [ ] FlowBuilderCanvas (ReactFlow): custom flow-node (hex visual + in/out Handles, agent-ref label, gate/fanOut/resumable read-only badge), palette drag → onDrop creates a node, port→port → onConnect creates an edge → opens ArtifactPicker → sets edge artifact label, edge delete (right-click/context), node mini-panel (agent name/purpose/open-in-builder/remove), toolbar (Clear, Layout=Kahn autolayout), pan/zoom (fitView). data-*: data-flow-node/data-node-id/data-agent-ref per node, canvas data-node-count/data-edge-count.
- [ ] FlowHeader: flow selector + name + goal (+ `data-goal-set` warning), project/kb selects (from /api/studio/projects + /kbs), trigger chips (on complete → flow picker), Save → saveFlow (PUT). Edit-lock UX: if a run is active, show a banner "flow locked — runs in flight" + Save creates the new version (or disable Save with the lock reason — match the 423 the backend returns).
- [ ] Mock fidelity: the BUILD tab matches flow-builder.html's interaction spec (drag-create, port-edges, artifact picker, mini-panel, autolayout, clear, goal warning, triggers). data-page="flows" (the monitor page already), data-flow-id.
- [ ] Next build green; commit `feat(studio-ui): flow builder canvas (ReactFlow) — BUILD tab authoring + save (M4-2)`.

### Task 3: Unified artifact viewer (`/artifact`)
**Files:** `forge-ui/app/artifact/page.tsx` (new, reads searchParams run/type/mode), `forge-ui/components/studio/artifact/{ArtifactTrail,GateBar,WorkItemsView,PrView,ReflectionView}.tsx` + compose PlanGate/DemoComparison/ReviewVerdictForm, `lib/studio-client.ts` (artifact fetch helpers), tests.
- [ ] `/artifact?run&type&mode` page: `<main data-run data-artifact-type data-mode data-gate-state>`, breadcrumb, ArtifactTrail (6 chips from run.artifactsReady — present/current/absent), the type→renderer switch, view-mode approval stamp, empty state.
- [ ] Renderers: plan → PlanGate (or a plan renderer for the goal/scope/ACs/decomposition/decisions per the mock — PlanGate today is the iframe; M4 plan-view renders the structured plan + decisions; gate-mode shows the gate bar with decisions-resolved-before-approve), workitems → new WorkItemsView (fetch WI specs, grid per mock), pr → new PrView (pr-description.md + the PR hero), demo → DemoComparison, verdict → ReviewVerdictForm (gate-mode) / verdict stamp (view-mode), reflection → new ReflectionView (3-col went-well/friction/lessons + KB links).
- [ ] GateBar: state machine idle→approved/sent-back; approve disabled until decisions resolved (plan) ; POSTs via postGate(runId, gateId, verdict) — gateId `verdict` for demo/verdict, `plan` for plan. Preserve the `verdict-form` + `plan-gate` data-* the harness asserts.
- [ ] data-* contract: data-page="flows", data-page-ready, data-run, data-artifact-type, data-mode, data-gate-state, trail chips data-artifact-trail-chip/data-trail-state, gate bar data-gate-state.
- [ ] Next build green; commit `feat(studio-ui): unified artifact viewer — 6 renderers + gate bar over the generalised gate endpoint (M4-3)`.

### Task 4: Fold-in + retirement
**Files:** `forge-ui/app/review/[cycleId]/page.tsx` + `app/architect/[sessionId]/page.tsx` (route through viewer / redirect), `scripts/e2e-journey.mjs` (new routes), tests.
- [ ] `/review/[cycleId]` → redirect to `/artifact?run=<cycleId>&type=verdict&mode=gate` (or render the viewer inline). The architect PLAN gate (`awaiting-verdict`) → the viewer's `type=plan&mode=gate` (the PlanGate iframe folds into the viewer's plan renderer). Preserve every data-* the harness asserts (verdict-form, plan-gate, demo-evaluation, the data-action buttons).
- [ ] e2e-journey: update the review/gate beats to navigate the new `/artifact` routes (or the redirect from the old routes); the assertions (`[data-component="verdict-form"]`, `[data-section="plan-gate"]`, `[data-action="approve-and-merge"]`) must still pass against the viewer.
- [ ] Old `/review` + architect PLAN screens become thin redirects (keep the redirect; the viewer is the single surface). `tab=monitor` deep links + the artifact-trail `back-to-monitor` link work.
- [ ] Spine green; commit `feat(studio-ui): fold /review + PLAN-gate into the artifact viewer; redirects (M4-4)`.

### Task 5: e2e author-a-flow + gate-via-viewer + verify
**Files:** `scripts/e2e-journey.mjs`, `docs/forge-studio/work-items.md`.
- [ ] e2e Act VII: author-a-flow beat — navigate /flows/<id> BUILD tab, drag an agent onto the canvas, draw an edge, label an artifact, set the goal, save (PUT → version bump). Assert data-node-count/data-edge-count + the save succeeded. gate-via-viewer beats — the review/plan gates now run through /artifact (replacing the old review beats). Soft-assert. frames.
- [ ] Full spine: npm test + build + brain lint + studio lint + ui:journey (exit 0, frames). 
- [ ] **verify:cycle (authorized, routine tier):** the gate path is touched (the gate now routes through the viewer) — re-run to confirm the cycle still reaches a green gate via the new path. Use the M3 setup (base f61d186, FORGE_SKIP_CONTRACT_CHECK, clear stale forge branch + resume_from). Expect the same green outcome as M3. Document.
- [ ] Commit `feat(studio): e2e Act VII — author-a-flow + gate-via-viewer; M4 (M4-5)`; tick work-items M4.

## Task order
1 (backend, foundation) → 2 (builder canvas, needs PUT) → 3 (viewer, needs gate endpoints from M3-4 + artifact trail from M1) → 4 (fold-in, needs the viewer) → 5 (e2e + verify, needs 2+3+4). 2 and 3 can overlap after 1 (different surfaces).

## Self-review notes
- Roadmap M4 ws-1 (ADR-030 + canvas)→T1+T2, ws-2 (flow builder)→T2, ws-3 (artifact viewer)→T3, ws-4 (fold-in)→T4, ws-5 (e2e)→T5. ✓
- ADR-030 spike is resolved by existing ReactFlow usage (not a separate spike PR) — recorded as the ADR.
- The riskiest fold-in risk: breaking the harness's verdict-form/plan-gate data-* assertions. Mitigation: the viewer RENDERS those exact components (ReviewVerdictForm/PlanGate) with their data-* intact; T4 preserves them + T5's ui:journey is the proof.
- Edit-lock (ADR-028 D6) is the load-bearing new backend rule — T1 enforces 423-when-active.
- verify:cycle at M4-5 (gate path touched) — authorized, expect the M3 green outcome via the new viewer-routed gate.
