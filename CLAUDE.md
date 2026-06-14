# Forge v2 — Project Instructions for Claude Code

> Idea machine for one human across many side projects. Six phases backed by a brain. Hand-rolling forbidden; battle-tested tools required.

## North star

Forge v2 is **designed to run primarily unattended between human interaction points** (architect, review, reflection). Every decision is judged against three things:

1. Does it preserve unattended operation?
2. Does it use a battle-tested community tool, or are we re-inventing one?
3. Is it the simplest thing that could work?

If the answer to (1) is no, the change must justify why. If (2) reveals a re-invention, find the existing tool. If (3) reveals complexity, cut.

There is **one operating model**: the daemon (`forge serve`). Operator-directed step-through falls out of isolated phase functions, not a forked runtime. The harness-overlay injection seam (`PhaseAgentSpec.allowedTools`) is kept clean but the full ADR-024 migration is incremental and not yet complete.

## The brain is the first source of knowledge

**Before** answering a question about how forge works, before designing, before implementing — **query the brain**. Since the three-brain restructure ([ADR 018](./docs/decisions/018-three-brain-model.md)) the brain is three scoped graphs: **Brain 1** `brain/forge-dev/` (forge engineering), **Brain 2** `brain/cycles/` (cross-cycle patterns + archives), and **Brain 3** `projects/<name>/brain/` (per-project, lives in each project's own repo). Query via the `brain-query` skill with `--scope`. If the brain doesn't know, research further AND log the gap so the next ingest pass can fill it.

Who reads what (see [ADR 010](./docs/decisions/010-brain-first.md) as amended + [`brain/forge-dev/themes/brain-read-policy.md`](./brain/forge-dev/themes/brain-read-policy.md)):

- **Planners (architect / project-manager) + reflector** — query Brain 2 + the cycle's Brain 3 (reflector: all three). Mandatory for planners.
- **Dev-loop + reviewer** — do **NOT** read the forge brain (Brains 1+2); the planner already encoded every relevant convention/antipattern into the work items, their single source of *intent*. They **may** consult the cycle's Brain 3 (the project's own `brain/`) for supplemental project context — advisory, not mandatory (amended 2026-05-26, ADR 010).

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
- Add a feature flag, fallback, or "for backwards compatibility" path. v2 has no v1 users to support.
- Squash-merge stacked PRs (we learned this in v1; the lesson lives in the brain after Pass B).

## Build & test

```bash
npm install              # install Claude Agent SDK + minimal deps
npm run build            # compile TypeScript
npm test                 # run scaffold smoke tests
forge --help             # CLI surface
forge brain lint         # structural integrity checks on brain/ (8 checks; exit non-zero on errors)
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
├── orchestrator/       # scheduler, cycle runner, flow engine, KB backends, logging (hot path)
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
fills the gap — `claude-harness` is forge's standing real-capability regression
harness (`scripts/verify-cycle.mjs`), asserting real-cycle **outcomes** (reached
PR/merge, dev-loop N/N, project tests green post-merge, cost under ceiling), not
synthetic rubrics. Tiered (frozen-SHA routine / full-greenfield release), run as
a manual gate before pointing forge at a real project.

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

The root `<main>` carries page-level state:

- `data-conn-state` — `connecting | open | reconnecting | no-bridge | daemon-stalled`
- `data-daemon-stalled` — `true | false` (the scheduler heartbeat went stale while the bridge is open)
- `data-bridge-url` — the resolved bridge base (debug handle)
- `data-live-count`, `data-recent-count` — cycle counts
- `data-active-cycle-id`, `data-active-cycle-status`, `data-active-cycle-events`, `data-active-cycle-cost-usd`
- `data-page-ready` — `true` once the bridge connection is open (or `no-bridge` / `daemon-stalled`)
- the header cost badge: `[data-cost-badge][data-cost-usd]`

Section + component anchors (post-2026-05-25 cascade-tree layout —
the old state-machine + activity-sidebar + standalone wi-graph
sections were merged into a single hex pipeline):

- `[data-section="cycles-tab"]` — the initiative pane: cycles grouped into
  per-project roadmap tracks. Carries `data-cycles-count` + `data-project-count`.
  Each group is `[data-project-group=<name>][data-project-cycle-count]` with a
  status tally header and a `[data-project-track]` of status-coloured cycle
  cards: `[data-cycle-id][data-cycle-initiative-id][data-cycle-status][data-cycle-project][data-cycle-active]`.
- `[data-section="pipeline-tree"]` — the cascading hex view (phases
  on top, WIs branching directly off the dev-loop hex) hosted by
  `[data-component="agent-graph"]`.
- *(ADR 020 cleanup)* the **inline dashboard** verdict box was retired —
  the review human moment runs on the `/review/<cycleId>` UI screen (approve /
  send-back), or by merging the PR in GitHub. The verdict form itself is **alive
  there**: `[data-component="verdict-form"]` (ReviewVerdictForm.tsx) carries
  `data-form-state` (`editing | submitting | submitted`) + `data-form-kind`
  (`approve | send-back`) + `data-initiative-id` + `data-ac-count`, and the
  harness depends on it.
- `[data-section="architect"]` — the in-UI architect **launcher** (ADR 020) on
  the primary dashboard, mounted above the cycles tab. Compact by design — the
  heavy interview + PLAN-gate UI lives on the dedicated screen. Carries
  `data-architect-session-count` + `data-pending-plan-count`. Children:
  - `[data-section="new-idea"][data-new-idea-ready]` — idea entry box.
  - One slim row per active session, linking to `/architect/<sid>`:
    `[data-architect-session-id][data-architect-phase][data-architect-project]`
    with a `[data-action="open-plan"]` (green, when `awaiting-verdict`) or
    `[data-action="open-architect"]` button.
- `[data-page="architect-session"][data-session-id][data-architect-phase][data-page-ready]`
  — the dedicated plan screen (`app/architect/[sessionId]`). Holds the focused
  architect hex `[data-component="architect-hex"][data-architect-phase][data-architect-active]`
  (with `[data-tool-burst]` chips) plus the phase-appropriate feedback surface:
  - `[data-section="architect-interview"][data-architect-round][data-questions-answered]`
    with per-question `[data-question-index][data-question-resolved]` and
    per-option `[data-option-label][data-option-selected]`.
  - `[data-section="plan-gate"][data-session-id][data-plan-verdict-state][data-decisions-resolved]`
    with `[data-plan-iframe]` (PLAN.html, `sandbox=""`) and
    `[data-section="design-decisions"]` → per-decision
    `[data-escalation-id][data-decision-resolved]`.
- Cycle buttons: `[data-cycle-id][data-cycle-status][data-cycle-active]`.
- Phase hex mirrors: `[data-phase-hex][data-phase][data-phase-status][data-phase-cost-usd]`.
- WI hex mirrors: `[data-wi-hex][data-wi-id][data-wi-deps]`.
- Canvas panel overlays: `[data-component="cost-panel"]` (CostPanel) + the FileHeatmap.
- Event tail (ActivityPanel): `[data-section="events-list"]` + `[data-section="event-detail"][data-detail-event-id]`.
- Components: `[data-component="scheduler-banner"][data-banner-state]`,
  `[data-component="toasts"][data-toast-count]`.

Phase and WI statuses share a single 5-state vocabulary
(`pending | active | complete | retrying | failed`). Yellow = retrying
(had a transient error, still recovering); red = full cycle failure
only — sibling units stay in their own state independently. See
[`forge-ui/lib/wi-status.ts`](./forge-ui/lib/wi-status.ts) +
[`forge-ui/lib/phases.ts`](./forge-ui/lib/phases.ts).

When changing component state, **add or update the corresponding
`data-*` attribute** alongside any visual change. After a sprawl of
ad-hoc demo/capture scripts, the harness surface is **two scripts only**
(2026-05-30 consolidation):

1. **UI-emulation harness** — [`scripts/e2e-journey.mjs`](./scripts/e2e-journey.mjs)
   (`npm run ui:journey`) is the **canonical end-to-end operator journey**
   through the centralised UI (ADR 020 + 021): dashboard new-idea →
   `/architect/<sid>` interview → PLAN gate approve → autonomous cycle on the
   grouped initiative pane → `/review/<cycleId>` structured demo → approve →
   reflection. It emulates the architect runner's turns + the autonomous cycle
   by seeding the same files/events the real phases write
   (`FORGE_ARCHITECT_NO_SPAWN=1`), grounded in the real cycle event sequence.
   It is BOTH the watchable demo (records a **video** + frame gallery +
   `index.html` under `forge-ui/.demo-shots/e2e/`) AND the **UI regression
   harness**: the old `forge-ui-harness.mjs` S1–S4 `data-*` assertions (status
   transitions, ≥5 phase hexes, materialised WI hexes, the per-phase cost
   rollup) were merged in as a soft-collecting layer — the video always
   finishes, and a non-zero exit flags any DOM-as-metrics regression. Cleans up
   its synthetic project/cycle/queue state afterwards.

2. **Real-capability harness** — [`scripts/verify-cycle.mjs`](./scripts/verify-cycle.mjs)
   (`npm run verify:cycle`) runs a **real** cycle end-to-end against a managed
   project (auto-approve + closure + reflection capture). This is the standing
   regression harness for forge's actual capabilities (ADR 022): it runs
   claude-harness initiatives and asserts real-cycle *outcomes*, tiered
   (frozen-SHA routine / full-greenfield release), as a manual gate.
