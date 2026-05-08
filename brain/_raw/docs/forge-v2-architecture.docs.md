---
source_type: docs
source_url: ARCHITECTURE.md
source_title: Forge v2 — Architecture (narrative version of forge2.0 diagram)
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 3)
cycle_id: pass-a-bootstrap
---

# Forge v2 Architecture (narrative)

> The drawio diagram is the source of truth; this is its English translation.

## Overview

Forge is six phases backed by a brain. Phases run in sequence per initiative; the brain is read by every phase as the first source of knowledge and written to at the end of every cycle.

```
                              ┌──────────┐
                              │  Brain   │ ◄───────────────────────────┐
                              │  (wiki)  │                              │
                              └────┬─────┘                              │
                                   │ queried by every phase             │ ingest
                                   ▼                                    │
   user ──► Architect ──► Project Manager ──► Developer Loop ──► Review Loop ──► Reflection
              ▲                                                       ▲             ▲
              │                                                       │             │
            user                                                    user          user
```

## Artifact flow

```
Roadmap ──► Initiative ──► Feature ──► Work item ──► (developer loop iterates) ──► Review-ready PR
```

## Branch flow

```
main ◄── (review loop merges) ──── initiative branch ◄── feature branches
```

## The phases

1. **Brain** — Karpathy three-layer wiki rendered as Obsidian vault. Three skills: brain-ingest, brain-lint, brain-query.
2. **Architect** *(human-in-the-loop)* — Claude skill turns ideas + roadmaps into initiatives. Uses LLM Council pattern (CEO/eng/design/DX critics).
3. **Project Manager** *(unattended)* — breaks initiative features into spec-driven work items with explicit dependencies and Given-When-Then acceptance criteria.
4. **Developer Loop** *(unattended)* — Ralph loop pattern over Claude Agent SDK. Loop runtime swappable via `loops/_adapters/`. Parallel work = N git worktrees × N Ralph instances.
5. **Review Loop** *(human-in-the-loop)* — review-prep (unattended) prepares working demo + PR; human approves/sends back.
6. **Reflection** *(human-in-the-loop, then unattended ingest)* — three scopes (agentic self-reflection, agent-prompted user questions, pure user feedback) all feed `brain-ingest`.

## Cross-cutting concerns

- **Unattended operation** — three human interaction points; everything else runs unattended via `_queue/` state-machine directories + `orchestrator/scheduler.ts` (~150-line persistent loop) + crash recovery via heartbeat + atomic claim. Not v1's job queue + worker + resource controller (see ADRs 011-013).
- **Brain-first research** — every skill mandates `brain-query` as first action. Broader research only when brain proves insufficient — gap is logged.
- **Logging & visualisation** — every skill invocation emits a structured event to `_logs/<cycle-id>/events.jsonl`. Source of truth for reflection, visualisation, metrics.
- **Phase isolation & benchmarks** — each phase has sample-input → measurable-output benchmark suite under `benchmarks/<phase>/`.

## What forge is *not*

- Not a job queue with priorities and dedup.
- Not a resource controller. (`maxConcurrentInitiatives` is static.)
- Not a per-project agent personality. (Skills shared; per-project taste in `brain/projects/<name>/profile.md`.)
- Does not retry failed initiatives automatically. (Failure → human triage.)
- Does not host its own model runtime, vector DB, or agent harness. (Claude Agent SDK does that.)
