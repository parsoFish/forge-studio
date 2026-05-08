---
source_type: docs
source_url: docs/decisions/002-ralph-loop-pattern.md
source_title: ADR 002 — Ralph loop pattern over Claude Agent SDK
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 1)
cycle_id: pass-a-bootstrap
---

# ADR 002 — Ralph loop pattern over Claude Agent SDK

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

The developer phase needs to iterate on a work item until quality gates pass — write code, run tests, fix what's broken, repeat. V1 modelled this as a sequence of stage agents (`plan → test → develop → pr`) which conflated "agent ran" with "work item complete," and added retry/fix-loop machinery to the orchestrator itself. The **Ralph loop pattern** (Geoffrey Huntley, late 2025) is simpler: the loop is the entire developer phase. Iteration happens inside the loop, not at the orchestrator.

## Decision

Developer loop = Ralph loop pattern:

```
loop:
  read PROMPT.md, AGENT.md (institutional memory), specs/, fix_plan.md
  call the underlying agent (Claude Agent SDK query()) against the worktree
  commit changes
  check stop conditions
  if stop: exit loop with success/failure
  else: update fix_plan.md with what's left, repeat
```

Implementation: `loops/ralph/runner.ts` (~30-line driver), `PROMPT.md.tmpl`, `AGENT.md.tmpl`, `stop-conditions.ts` (pluggable: quality gates pass, iteration budget, wedged-detector). Pattern is **agent-swappable** — `loops/_adapters/` holds future hermes/aider/openhands adapters that implement the same loop shape.

## Consequences

- Developer phase = one process, not a stage pipeline.
- Retry/fix-loop logic lives where the work happens, not in orchestrator.
- Trade-off: no built-in stop condition — bolted on. No built-in merge-conflict handling — handled inside the loop's prompts plus orchestrator-level worktree isolation. Can burn tokens — `iteration_budget` and `cost_budget_usd` cap this.

## Alternatives considered

- V1's stage pipeline — more orchestration code and worse error handling.
- Hermes Agent — duplicates the brain (Hermes has its own persistent memory).
- OpenClaw — heavyweight, opinionated about its skill registry, conflicts with our skills/.
- No loop, agent one-shots — observed in v1 to be the dominant cause of incomplete work items.

## References

- https://ghuntley.com/ralph/ (Geoffrey Huntley write-up)
- https://github.com/ghuntley/how-to-ralph-wiggum
- https://github.com/anthropics/claude-code/tree/main/plugins/ralph-wiggum
- https://github.com/vercel-labs/ralph-loop-agent
- https://www.humanlayer.dev/blog/brief-history-of-ralph
