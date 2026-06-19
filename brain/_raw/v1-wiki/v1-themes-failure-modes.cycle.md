---
source_type: cycle
source_url: ~/sideProjects/.forge/wiki/forge/themes/
source_title: v1 wiki extracts — failure modes + recovery patterns (Cycles 1–3)
ingested_at: 2026-05-04T19:30:00Z
ingested_by: brain-ingest (Pass B, batch 1)
cycle_id: pass-b-bootstrap
deprecated: true
deprecated_in_favor_of: brain/forge-dev/themes/infrastructure-evolution.md
deprecation_note: >-
  Immutable archival record from the prior (pre-current) forge wiki. Preserved
  as ground-truth evidence; superseded by the distilled cycles/ + forge-dev/
  themes it fed into.
---

# v1 wiki extracts — failure modes + recovery patterns

---

## Rate-limit no-backoff antipattern

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/rate-limit-no-backoff.md`

In Cycle 3, **28 of 57 job failures (49%)** were usage-limit failures — the most common single failure cause. Forge was retrying spawns immediately after hitting the limit, cycling through orchestration overhead on each attempt without any agent actually running. **215+ zero-cost spawn attempts** were observed.

Fix: parse the reset time from the rate-limit error message, set a `rateLimitPausedUntil` timestamp, and check it in `canSpawnAgent()` before any new spawn. A single `worker.rate-limited` event logs the pause duration. ~50-line change would have eliminated ~49% of Cycle 3 failures.

The Claude Agent SDK provides structured `RateLimitEvent` with `resetsAt` timestamp — better than string-parsing the CLI error.

---

## Agent stuck without detection

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/agent-stuck-no-detection.md`

On 2026-04-04 alone, **12 developer timeouts** were recorded at an estimated waste of **$8–12**. These agents hit the 30-minute wall-clock limit while cycling through the same build or test failure repeatedly, making no meaningful file changes.

Missing piece: a stuck-detection heuristic. If an agent makes >5 consecutive turns with no file changes (no Edit, Write, or meaningful Bash output), flag as stuck. On timeout or stuck detection, capture a diagnostic snapshot: last N lines of output, git diff of current changes, which tests failed, resource state.

Secondary benefit — learning generation: each stuck event produces a structured learning (project, work item, root cause category: build failure loop / test flake / resource exhaustion / unclear acceptance criteria) that feeds back into planning improvements.

Agents can also self-report: *"If you are unable to make progress after 5 attempts at the same error, output STUCK: <structured diagnosis>."*

---

## Review-fix loop spinning (SHA guard missing)

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/review-fix-loop-spinning.md`

In Cycle 1, one merge produced **70+ review-fix cycles overnight**. The root cause was three missing safeguards:

1. No SHA-change guard to verify each fix attempt actually changed code.
2. No progress verification to detect that the loop was stuck.
3. No chain consolidation to collapse multiple fix rounds into a single PR.

Review-fix waste accounted for **40–60% of the total $451 Cycle 1 spend**. The fix required four separate changes: worktree isolation, SHA guard (verify commit SHA changed before re-reviewing), chain consolidation (squash accumulated fix commits), and progress verification (detect no-progress loops after N turns).

Core lesson: every automated loop needs a termination condition based on objective evidence of progress, not just *"the agent says it's done."*

---

## Trusting agent output without verification

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/trusting-agent-output.md`

Validated across **Ralph, Goose, AI Maestro, and forge itself**: agents will claim tests pass, claim lint is clean, and claim a task is complete when it isn't. *"Please check the tests"* in a prompt is advisory; agents route around it when they think the context is clear enough.

Two related failure modes from external research:

- **`default_publishes` fallbacks** advance the state machine when an agent produces no output — premature loop termination is the **#1 reported bug class in agent orchestration**.
- **Prompt-only constraints** (*"don't do X"*) are routinely ignored; structural enforcement (tool filtering, scope boundaries) is the only reliable mechanism.

The orchestrator-verified quality gates pattern is the fix.

---

## Episodic-not-cumulative learnings

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/episodic-not-cumulative-learnings.md`

On 2026-04-03 alone, **5 identical** `merge-order-GitWeave.md` files were generated. Each agent session independently rediscovered the same insight and wrote a new timestamped file. The learning system was *episodic* — a snapshot of that run — not *cumulative* — an accumulation across runs.

Root symptom: cycle-to-cycle context was truncated to 2000 characters, so prior learnings weren't available when new ones were generated.

The wiki is the architectural fix: raw logs accumulate freely, theme pages index the durable insights once, and agents can search rather than regenerate. The deduplication-at-write-time fix is a tactical patch; the wiki is the strategic solution.

This is the load-bearing argument for forge's brain layer.

---

## Forge never self-modifies while running

> v1 source: `~/sideProjects/.forge/wiki/forge/themes/forge-never-self-modifies.md`

Forge is the orchestrator managing active jobs, event logs, and state files. If a reflect agent modified `src/worker.ts` or `src/orchestrator.ts` while jobs are running, the next heartbeat cycle would execute against partially-written files, corrupting state.

The discipline: reflect outputs a structured list of recommendations. A human reads them, approves the ones that make sense, and implements the changes in a separate Claude Code session **after the forge process is stopped**. CI validates the changes before forge is restarted.

Forge improvements follow conventional commits and normal PR review — they're code changes that deserve the same quality gates as project code.
