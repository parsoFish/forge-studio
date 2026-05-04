# Forge

> Idea machine for one human across many side projects.

Forge is an autonomous multi-agent system designed around a single insight: **most of the time spent on a side project is implementation, not ideation.** The human supplies direction (roadmap, review, feedback). Agents do the rest, unattended, between the human's interactions.

This is **forge v2** — a fresh implementation that learns from v1 (at `~/sideProjects/`) and explicitly delegates to battle-tested community tooling rather than re-inventing it.

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

## Quickstart

> **Status:** scaffold only. Most phases are stubs — see `docs/phases/` for what's there and what's planned.

```bash
# Prerequisites
node --version           # Node 20+
gh --version             # GitHub CLI
git --version            # 2.20+ (for git worktree)

# Install
cd ~/forge
npm install
npm run build

# CLI surface
forge --help
forge cycle --help        # run one initiative end-to-end
forge serve --help        # start the unattended scheduler
forge enqueue --help      # add an initiative to the queue
forge status              # show queue counts and in-flight initiatives
forge bench <phase>       # run a phase's benchmark suite
forge brain query "..."  # ask the brain a question
forge metrics             # cost / iterations / duration view
```

## Repository layout

| Path | What lives here |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Narrative architecture extracted from the forge2.0 diagram |
| [`PRINCIPLES.md`](./PRINCIPLES.md) | The five user-stated principles that gate every decision |
| [`CLAUDE.md`](./CLAUDE.md) | Project instructions for Claude Code sessions |
| [`docs/`](./docs/) | Decisions (ADRs), phase docs, seeding plan, architecture diagram |
| [`brain/`](./brain/) | The wiki — empty at scaffold, seeded post-scaffold per `docs/seeding-plan.md` |
| [`skills/`](./skills/) | Claude Code skills (one per agent role); the agent surface |
| [`loops/`](./loops/) | Agentic loop runtimes (default: Ralph over Claude Agent SDK) |
| [`orchestrator/`](./orchestrator/) | Minimal coordination — scheduler, cycle runner, logging |
| [`_queue/`](./_queue/) | File-based initiative queue (gitignored) |
| [`benchmarks/`](./benchmarks/) | Per-phase eval harnesses for fast feedback |
| [`monitor/`](./monitor/) | tmux + Obsidian + log-tail visualisation |
| [`_logs/`](./_logs/) | JSONL event logs (gitignored) |
| [`projects/`](./projects/) | Managed projects auto-discovered (gitignored) |

## Why a fresh repo (not a refactor of v1)

V1 grew rich infrastructure: a job queue, a worker pool, a resource controller, adaptive concurrency, process isolation. Each was a reasonable response to a real problem at the time. Together they made it onerous to change the *shape* of the system. V2 keeps v1's mental models (TDD, dependency-ordered work items, orchestrator-verified quality gates, the wiki-as-brain) and replaces v1's infrastructure with battle-tested community tools (Claude Agent SDK, Ralph loop pattern, gh CLI, git worktrees, Claude Code skills).

## Status

- ✅ Scaffold (this commit)
- ⏳ Phase implementations (each phase tracked in `docs/phases/<phase>.md`)
- ⏳ Brain seeding Pass A (general best practices)
- ⏳ Brain seeding Pass B (v1 wiki + existing project state)

## License

TBD. v1 was BSL-1.1 → MIT; v2 will likely follow the same pattern.
