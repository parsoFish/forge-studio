# Forge Studio — Target Architecture

> Design rule: every Studio object is a **thin declarative layer over a
> mechanism forge already proved in production**. New code is the meta-layer
> (definitions, registries, the engine that interprets them, builder UIs).
> Anything that smells like a second implementation of an existing mechanism
> is a defect in this design.

## 1. Object model

Four first-class objects + two derived ones. All persisted as
markdown/YAML files, git-versioned, written only through one canonical
serializer module (the `serializeManifest` rule, generalised).

### Agent — extended SKILL.md (amends ADR-024)

An agent IS a skill directory. No parallel "agent registry" file — the
frontmatter grows machine-readable fields and the body keeps the process
intent. `PhaseAgentSpec` becomes a *derived view* of this file.

```yaml
# skills/<slug>/SKILL.md frontmatter (today's fields + studio fields)
name: developer
purpose: Implement one work item to green gates inside its worktree.
composition:
  skills: [tdd-workflow, worktree-isolation]      # composed sub-skills
  tools: [git, node]                              # catalog tool ids
  mcps: []
  hooks: [event-log, cost-guard, stall-watchdog]  # orchestrator behaviours
runtime:
  sdk: claude                  # adapter id; only `claude` until ADR-029 lands
  strategy: fixed              # fixed | range
  model: claude-sonnet-4-6     # or range: [...] when strategy=range
brainAccess: none              # mandatory | advisory | none  (ADR-010 promoted)
interactivity: >-
  Fully autonomous; never blocks on the operator.
budgets:
  iterationFloor: 5            # existing dev-loop semantics
  maxTurnsPerIteration: 120
  wedgeKillMs: 1800000         # NEW: heartbeat-without-tool-progress ceiling
```

- `hooks` do not spawn anything: they toggle existing orchestrator behaviours
  (JSONL event emission, cost guard, stall watchdog, merge gate, scratch
  strip). The catalog names them; the runner honours them.
- Validation = the agent-builder readiness checks, enforced server-side at
  save and again at spawn.
- The six in-cycle agents (architect, pm, developer, unifier, reviewer,
  reflector) are migrated in place — their SKILL.md files gain frontmatter;
  invocation files (`*-invocation.ts`) read the file instead of hardcoding
  the spec. Architect joins PhaseAgentSpec here (closing the last ADR-024
  migration gap).

### Flow — `flows/<slug>/flow.yaml` (new, ADR-028)

```yaml
id: forge-cycle
name: Forge Cycle
goal: Take an approved initiative to a merged PR with reflection captured.
project: null                  # optional default binding; runs may override
kb: cycles                     # kb id this flow's reflector writes to
costCeilingUsd: 25             # hard runner-enforced ceiling
origin: seed                   # provenance
nodes:
  - { id: architect, agent: architect, gate: plan }        # human gate after
  - { id: pm,        agent: project-manager }
  - { id: dev,       agent: developer, fanOut: work-items } # dynamic multiplicity
  - { id: unifier,   agent: developer-unifier, resumable: true }
  - { id: review,    agent: reviewer, gate: verdict }       # human gate
  - { id: reflect,   agent: reflector }
edges:
  - { from: architect, to: pm,      artifact: plan }
  - { from: pm,        to: dev,     artifact: work-items }
  - { from: dev,       to: unifier, artifact: wi-branches }
  - { from: unifier,   to: review,  artifact: pr }
  - { from: review,    to: reflect, artifact: verdict }
triggers:
  - { on: complete, flow: knowledge-ingest }
```

Load-bearing semantics:

- **`fanOut`** — the node multiplies at runtime: one instance per item in the
  named upstream artifact (per-WI Ralphs with worktrees + dependency DAG —
  exactly today's dev-loop). The mock's `fn-dev-1/2/3` + `lane: parallel` is
  the *rendering* of this, not three static nodes.
- **`gate`** — a declared human gate. Gate verdicts are server-verified
  endpoints; no auto-approve code path exists. Flow save validation rejects a
  zero-gate flow unless `disposable: true` (brain: review-spin incident).
- **`resumable`** — a phase boundary `resume_from` may target. The engine
  derives the allowed resume set from these flags (today: unifier).
- **Edit lock** — a flow with in-flight runs is read-only; saving creates
  `version: n+1`, used by new runs only (brain: never self-modify while
  running).
- The **forge cycle ships as seed data** and `verify-cycle` proves the engine
  reproduces it. The hand-written `runCycle` is retired only when the engine
  passes the release-tier harness.

### Project — extended `.forge/project.json` (in the project repo)

Today's contract fields stay; Studio adds the mock's fields:

```jsonc
{
  // existing: gates, acceptance_gate, standing_work_item_acs, ...
  "northStar": "≤140 chars; every agent decision judged against this",
  "instructions": "standing constraints injected into every agent context",
  "demoProcess": [ { "kind": "capture|verify|present", "text": "..." } ],
  "skills": ["ado-demo"],          // project-side skills agents compose
  "kb": "betterado"                // Brain 3 binding
}
```

- Stays **in the project repo** (portability, ADR-018). Forge keeps only a
  registry index (`studio/projects.yaml`: id → repo path).
- `instructions` generalises `standing_work_item_acs` (which becomes the
  WI-shaped subset of it).
- `demoProcess` + `skills` close the open `demo.skill` known-gap: the unifier
  composes the project's demo skill and follows the typed steps.
- Contract readiness = `forge preflight` C1–C8 exposed through the bridge;
  the mock's 5 checks are a subset and adopt preflight as source of truth.
  **A flow run refuses a project that isn't contract-ready** (mock's
  "flow-ready" promoted to runner enforcement).

### Knowledge Base — `brain/.../kb.yaml` descriptor over existing brains

```yaml
id: cycles
name: Cycle Patterns
scope: flow            # project | flow | agent-integration
desc: What forge has learned about running cycles.
```

- The three-brain model maps 1:1 onto the mock's scopes: `forge-dev` →
  agent-integration, `cycles` → flow, per-project `brain/` → project.
- Graph data comes from the existing graphify output (`graphify-out/graph.json`)
  + frontmatter layers; **no new graph store**.
- Health = `forge brain lint` results served as API.
- Human guidance = `_guidance/*.md` pending notes (node-linked or floating),
  consumed and deleted by the next `brain-ingest` pass — the human-originated
  twin of the existing `brain-gaps.jsonl` loop.
- Scope contamination becomes mechanical: ingest validates the
  category→brain routing rule against the target KB's `scope` (brain gap #8).

### Run (derived) — the aggregation of what already exists

A Run is **not stored**; it is computed by a server-side aggregator from
sources that already exist, matching the mock's run shape:

| Run field | Source |
|---|---|
| `status` | `_queue/` directory + manifest frontmatter |
| `phases{}` | phase start/end events in `events.jsonl` |
| `phaseMeta{}` (cost, retries, model, iter/budget, brainReads, delivered, lastProgress) | `cost_usd`/`usage_delta`/iteration/`agent_heartbeat`/`tool_use`/`brain-query` events + `tallyToolUse` |
| `artifactsReady{}` | `_logs/<cycleId>/artifacts/` + gate state |
| `gate`, `gateNote` | pending verdict files / plan-gate state |
| `failedAt`, `failNote` | failure-classifier output |
| `origin` | manifest `origin: architect \| human-directed` tag |

This aggregator (`orchestrator/run-model.ts`) is the single biggest *read*
deliverable: it is what makes the monitor, run rail, drawer, trail, and
library live-strips real with zero new write paths.

### Catalog (derived) — `studio/catalog.yaml` + filesystem scan

Skills scanned from `skills/` + project `.claude/skills/`; tools, MCPs,
hooks, SDKs, models declared in one small YAML (models carry sdk/tier/cost
for the picker). Read-only API; editing the catalog is a git change.

## 2. Flow engine (ADR-028 — the one genuinely new mechanism)

`orchestrator/flow-runner.ts` interprets a FlowDefinition:

```
claim run → validate project contract-ready → walk DAG in topological order:
  static node  → spawn agent from AgentDefinition (Ralph loop or single-pass
                 per the agent's process), orchestrator-verified gate after
  fanOut node  → materialise N instances from upstream artifact, worktree
                 each, respect depends_on DAG     (existing dev-loop engine)
  gate node    → park run as `gated`, surface artifact, wait for verdict
                 endpoint (approve → continue; send-back → typed work items
                 to the declared handler node — generalised ADR-026)
  on terminal  → fire triggers (enqueue target flow), move manifest,
                 fire reflection if flow declares it
```

Constraints honoured by construction (not by prompt):

- Gates re-run orchestrator-side; agent claims ignored.
- Per-node budgets: iterations, turns, **wedge kill** (`wedgeKillMs` —
  heartbeat-without-tool-progress ceiling; closes the 33h wedge), and the
  flow-level `costCeilingUsd` (warn at 70%, stop at a clean phase boundary at
  100% — never mid-write).
- Rate-limit `resetsAt` gates every spawn.
- Resume: `resume_from` accepts any node flagged `resumable`; worktree
  preserved; rebase-onto-main on resume (existing semantics).
- Scratch files declared per agent are base-guard stripped pre-PR.
- One terminal-move authority (closure semantics unchanged).

**Migration strategy (strangler):**
1. Engine v1 supports exactly the node/edge/gate shapes the forge cycle needs.
2. Forge cycle flow.yaml ships; `runCycle` delegates phase order to the
   definition while keeping its internals (PM/dev/unifier functions become
   node executors).
3. `verify-cycle` routine tier must pass on the engine-driven path before the
   hardcoded path is deleted.
4. Only then does the engine widen (arbitrary DAGs, triggers, new flows like
   knowledge-ingest as a real definition).

## 3. API surface (extends `cli/ui-bridge.ts`)

Existing endpoints stay. New, all thin over registries + run model:

```
GET/PUT  /api/studio/agents[/:id]         # AgentDefinition CRUD
GET/PUT  /api/studio/flows[/:id]          # FlowDefinition CRUD (+version, edit-lock)
GET/PUT  /api/studio/projects[/:id]       # registry + project.json proxy
GET      /api/studio/kbs[/:id]            # descriptor + graph + health
POST     /api/studio/kbs/:id/guidance     # pin guidance note
GET      /api/studio/catalog              # skills/tools/mcps/hooks/sdks/models
GET      /api/runs?flow=:id               # run model list (rail, library strips)
GET      /api/runs/:id                    # full run aggregate
GET      /api/runs/:id/phases/:node/log   # drawer tail (+stderr filter)
GET      /api/runs/:id/artifacts/:type    # viewer payloads
POST     /api/runs                        # start run (origin-tagged)
POST     /api/runs/:id/gates/:gateId      # approve | send-back{notes}  (generalises /api/verdict + /api/plan-verdict)
POST     /api/runs/:id/resume             # resume_from=<resumable node>
WS       (existing)                       # run/phase/event push
```

Server-side validation on every PUT (readiness, contract, zero-gate
rejection, canonical serialization). Gate endpoints remain the only
approve path — security review required (auth surface) before exposing
beyond localhost.

## 4. UI shell (forge-ui, App Router)

Port the mocks 1:1 in structure; reuse proven components.

| Route | Mock source | Reuses today |
|---|---|---|
| `/` library | index.html | dashboard cards/status patterns, Toasts |
| `/flows/[id]` (build + monitor tabs) | flow-builder.html | AgentGraphCanvas, StageHex, HexDetailDrawer, ActivityPanel, dep-layout, wi-status/phases |
| `/agents/[id]` | agent-builder.html | — (new builder) |
| `/projects/[id]` | project-builder.html | preflight API |
| `/knowledge/[id]` | knowledge-base.html | graphify data, brain lint |
| `/artifact?run&type&mode` | artifact.html | PlanGate, DemoComparison, ReviewVerdictForm |
| `/architect/[sessionId]` | (kept) | existing screen, restyled into shell |

- `tokens.css` becomes the forge-ui design system (object-type colours,
  hex frames, status vocabulary already shared).
- DOM-as-metrics convention extends to every new page; `e2e-journey.mjs`
  grows acts per milestone and stays the canonical demo + regression harness.
- Existing `/review/[cycleId]` and PLAN-gate screens fold into the artifact
  viewer; redirects preserved until e2e-journey is fully migrated.
- Canvas authoring: prefer a battle-tested graph-editing library
  (react-flow/xyflow) over hand-rolled drag math — decided in ADR-030 after a
  spike (number reserved); the mock's interaction spec is the acceptance bar
  either way.
- KB graph: d3-force (or sigma.js) over graphify JSON; the mock's custom
  physics is spec, not implementation.

## 5. Runtime adapters (ADR-029, last)

`loops/_adapters/<sdk>/` realising one interface (extracted from
`createClaudeAgent`): `spawn(spec, callbacks) → {turns, usage, toolEvents}`
with heartbeat/idle-deadline/usage-delta semantics preserved. `claude` is the
reference adapter (existing code moves, not rewritten). Codex/Gemini/local
land behind it one at a time; model `strategy: range` routing lives in the
adapter layer (cheapest capable tier first, escalate on gate failure).
UI ships the SDK picker earlier with non-Claude options disabled
("coming soon") so the definition schema is stable from M2.

## 6. Code placement & size discipline

```
orchestrator/
  run-model.ts          # run aggregator (read-only)
  flow-runner.ts        # ADR-028 engine
  studio/registry.ts    # load/validate/serialize definitions (one writer)
  studio/validate.ts    # readiness + zero-gate + contract checks
cli/ui-bridge.ts        # +studio routes (split if >800 LOC: bridge-studio.ts)
studio/                 # flow definitions, catalog.yaml, projects.yaml
skills/<slug>/SKILL.md  # agent definitions (extended frontmatter)
forge-ui/app/...        # routes above
loops/_adapters/        # M6
```

Orchestrator surface stays capped: the engine replaces `cycle.ts`'s phase
order rather than adding beside it permanently; `run-model.ts` is read-only;
registries are data access, not logic. Hard cap 800 LOC/file holds.

## 7. Open decisions (flagged, not blocking)

1. **Canvas library** — react-flow vs extend hex canvas (ADR-030 spike, M4).
2. **Exploration-type flows** — brain documents the shape but flags
   prerequisites missing; **deferred** past M6, schema reserves `type:`.
3. **Multi-operator / sharing semantics** for agents+KBs — out of scope for
   MVUS (one operator); schema avoids decisions that would preclude it.
4. **Zero-gate flows** — current answer per brain evidence: rejected unless
   `disposable: true`. Revisit only with new evidence.
5. **Knowledge-ingest as a real flow** — becomes the second seed flow once
   the engine widens (M3 exit); until then triggers no-op with a logged event.
