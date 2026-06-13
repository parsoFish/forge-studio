# Forge Studio — Feature & Work-Item Breakdown

> Companion to [`roadmap.md`](./roadmap.md). The roadmap fixes scope and exit
> criteria per milestone; this doc decomposes each milestone into
> implementation-ordered work items (WIs) with explicit dependencies and
> acceptance criteria, sized for one focused PR-shaped unit each.
> Status: living doc, updated as milestones land. Created 2026-06-13.

Legend: `⛓ depends-on` · AC = acceptance criteria · spine = `npm test` +
`npm run build` + `forge brain lint` (+ `npm run ui:journey` where UI touched).

---

## M0 — Definitions as data

Detailed executable plan: [`docs/superpowers/plans/2026-06-13-forge-studio-m0.md`](../superpowers/plans/2026-06-13-forge-studio-m0.md).

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

## M1 — Run model + read-only Studio UI

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

## M3 — Flow engine (ADR-028)

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M3-1 | ADR-028 finalised semantics | — | node kinds, orchestrator-verified gates, resumable boundaries, triggers, budgets, edit-lock/versioning, terminal moves; ADR-019/026 refs updated |
| M3-2 | `flow-runner.ts` — phase fns become node executors | M2-3 | `runCycle` shrinks to "load flow.yaml → flow-runner"; no parallel old/new paths post-cutover |
| M3-3 | Budgets + safety | M3-2 | flow `costCeilingUsd` (warn 70%, stop at clean boundary 100%); per-node `wedgeKillMs` kill + `phase.wedge-killed` event + resumable classification; rate-limit `resetsAt` spawn gate |
| M3-4 | Run write endpoints + UI enablement | M3-2 | `POST /api/runs`, `/resume`, generalised `/gates/:gateId` (verdict + plan-verdict become aliases); start CTA, resume button, cost gauge live |
| M3-5 | Triggers v1 + knowledge-ingest seed flow | M3-2 | on-terminal enqueue; second flow proves non-cycle path |
| M3-6 | Flow lint joins preflight/claim | M0-5, M3-2 | claim refuses non-contract-ready project, locked/invalid flow version, zero-gate non-disposable |
| M3-7 | Harness beats + cutover gate | M3-3..6 | e2e: start-run/gate-approve/resume/ceiling-warn; **verify:cycle release tier** before hardcoded phase order deleted |

## M4 — Flow builder canvas + artifact viewer

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M4-1 | ADR-030 canvas spike (react-flow/xyflow vs hex canvas) | — | mock interaction spec = acceptance bar; decision recorded |
| M4-2 | Flow builder (build tab) | M4-1, M3-4 | authoring against PUT flows with versioning + edit-lock UX, trigger picker, goal warning, project/kb binding |
| M4-3 | Unified artifact viewer `/artifact` | M1-1 | all six renderers (plan, work-items, PR, demo, verdict, reflection), gate bar state machine on generalised gate endpoint, approval stamp, empty state |
| M4-4 | Fold-in + retirement | M4-3 | `/review/[cycleId]` + PLAN-gate route through viewer; redirects; e2e migrated |
| M4-5 | e2e: author-a-flow + gate-via-viewer | M4-2..4 | verify:cycle routine re-run (gate path touched) |

## M5 — Knowledge Bases as objects

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M5-1 | KB read API | M0-4 | descriptors, graphify JSON + frontmatter → nodes/edges, markdown + wiki-link article rendering, lint-as-API health |
| M5-2 | KB viewer `/knowledge/[id]` | M5-1 | d3-force/sigma.js graph, pan/zoom/hover-adjacency, article panel, scope-grouped selector, health panel + suggested-ingest |
| M5-3 | Guidance loop | M5-1 | POST guidance → `_guidance/*.md`; brain-ingest consumes+deletes; amber-diamond render until ingested |
| M5-4 | Mechanical scope guard + KB create | M0-2 | ingest validates category→brain routing vs kb.yaml scope (brain gap #8); project-builder KB scaffold |
| M5-5 | Reflection → KB links | M4-3 | reflector lessons carry `target:`; viewer badges resolve |
| M5-6 | e2e: browse-KB + pin-guidance | M5-2, M5-3 | round-trip proven |

## M6 — Multi-runtime + model range (ADR-029)

| WI | Title | Depends | AC (summary) |
|---|---|---|---|
| M6-1 | Adapter seam extraction | M3-2 | interface from `createClaudeAgent`; `loops/_adapters/claude/` behaviour-identical (verify:cycle routine guards) |
| M6-2 | Second adapter | M6-1 | operator-chosen SDK; conformance suite gates; **ask-first dep** |
| M6-3 | `strategy: range` router | M6-1 | cheapest-capable-first, escalate on gate failure; cost attribution unchanged |
| M6-4 | UI enablement | M6-2, M6-3 | SDK picker unlocks per installed adapter |

---

## Operator-gated checkpoints (cannot run unattended)

- M2-7 / M3-7 / M4-5 / M6: `npm run verify:cycle` (real $) — queued for the
  operator at each milestone close.
- M6-2: new external dependency — ask-first.
