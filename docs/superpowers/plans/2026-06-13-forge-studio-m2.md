# Forge Studio M2 — Builders: Agents + Projects: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Agents and projects become editable through the UI, and definitions begin to *drive* the hot path: the four in-cycle invocation specs and the architect read from SKILL.md instead of hardcoded literals; project `instructions`/`demoProcess`/`skills` flow into agent context. First write surfaces land behind server-side validation + a mandatory security review.

**Architecture:** Agent builder + project builder pages over new bridge PUT routes (`handleStudioWriteRoutes`, the first non-GET studio surface) using the M0 canonical serializers. Invocation files flip `export const pmAgentSpec = {…}` → `deriveAgentSpec('skills/<x>/SKILL.md')`; the M0 no-drift test flips from dual-source to single-source. The architect gains `architectAgentSpec`. Project config grows `northStar/instructions/demoProcess/skills/kb` (in the project repo's `.forge/project.json`), consumed by PM (instructions) and the unifier (demoProcess+skills, closing the demo.skill gap).

**Tech Stack:** Existing — TS ESM + node:test, Next 14, the M0 registry (gray-matter/js-yaml serializers), the M1 bridge-studio module. No new deps.

---

## Ground-truth facts (verified 2026-06-13 — do NOT re-derive)

**Schema reconciliation (critical):**
- M0 `AgentDefinition` (orchestrator/studio/types.ts) nests `composition.{skills,tools,mcps,hooks}` and uses `body` for process intent. The **mock** (agent-builder.html) stores `skills/tools/mcps/hooks` FLAT on the agent root and uses `process` for the body. The builder UI ↔ server must translate: UI flat fields → frontmatter `composition` + `body`. The PUT route writes via `serializeAgentDefinition` which already emits the `composition` shape.
- The builder does NOT expose `slug/phase/surface/allowedTools/disallowedTools/budgets`. **PUT must preserve** these from the existing SKILL.md (load current def, merge UI-editable fields over it, re-serialize) — never clobber the body below the frontmatter or the non-UI frontmatter keys. `allowedTools/disallowedTools` stay SKILL.md-authored in M2 (UI editing of tool allow-lists deferred).
- No `ProjectDefinition` type exists. Project config lives in `orchestrator/project-config.ts` (`ProjectConfig`, loaded from `.forge/project.json` in the PROJECT repo via `loadProjectConfig`, project-config.ts:154). M2 ADDS fields `northStar/instructions/demoProcess/skills/kb` to `ProjectConfig` + its validator. `demoProcess` = `{kind:'capture'|'verify'|'present', text:string}[]`.
- Catalog model picker needs `costIn/costOut` per model (mock) — M0 `CatalogModel` has only `{id,name,sdk,tier}`. Add `costIn?/costOut?` to the catalog schema + seed (additive, optional).

**Invocation flip (M2-3):**
- `pmAgentSpec` (pm-invocation.ts:35), `devAgentSpec` (dev-invocation.ts:56), `unifierAgentSpec` (unifier-invocation.ts:61), `reflectorAgentSpec` (reflector-invocation.ts:51) — each replaced by `deriveAgentSpec('skills/<x>/SKILL.md')`. `PM_MODEL = modelForSpec(pmAgentSpec)` (pm-invocation.ts:44) etc. keep working (modelForSpec reads the derived tier).
- **deriveAgentSpec reads files eagerly at module load** (derive.ts:27, readFileSync). Flipping means the read runs at import time with `root = process.cwd()`. Forge always runs from repo root; tests import these modules from repo root too (verified: derive.test.ts imports them). Acceptable — but the flip must keep `process.cwd()` as the default root. If any test imports an invocation module from a non-root cwd it will throw at import; none do today.
- The M0 no-drift test (derive.test.ts) currently deep-equals derived vs the hardcoded constants. After the flip the constants ARE the derived values (tautology). REPLACE that test: assert each derived spec deep-equals an explicit expected literal (the known-good values), so it still catches frontmatter regressions without the now-removed second source. Keep the 4 phase agents covered.

**brainAccess enforcement (M2-3):**
- PM "0 brain reads = abort" gate at project-manager.ts:245 (`recordBrainGateResult`) is hardcoded for PM. M2 wires it to the agent's `brainAccess`: enforce the abort ONLY when the agent def's `brainAccess === 'mandatory'`. PM/reflector/architect frontmatter = mandatory; dev/unifier = advisory (M0 seeds). Read brainAccess from `loadAgentDefinition` (the derived path) and gate on it. Reflector has no such gate today — adding one is optional/out-of-scope; just don't break PM.

**Architect adoption (M2-4):**
- architect-runner.ts:862 hardcodes `allowedTools: ['Read','Grep','Glob','Bash']`; no model set (SDK default). M2: add `export const architectAgentSpec = deriveAgentSpec('skills/architect/SKILL.md')` (frontmatter already seeded in M0 with those exact tools + sonnet), replace the inline allowedTools with `architectAgentSpec.allowedTools`, add `model: modelForSpec(architectAgentSpec)` to the runStructured options (architect-runner.ts ~862 options object). The queryFn injection seam stays. Closes the last ADR-024 gap.

**Project config consumption (M2-6):**
- `instructions` generalises `standing_work_item_acs` (injected at project-manager.ts:292 via `appendStandingAcs`). Add a parallel injection: project `instructions` → PM user prompt or WI body, same idempotent best-effort pattern. `standing_work_item_acs` stays (the WI-shaped subset).
- `demoShape` sourced from `project.json` at developer-loop.ts:1023; `demoInstructionsForShape` (unifier-invocation.ts:186) references skills/demo/SKILL.md by name (agent reads it). M2: thread the project's `demoProcess` typed steps + `skills[]` into the unifier prompt so the unifier composes the project's demo skill and follows the typed steps (closes demo.skill known-gap §2026-05-31). Read from the already-loaded projectConfig.

**Write-route seam (M2-2):**
- bridge-studio.ts:292 `if (method !== 'GET') return false`. Add `handleStudioWriteRoutes(req,res,ctx,url,method): Promise<boolean>` handling PUT (call BEFORE the GET early-return, or split: GET routes vs write routes, both plugged into ui-bridge after handleReflect). Body via `readJson(req)` (ui-bridge.ts:1150). CORS: ui-bridge handleHttp:466 only allows GET,POST — add PUT to access-control-allow-methods + OPTIONS. Serializers: `serializeAgentDefinition` (registry.ts:220), `serializeFlowDefinition` (registry.ts:368) — pre-built, no callers yet. **security-review skill MANDATORY before merge (first write surface; CLAUDE.md rule).**

**preflight (M2-5):** `cli/preflight.ts` — `runPreflight(projectDir)` → PreflightReport; clauses C1–C8+BRAIN/DEMO/ARTIFACTS (ClauseId at preflight.ts:35); hard=C1/C2/C4. The project-builder's 5 readiness checks (north star / instructions / demo capture+verify / ≥1 skill / KB bound) are a UI-side subset; the bridge exposes `runPreflight` via a GET route for the contract-ready panel.

**Mock specs (READ THESE — they are the product spec):** mockups/agent-flow-builder/agent-builder.html (3-col workbench: catalog palette w/ search+collapse+used-dimming, 4 typed drop zones w/ kind-rejection, name/purpose/process/interactivity, SDK cards [non-Claude clickable in mock but M2 disables non-installed per plan], fixed/range strategy segmented toggle, model chips w/ tier+cost, sub-agent model, 3 brain-access cards, live YAML preview, 6-check readiness + ready badge at 6, used-in-flows, dirty-guard, ?id= routing, save→upsert) + project-builder.html (north star +140 counter, instructions+readback chips, demo timeline w/ typed steps+drag-reorder+8 presets, skills bind, KB bind/create, 5-check contract readiness + flow-ready badge, used-by-flows, Ctrl+S) + shared/data.js (Agent/Project/catalog shapes) + shared/tokens.css.

**M1 surfaces to extend:** forge-ui/lib/studio-client.ts (add PUT helpers), globals.css (tokens already there), StudioNav (Agents/Projects currently disabled chips → enable when pages exist), the library "+ New"/card links (enable agent/project navigation).

---

## Design decisions locked for M2

1. **Agent PUT contract** — `PUT /api/studio/agents/:slug` body = `{name, purpose, process, interactivity, brainAccess, composition:{skills,tools,mcps,hooks}, runtime:{sdk,strategy,model?,range?,subagentModel?}}`. Server: `loadAgentDefinition` the existing SKILL.md → merge these fields over it (preserve slug/phase/surface/allowedTools/disallowedTools/budgets/body-below-frontmatter... wait: `process` IS the body — so body = process from UI) → `validateAgent` → reject on any error-level finding (400 with findings) → `serializeAgentDefinition` → write. New agents: `slug` from name, scaffold a skills/<slug>/SKILL.md. Re-run validateAgent at spawn already happens via studio lint gate.
2. **Project PUT contract** — `PUT /api/studio/projects/:id` writes the project repo's `.forge/project.json` (path from projects.yaml registry). Body = the M2 fields; merge over existing config (preserve demo/quality_gate_cmd/gates/standing_work_item_acs). Validate northStar ≤140, demoProcess kinds enum, skills are strings. Registry index (studio/projects.yaml) only updated when a NEW project is registered (out of M2 scope — M2 edits existing registered projects).
3. **No auto-approve, localhost-only** — write routes stay localhost (bridge binds 127.0.0.1); security-review covers input validation, path traversal (slug/id → fs path), and the no-clobber guarantee. PUT validates slug/id against SLUG_RE before any fs path construction.
4. **Single-source flip is the load-bearing risk** — gated by verify:cycle (M2-7). The flip changes how every phase gets its model/tools. Mitigation: the derived values are byte-identical to today's hardcoded ones (M0 proved this via the no-drift test); the flip is mechanical.
5. **UI editing scope** — M2 agent builder edits composition + identity + runtime + brainAccess; it does NOT edit allowedTools/disallowedTools/phase/budgets (SKILL.md-authored, shown read-only). Project builder edits the 5 M2 fields. Flow builder is M4.

---

## Tasks

### Task 1: Schema extensions (types + validation + catalog) — M2 foundation
**Files:** orchestrator/studio/types.ts (+ProjectDefinition/DemoStep, CatalogModel cost fields), orchestrator/studio/validate.ts (+validateProject), orchestrator/project-config.ts (+M2 fields on ProjectConfig + validator), studio/catalog.yaml (+costIn/costOut seed), tests.
- [ ] Add `DemoStep = {kind:'capture'|'verify'|'present', text:string}` and `ProjectDefinition` (id,name,northStar,instructions,demoProcess:DemoStep[],skills:string[],kb:string|null) to types.ts. Add `costIn?:number; costOut?:number` to CatalogModel.
- [ ] Extend `ProjectConfig` (project-config.ts) + `validateProjectConfig` with optional `northStar?` (≤140), `instructions?`, `demoProcess?` (kind enum + text), `skills?` (string[]), `kb?` (string|null). TDD: validator accepts/rejects each.
- [ ] `validateProject(def): Finding[]` in validate.ts: northStar length, demoProcess kinds, skills string array, slug. Tests.
- [ ] catalog.yaml: add costIn/costOut to the 3 models; lockstep test stays green.
- [ ] Spine green; commit `feat(studio): project + demo-step schema, catalog model costs (M2-1)`.

### Task 2: Bridge write routes + security review — M2-2
**Files:** cli/bridge-studio.ts (handleStudioWriteRoutes), cli/ui-bridge.ts (PUT in CORS + dispatch), tests.
- [ ] `handleStudioWriteRoutes(req,res,ctx,url,method)`: `PUT /api/studio/agents/:slug` (per design §1 — load+merge+validate+serialize+write SKILL.md; new agent scaffolds dir), `PUT /api/studio/projects/:id` (per design §2 — write project repo .forge/project.json). 400 on validation findings (return the findings), 404 unknown, 403/400 on bad slug (SLUG_RE before fs path). readJson for body. Never clobber preserved fields (load-merge-write); no path traversal (validate slug/id).
- [ ] ui-bridge: add PUT to access-control-allow-methods + OPTIONS; dispatch handleStudioWriteRoutes after handleReflect (alongside the GET handler).
- [ ] TDD: tmp-fixture — PUT an agent edits composition + preserves body/allowedTools; PUT a project writes project.json; invalid body → 400 + findings; traversal slug `../x` → 400; unknown slug → 404; GET passthrough unaffected.
- [ ] **Run the security-review skill on the diff** (mandatory — first write surface). Address findings.
- [ ] Spine green; commit `feat(studio): bridge PUT routes for agents + projects, server-validated (M2-2)`.

### Task 3: Invocation files read definitions (single-source flip) — M2-3
**Files:** orchestrator/{pm,dev,unifier,reflector}-invocation.ts, orchestrator/studio/derive.test.ts, orchestrator/phases/project-manager.ts (brainAccess gate), tests.
- [ ] Flip each `export const <x>AgentSpec = {…}` → `deriveAgentSpec('skills/<x>/SKILL.md')`. Keep `<X>_MODEL = modelForSpec(<x>AgentSpec)` and the tool-list constants (PM_ALLOWED_TOOLS etc. — derive them FROM the spec: `export const PM_ALLOWED_TOOLS = pmAgentSpec.allowedTools` so downstream imports keep working). Verify the cycle still runs (the existing per-phase tests must pass unchanged).
- [ ] Replace the no-drift test (derive.test.ts) per ground-truth: assert each of the 4 derived specs deep-equals an explicit expected literal (phase/skill/tier/allowedTools/disallowedTools). Remove the now-tautological dual-source import.
- [ ] Wire brainAccess: read the agent def's brainAccess; PM 0-read abort (project-manager.ts:245) fires only when brainAccess==='mandatory'. Test: PM with mandatory + 0 reads → abort; (advisory hypothetical → no abort). Keep PM behaviour identical (it IS mandatory).
- [ ] Spine green; commit `feat(studio): invocation specs derive from SKILL.md (single source); brainAccess gates PM (M2-3)`.

### Task 4: Architect adopts PhaseAgentSpec — M2-4
**Files:** orchestrator/architect-runner.ts, test.
- [ ] `export const architectAgentSpec = deriveAgentSpec('skills/architect/SKILL.md')`; replace inline `allowedTools:['Read','Grep','Glob','Bash']` (runStructured options ~862) with `architectAgentSpec.allowedTools`; add `model: modelForSpec(architectAgentSpec)`. queryFn seam unchanged.
- [ ] Test: architect spec derives to the expected tools/tier; the runStructured options carry them (assert via the queryFn injection seam capturing the options).
- [ ] Spine green; commit `feat(studio): architect adopts derived PhaseAgentSpec — closes ADR-024 gap (M2-4)`.

### Task 5: Agent builder page — M2 (largest UI)
**Files:** forge-ui/app/agents/[id]/page.tsx (+ ?id= via searchParams or [id] route — match mock ?id=), components/studio/agent-builder/* (CatalogPalette, DropZone, RuntimePicker, ReadinessPanel, YamlPreview), lib/studio-client.ts (putAgent), StudioNav (enable Agents).
- [ ] Full mock agent-builder.html spec: catalog palette (search/collapse/used-dimming from /api/studio/catalog), 4 typed drop zones with kind-rejection, name/purpose/process/interactivity, SDK cards (non-installed SDKs disabled — only claude installed in M2, codex/gemini show disabled), fixed/range strategy (range stored, enforced M6 — selectable + saved), model chips with tier+cost, sub-agent model, 3 brain-access cards, live YAML preview, 6-check readiness + ready badge at 6, used-in-flows (from /api/studio/flows), dirty/discard/unsaved-guard, save→PUT /api/studio/agents/:slug. data-* per mock (data-page="agents", data-agent-id, data-dirty, zones data-accepts/data-count, runtime data-sdk/data-strategy/data-model-count, readiness data-ready-count, ready-badge). Translate flat UI ↔ composition on load/save.
- [ ] Enable the Agents nav link + library agent-card links → /agents/<slug>.
- [ ] Next build green; commit `feat(studio-ui): agent builder — catalog, drop zones, runtime, readiness, YAML preview (M2-5)`.

### Task 6: Project builder page + config consumption — M2-5/M2-6
**Files:** forge-ui/app/projects/[id]/page.tsx + components/studio/project-builder/*, lib/studio-client.ts (putProject, fetchPreflight), bridge GET /api/studio/projects/:id/preflight, orchestrator/phases/project-manager.ts (instructions injection), orchestrator/{unifier-invocation,phases/developer-loop}.ts (demoProcess+skills consumption), tests.
- [ ] Project builder per mock: north star +140 counter, instructions + readback chips, demo timeline (typed steps, drag-reorder, 8 presets), skills bind (search + drop), KB bind/create, 5-check contract readiness driven by a `GET /api/studio/projects/:id/preflight` (runPreflight subset) + the UI checks, used-by-flows, Ctrl+S → PUT. data-* per mock (data-page="projects", data-project-id, demo data-step-count, skills data-count, readiness data-ready-count/data-flow-ready). Enable Projects nav.
- [ ] Consume config: `instructions` injected into agent context (parallel to standing_work_item_acs at project-manager.ts:292, idempotent); `demoProcess` typed steps + `skills[]` threaded into the unifier prompt (unifier-invocation.ts demoInstructions path) so the unifier composes the project demo skill + follows steps (closes demo.skill gap). Tests for both injections.
- [ ] Spine green + Next build green; commit `feat(studio): project builder + instructions/demoProcess/skills consumption (M2-5/6)`.

### Task 7: e2e Act V + verify:cycle gate — M2-7
**Files:** scripts/e2e-journey.mjs, docs/forge-studio/work-items.md.
- [ ] New beats: edit-an-agent (open /agents/project-manager, change composition/purpose, save, readiness reflects, YAML preview updates) + edit-a-project (open a project, set north star + add demo steps, contract readiness → flow-ready, save). Soft-assert data-* per existing harness pattern. Repoint any nav. Renumber end card.
- [ ] Full spine: npm test + build + brain lint + studio lint + ui:journey (exit 0, video). Paste counts.
- [ ] **Operator-gated:** flag `npm run verify:cycle` (routine tier) — real $; cannot run unattended. Document the checkpoint in the commit + work-items; the human runs it to confirm the single-source flip + instructions flow on a real cycle before M2 is fully closed.
- [ ] Commit `feat(studio): e2e Act V — agent + project builders; M2 (M2-7)`; tick work-items M2.

## Task order
1 → 2 (needs 1) → 3 (independent of 2, needs M0 derive) → 4 (needs 3's pattern) → 5 (needs 2) → 6 (needs 2) → 7 (needs 5+6). 3 and 5 can overlap after 1+2.

## Self-review notes
- Roadmap M2 ws-1→T5, ws-2→T2, ws-3→T3, ws-4→T4, ws-5→T6, ws-6→T6, ws-7→T7. ✓
- The flat-composition ↔ nested reconciliation (mock vs M0 schema) is the subtle correctness risk — called out in design §1 + T5. The no-clobber-preserve guarantee is the security-review focus + T2 test.
- Exit criteria: every phase spec file-sourced (T3+T4), builders functional in ui:journey (T7), security review clean (T2), **verify:cycle routine passes (operator-gated, T7)**.
- ADR touch: ADR-024 closes (architect adoption); ADR-010 brainAccess promoted to field-driven (T3); ADR-017 project config extended (T1). Update those ADRs' status notes in the relevant task.
