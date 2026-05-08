---
source_type: web
source_url: https://ghuntley.com/ralph/
source_title: Ralph Wiggum as a "software engineer" — Geoffrey Huntley
ingested_at: 2026-05-04T18:00:00Z
ingested_by: brain-ingest (Pass A, batch 4)
cycle_id: pass-a-bootstrap
---

# The Ralph Wiggum Loop: Core Pattern (Geoffrey Huntley)

**What It Is:**
Ralph is an agentic loop executing `while :; do cat PROMPT.md | claude-code ; done`—a monolithic, single-task-per-iteration pattern where an LLM agent autonomously decides priority and iterates until completion.

**The Mechanism:**

- **PROMPT.md** — Core task instruction allocating specs and fix_plan.md to context each loop.
- **@specs/*** — Technical specifications defining correct patterns and behaviour.
- **@fix_plan.md** — Prioritised todo list (continuously updated, periodically discarded).
- Supporting files: AGENT.md (learnings), test suites, git history.

**Why It Works:**

Deterministic allocation of limited context (~150k effective tokens) combined with tight feedback loops. *"The technique is deterministically bad in an undeterministic world"* — Ralph fails predictably, making failures tunable through prompt refinement rather than architectural change. Each loop receives fresh specs, allowing the model to self-correct via backpressure (tests, compilation, static analysis).

**Stop Conditions:**

- All tests pass, todos completed, git-tagged.
- OR operator judgment: reset and restart.
- OR pivots to new todo generation.

**Key Insight:**

Engineers remain essential for tuning prompts and evaluating directions. Ralph displaces greenfield-only SWE volume, achieving *"shocking ROI"* ($50k contracts for $297) through relentless iteration within controlled constraints.
