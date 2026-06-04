# Forge

> Idea machine for one human across many side projects.

Forge is an autonomous multi-agent system designed around a single insight: **most of the time spent on a side project is implementation, not ideation.** The human supplies direction (roadmap, review, feedback). Agents do the rest, unattended, between the human's interactions.

This is **forge v2** — a fresh implementation that learns from v1 (at `~/sideProjects/`) and explicitly delegates to battle-tested community tooling rather than re-inventing it.

## See it run

A real cycle — architect-supplied initiative → PM decomposes → dev-loop writes the code → unifier opens a PR — recorded against the operator UI shipped under [`forge-ui/`](./forge-ui).

https://github.com/parsoFish/forge-v2/releases/download/v0.1.0/cycle.mp4

(GitHub auto-embeds this as an inline `<video>` element on the rendered README page. Direct link: [cycle.mp4](https://github.com/parsoFish/forge-v2/releases/download/v0.1.0/cycle.mp4) · Phase-by-phase captions: [docs/demo/README.md](./docs/demo/README.md).)

The cycle shown is `INIT-2026-05-25-claude-trail-verdict-summary` — cycle 10 of the `claude-harness` dogfood sequence (claude's own forge project, also published at [parsoFish/claude-harness](https://github.com/parsoFish/claude-harness)).

## The six phases

```
Brain ──► Architect ──► Project Manager ──► Developer Loop ──► Review Loop ──► Reflection
                                                                                      │
                                                                                      ▼
                                                                                    Brain (ingest)
```

- **Brain** — Karpathy-style three-layer LLM wiki, queryable as a Claude skill, rendered in Obsidian.
- **Architect** *(human-in-the-loop)* — Claude skill that turns ideas + roadmaps into initiatives.
- **Project Manager** *(unattended)* — breaks initiatives into spec-driven work items.
- **Developer Loop** *(unattended)* — Ralph loop pattern over the Claude Agent SDK; runs until quality gates pass.
- **Review Loop** *(human-in-the-loop)* — agent prepares a working demo + PR; human approves or sends back.
- **Reflection** *(human-in-the-loop)* — agent + user retrospect; outputs go into the brain.

The architecture is documented in [`ARCHITECTURE.md`](./ARCHITECTURE.md). The non-negotiable principles are in [`PRINCIPLES.md`](./PRINCIPLES.md). Every load-bearing decision has an ADR in [`docs/decisions/`](./docs/decisions/).

## The three human moments — how *you* drive a cycle

Forge runs unattended **between** exactly three deliberate human
interaction points. Everything else (PM → developer-loop → unifier)
is autonomous. Each human moment is a **UI screen** in the forge UI
([ADR 023](./docs/decisions/023-ui-sole-operator-surface.md)) — the
UI is the sole operator surface; slash commands are thin invokers at most.

This is the exact back-and-forth. A full cycle is: **you architect → forge
runs → you review → forge merges-closes → you reflect.**

### 1. Architect — forge UI dashboard → `/architect/<sid>`  (you start here)

- **When:** any time you have a new direction for a project. This is
  *out-of-cycle* — it is not part of `runCycle`; you initiate it.
- **You do:** open the forge UI dashboard, enter a new idea, and work
  through the interview + PLAN gate on the `/architect/<sid>` screen.
  The skill brain-queries first, then proposes one or more right-sized
  initiative manifests. Iterate until the scope/sizing is right, then confirm.
- **Forge produces:** `_queue/pending/INIT-<date>-<slug>.md`. Then
  **stop** — you do not run a cycle; the scheduler picks the pending
  manifest up on its own.
- **Then forge runs unattended:** scheduler claims it → Project Manager →
  Developer Loop → unifier prepares a demo + PR draft → opens a
  GitHub PR with the **demo committed and embedded in the PR itself** →
  **stops** and notifies you (`review-ready`). It never auto-merges.

### 2. Review — `/review/<cycleId>` UI screen

The cycle has paused with an open PR (manifest in
`_queue/ready-for-review/`). Open the **`/review/<cycleId>`** screen in
the forge UI — the structured demo and PR are surfaced there. Pick **one**:

- **Approve → merge in GitHub (the normal path).** Click *Merge* on the
  PR. That is the *only* merge path — forge never merges for you. On the
  next cycle trigger, **closure** confirms `gh pr view == MERGED`,
  fast-forwards local `main`, prunes the branch, and **fires
  reflection**. Nothing else to do for approval.
- **Send back for changes.** Write a send-back verdict via the UI (or
  directly into `_queue/in-flight/<id>.verdict-response.md` with
  `verdict: send-back` and `- GIVEN … WHEN … THEN …` acceptance
  criteria). The unifier reads send-back ACs from `fix_plan.md` on the
  next iteration. Cap: **2 send-back rounds** (1 prep + ≤2).
- **Approve without merging (rare).** `verdict: approve` only releases
  the review gate; it does **not** merge. You still merge in GitHub.

> **Iterating via PR comments** is a fully supported, low-overhead loop
> when you are engaged: review → comment → agent addresses → push →
> re-review, all on the PR. It works *because the demo lives in the PR*.
> Pattern of record:
> [`brain/cycles/themes/pr-as-sole-review-window.md`](./brain/cycles/themes/pr-as-sole-review-window.md).

### 3. Reflect — `/reflect/<cycleId>` UI screen  (after the merge)

- **When:** after the merge is confirmed, the reflector runs and may
  write `_logs/<id>/user-questions.md` (≤4 questions).
- **You do:** open the **`/reflect/<cycleId>`** screen, skim
  `_logs/<id>/retro.md` and the questions, then write
  `_logs/<id>/user-feedback.md` — answer each question plus any
  free-form notes. The reflector distils it into the brain (themes +
  retro + cycle archive + `brain/log.md`).
- **If you skip it:** reflection still runs and records *"no feedback
  this cycle"* — so writing the file is how your voice enters the brain.
  Write it *before* the reflector runs to land in that cycle.

| Moment | UI screen | File handoff |
|---|---|---|
| Architect | `/architect/<sid>` | writes `_queue/pending/INIT-*.md` |
| Review | `/review/<cycleId>` | `…verdict-response.md` (send-back/approve), or GitHub merge |
| Reflect | `/reflect/<cycleId>` | writes `_logs/<id>/user-feedback.md` |

The **authoritative contract** for each moment is its skill:
architect → [`skills/architect/SKILL.md`](./skills/architect/SKILL.md);
review → [`skills/developer-unifier/SKILL.md`](./skills/developer-unifier/SKILL.md)
(the reviewer folded into the unifier + `cycle.ts`), with the demo contract in
[`skills/demo/SKILL.md`](./skills/demo/SKILL.md);
reflect → [`skills/reflector/SKILL.md`](./skills/reflector/SKILL.md).
Design of record: [`brain/cycles/themes/human-interaction-via-own-session.md`](./brain/cycles/themes/human-interaction-via-own-session.md);
review/closure mechanics in [`docs/phases/review-loop.md`](./docs/phases/review-loop.md).

## Quickstart

> **Status:** all six phases implemented, benchmarked, and closed; the
> brain is seeded; the full cycle runs end-to-end (architect → PM →
> developer-loop → review-Ralph → operator merge → closure → reflection).
> See `docs/phases/` and [`CLAUDE.md`](./CLAUDE.md) for per-phase status.

```bash
# Prerequisites
node --version           # Node 20+
gh --version             # GitHub CLI
git --version            # 2.20+ (for git worktree)

# Install
cd ~/forge
npm install
npm run build
npm link                 # puts the `forge` command on PATH
                         # (declared in package.json `bin` → bin/forge.mjs;
                         #  TS runs directly, no build needed for the CLI)

# CLI surface (see `forge --help` for the full list)
forge --help
forge serve [--once]              # run the unattended scheduler
forge cycle <initiative-id>       # run one initiative end-to-end (foreground)
forge enqueue <project> <spec>    # add an initiative to the queue
forge status [--watch]            # queue counts + in-flight initiatives
forge preflight <project>         # check the C1–C6 (+BRAIN) project contract
forge review <id>                 # print the open verdict prompt / recovery
forge report <cycle-id>           # human-facing cycle report
forge metrics [<cycle-id>]        # cost / iterations / duration
forge brain index [--scope <p>]   # emit brain navigation indexes

# The brain is queried via the `brain-query` Claude skill, not a CLI verb.
```

## Repository layout

| Path | What lives here |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Narrative architecture extracted from the forge2.0 diagram |
| [`PRINCIPLES.md`](./PRINCIPLES.md) | The five user-stated principles that gate every decision |
| [`CLAUDE.md`](./CLAUDE.md) | Project instructions for Claude Code sessions |
| [`docs/`](./docs/) | Decisions (ADRs), phase docs, seeding plan, architecture diagram |
| [`brain/`](./brain/) | The wiki — seeded (forge-level themes + per-project sub-wikis); category-indexed, `brain-query`-able |
| [`skills/`](./skills/) | Claude Code skills (one per agent role); the agent surface |
| [`loops/`](./loops/) | Agentic loop runtimes (default: Ralph over Claude Agent SDK) |
| [`orchestrator/`](./orchestrator/) | Minimal coordination — scheduler, cycle runner, logging |
| [`_queue/`](./_queue/) | File-based initiative queue (gitignored) |
| [`_logs/`](./_logs/) | JSONL event logs (gitignored) |
| [`projects/`](./projects/) | Managed projects auto-discovered (gitignored) |

## Why a fresh repo (not a refactor of v1)

V1 grew rich infrastructure: a job queue, a worker pool, a resource controller, adaptive concurrency, process isolation. Each was a reasonable response to a real problem at the time. Together they made it onerous to change the *shape* of the system. V2 keeps v1's mental models (TDD, dependency-ordered work items, orchestrator-verified quality gates, the wiki-as-brain) and replaces v1's infrastructure with battle-tested community tools (Claude Agent SDK, Ralph loop pattern, gh CLI, git worktrees, Claude Code skills).

## Status

- ✅ Scaffold + all six phases implemented, benchmarked, and closed
- ✅ Brain seeded (Pass A general best-practice + Pass B v1 wiki / project
  state) and kept current by the reflection phase
- ✅ Full cycle runs end-to-end: architect → PM → developer-loop →
  review-Ralph (demo-embedded PR) → operator merge → closure → reflection
- ✅ Operator-review reliability hardened (the PR is the self-contained review window)
- ▶ Ongoing: real project arcs (e.g. trafficGame) drive further hardening;
  per-phase status in [`CLAUDE.md`](./CLAUDE.md) and `docs/phases/`

## License

TBD. v1 was BSL-1.1 → MIT; v2 will likely follow the same pattern.
