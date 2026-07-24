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
[`brain/forge-dev/log.md`](./brain/forge-dev/log.md).

**Note (2026-05-25):** the per-phase + e2e bench harnesses under
`benchmarks/` were removed in this commit. They had grown into a set
of synthetic rubrics and thresholds that were starting to *teach* the
phases toward the bench shape rather than measure real-cycle outcomes
— the opposite of the intent. Phase quality going forward is judged
on real merged cycles (brain themes accumulate the evidence). Benches
will be rebuilt later, anchored on actual past successful cycle
artifacts rather than hand-curated fixtures.

**Amended 2026-05-30 ([ADR 022](./docs/decisions/022-real-capability-harness.md));
ground re-stated 2026-07-17 (R5-07-F4, ADR 022 ground-swap amendment):**
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
- Per-phase invocation contracts: `orchestrator/phases/{pm,dev,reflector}-binding.ts` (+ `orchestrator/unifier-invocation.ts`, the one un-migrated phase until R4-01-F4).
- Cycle archives: [`brain/_raw/cycles/`](./brain/_raw/cycles/).
- Forge-level patterns: [`brain/cycles/themes/`](./brain/cycles/themes/).
- Per-project patterns: [`brain/projects/<project>/themes/`](./brain/projects/).
- Operator UI: [`forge-ui/`](./forge-ui/) (launched by `forge studio`).

## forge-ui DOM-as-metrics + journeys-as-data (reference)

Every load-bearing UI state in `forge-ui/` is mirrored to `data-*` attributes so
automation drives pages by structured DOM state, not scraped text (the CWC
`how-we-claude-code` pattern). The full **per-route `data-*` contract**, the
shared status vocabularies, the **journeys-as-data** harness
(`scripts/e2e-journey.mjs` + `scripts/journeys/`; `ui:journey` / `ui:deadpaths`),
and the **real-capability harness** (`scripts/verify-cycle.mjs` — the gitpulse /
betterado grounds) live in
[`docs/forge-ui-dom-and-harness.md`](./docs/forge-ui-dom-and-harness.md), kept
out of this file so the always-injected instructions stay lean.

When a change touches forge-ui load-bearing state, **update the `data-*`
attribute, that reference doc, and the affected journey in the same PR** — invoke
the `journey-sync` skill for the maintenance contract. The journeys are both the
demo and the UI regression gate: a UI change without its journey update either
breaks the gate or silently rots the demo.
