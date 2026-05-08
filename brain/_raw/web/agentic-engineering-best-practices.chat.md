---
source_type: chat
source_url: synthesis (general agentic-engineering practitioner consensus)
source_title: Generic agentic-engineering best practices — TDD, spec-driven, dependency-ordered, eval-driven, cost-aware routing
ingested_at: 2026-05-04T18:00:00Z
ingested_by: brain-ingest (Pass A, batch 6)
cycle_id: pass-a-bootstrap
---

# Generic agentic-engineering best practices (synthesis)

These are practitioner-consensus patterns from the broader agentic-coding ecosystem (Claude Code rules, Cursor/Aider community write-ups, Anthropic prompt-engineering guides, gstack, ralph practitioners). Forge v2 inherits all five.

## 1. TDD with agents (write tests before implementation; verify in a worktree)

Agents are good at producing plausible-looking code that doesn't quite work. Tests are the cheapest way to make "does it work?" mechanically verifiable. Practice:

- Write tests first, run them red.
- Have the agent implement against the failing tests.
- Run the tests green in a *worktree*, not just in the agent's response.
- Hallucinated test passes are real — never trust agent self-reports of green; the orchestrator runs the gate independently.
- Coverage target ≥80% (forge inherits this from the user's global rules).

## 2. Spec-driven development (PRD as the contract between PM and developer)

Vague specs propagate downstream and break the developer loop. Concrete specs let agents self-verify. Practice:

- Every work item has at least one Given-When-Then acceptance criterion.
- The PRD is the contract — the architect agrees with the user; the PM decomposes against the PRD; the developer loop verifies against the PM's specs.
- Specs declare desired *state*, not procedure (declarative > imperative).
- Files-in-scope are declared so changes don't sprawl.

## 3. Dependency-ordered work items (parallelism is correctness, not optimisation)

When work items don't declare dependencies, parallel execution silently corrupts merges. Practice:

- Every work item declares `depends_on: [WI-X, WI-Y]`.
- A dependency-graph critic checks for missing edges before queueing.
- Parallel execution is fearless because dependencies make it safe — it's a *correctness* property, not an optimisation knob.
- Target: ≥30% of work items run in parallel without conflict.

## 4. Eval-driven development (every change comes with a benchmark delta)

If a change can't move a benchmark, you don't know if it helped. Practice:

- Every phase has a benchmark suite (`benchmarks/<phase>/`).
- Every PR shows the benchmark delta (before/after score).
- Reflection-discovered failures become new benchmark cases.
- Benchmark drift from real-world is mitigated by occasional full-cycle runs.

## 5. Cost-aware model routing (Opus for design, Sonnet for coding, Haiku for triage)

Different tasks have different reasoning depths. Using the most powerful model for everything is wasteful and slow. Practice:

- **Haiku 4.5** — lightweight agents with frequent invocation; pair programming; worker agents in multi-agent systems. ~3× cost savings vs Sonnet at ~90% capability.
- **Sonnet 4.6** — main development work; orchestrating multi-agent workflows; complex coding tasks. The default.
- **Opus 4.7** — complex architectural decisions; maximum reasoning requirements; research and analysis tasks.
- Per-skill overrides via `forge.config.json` `models.<skill>` (e.g. `architect: opus`, `brain-query: haiku`).
