# Forge Studio M5 — Knowledge Bases as Objects: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The brain becomes browsable, guidable, and health-visible — the mock's knowledge page over the real three-layer brains. A KB read API (graph from the brain filesystem + health from `forge brain lint` + node articles), the `/knowledge` viewer (hand-rolled force graph + node panel + health), a human-guidance loop (pin a note → `_guidance/*.md` → consumed by `brain-ingest`), a mechanical scope guard, and reflection→KB links.

**Architecture:** New read/write KB routes on the bridge over the existing brain dirs (`brain/forge-dev`, `brain/cycles`, `projects/<n>/brain`) + their M0 `kb.yaml` descriptors. The graph is built directly from the brain filesystem (gray-matter frontmatter + `[[wiki-link]]`/`related_themes` resolution) — NOT from the external graphify tool (which excludes `_raw/` and is an external dependency). Health reuses `runBrainLint`. The viewer **hand-rolls an SVG spring simulation** (no new dep — d3-force/sigma would be ask-first; the mock proves the hand-roll works for the brain's node counts). Guidance creates a new `_guidance/` convention consumed by `brain-ingest`.

**Tech Stack:** Existing — Next 14 (plain SVG, no graph lib), the M0 registry (loadKbDescriptor), `cli/brain-lint.ts` (runBrainLint), gray-matter, the M2/M4 PUT/POST CSRF seam. **No new dependencies.**

---

## Ground-truth facts (verified 2026-06-13 — do NOT re-derive)

**Brain structure:** `brain/forge-dev/` (kb.yaml scope `agent-integration`, ~11 `themes/*.md` + `decisions.md`/`reference.md` category indexes), `brain/cycles/` (kb.yaml scope `flow`, ~60 `themes/*.md` + `patterns.md`/`antipatterns.md`/`decisions.md`/`operations.md` indexes + `_raw/` cycle archives), `projects/<n>/brain/themes/` (Brain 3). `brain/INDEX.md` top-level. The THREE LAYERS map: index = INDEX.md + the category index files; theme = `themes/*.md`; raw = `_raw/**/*.md`.

**Theme node frontmatter** (gray-matter, verified): `title`, `description`, `category` (`pattern|antipattern|decision|operation|reference`), `keywords[]`, `created_at`, `updated_at`, `related_themes[]` (slug list). NO `layer`/`touched-by`/`links` fields (the mock's `layer` is derived from the dir; `touched-by` derive from git/updated_at). Wiki-links in body = `[[slug]]` (no path/ext), resolved by checking both `cycles/themes/<slug>.md` and `forge-dev/themes/<slug>.md` (`brain-lint.ts:findThemeBySlug`). `_raw` frontmatter: `source_type/source_url/source_title/ingested_at/ingested_by/cycle_id`.

**graphify-out/graph.json** exists but EXCLUDES `_raw/` (via `.graphifyignore`) and is from an external CLI tool. **M5 builds its own per-KB graph from the brain filesystem** (gray-matter walk + related_themes + [[wiki-link]] edges) — cleaner, scoped, no external-tool dependency. (Note in the plan: graphify is not used; the brain FS is the source.)

**forge brain lint health source:** `runBrainLint({cwd, scope:'full', project?, file?})` (`cli/brain-lint.ts:748`) → `{findings: Finding[], exitCode}`. `Finding = {category: 'auto-fix'|'flag'|'error', file, message, check?}`. 8 checks: checkFrontmatter, checkIndexSync, checkSourceLinks (wiki/link resolution), checkStaleness (forge-path refs), checkOrphans (reachable via INDEX→category→theme), checkLengthSoftCap (>60 flag/>100 error), checkContradictions (pattern+antipattern keyword overlap), checkCleanupCandidates. The mock's health (layer balance / orphans / link density / staleness) maps: layer balance from the counts, orphans from checkOrphans findings, link density = edges/nodes (computed), staleness from updated_at age + checkStaleness.

**Category→brain SSOT** (`brain-lint.ts:98` CATEGORY_TO_BRAIN_SUBDIR): pattern/antipattern/operation→`cycles`, decision/reference→`forge-dev`. **Brain gap #8 (category→brain vs kb.yaml scope) is NOT implemented** — M5-4 adds the mechanical guard (ingest validates the theme's category routes to a brain whose kb.yaml scope matches).

**brain-ingest + guidance:** `skills/brain-ingest/SKILL.md` (appends raw → themes → category index → log). The gap loop is `_logs/<cycle-id>/brain-gaps.jsonl` (brain-query logs unanswered Qs; brain-ingest consumes). **NO `_guidance/` dir exists** — M5-3 CREATES the convention: `brain/<kb-id>/_guidance/*.md` (a pinned human note, node-linked or floating); brain-ingest consumes + deletes them on the next pass; guidance nodes render amber-diamond until ingested.

**Existing KB GET (M1):** `GET /api/studio/kbs` (`bridge-studio.ts:532`) → `{kbs: KbWithCounts[]}` where `KbWithCounts = KbDescriptor{id,name,scope,desc,path} + counts{index,themes,raw}`. `loadKbDescriptor` (`registry.ts:404`). Client `Kb` type (studio-client.ts:131, path dropped). **NO** `GET /api/studio/kbs/:id`, **NO** `POST /api/studio/kbs/:id/guidance`, **NO** `POST /api/studio/kbs` (create) — all M5.

**Reflection→KB (M5-5):** `ReflectionRenderer.tsx:9` already has `ReflectionLesson = {text, target?: string}` and renders `target` → `<a href="/knowledge?id=<target>">⬡ {target}</a>`. BUT the reflector (`reflector.ts`) does NOT emit `target`, and there's no pipeline from `retro.md`/cycle-archive → the structured `ReflectionDoc` the viewer reads. M5-5: reflector lessons carry `target:<kb-node>`; a parse pipeline builds `ReflectionDoc` from the reflection output. (Smallest-value M5 piece — the viewer badge already resolves once `/knowledge` exists.)

**Project-builder KB create (M5-4):** `KbBind.tsx:34` "+ Create project brain" button is `disabled title="KB create is M5"`. Scaffolding a KB = mkdir `brain/<id>/` + write `kb.yaml` (id/name/scope/desc) + mkdir `themes/`+`_raw/`. Needs a `POST /api/studio/kbs` create route.

**StudioNav Knowledge (M5 enable):** `StudioNav.tsx:30` `{kind:'disabled', label:'Knowledge', title:'M5', id:'knowledge'}`. Flip to `{kind:'link', href:'/knowledge', id:'knowledge'}` once the route exists. Library KB cards (`LibraryCard.tsx:165` KbCard) are display-only `cursor:default` — link them to `/knowledge?id=<id>`.

**Mock (`knowledge-base.html`, the M5 UI spec — READ IT):** `data-page="knowledge"`, `?id=<kb-id>` selects the KB (query param, NOT a path — matches ReflectionRenderer's `/knowledge?id=`). SVG `#kb-svg` with `data-kb-id/data-node-count/data-edge-count/data-selected-node`. Nodes by layer: index=green hexagon, theme=steel circle, raw=faint dot, guidance=amber-dashed-diamond. Hand-rolled spring sim (k=0.04, restLength=160, repulsion=6000, damping=0.82, centerPull=0.012; 180 off-screen ticks then animate). Pan/zoom/drag, hover-adjacency. Right rail: NODE ARTICLE (title + layer badge + inbound/outbound `node-chip[data-jump]` + body with `wiki-link[data-target]`), HUMAN GUIDANCE (textarea + pin-guidance-btn → guidance node, node-linked or floating), KB HEALTH (layer-balance bars + connectivity dots [orphans/link-density] + staleness + suggested-ingest action). KB selector grouped by scope (project/flow/agent-integration optgroups). Legend + counts. Node `data-node-id/data-layer`, edges `data-edge-from/data-edge-to`.

---

## Design decisions locked for M5

1. **Graph from the brain filesystem (no graphify, no graph-lib dep).** M5-1 walks `brain/<kb>/themes/*.md` (gray-matter) → nodes (layer=theme); INDEX.md + category indexes → index nodes; `_raw/**/*.md` → raw nodes (optional/summarised — the brain has many; cap or sample). Edges from `related_themes[]` (frontmatter) + `[[wiki-link]]` (body, resolved). The viewer hand-rolls the SVG spring sim (port the mock's physics to a React component + requestAnimationFrame). NO new npm dep.
2. **KB id = the descriptor id** (`forge-dev`, `cycles`, or a project's). The route `/knowledge?id=<kb-id>` (query param). Per-KB graph scoped to that brain's dir.
3. **Guidance is a NEW filesystem convention:** `POST /api/studio/kbs/:id/guidance {text, targetNode?}` → writes `brain/<kb-id>/_guidance/<timestamp>.md` (frontmatter: `created_at`, `target_node?`, body=text). The viewer renders pending `_guidance/*.md` as amber-diamond nodes. `brain-ingest` gains a consume step (read `_guidance/*.md`, incorporate, delete) — M5-3 adds it to the skill + a consume helper. Guidance is human-originated (the twin of brain-gaps.jsonl).
4. **Scope guard (M5-4)** = a mechanical check added to the ingest/lint path: a theme's `category` must route (CATEGORY_TO_BRAIN_SUBDIR) to a brain dir whose `kb.yaml` scope is consistent (e.g. a `pattern` → cycles, whose kb.yaml scope is `flow`; a `decision` → forge-dev, scope `agent-integration`). Add a `checkCategoryScope` lint check OR an ingest-time validation. Closes brain gap #8.
5. **Reflection→KB (M5-5)** is the smallest piece: the reflector emits `target:<kb-node-slug>` on lessons where applicable; a parse step builds the `ReflectionDoc` (with `lessons[].target`) the M4 ReflectionRenderer already consumes. The viewer's KB badge resolves to `/knowledge?id=<target>` (already wired). M5 just needs the target to flow + the doc pipeline.
6. **Write surfaces (guidance POST, KB-create POST)** are new — security-review (input validation, path traversal on kb-id, no command injection; guidance text is markdown, sanitized on render). Lighter than M2/M3 (no exec fields) but the parent runs a security pass.

---

## Tasks

### Task 1: KB read API (graph + health + node article)
**Files:** `orchestrator/kb-graph.ts` (new — build the per-KB graph from the brain FS), `cli/bridge-studio.ts` (GET /api/studio/kbs/:id), `cli/brain-lint.ts` (reuse runBrainLint), `forge-ui/lib/studio-client.ts` (fetchKb), tests.
- [ ] `orchestrator/kb-graph.ts`: `buildKbGraph(forgeRoot, kbId): {nodes: KbNode[], edges: KbEdge[]}` where `KbNode = {id, title, layer: 'index'|'theme'|'raw', category?, updatedAt?, body?}` and `KbEdge = {from, to}`. Walk the kb's brain dir: INDEX/category indexes → index nodes; `themes/*.md` (gray-matter) → theme nodes (title/category/updated_at/body); `_raw/**/*.md` → raw nodes (cap to a reasonable N, e.g. 80, newest-first — note the cap). Edges: each theme's `related_themes[]` → edges; each `[[slug]]` in a body → resolved edge; raw `## Sources` citations → edges (optional). `getKbNodeArticle(forgeRoot, kbId, nodeId): {title, layer, body, inbound: string[], outbound: string[], touchedBy?}` (touchedBy from git last-author or updated_at). Pure FS reads; tests against the real brain dirs.
- [ ] `GET /api/studio/kbs/:id` (bridge-studio handleStudioRoutes): slug-guard id, resolve the brain dir from loadKbDescriptors, return `{kb: KbWithCounts, graph: {nodes, edges}, health: {...}}`. Health = run `runBrainLint({cwd:forgeRoot, scope:'full'})` filtered to this kb's dir → layer-balance (counts), orphans (checkOrphans findings for this kb), linkDensity (edges/nodes), staleness (themes/raw with old updated_at). `GET /api/studio/kbs/:id/nodes/:nodeId` → the node article (or include articles in the graph payload — decide; prefer a separate node-article fetch to keep the graph payload small).
- [ ] studio-client: `fetchKb(id)` + `fetchKbNode(id, nodeId)`.
- [ ] TDD: buildKbGraph on `cycles` → nodes incl. index+themes, edges from related_themes/wiki-links; the article fetch returns body + inbound/outbound; health reflects real lint findings; bad kb id → 404; traversal → 400.
- [ ] Spine green; commit `feat(studio): KB read API — per-KB graph from brain FS + health from brain-lint + node articles (M5-1)`.

### Task 2: KB viewer (`/knowledge`)
**Files:** `forge-ui/app/knowledge/page.tsx` (new, ?id= param), `forge-ui/components/studio/knowledge/{KbGraph,NodeArticle,KbHealth,GuidancePanel,KbSelector}.tsx`, `lib/studio-client.ts`, StudioNav (enable Knowledge), tests.
- [ ] `/knowledge?id=<kb-id>` page ('use client'): `<main data-page="knowledge" data-page-ready>`. StudioNav (enable the Knowledge link). KB selector (scope-grouped optgroups project/flow/agent-integration). The graph + right rail (article/guidance/health) per the mock.
- [ ] KbGraph (hand-rolled SVG spring sim): port the mock's physics (k/restLength/repulsion/damping/centerPull; off-screen ticks then requestAnimationFrame animate). Nodes by layer (index=green hexagon, theme=steel circle, raw=faint dot, guidance=amber-dashed-diamond). data-kb-id/data-node-count/data-edge-count/data-selected-node on the svg; data-node-id/data-layer per node; data-edge-from/data-edge-to per edge. Pan/zoom (wheel + drag canvas), drag node (pin), hover-adjacency highlight, click node → select + fetch article. Legend + counts.
- [ ] NodeArticle: title + layer badge + inbound/outbound node-chips (data-jump) + body (resolve [[wiki-link]] → data-target clickable). KbHealth: layer-balance bars + connectivity dots (orphans/link-density) + staleness + suggested-ingest. GuidancePanel: textarea + pin button (M5-3 wires the POST; for M5-2 the panel renders, the POST lands in M5-3 OR wire it here — decide; minimal: panel + button present in M5-2, POST in M5-3).
- [ ] Enable StudioNav Knowledge link + library KbCard links → /knowledge?id=<id>.
- [ ] Mount-effect signal.cancelled; reach data-page-ready; stable keys; no nested <a>; components <400 LOC (the graph component may approach it — split the sim into a hook if needed).
- [ ] Next build green; commit `feat(studio-ui): /knowledge viewer — hand-rolled force graph + node article + health (M5-2)`.

### Task 3: Human guidance loop
**Files:** `cli/bridge-studio.ts` (POST /api/studio/kbs/:id/guidance), `orchestrator/kb-graph.ts` (include pending `_guidance/*.md` as guidance nodes), `skills/brain-ingest/SKILL.md` + a consume helper, `forge-ui/.../GuidancePanel.tsx` (wire the POST), tests.
- [ ] `POST /api/studio/kbs/:id/guidance {text, targetNode?}`: slug-guard id + targetNode; write `brain/<kb-id>/_guidance/<ISO-timestamp>.md` (frontmatter created_at + target_node? + body=text). 200 {ok, file}. CSRF auto. Sanitize. Path-guard.
- [ ] buildKbGraph: read `brain/<kb>/_guidance/*.md` → guidance nodes (layer 'guidance', linked to target_node if set, else floating). The viewer renders them amber-diamond.
- [ ] brain-ingest consume: add a step to skills/brain-ingest/SKILL.md (read `_guidance/*.md`, incorporate into themes, DELETE the consumed files) + a small `consumeGuidance(forgeRoot, kbId)` helper if the skill needs orchestrator support. Document the human-guidance twin of brain-gaps.
- [ ] GuidancePanel: pin-guidance → POST → on success the guidance node appears (re-fetch the graph). data-guidance-pinned signal.
- [ ] TDD: POST writes the file; buildKbGraph surfaces it as a guidance node; consume deletes it; traversal/bad-id → 400/404. security self-audit (the parent runs a security pass — guidance is markdown, no exec).
- [ ] Spine green; commit `feat(studio): human guidance loop — pin → _guidance/*.md → brain-ingest consumes (M5-3)`.

### Task 4: Scope guard + KB create
**Files:** `cli/brain-lint.ts` (checkCategoryScope) OR an ingest-time guard, `cli/bridge-studio.ts` (POST /api/studio/kbs create), `forge-ui/.../KbBind.tsx` (enable create), tests.
- [ ] Scope guard (brain gap #8): add a `checkCategoryScope` to brain-lint (or the ingest path) — a theme's category must route (CATEGORY_TO_BRAIN_SUBDIR) to a brain dir consistent with that brain's kb.yaml scope; a mis-routed theme (e.g. a `decision` theme sitting in cycles/) → flag/error. TDD with a mis-categorised fixture.
- [ ] `POST /api/studio/kbs {id, name, scope, desc}` create: slug-guard id; scaffold `brain/<id>/` + `kb.yaml` (serialize via the registry pattern) + mkdir `themes/`+`_raw/`; reject if exists (409); validate scope enum. Returns {ok, id}.
- [ ] KbBind: enable the "+ Create project brain" button → POST create (scaffold a project brain + bind it to the project). Slugify the project name → kb id.
- [ ] TDD: create scaffolds the dir+kb.yaml; duplicate → 409; bad scope → 400; the scope guard catches a mis-routed theme.
- [ ] Spine green; commit `feat(studio): category→scope guard (brain gap #8) + KB create from project builder (M5-4)`.

### Task 5: Reflection → KB links
**Files:** `orchestrator/phases/reflector.ts` (emit target on lessons), a retro→ReflectionDoc parse step (wherever the artifact viewer's reflection data is sourced — check the M4 viewer's reflection fetch), tests.
- [ ] The reflector's lessons carry `target:<kb-node-slug>` where a lesson maps to a brain theme (the reflector already writes themes — link the lesson to the theme slug it created/touched). 
- [ ] The reflection artifact the M4 viewer reads (ReflectionRenderer's ReflectionDoc) is built with `lessons[].target` populated. Trace where the viewer's reflection data comes from (fetchReflection / the reflection artifact) and ensure target flows. The viewer's KB badge (→ /knowledge?id=<target>) then resolves to the M5 viewer.
- [ ] TDD: a reflection with a lesson.target renders the KB badge linking to /knowledge?id=<target>; the link resolves (the node exists in that kb's graph).
- [ ] Spine green; commit `feat(studio): reflection lessons carry KB-node targets; viewer badges resolve to /knowledge (M5-5)`.

### Task 6: e2e browse-KB + pin-guidance + verify
**Files:** `scripts/e2e-journey.mjs`, `docs/forge-studio/work-items.md`.
- [ ] e2e Act VIII: browse-KB beat — from the library, click a KbCard → /knowledge?id=<kb> → assert data-page="knowledge" ready, the graph (data-node-count ≥ some, data-edge-count), click a theme node → article panel (the node's body + inbound/outbound), the health panel. pin-guidance beat — type a guidance note + pin → assert the guidance node appears (amber-diamond) OR the POST succeeded + data-guidance-pinned. Soft-assert. frames.
- [ ] Full spine: npm test + build + brain lint + studio lint + ui:journey (exit 0, frames). 
- [ ] **verify:cycle (authorized, routine tier)** IF the reflection/ingest path is touched in a way that affects a cycle — M5 is mostly read + a guidance write + a lint check; the reflector change (M5-5) touches the cycle's reflection phase. Re-run verify:cycle to confirm the reflector still closes the cycle green (the reflector is log-and-continue, so low risk, but the M5-5 target emission touches it). Use the M3/M4 setup. Document. (If M5-5 is purely additive to the lesson shape with no behaviour change, note that verify is a low-risk confirmation.)
- [ ] Commit `feat(studio): e2e Act VIII — browse-KB + pin-guidance; M5 (M5-6)`; tick work-items M5.

## Task order
1 (read API, foundation) → 2 (viewer, needs the API) → 3 (guidance, needs the viewer's panel + the API) → 4 (scope guard + create, independent of 2/3 — can overlap after 1) → 5 (reflection→KB, independent — can run anytime) → 6 (e2e + verify, needs 2+3). 4 and 5 can run in parallel with 2/3 (different surfaces).

## Self-review notes
- Roadmap M5 ws-1 (read API)→T1, ws-2 (viewer)→T2, ws-3 (guidance)→T3, ws-4 (scope guard + create)→T4, ws-5 (reflection→KB)→T5, ws-6 (e2e)→T6. ✓
- Graph-lib decision: HAND-ROLL the SVG spring sim (no new dep, mock precedent, brain node counts are small). d3-force/sigma rejected as ask-first new deps. Recorded here (no separate ADR needed — it's a no-new-dep implementation choice).
- graphify NOT used (external tool, excludes _raw); M5 builds the graph from the brain FS directly — more accurate + scoped + dependency-free.
- The guidance `_guidance/` convention is NEW (no prior dir) — M5-3 creates it + the brain-ingest consume step.
- Brain gap #8 (category→scope) closes in M5-4.
- verify:cycle at M5-6 only if the reflector change touches cycle behaviour — likely a low-risk confirmation since M5-5 is additive.
- Write surfaces (guidance POST, KB-create POST): security pass (path traversal on id/targetNode, markdown sanitization) — lighter than M2/M3 (no exec fields).
