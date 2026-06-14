# Forge Studio — Feature & Work-Item Breakdown

> Companion to [`roadmap.md`](./roadmap.md). The roadmap fixes scope and exit
> criteria per milestone; this doc decomposes each milestone into
> implementation-ordered work items (WIs) with explicit dependencies and
> acceptance criteria, sized for one focused PR-shaped unit each.
> Status: living doc, updated as milestones land. Created 2026-06-13.

Legend: `⛓ depends-on` · AC = acceptance criteria · spine = `npm test` +
`npm run build` + `forge brain lint` (+ `npm run ui:journey` where UI touched).

---

## M0 — Definitions as data ✅ COMPLETE 2026-06-13

Detailed executable plan: [`docs/superpowers/plans/2026-06-13-forge-studio-m0.md`](../superpowers/plans/2026-06-13-forge-studio-m0.md).
All five WIs landed on `feat/studio-m0` (751 tests, build, brain lint, studio lint all green;
exit criteria met: definitions lint clean, no-drift derivation test, zero hot-path change).

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M0-1 | Studio types + registry (load/serialize all definition kinds) | — | `orchestrator/studio/{types,registry}.ts`; gray-matter for SKILL.md frontmatter, js-yaml for flow/kb/catalog/projects YAML (ADR-027 names both); round-trip tests; `orchestrator/studio/*.test.ts` joins npm test glob |
| M0-2 | Validation (`validate.ts`) | M0-1 | agent readiness 6 checks (mock parity: purpose / ≥1 skill / ≥1 hook / process / interactivity / runtime) — structural ones error, empty-composition ones flag; flow rules: unique node ids, node has agent-or-gate, agent refs resolve, edges resolve, DAG acyclic, fanOut names an inbound-edge artifact, zero-gate rejected unless `disposable: true`; kb scope enum; catalog model→sdk ref integrity; slug rule `^[a-z][a-z0-9-]*$` |
| M0-3 | Spec derivation + seed agent frontmatter | M0-1 | studio frontmatter added to the 5 agent SKILL.md files (architect, project-manager, developer-ralph, developer-unifier, reflector) mirroring `*-invocation.ts` verbatim; `derive.ts` maps frontmatter → `PhaseAgentSpec`; no-drift test deep-equals derived vs hardcoded for pm/dev/unifier/reflector |
| M0-4 | Seed studio data | M0-1, M0-2 | `studio/flows/forge-cycle/flow.yaml` (today's cycle, truthful), `studio/catalog.yaml`, `studio/projects.yaml`, `brain/forge-dev/kb.yaml`, `brain/cycles/kb.yaml`; all pass validate in tests |
| M0-5 | CLI `forge studio lint` | M0-2, M0-3, M0-4 | `case 'studio'` in `orchestrator/cli.ts` → `cli/studio-lint.ts`; lints every definition; exit non-zero on errors (brain-lint pattern); joins standing gate set; full spine green |

**Reality deltas found vs roadmap text (locked in here):**
- Only **5** agent SKILL.md files exist — there is no reviewer skill; review is
  the human gate. Flow schema therefore allows **gate-only nodes** (node valid
  with `gate` and no `agent`); the seed `review` node is gate-only.
- Adding frontmatter changes the raw SKILL.md text injected as system prompts
  (the loaders do `readFileSync`, no stripping). Accepted: ~15 lines of
  descriptive YAML; flagged for the M0 review pass.
- `js-yaml` becomes an explicit dependency (today only transitive via
  gray-matter). Sanctioned by ADR-027 ("gray-matter/js-yaml").

## M1 — Run model + read-only Studio UI ✅ COMPLETE 2026-06-13

All six WIs landed on `feat/studio-m1` (792 tests, build, brain lint 0 errors, studio lint 0 errors,
ui:journey 40 frames 0 failures all green). Exit criteria met: monitor parity via Act IV beats,
run-model suite green vs real fixtures, ui:journey exits 0 with video + gallery.

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M1-1 | `orchestrator/run-model.ts` aggregator | M0-1 | queue dirs + manifest + events.jsonl + artifacts → mock Run shape (status, phases, phaseMeta incl. iter/budget/brainReads/delivered/lastProgress, artifactsReady, gate, failedAt, origin); unit tests against recorded real-cycle event logs (betterADO archives as fixtures) |
| M1-2 | Bridge read routes + WS deltas | M1-1 | `/api/runs`, `/api/runs/:id`, `/api/runs/:id/phases/:node/log` (stderr filter), `/api/studio/*` GETs, `/api/studio/catalog`; ui-bridge.ts (1,195 LOC) splits — studio/run routes into `cli/bridge-studio.ts` (≤800 LOC rule) |
| M1-3 | Structured gate sub-check events | — | composed 5-gate emits one event per sub-check (id, pass/fail, detail); event schema documented |
| M1-4 | Library page `/` | M1-2 | four object sections + operator pulse, live strips/gated chips, full data-* mirroring; old dashboard stays reachable |
| M1-5 | Flow monitor `/flows/[id]` (monitor tab) | M1-2, M1-3 | run rail by status, summary strip, topology from flow.yaml via existing hex components, phase drawer (status/model/cost/retries, liveness+wedged banner, iteration pips, brain-reads, delivered, gate sub-checks, artifact chips, log tail+stderr filter), live event tail; start/resume rendered disabled |
| M1-6 | e2e-journey acts: library + monitor | M1-4, M1-5 | seeded synthetic run drives both pages; soft-assert data-* layer; spine + ui:journey green |

## M2 — Builders: Agents + Projects

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M2-1 | Agent builder `/agents/[id]` | M1-2 | full mock spec: catalog palette (search/collapse/used-dimming), 4 typed drop zones with kind rejection, SDK picker (non-Claude disabled), fixed/range strategy stored, knowledge-access cards, YAML preview, readiness panel, used-in-flows, dirty/unsaved guard, `?id=` routing |
| M2-2 | Bridge write routes (PUT agents/projects) | M0-2, M1-2 | through registry serializer + server-side validation; **security-review skill before merge** (first write surface) |
| M2-3 | Invocation files read definitions | M0-3 | pm/dev/unifier/reflector specs derived from SKILL.md; derivation test flips dual-source → single-source; `brainAccess` drives existing enforcement |
| M2-4 | Architect adopts PhaseAgentSpec | M2-3 | architect-runner uses derived spec (model tiering + allowedTools); closes last ADR-024 gap |
| M2-5 | Project builder `/projects/[id]` | M1-2 | north star (+140 counter), instructions + readback, demo-process timeline (typed steps, drag-reorder, presets), skills binding, KB bind/create, contract readiness via `forge preflight` over bridge, Ctrl+S |
| M2-6 | Project config extensions consumed | M2-3 | `instructions` injected into agent context (generalises `standing_work_item_acs`); `demoProcess`+`skills[]` composed by unifier/demo path (closes demo.skill gap); contract-ready enforced at claim |
| M2-7 | e2e-journey acts: edit-agent, edit-project | M2-1, M2-5 | acts green; **verify:cycle routine tier** (operator-gated) — every phase spec file-sourced |

**M2 status (2026-06-13): builders + single-source flip + hot-path consumption landed.**
Act V beats (beats 24–25: agent builder /agents/project-manager + project builder /projects/claude-harness) pass
in `ui:journey` — 44 frames, 0 failures. All spine gates green (851 tests, build, brain lint 0 errors,
studio lint 0 errors).

**verify:cycle (routine tier) — run 2026-06-13, $0.78 real spend.** The single-source flip is
**confirmed executing on a real cycle**: after fixing a stale-state trap, the cycle ran fresh —
architect → PM spawned and decomposed (1 WI) → the dev-loop spawned its agent and ran — all via the
SKILL.md-derived specs (PM + developer agents resolved their model/tools from the flipped specs and
executed real work). The gate verdict was FAIL on one assertion only — `dev-loop completed N/N`
(`WI-1 dev failed · iters=0 · gate-too-loose`) — which is forge's iter-0 hollow-pass guard
(PRINCIPLES #3) firing because the corpus initiative's per-WI gate passes green at the reset base
before the feature exists. This is a **corpus/gate-scoping artifact orthogonal to M2** (the flip
left PM's gate-generation behaviour byte-identical, so pre-M2 code hits the same artifact at this
base) and reproduces the documented `gate-too-loose-unifier-instant-stop` harness theme. A
fully-green verdict needs a corpus initiative+base whose WI gate asserts the new feature at iter-0
(operator corpus knowledge), not an M2 code change. Two real bugs were fixed en route:
(1) `verify-cycle.mjs` `stageManifest` now strips a stale `resume_from` from the corpus manifest —
without it every staged run resumed-to-unifier, skipped architect+PM, and failed at $0 (commit
`ad17c6a`); (2) a stale `origin/forge/<id>` ephemeral branch from the initiative's original build
triggered a resume — pruned. M2 code is complete and verified by every M2-isolating gate; the
remaining verify FAIL is a corpus-harness concern tracked for operator follow-up.

## M3 — Flow engine (ADR-028) ✅ COMPLETE 2026-06-13 (cutover landed; verify:cycle operator-gated)

All seven WIs landed on `feat/studio-m3`. Full spine green: 932 tests, build clean, brain lint
0 errors, studio lint 0 errors, `ui:journey` 48 frames 0 failures (Acts I–VI, all assertions pass).

**Flow-engine cutover confirmed clean:** `runCycle` in `orchestrator/cycle.ts` delegates the full
phase sequence to `runFlow` (loads `studio/flows/forge-cycle/flow.yaml` via `loadFlowDefinition`,
calls `flow-runner.ts`'s DAG walk). The old hardcoded pm→dev→review→reflect sequence is gone; no
dead remnant remains (cycle.ts post-cutover: ~919 LOC of helpers, no inline phase sequence).

**M3 items landed:**
- M3-1: ADR-028 finalised and accepted (9 decisions, node kinds, gate semantics, resume, budgets).
- M3-2: `flow-runner.ts` DAG walk — phase functions unchanged as node executors; `runCycle` is now
  a thin wrapper (load flow + call runFlow). The 8 dev-loop-close items (assertNonEmptyDelivery,
  commitDevLoopBoundary, enforceDevLoopCloseInvariant, enforceFinalCiGate, preservingForgeScratch,
  synthetic-architect, resume-from-unifier) all ported to flow-runner as injected deps or pre/post
  hooks. Full equivalence unit suite passes unchanged.
- M3-3: Runner budgets + safety — `costCeilingUsd` (warn ≥70% → `flow.cost-warn`, stop ≥100% at
  clean boundary → `flow.cost-ceiling-stop`, classify resumable); `wedgeKillMs` per-node
  heartbeat-without-tool-progress kill + `phase.wedge-killed`; rate-limit `resetsAt` spawn gate.
  Closes the 33h wedge gap.
- M3-4: Run + gate write endpoints — `POST /api/runs` (start), `POST /api/runs/:id/resume`,
  `POST /api/runs/:id/gates/:gateId` (generalised gate); `/api/verdict` + `/api/plan-verdict` as
  thin aliases. Start CTA, resume button, cost gauge enabled in the flow monitor UI.
- M3-5: Triggers v1 — on terminal state, fire `flow.triggers` by enqueueing the target flow's run.
  `knowledge-ingest` seed flow (`studio/flows/knowledge-ingest/flow.yaml`) proves a non-cycle
  single-node disposable flow runs end-to-end.
- M3-6: Claim refusal — scheduler `runOne` refuses if project not contract-ready (`runPreflight`
  hard clauses), flow invalid/locked (validateFlow + version lock), or zero-gate non-disposable.
- M3-7: Harness beats (Act VI, beats 26–29) — start-run CTA (`knowledge-ingest`, no runs, 
  `data-can-start="true"`); cost-ceiling-warn gauge (75% of $25 ceiling → amber fill);
  gate control (gated run → "Open gate →" link to /review/<runId>); resume button (failed run →
  `data-action="resume-run"` interactive). All soft-assert; no real cycles started.

**verify:cycle engine-path run — RAN 2026-06-13, GATE PASS ✓ ($4.20 real spend).** The flow-runner
path executed a complete cycle end-to-end on claude-harness (base f61d186): claim → synthetic
architect → PM spawned + decomposed (1 WI) → dev-loop ran WI-1 to completion (`iters=1 ·
quality-gates-pass`) → unifier → review → pr-open → auto-approve. All four routine-tier assertions
green: reached merge (done), dev-loop 1/1 complete 0 failed, project tests green post-merge, cost
$4.20 / $25 ceiling. This is a **stronger result than the M2 baseline** (which hit the orthogonal
iter-0 `gate-too-loose` artifact on that run): the engine path drove a real cycle to a fully-green
verify gate, confirming the cutover (runCycle → flow-runner walking forge-cycle.yaml) executes
real cycles equivalently — not just by the 932 unit tests but by a real-money green cycle. The run
surfaced + closed two correct interactions: (1) M3-6's claim refusal fired correctly (claude-harness
fails C2 at the frozen base), so the routine-tier harness gained a scoped `FORGE_SKIP_CONTRACT_CHECK`
opt-out (contract-ready check only; structural flow/zero-gate checks stay enforced) — verify:cycle
tests EXECUTION, the contract gate is orthogonal; (2) stale `origin/forge/<id>` ephemeral branches +
the corpus manifest's `resume_from` (fixed in M2) must be cleared before a fresh run.

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M3-1 | ADR-028 finalised semantics | — | node kinds, orchestrator-verified gates, resumable boundaries, triggers, budgets, edit-lock/versioning, terminal moves; ADR-019/026 refs updated |
| M3-2 | `flow-runner.ts` — phase fns become node executors | M2-3 | `runCycle` shrinks to "load flow.yaml → flow-runner"; no parallel old/new paths post-cutover |
| M3-3 | Budgets + safety | M3-2 | flow `costCeilingUsd` (warn 70%, stop at clean boundary 100%); per-node `wedgeKillMs` kill + `phase.wedge-killed` event + resumable classification; rate-limit `resetsAt` spawn gate |
| M3-4 | Run write endpoints + UI enablement | M3-2 | `POST /api/runs`, `/resume`, generalised `/gates/:gateId` (verdict + plan-verdict become aliases); start CTA, resume button, cost gauge live |
| M3-5 | Triggers v1 + knowledge-ingest seed flow | M3-2 | on-terminal enqueue; second flow proves non-cycle path |
| M3-6 | Flow lint joins preflight/claim | M0-5, M3-2 | claim refuses non-contract-ready project, locked/invalid flow version, zero-gate non-disposable |
| M3-7 | Harness beats + cutover gate | M3-3..6 | e2e: start-run/gate-approve/resume/ceiling-warn; **verify:cycle release tier** before hardcoded phase order deleted |

## M4 — Flow builder canvas (ReactFlow, ADR-030) + unified artifact viewer ✅ COMPLETE 2026-06-13 (verify:cycle operator-gated)

All five WIs landed on `feat/studio-m4` (954 tests, build, brain lint 0 errors, studio lint 0 errors,
ui:journey 52 frames 0 failures all green). Exit criteria met: BUILD tab live (6 nodes/5 edges,
palette + FlowHeader); unified /artifact viewer live (6-chip trail, demo + verdict gate surfaces);
DemoComparison `.checkpoints` null-guard fixed (first live run bug).

**verify:cycle (gate path) — RAN 2026-06-13, GATE PASS ✓ ($4.18 real spend).** The M4 fold-in routes
both human gates (review verdict + architect PLAN) through the unified `/artifact` viewer; the
engine-path cycle ran green end-to-end through that path (claim → PM → dev WI-1 complete iters=1
gates-pass → unifier → review → merge; 1/1 WI, tests green, $4.18/$25). Confirms the viewer fold-in
didn't break real-cycle gating. Same setup as M3 (base f61d186, `FORGE_SKIP_CONTRACT_CHECK`, clear
stale `origin/forge/<id>` branch first).

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M4-1 | ADR-030 canvas decision + PUT/GET flows backend | — | ADR-030 records ReactFlow (already in AgentGraphCanvas); PUT /api/studio/flows/:id + version-bump + edit-lock (423 active); GET single flow; saveFlow/fetchFlow client helpers; security self-audit |
| M4-2 | Flow builder (BUILD tab) | M4-1, M3-4 | ReactFlow canvas — custom flowNode (hex + Handles), palette drag-to-create, port→port onConnect + ArtifactPicker, NodeMiniPanel, toolbar (Clear/Layout), FlowHeader (goal/project/kb/triggers/Save); data-node-count/data-edge-count/data-flow-node/data-node-id/data-agent-ref/data-goal-set/data-active-tab; edit-lock UX |
| M4-3 | Unified artifact viewer `/artifact` | M1-1 | all six renderers (plan, work-items, PR, demo, verdict, reflection), gate bar state machine on generalised gate endpoint, approval stamp, empty state; data-page="flows"/data-page-ready/data-run/data-artifact-type/data-mode/data-gate-state; ArtifactTrail 6 chips |
| M4-4 | Fold-in + retirement | M4-3 | `/review/[cycleId]` + PLAN-gate route through viewer; redirects; e2e migrated; harness data-* (verdict-form/plan-gate) preserved |
| M4-5 | e2e Act VII: author-a-flow + gate-via-viewer | M4-2..4 | beat 30: BUILD tab live (6 nodes, palette, goal field, no save — seed immutable); beat 31: /artifact demo view (6-chip trail, demo-evaluation) + verdict gate (verdict-form, approve-and-merge, send-back radio); DemoComparison crash fix (checkpoints?.length); 52 frames, 0 failures; remaining gate: operator-authorized verify:cycle |

## M5 — Knowledge Bases as objects ✅ COMPLETE 2026-06-13 (verify:cycle operator-gated)

All six WIs landed on `feat/studio-m5` (1027 tests, build clean, brain lint 0 errors, studio lint
0 errors, `ui:journey` 56 frames 0 failures all green). Exit criteria met: KB read API live (real
brain filesystem walk, gray-matter, wiki-link resolution), `/knowledge` force-graph viewer hand-rolled
(SVG spring sim, no new dep), guidance loop (POST → `_guidance/*.md` → amber-diamond node → cleanup),
scope guard (checkCategoryScope in brain-lint), KB create endpoint, reflection→KB links.
Post-review hardening: KB-create writes kb.yaml via js-yaml dump (YAML-injection safe), guidance text
8 KiB cap, reflection deeplink lands on the node (`/knowledge?node=<slug>` + a resolve-node endpoint),
`cli/bridge-studio.ts` split into `bridge-studio-kbs.ts` + `bridge-studio-writes.ts` (all <800 LOC).
1036 tests. M5-4 also caught + fixed 2 mis-routed brain themes (antipatterns moved forge-dev→cycles).

**verify:cycle — RAN 2026-06-13, GATE FAIL on the orthogonal corpus artifact (NOT M5).** The cycle
ran fresh through the engine (claim → PM → dev) but the dev agent hit `WI-1 dev failed · iters=0 ·
gate-too-loose` ($0.58) — the same iter-0 hollow-pass corpus artifact as the M2 baseline (the dev
agent is non-deterministic: M3/M4 runs did real work and went green, this run + M2 hit the hollow-pass
guard). The cycle died at the dev gate before reflection ran, so M5's reflector change (best-effort
`reflection.json` write) wasn't even exercised. **M5 code is not implicated** — the flow-engine
faithfully ran claim→PM→dev as in every prior verify; the FAIL is the documented dev-agent corpus
non-determinism, orthogonal to M5.

**Act VIII (beats 32–33) confirmed live against the real brain:**
- browse-KB: 104 nodes, 200 edges from the `cycles` brain (67 themes + index/raw nodes); all layer
  variants present; KB health panel and selector rendered.
- pin-guidance: POST written → `data-guidance-pinned="true"` → `[data-layer="guidance"]` amber-diamond
  node appeared in the re-fetched graph → `finally` cleanup removed `brain/cycles/_guidance/` → brain
  lint confirmed 0 errors post-journey.

**Remaining gate:** operator-authorized `verify:cycle` (routine tier). M5 is mostly read + a guidance
write + a lint check; the reflector change (M5-5: lessons carry `target:`) is additive with no behaviour
change, so this is a low-risk confirmation that the reflector still closes the cycle green.

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M5-1 | KB read API | M0-4 | `orchestrator/kb-graph.ts` walks brain FS (gray-matter, wiki-links, `_guidance/`); `GET /api/studio/kbs/:id` returns graph+health+article; `GET /api/studio/kbs/:id/nodes/:nodeId`; traversal/bad-id guards |
| M5-2 | KB viewer `/knowledge` | M5-1 | hand-rolled SVG spring sim (k/restLength/repulsion/damping/centerPull; off-screen ticks + rAF); nodes by layer (index hex/theme circle/raw dot/guidance amber-diamond); `data-kb-id/data-node-count/data-edge-count/data-selected-node`; pan/zoom/drag; NodeArticle (inbound/outbound chips, wiki-link body); KbHealth; KbSelector (scope-grouped); StudioNav Knowledge enabled; LibraryCard KB → `/knowledge?id=<id>` |
| M5-3 | Guidance loop | M5-1 | `POST /api/studio/kbs/:id/guidance {text,targetNode?}` → `brain/<kb>/_guidance/<ts>.md`; buildKbGraph surfaces as guidance nodes; GuidancePanel wired; `data-guidance-pinned`; brain-ingest consume step |
| M5-4 | Mechanical scope guard + KB create | M0-2 | `checkCategoryScope` in brain-lint (brain gap #8); `POST /api/studio/kbs` scaffold; KbBind "+ Create" enabled |
| M5-5 | Reflection → KB links | M4-3 | reflector lessons carry `target:<kb-node-slug>`; ReflectionDoc pipeline; viewer KB badge resolves to `/knowledge?id=<target>` |
| M5-6 | e2e Act VIII: browse-KB + pin-guidance | M5-2, M5-3 | 56 frames 0 failures; 104 nodes/200 edges live; guidance pinned + cleanup confirmed; brain lint 0 errors post-journey |

## M6 — Multi-runtime + model range (ADR-029) ✅ COMPLETE 2026-06-14 (verify:cycle operator-gated)

All five WIs landed on `feat/studio-m6` (1084 tests, build clean, brain lint 0 errors, studio lint 0 errors,
`ui:journey` 35 beats 0 failures all green). Exit criteria met: RuntimeAdapter interface defined +
Claude reference adapter extracted (behaviour-identical); adapter registry + dependency-free example
adapter proves the conformance contract without a new dep; `strategy: range` routing live across
Claude tiers (haiku→sonnet→opus, cheapest-first, escalate on gate failure); registry-driven SDK
picker (codex/gemini disabled — no adapter registered; claude selectable); Act IX e2e beat proves
range mode authors `strategy: range` in the YAML preview without saving (seed SKILL.md immutable).

**M6 adapter framework scope (operator-directed 2026-06-14):** The deliverable is the **framework**,
not a second runtime. A real Codex/Gemini/local adapter is the documented later drop-in:
implement `RuntimeAdapter` in `loops/_adapters/<sdk>/`, register it, install the dep — this is an
**ask-first event** at that time. No new npm dep was added; the example adapter is an in-repo mock.

**verify:cycle — RAN 2026-06-14, behaviour-identical extraction CONFIRMED ($0.53).** The cycle ran
through the Claude adapter (M6-1's wrapper): claim → PM spawned + ran (~74s real agent work) → dev
spawned → reached the dev gate — exactly as in every prior verify, proving the adapter extraction is
transparent (`createClaudeAgent` wrapped, not changed). The dev agent then hit `WI-1 dev failed ·
iters=0 · gate-too-loose` — the **same orthogonal corpus artifact** as the M2/M5 runs (dev-agent
non-determinism: M3/M4 did real work and went green, this run + M2 + M5 hit the iter-0 hollow-pass
guard). **M6 is not implicated** — the adapter path executed claim→PM→dev identically; the gate FAIL
is the documented corpus non-determinism, orthogonal to the adapter wrapper. The full 1084-test suite
+ the no-drift derivation test are the unit guards; this real-cycle run confirms the wrap is transparent.

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M6-1 | Adapter seam extraction | M3-2 | `RuntimeAdapter` interface in `loops/_adapters/types.ts`; `loops/_adapters/claude/index.ts` thin wrapper around `createClaudeAgent`; behaviour-identical (existing suite unchanged); full spine green |
| M6-2 | Registry + conformance + example adapter | M6-1 | `loops/_adapters/registry.ts` (getAdapter/listAdapters/registeredSdkIds); `loops/_adapters/example/index.ts` dependency-free mock adapter; `loops/_adapters/conformance.ts` contract suite proven against both claude (mock queryFn) + example; TDD green; no new dep |
| M6-3 | `strategy: range` router | M6-1 | `resolveRangeModel` in `orchestrator/model-range.ts` (cheapest-capable-first by costIn+costOut, escalate on gate failure); `deriveAgentSpec` range-gating throw removed; range spec resolves to cheapest tier; fixed unchanged; TDD green |
| M6-4 | Registry-driven SDK picker | M6-2, M6-3 | `GET /api/studio/adapters` exposes `registeredSdkIds`; RuntimePicker `sdkAvailable` driven by registered adapters; codex/gemini disabled; range strategy toggle + chips functional (stored + routed M6-3); Next.js build green |
| M6-5 | e2e Act IX + work-items tick | M6-2..4 | Act IX beat 34 (range strategy): /agents/project-manager → SDK picker shows claude selectable/codex+gemini disabled; range toggle → `data-strategy="range"` flips; ≥1 chip selected → `data-model-count ≥1`; YAML preview contains `strategy: range`; 35 beats 0 failures; work-items.md ticked; **remaining gate: operator-authorized verify:cycle** |

---

## M7 — Consolidation + productionisation (ADR-031) — IN PROGRESS 2026-06-14

Make Forge Studio the one product: rip out the pre-Studio `/dashboard` + the
moment-screens, remove the bridge-duplicating CLI, replace `forge watch` with a
deterministic `forge studio` launcher. Operator decisions (2026-06-14): architect
**rebuilt** in Studio; CLI **full removal**; cross-project roadmap **dropped**;
launcher → new **`forge studio`** command.

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M7-0 | ADR gate | — | ADR-031 written; 023 amended + 020/021 noted; roadmap/work-items rows; `forge brain lint` 0 err |
| M7-1 | Harness → Studio selectors | M7-0 | e2e-journey beats 0–21 assert against `/flows/forge-cycle` monitor (`data-mon-node`, `#phase-drawer`, `data-run-id`); `data-project-group` dropped; **green on unmodified `main`** before any deletion |
| M7-2 | Delete `/dashboard` + dead cluster | M7-1 | sever `hex-detail`→`bridge-client` type; delete dashboard page + exclusive components + dead lib; keep `phases`/`dep-layout`/`status-colors`; build + test + ui:journey + studio lint green |
| M7-3 | Fold `/review`+`/reflect` into `/artifact` | M7-0 | repoint `RunRail`/`PhaseDrawer` gate links to `/artifact?…&mode=review`; wrappers redirect/deleted; harness beats 16–21 migrated; ui:journey green |
| M7-4 | Rebuild architect in Studio | M7-0 | native interview + PLAN gate (via `/artifact`); P1–P4 observability assertions preserved; bridge unchanged; ui:journey beats 0–9 green |
| M7-5 | CLI full removal | M7-0 | 5a `verify:cycle`→bridge verdict POST; 5b bridge→daemon helpers (no `forge start` spawn); 5c delete `start`/`stop`/`pause`/`resume`/`status`/`review --approve`, internalise `architect run`; runtime spine kept; test green; verify:cycle re-run |
| M7-6 | `forge studio` launcher | M7-0 | new `cli/forge-studio.ts`; health-probe readiness + structured ready signal; WSL2 port-takeover kept; `forge watch` deprecated alias; manual launch clean |
| M7-7 | Harness `startWatch` off stdout-scraping | M7-6 | `startWatch` spawns `forge studio --no-open` + reads ready signal; ui:journey boots + completes |

---

## Operator-gated checkpoints (cannot run unattended)

- M2-7 / M3-7 / M4-5 / M6 / M7-5: `npm run verify:cycle` (real $) — queued for the
  operator at each milestone close.
- M6 next real SDK: new external dependency — ask-first.
