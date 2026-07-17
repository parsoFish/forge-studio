# Forge Studio — Project Instructions for Claude Code

> A modular platform for building the ideas machine — or any other agentic flow — that ships the ideas machine itself out of the box. Six phases backed by a brain. Hand-rolling forbidden; battle-tested tools required.

## North star

Forge's mission is **two-level** ([ADR 038](./docs/decisions/038-north-star-platform-and-ootb.md), 2026-07-17):

- **Scope 1 — the platform.** `orchestrator/`, `cli/`, `loops/`, `forge-ui/`, and every seam (runtime adapter, KB backend, the `PhaseAgentSpec` harness-overlay injection point) are a **modular platform for building the ideas machine — or any other agentic flow**. SWE-focused for now by explicit operator choice; connectors to non-SWE systems are deliberately future work, not built in advance.
- **Scope 2 OOTB — the ideas machine.** The six-phase cycle (architect → plan/decompose → developer loop → demo/review → reflect) and the brain-tuning loop are the concrete, opinionated agentic flow forge ships out of the box — see [`docs/product/minimum-viable-user-story.md`](./docs/product/minimum-viable-user-story.md) (MVUS) for its canonical vision.

Both levels serve the same operator: **one human running many side projects** — a single technical operator driving a portfolio through forge.

Forge is **designed to run primarily unattended between human interaction points** (architect, review, reflection). Every decision is judged against three things:

1. Does it preserve unattended operation?
2. Does it use a battle-tested community tool, or are we re-inventing one?
3. Is it the simplest thing that could work?

If the answer to (1) is no, the change must justify why. If (2) reveals a re-invention, find the existing tool. If (3) reveals complexity, cut.

There is **one operating model**: the daemon (`forge serve`). Operator-directed step-through falls out of isolated phase functions, not a forked runtime. The harness-overlay injection seam (`PhaseAgentSpec.allowedTools`) is kept clean, and [ADR 024](./docs/decisions/024-phases-as-subagents-invoking-skills.md)'s **spec migration is done** — all five LLM phases (architect, project-manager, developer-loop, unifier, reflector) source their intent from `SKILL.md` via `PhaseAgentSpec`, landed 2026-06-13. What ADR 024's incremental-migration decision leaves open is the **artifact migration** — moving the phases off hand-written `orchestrator/*-invocation.ts` prose onto registry-driven OOTB artifacts on the generic runnable primitive — tracked as **R4-01** (`docs/roadmaps/R4-ootb-suite.md`), not an ADR-024 gap.

## Studio session workflow

`forge studio` is the operator surface (ADR-031: the UI/bridge is the sole interaction point). It runs on **fixed ports** — bridge `4123`, UI `4124` — so one browser tab stays pinned and auto-reconnects across re-runs.

- **The agent runs `forge studio` once at session start and keeps it up all session.** Restart it **only** to apply changes to Studio's own code (bridge/UI). It is the live window onto every cycle — don't tear it down between tasks.
- **A second `forge studio` attaches read-only by default** (F1). It probes `GET /api/health` for the bridge identity `{service:'forge-bridge',pid,startedAt}`: a healthy forge bridge is **reused** (the running session — and any in-flight cycle — is left untouched); only a free, stale, or foreign port is taken over. Human viewers should open a second window with `forge studio --attach` (errors if nothing healthy is there) and **never `--force-takeover` a running agent session** — that SIGKILLs the bridge and hard-resets in-flight cycles. `--force-takeover` is the deliberate escape hatch to replace a healthy bridge on purpose.

## The brain is the first source of knowledge

**Before** answering a question about how forge works, before designing, before implementing — **query the brain**. Since the three-brain restructure ([ADR 018](./docs/decisions/018-three-brain-model.md)) the brain is three scoped graphs: **Brain 1** `brain/forge-dev/` (forge engineering), **Brain 2** `brain/cycles/` (cross-cycle patterns + archives), and **Brain 3** `brain/projects/<name>/themes/` (per-project, lives in the forge repo — [ADR 035](./docs/decisions/035-forge-owned-central-artifacts.md)). Query via the `brain-query` skill with `--scope`. If the brain doesn't know, research further AND log the gap so the next ingest pass can fill it.

Who reads what (see [ADR 010](./docs/decisions/010-brain-first.md) as amended + [`brain/forge-dev/themes/brain-read-policy.md`](./brain/forge-dev/themes/brain-read-policy.md)):

- **Planners (architect / project-manager) + reflector** — query Brain 2 + the cycle's Brain 3 (reflector: all three). Mandatory for planners.
- **Dev-loop + reviewer** — do **NOT** read the forge brain (Brains 1+2); the planner already encoded every relevant convention/antipattern into the work items, their single source of *intent*. They **may** consult the cycle's Brain 3 at `brain/projects/<name>/themes/` in the forge repo (per [ADR 035](./docs/decisions/035-forge-owned-central-artifacts.md)) for supplemental project context — advisory, not mandatory (amended 2026-05-26, ADR 010).

## Architecture, principles, decisions

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — narrative architecture
- [`PRINCIPLES.md`](./PRINCIPLES.md) — the five non-negotiable principles
- [`docs/decisions/`](./docs/decisions/) — ADRs for every load-bearing choice
- [`docs/phases/`](./docs/phases/) — one doc per phase: purpose, success signals (bench-hook references here are historical — the bench harnesses were removed 2026-05-25)

If a change conflicts with an ADR, **update the ADR first** (with rationale) before changing the code.

## Always do

- Emit structured events to the JSONL event log on every skill invocation.
- Use markdown artifacts to flow data between phases — every artifact must be greppable.
- Use git worktrees for parallel work units.
- Use conventional commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`).
- One concern per PR.

(Brain-querying is mandatory for **planners only** — architect / PM /
reflector. See the brain-first section above + the Never-do bullet
below. The dev-loop and reviewer correctly do NOT read the brain.)

## Ask first

- Major architectural changes (touch an ADR? ask).
- New external dependencies (every dep is a maintenance liability — justify it).
- Cross-project breaking changes.
- Anything that increases the surface area of `orchestrator/` (we explicitly cap this).

## Never do

- Re-invent a job queue, worker pool, resource controller, or process isolator. (See ADRs 011-013 for the line we hold.)
- Spawn agents as Claude CLI subprocesses. Use Claude Code skills via the SDK.
- Ship a **planner or reflector** skill that doesn't read the brain first. (The dev-loop and reviewer skills correctly do NOT — see the brain-read policy.)
- Add a feature flag, fallback, or "for backwards compatibility" path. There are no legacy users to support.
- Squash-merge stacked PRs (the lesson lives in the brain after Pass B).

## Build & test

```bash
npm install              # install Claude Agent SDK + minimal deps
npm run build            # compile TypeScript
npm test                 # run scaffold smoke tests
forge --help             # CLI surface
forge brain lint         # structural integrity checks on brain/ (9 checks; exit non-zero on errors)
forge brain index --write  # regenerate brain/INDEX.md from filesystem (counts + sub-wiki listing)
forge studio lint        # validate studio definitions (agents/flows/catalog/kb); exit non-zero on errors
```

## Architecture (post-scaffold)

```
forge/
├── ARCHITECTURE.md     # narrative version of the diagram
├── PRINCIPLES.md       # five user-stated principles
├── docs/               # decisions (ADRs), phase docs, seeding plan
├── brain/              # the wiki (Karpathy three-layer)
├── skills/             # Claude Code skills (the agent surface)
├── loops/              # agentic loop runtimes (default: Ralph)
├── orchestrator/       # scheduler, cycle runner, flow engine, KB backend seam, logging (hot path)
├── cli/                # operator utilities + forge subcommand handlers (post-2026-05-24 Move 1)
├── forge-ui/           # Next.js operator UI; launched by `forge studio` (see CWC DOM convention below)
├── _queue/             # initiative queue (gitignored)
├── _logs/              # JSONL event logs (gitignored)
└── projects/           # managed projects (gitignored)
```

## Status of the scaffold

All six phases (brain, architect, project-manager, developer-loop,
review-loop, reflection) are closed and production-running. End-to-end
cycles ship merged PRs against managed projects. The detail of when
each phase closed and the historical iteration arcs live in
[`brain/log.md`](./brain/log.md).

**Note (2026-05-25):** the per-phase + e2e bench harnesses under
`benchmarks/` were removed in this commit. They had grown into a set
of synthetic rubrics and thresholds that were starting to *teach* the
phases toward the bench shape rather than measure real-cycle outcomes
— the opposite of the intent. Phase quality going forward is judged
on real merged cycles (brain themes accumulate the evidence). Benches
will be rebuilt later, anchored on actual past successful cycle
artifacts rather than hand-curated fixtures.

**Amended 2026-05-30 ([ADR 022](./docs/decisions/022-real-capability-harness.md)):**
the *synthetic per-phase* benches stay dead, but a *real-cycle* harness now
fills the gap — `verify-cycle.mjs` is forge's standing real-capability regression
harness (`scripts/verify-cycle.mjs`), asserting real-cycle **outcomes** (reached
PR/merge, dev-loop N/N, project tests green post-merge, cost under ceiling), not
synthetic rubrics. The routine, creds-free ground is **gitpulse**
(`github.com/parsoFish/gitpulse` — an independent repo; the harness's
`--project` flag literally defaults to `mdtoc`, but `mdtoc` is uniquely
committed inside forge's own repo (`projects/mdtoc/`) and must **never**
actually be the harness ground — always pass `--project gitpulse`);
**betterado** is the live-ADO tier. Tiered (frozen-SHA routine /
full-greenfield release), run as a manual gate before pointing forge at a
real project.

Where to look for as-built detail:

- Code structure: [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`PRINCIPLES.md`](./PRINCIPLES.md), [ADRs](./docs/decisions/).
- Per-phase invocation contracts: `orchestrator/<phase>-invocation.ts` (PM, dev, unifier, reflector).
- Cycle archives: [`brain/_raw/cycles/`](./brain/_raw/cycles/).
- Forge-level patterns: [`brain/cycles/themes/`](./brain/cycles/themes/).
- Per-project patterns: [`brain/projects/<project>/themes/`](./brain/projects/).
- Operator UI: [`forge-ui/`](./forge-ui/) (launched by `forge studio`).

## forge-ui DOM-as-metrics convention

Every load-bearing UI state in `forge-ui/` is mirrored to `data-*`
attributes so any automation (playwright today, LLM-driven UI tests
tomorrow) can drive the page by reading structured DOM state rather
than scraping rendered text. Pattern from
[anthropics/cwc-workshops `how-we-claude-code`](https://github.com/anthropics/cwc-workshops/tree/main/how-we-claude-code).

Studio has no standalone `/dashboard` any more (retired M7, ADR-031) —
every route below owns its own `data-page="<name>"` root (+
`data-page-ready` once its first fetch settles), so this is a per-route
inventory rather than one shared page-level contract:

- **Library `/`** — the landing/browse surface: `[data-page="library"][data-page-ready]`,
  one `data-section` per pillar (`orientation`, `projects`, `agents`,
  `flows`, `kbs`).
- **`/flows/[id]` — monitor + build.** `[data-page="flow-monitor"][data-flow-id][data-page-ready][data-run-count][data-can-start][data-active-tab]`
  (`data-active-tab` is `monitor | build`). MONITOR renders the run's hex
  topology (`FlowTopology.tsx`): each node is
  `[data-mon-node][data-node-id][data-status][data-hex-kind]`
  (`data-hex-kind` is `phase | wi`); phase hexes carry `data-phase-cost-usd`,
  WI hexes additionally carry `data-wi-cost-usd`; a fanned-out dev node's
  own aggregate carries `data-fanout-phase` rather than
  `data-hex-kind="phase"`. A single **flowLineage** run threads across
  chained flow definitions (`forge-architect` → `forge-develop` →
  `forge-reflect`) — each renders only its own slice of nodes, so
  switching `/flows/<flowId>` changes which hexes appear. BUILD renders
  the flow-as-data canvas: `[data-component="flow-header"][data-goal-set]`
  + `[data-component="flow-builder-canvas"][data-node-count][data-edge-count]`,
  per-node `[data-flow-node][data-node-id][data-agent-ref]`, and
  `[data-action="save-flow"|"clear-canvas"|"auto-layout"]`.
- **`/artifact` — the unified gate/artifact viewer + the review/reflect
  redirect stubs.** `?run=<id>&type=plan|workitems|pr|demo|verdict|reflection&mode=gate|view`;
  root carries `[data-page="flows"][data-page-ready][data-run][data-artifact-type][data-mode][data-gate-state]`
  (that `data-page="flows"` value is the page's own literal, not a typo —
  every gate/artifact moment folded into this one route). `type=verdict&mode=gate`
  is the sole review gate: `[data-section="demo-comparison"]` /
  `[data-section="demo-evaluation"][data-ac-verdict]` (DemoComparison) plus
  the verdict form —
  `[data-component="verdict-form"][data-form-state][data-form-kind][data-initiative-id][data-ac-count]`
  (`data-form-state` is `editing | submitting | submitted`, `data-form-kind`
  is `approve | send-back`), submit button
  `[data-action="approve-and-merge"|"send-back"]`. `type=reflection&mode=view`
  is the sole reflection surface (interactive ReflectionGate above a
  read-only renderer). The old `/review/[cycleId]` and `/reflect/[cycleId]`
  routes are now permanent client-side redirects into `/artifact` (M7-3,
  ADR-031) — `[data-page="review-redirect"|"reflect-redirect"][data-page-ready="true"]`
  — kept only so stale bookmarks keep working.
- **`/agents/[id]`** — the agent builder: `[data-page="agents"][data-page-ready][data-agent-id][data-dirty]`;
  the catalog palette renders `[data-id]` chips; Advanced is collapsed by
  default (`[data-section="advanced"][data-advanced-open]`) behind which sit
  the capability drop zones `[data-accepts="skill"|"tool"|"mcp"|"hook"]`, a
  `[data-sdk]` runtime pick, and a `[data-ready-count]` readiness panel.
  `/agents/new` shows the curated starter picker first
  (`[data-section="starter-picker"]`, per-option `[data-starter-option]`).
- **`/projects` + `/projects/[id]` — editor + roadmap.** Bare `/projects`
  just redirects to the first registered project
  (`[data-page="projects-index"]` while empty/loading). The project page is
  `[data-page="projects"][data-project-id][data-dirty][data-page-ready][data-demo-design-state]`
  with an Editor/Roadmap tab bar (`[data-tab="editor"|"roadmap"][data-tab-active]`).
  Roadmap renders `SerpentineTimeline.tsx`:
  `[data-roadmap-timeline][data-node-count]` with per-initiative
  `[data-roadmap-node][data-initiative-id][data-initiative-status]` and a
  pop-off detail card `[data-roadmap-popover][data-popover-initiative-id]`. A
  brand-new project renders `ProjectOnboardForm` instead:
  `[data-section="project-onboard"]`, collapsible
  `[data-section="onboard-advanced"][data-advanced-open]`, and a preflight
  check against the forge project contract —
  `[data-section="onboard-preflight"]` / `[data-section="failing-clauses"]`.
  The recovery page groups by initiative too (see `/recovery` below).
- **`/architect/new` + `/architect/[sid]/interview`.** `/architect/new` is
  the native "start a run" entry that replaced the retired `/dashboard`
  launcher — `[data-page="architect-new"][data-page-ready]` wrapping the
  same idea box, `[data-section="new-idea"][data-new-idea-ready]`. The
  interview is a dedicated Studio-chrome screen —
  `[data-page="architect-interview"][data-page-ready][data-session-id][data-architect-phase]`
  — with the focused architect hex (`[data-architect-phase][data-architect-active]`,
  `[data-tool-burst]` chips) plus
  `[data-section="architect-interview"][data-architect-round][data-questions-answered]`,
  per-question `[data-question-index][data-question-resolved]`, per-option
  `[data-option-label][data-option-selected]`. The bare
  `/architect/[sessionId]` route (no `/interview`) is now a permanent
  server-side redirect into `/architect/<sid>/interview` (M7-4, ADR-031) —
  the old standalone screen + its `design-decisions`/`escalation-id` PLAN
  gate are gone; the PLAN gate is just
  `/artifact?run=_architect-<sid>&type=plan&mode=gate` like any other gate.
- **`/instructions/[sid]`** — the AI-assisted AGENTS.md/instructions
  interview, sharing the same Studio-chrome shell and (deliberately) the
  same round/question/option attribute names as the architect interview:
  `[data-page="instructions-interview"][data-page-ready][data-session-id][data-instructions-phase]`,
  `[data-section="instructions-status"]`,
  `[data-section="instructions-interview"][data-architect-round][data-questions-answered]`.
  Its verdict form is
  `[data-component="instructions-verdict"][data-form-state][data-form-kind]`
  with `[data-action="approve-instructions"|"revise-instructions"|"reject-instructions"]`.
- **`/project-brain/[sid]`** — the onboarding Brain-3 builder:
  `[data-page="project-brain"][data-session-id][data-project-brain-phase]`
  stepping through
  `[data-section="brain-briefing"|"brain-analyzing"|"brain-review"|"brain-committing"|"brain-committed"|"brain-abandoned"]`
  (`brain-review` carries `data-theme-count`).
- **`/demo/[sid]`** — the per-project demo-page builder (brief → generate →
  lock, element-by-element): shares the Studio-chrome shell —
  `[data-page="demo-builder"][data-page-ready][data-session-id][data-demo-phase]`
  — with
  `[data-section="demo-target-element"|"demo-status"|"demo-history"|"demo-viewer"|"demo-process"]`.
- **`/knowledge` + `/knowledge/new`** — the knowledge-graph browser
  (`[data-page="knowledge"][data-page-ready]`) and the new-KB form
  (`[data-page="knowledge-new"][data-page-ready="true"][data-section="kb-new"]`).
- **`/recovery`** — the stuck-initiative operator surface, grouped by
  initiative: `[data-page="recovery"][data-page-ready][data-recovery-count]`
  with per-item
  `[data-recovery-item][data-recovery-initiative][data-recovery-status][data-recovery-attempt-count]`
  (+ `[data-recovery-prior-attempts]`) and an expandable
  `[data-section="recovery-detail"][data-recovery-detail-initiative]`.
- **`/skills`** — no standalone catalog route; the OOTB
  community-sourced skill library (`studio/catalog.yaml`, with provenance +
  stars) surfaces inside the agent builder's palette (`/agents/new`,
  `/agents/[id]`), editing an existing skill happens through that same
  `/agents/[id]` builder, and authoring a brand-new one is `/skills/new` —
  `[data-page="skill-builder"][data-page-ready="true"][data-section="skill-new"]`.

The shared status vocabularies:

- **Pipeline/WI 5-state** — `pending | active | complete | retrying |
  failed`. Was `forge-ui/lib/wi-status.ts` (now **deleted**); the type is
  inlined in [`forge-ui/lib/status-colors.ts`](./forge-ui/lib/status-colors.ts)
  (`WiStatus`) alongside [`forge-ui/lib/phases.ts`](./forge-ui/lib/phases.ts)
  (`PhaseStatus`) — same 5 values, one shared palette
  (`STATUS_COLOR` + `WI_STATUS_GLOW`) so a colour change happens in exactly
  one place. Yellow = retrying (transient error, still recovering); red =
  terminal failure only — sibling units stay in their own state
  independently.
- **Run lifecycle** (`RunStatus`, [`forge-ui/lib/studio-client.ts`](./forge-ui/lib/studio-client.ts)) —
  `planned | active | gated | complete | failed`.
- **Roadmap initiative status** (`SerpentineTimeline.tsx`) — `pending |
  in-flight | ready-for-review | done | failed`.
- **`HexKind`** ([`forge-ui/lib/monitor-layout.ts`](./forge-ui/lib/monitor-layout.ts)) —
  `phase | wi`, the phase-vs-WI distinction every monitor hex carries.

When changing component state, **add or update the corresponding
`data-*` attribute** alongside any visual change — and **sync the affected
UI journey in the same PR** (beats/checks + narration/clips): invoke the
`journey-sync` skill for the maintenance contract. The journeys are both the
demo and the UI regression gate; a UI change without its journey update either
breaks the gate or silently rots the demo.

The harness surface is **journeys-as-data**:
[`scripts/e2e-journey.mjs`](./scripts/e2e-journey.mjs) (`npm run ui:journey`)
is a thin runner over 10 user-story journeys in
[`scripts/journeys/`](./scripts/journeys/) — `stand-up-create`, `agents`,
`flows-author`, `stand-up-onboard`, `skills`, `flows-run`, `roadmap`,
`knowledge`, `recovery`, `demo-builder` — one file per journey (plus
`index.mjs`, the registry/run-order module — not itself a journey), each
mapping to a capability-diagram user story rather than a step of one
linear cycle. The standalone `swap-runtime` journey was retired
2026-07-17 — its checks folded into `agents`' `agents-scratch-build` beat,
which now drives the SDK/model picker as part of composing a brand-new
agent from scratch. Each journey is
`defineJourney({ id, title, story, beats })`
([`scripts/lib/journey-runtime.mjs`](./scripts/lib/journey-runtime.mjs));
a **beat** is a scripted story moment (`{ id, title, narration, drive(ctx) }`)
that is simultaneously a demo scene (captured as a clip/frame) AND a named
test case (auto-tagged into `demos/e2e/results.json` so every `check()`
traces back to the beat that raised it). Shared machinery:
[`scripts/lib/journey-assertions.mjs`](./scripts/lib/journey-assertions.mjs)
(the soft `check()` + the `data-*` DOM-as-metrics helpers) and
[`scripts/lib/journey-fixtures.mjs`](./scripts/lib/journey-fixtures.mjs)
(seeds + grounding — values are corpus-grounded, with code comments citing
real archived cycle artifacts under `_queue/done/` — e.g.
`INIT-2026-07-11-cli-sort-flag.md` — as provenance for things like the
architect's real cost/budget shape, not hand-waved numbers). The runner
supports `--list` (enumerate journeys/beats without running), a daemon
guard ([`scripts/lib/journey-daemon-guard.mjs`](./scripts/lib/journey-daemon-guard.mjs))
that refuses to run against a real live `forge serve`, and
finalize-neutralisation (strips `releaseProcess` from the grounding
project's config for the run's duration, so the emulated approve+merge
beat can't trigger a real release finalize). Output: a journey-sectioned
gallery (`demos/e2e/index.html`, one section per journey with its story +
a green/red check-count badge) plus 8 looping long-tail clips
(`demos/e2e/clips/*.webm`) and the tracked `demos/e2e/results.json` — the
video always finishes; a non-zero exit flags any DOM-as-metrics
regression. Cleans up all seeded state (architect/instructions/demo
sessions, cycle logs, queue manifests, the scratch flow it authored, any
`_guidance/*.md`) afterwards.

Plus [`scripts/e2e-deadpaths.mjs`](./scripts/e2e-deadpaths.mjs)
(`npm run ui:deadpaths`), the dead-route/no-op sweep, sharing the same
assertion module.

**Real-capability harness** — [`scripts/verify-cycle.mjs`](./scripts/verify-cycle.mjs)
(`npm run verify:cycle`) runs a **real** cycle end-to-end against a managed
project (auto-approve + closure + reflection capture). This is the standing
regression harness for forge's actual capabilities (ADR 022): it asserts
real-cycle *outcomes* (reached merge, dev-loop N/N, the project's own quality
gate green post-merge, cost under ceiling), as a manual gate. Two grounds:
**gitpulse** (`--project gitpulse` — the creds-free, independent reference
project; see `docs/verify-cycle-ideas/README.md` for the corpus of idea
files) and the **betterado terraform provider**
(`--project terraform-provider-betterado` — the live-ADO tier, higher
ceiling, plus a 5th gate asserting the demo carries **live REST
evidence**, not a test-name table). Tiered (frozen-SHA routine /
greenfield release).
