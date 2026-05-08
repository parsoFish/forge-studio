---
source_type: web
source_url: https://github.com/vercel-labs/ralph-loop-agent
source_title: Vercel's ralph-loop-agent (Anthropic AI SDK wrapper)
ingested_at: 2026-05-04T18:00:00Z
ingested_by: brain-ingest (Pass A, batch 4)
cycle_id: pass-a-bootstrap
---

# Vercel ralph-loop-agent

**Core Function**: Ralph Loop Agent wraps the AI SDK's `generateText` in an outer loop that *"keeps iterating until your `verifyCompletion` function confirms success — or you hit a safety limit."*

**Distinction from Standard Bash Loops**: unlike traditional tool-calling workflows that terminate when the model finishes calling tools, Ralph implements continuous autonomy. *"Keep feeding an AI agent a task until the job is done,"* with verification checks guiding iterative refinement rather than single-shot execution.

**SDK Integration**: built on the Anthropic AI SDK, using AI Gateway string format for model specification and supporting all native AI SDK tools.

**Iteration Controls**:

- `iterationCountIs(n)` — limits outer loop iterations.
- `tokenCountIs(n)` — caps total token usage.
- `costIs(maxCost)` — enforces spending limits.
- `toolStopWhen` — inner loop constraints.

**Lifecycle Logging**: developers can hook into iteration timing via `onIterationStart` and `onIterationEnd` callbacks, receiving iteration count and duration metrics.

**State Persistence**: the framework maintains `allResults` (complete history of iteration outputs) and aggregated `totalUsage` statistics across loops, accessible in the final `RalphLoopAgentResult`.
