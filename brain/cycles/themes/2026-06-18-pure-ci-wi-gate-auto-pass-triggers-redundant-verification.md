---
title: Pure-CI work item gate auto-passes at iter 0 but ralph runs exhaustive redundant checks in iter 1
description: When a WI's sole purpose is CI verification (no new code, gate already satisfied by prior WIs), the gate auto-passes at iteration 0. Ralph then runs the full offline suite anyway (golangci-lint ×2, terrafmt ×2, make test) in iteration 1, burning tokens and time before committing zero files.
category: antipattern
created_at: 2026-07-10T10:39:32.000Z
updated_at: 2026-07-10T10:39:32.000Z
---

## Pattern

A CI-gate WI (e.g. "Given all files from WI-1 and WI-2 are present — Then exit 0, no gofmt violations, no compilation errors") is the last in a dependency chain. Its quality_gate_cmd passes immediately at iter 0 because prior WIs committed all required changes. The gate auto-pass signal fires before any agent work.

However, ralph processes the gate.pass as "gate met — confirm ACs", then reads the WI spec's ACs (which include: gofmt, golangci-lint, terrafmt, make test, resource count test) and re-runs each check independently in iter 1. The iteration ends with 0 new files committed.

## Evidence

WI-3 in INIT-2026-06-17-release-folder-coverage:
- gate.pass at iter 0 (09:54:01 → 10:00:53), delta: 0 files, 0 insertions
- ralph iter 1: 44 bash calls, 15 test runs, 63 bash calls total, ~17 min elapsed
- Discoveries in iter 1 included `make test` hang (pre-existing, not WI-3's fault)
- ralph.end: iters=1, status=complete, stop=quality-gates-pass
- dev-loop.delivered: files_changed=0, insertions=0, commits=0

## Why it happens

The gate.pass at iter 0 does NOT terminate the WI. The WI spec's ACs are richer than the quality_gate_cmd — they enumerate all the checks the PM included. Ralph sees "AC1: gofmt; AC2: golangci-lint; AC3: terrafmt; AC4: resource count test" and treats them as a verification checklist to run independently, even though the gate already represents the summary assertion.

## Cost

WI-3 in this cycle: ~17 minutes of agent wall-clock, 44 bash commands, 15 test runs, 63 bash calls. The `make test` hang investigation alone was 6 probe commands and ~17 min. All for a WI that delivered zero new artifacts.

## Fix options

1. **PM instruction**: when decomposing a CI-gate WI, set `quality_gate_cmd` to cover all ACs explicitly (already done) AND add a note "if gate passes at iter 0, commit with no new files — do not re-run ACs individually".
2. **Ralph SKILL.md**: if `gate.pass` fires at iter 0 with no new file changes, emit a commit with the current state and terminate — the gate is the oracle.
3. **Structural**: PM could mark CI-gate WIs with `ci_only: true`, causing the dev-loop to skip iteration-1 verification and immediately commit the unchanged state.

## Sources

- `_logs/2026-06-18T09-50-09_INIT-2026-06-17-release-folder-coverage/events.jsonl` — WI-3 gate.pass iter 0 (10:00:53), WI-3 bash calls seq 1–51, ralph.end (10:18:08)
- `brain/cycles/_raw/2026-06-18T09-50-09_INIT-2026-06-17-release-folder-coverage.md`
