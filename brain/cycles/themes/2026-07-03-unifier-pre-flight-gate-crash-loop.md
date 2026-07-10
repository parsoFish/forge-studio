---
title: "Unifier pre-flight gate crash loop: review-gate fires before agent runs"
description: "review-gate-r3.sh asserted live evidence before the unifier agent took a single tool call; exit code 1 → 'crashed' classification → re-queue → same gate fires immediately → 52 failures / 17 unifier.failed / ~2 hr loop before operator intervention."
category: antipattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

# Unifier pre-flight gate crash loop

## What happened

In the `new-api-pipelines-v2` initiative, UWI-4 (demo/evidence assembly) was assigned `bash .forge/review-gate-r3.sh` as its quality gate. This script uses Python to assert that `CaptureLiveEvidence` had been called and the live-evidence JSON checkpoint exists.

The gate ran at the **very start of each unifier invocation** — before the agent executed any tool calls (`iterations=0`, heartbeats show `tool_use_count=0`). Because the live-evidence checkpoint was absent from the worktree at invocation time, the gate returned exit code 1, the orchestrator classified the unifier as `dev-loop-unifier-crashed`, and re-queued the whole cycle. The next invocation immediately hit the same gate failure.

Result: **52 gate.expected-fail events**, **17 unifier.failed events**, **35 crash-retry events** over ~2 hours before operator intervention resolved the live-evidence state.

## Root cause

The pre-flight gate check is meant to verify completed work, not to guard at entry. When the gate assertion requires a side-effect that the agent itself is supposed to produce, and the gate fires before the agent runs, the loop is structurally unbreakable without external intervention.

## Failure signatures

- `unifier.crash-retry` attempt 1 and 2 within seconds of `unifier.start`
- `iterations=0` in every `unifier.failed` event
- `tool_use_count=0` in heartbeats
- 17 identical `failure_class: dev-loop-unifier-crashed`

## What would fix it

1. **Delay the pre-flight gate** until after the agent completes at least one tool call — or run the gate only at the *end* of an iteration, not at start.
2. **Circuit breaker**: after N consecutive `dev-loop-unifier-crashed` with `iterations=0`, pause and notify operator instead of re-queuing immediately.
3. **Pre-flight vs. quality gate distinction**: distinguish "does the worktree have the right pre-conditions to start work?" (pre-flight) from "did the agent produce the expected artefact?" (quality gate). Only quality gates should gate on agent-produced artefacts.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelines-v2/events.jsonl` — 52× `gate.expected-fail` for `bash .forge/review-gate-r3.sh`, 17× `unifier.failed` with `failure_class: dev-loop-unifier-crashed`, `iterations=0`
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-pipelines-v2.md`
