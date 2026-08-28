# Forge Studio — Project Instructions for Claude Code

## Identity

**forge-studio** is a construction platform for agentic software factories: a small set of composable primitives — agents, skills, flows, knowledge, gates — that let one operator assemble a purpose-built delivery pipeline for any codebase. It ships **one working example, the develop flow**, to prove the primitives out of the box: evidence the kit works, not the product itself. Licence AGPL-3.0-or-later. Install form: a Node source checkout. Supported platform: WSL2 / Linux. The operator is **one human running many side projects**.

**Vocabulary — use these words in docs, UI and code.** *Factory* (one assembled, running pipeline) · *Flow* (ordered path of stations; `FlowDef`, [ADR 028](./docs/decisions/028-flow-engine.md)) · *Station* (a step where an agent or gate acts) · *Gate* (human or automated approval between stations) · *Agent* (worker executing a station; `PhaseAgentSpec`, [ADR 024](./docs/decisions/024-phases-as-subagents-invoking-skills.md); session kinds, [ADR 043](./docs/decisions/043-generic-interactive-surface.md)) · *Skill* (reusable instruction/tool unit) · *Brain* in-product, *Knowledge* outward (`KbBackend`, [ADR 018](./docs/decisions/018-three-brain-model.md)). Four terms are retired; this file cannot name them without failing its own gate — `node scripts/check-identity.mjs` lists them and fails CI on any current-state doc, skill or README that still uses one.

Forge runs **primarily unattended** between three human interaction points (architect, review, reflection). Judge every change against three questions: does it preserve unattended operation · does a battle-tested tool already do this · is it the simplest thing that could work. There is **one operating model**: the daemon (`forge serve`); operator-directed step-through falls out of isolated phase functions, not a forked runtime.

Narrative architecture [`ARCHITECTURE.md`](./ARCHITECTURE.md) · principles [`PRINCIPLES.md`](./PRINCIPLES.md) · repo layout [`docs/repo-map.md`](./docs/repo-map.md) · commands and quickstart [`README.md`](./README.md) · per-phase docs [`docs/phases/`](./docs/phases/) · UI `data-*` contract + journey harness [`docs/forge-ui-dom-and-harness.md`](./docs/forge-ui-dom-and-harness.md) (a change to load-bearing forge-ui state updates the attribute, that doc and the affected journey in the **same PR** — invoke the `journey-sync` skill) · decisions [`docs/decisions/`](./docs/decisions/).

## The active plan — read this before anything else

[`docs/roadmaps/1.0.md`](./docs/roadmaps/1.0.md) is the single roadmap for all forge work. Its **§1 is the fresh-session read order** — follow it before designing or implementing anything. It supersedes R1–R8 for new work. Design record: [`docs/superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md`](./docs/superpowers/specs/2026-08-28-forge-1-0-blueprint-design.md). Campaign state lives in `_1.0/` (gitignored); a permanent artifact — an ADR, a roadmap, anything in `docs/` — never cites a path inside it.

## Studio session

`forge studio` is the sole operator surface ([ADR 031](./docs/decisions/031-studio-consolidation.md)), on fixed ports: bridge **4123**, UI **4124**, so one browser tab stays pinned across re-runs. Run it once at session start and keep it up all session — it is the live window onto every cycle. Restart it **only** to apply changes to Studio's own code. It serves a production Next build by default; `--dev` keeps the next-dev path for forge-ui iteration. A second `forge studio` attaches read-only: it probes `GET /api/health` for `{service:'forge-bridge',pid,startedAt}` and **reuses** a healthy forge bridge, taking over only a free, stale or foreign port. Human viewers open a second window with `--attach`. **Never `--force-takeover` a running agent session** — it SIGKILLs the bridge and hard-resets in-flight cycles.

## The brain is the first source of knowledge

Three scoped graphs ([ADR 018](./docs/decisions/018-three-brain-model.md)): **Brain 1** `brain/forge-dev/` (forge engineering) · **Brain 2** `brain/cycles/` (cross-cycle patterns + archives in `brain/cycles/_raw/`) · **Brain 3** `brain/projects/<name>/themes/` (per-project, in this repo — [ADR 035](./docs/decisions/035-forge-owned-central-artifacts.md)).

Who reads what ([ADR 010](./docs/decisions/010-brain-first.md) as amended + [`brain/forge-dev/themes/brain-read-policy.md`](./brain/forge-dev/themes/brain-read-policy.md)): **planners (architect / project-manager) and the reflector** query Brain 2 + the cycle's Brain 3 (reflector: all three) — **mandatory**, and a planner or reflector skill that does not read the brain must not ship. **Dev-loop and reviewer do NOT** read Brains 1+2: the planner already encoded every relevant convention and antipattern into the work items, their single source of intent. They *may* read the cycle's Brain 3 for supplemental project context (advisory); the reviewer additionally gets an advisory read of any `{kind: flow, band: review-band}` KB granted to it. If the brain does not know, research further **and** log the gap.

**Campaign override:** the 1.0 plan's §1.1 read order does not include the brain, and `brain-query` is a *product* skill under `skills/` that forge's own agents invoke — a session working the 1.0 plan edits it, it does not run it.

## Merge protocol

Strict branch protection → `gh pr update-branch` → CI green **on the exact head SHA** → merge → re-verify merged main with build, typecheck and the full `npm test`. Never merge on absence of red: a gate that reports no checks is not a green gate. Never `--admin`. Never `git add -A`. `git checkout` never shares a command line and never takes `.`. Conventional commits (`feat|fix|refactor|test|docs|chore|perf|ci`), no AI attribution lines, one concern per PR, git worktrees for parallel work units.

## Never do — and what parks instead of proceeding

- Re-invent a job queue, worker pool, resource controller or process isolator (ADRs 011–013).
- Spawn agents as Claude CLI subprocesses — use Claude Code skills via the SDK.
- Add a feature flag, fallback or backwards-compatibility path. There are no legacy users.
- Squash-merge stacked PRs.
- Ship a planner or reflector skill that does not read the brain first.
- Emit an artifact that is not greppable markdown, or a skill invocation that logs no structured event to the JSONL event log.

**Park — produce the artifact, say so, and stop** rather than proceeding: a change that conflicts with an ADR (**update the ADR first, with rationale**) · a new external dependency (every dep is a maintenance liability) · a cross-project breaking change · anything that grows the surface area of `orchestrator/`, which is explicitly capped — the cap governs `orchestrator/` only, and [ADR 042](./docs/decisions/042-surface-cap-scope-and-testability.md) records its three ratified boundaries.
