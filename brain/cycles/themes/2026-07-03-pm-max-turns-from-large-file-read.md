---
title: PM hits error_max_turns when key file too large for Read tool — no Grep fallback attempted
description: PM run exhausted its turn budget (error_max_turns) attempting to read azuredevops/framework.go via Read tool + 7 Bash/Task retries without success. No Grep fallback to extract specific content was attempted. Zero WIs emitted, $0.89 wasted.
category: antipattern
created_at: 2026-07-03T00:00:00.000Z
updated_at: 2026-07-03T00:00:00.000Z
---

## Pattern observed

Cycle: `2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook` (terraform-provider-betterado, servicehook migration, PM run 2).

The PM needed to read `azuredevops/framework.go` (the framework provider file listing registered resources) to understand which servicehook resources were already registered there. The file is too large for the `Read` tool to return cleanly. The PM:

1. Called `Read` (seq 19) — result unclear / truncated
2. Called `Task(Bash, "cat framework.go")` (seq 33) — failed or truncated
3. Called `headroom_retrieve` × 3 (cache misses, seqs 36-38)
4. Called `Read` again (seq 39) — same file
5. Called `Task(Bash, "cat framework.go")` (seq 41)
6. Called `headroom_retrieve` (seq 43, cache miss)
7. Called `Task(Bash, 'cat "...framework.go"')` with quoting (seq 48)
8. Called `headroom_retrieve` (seq 50, cache miss)
9. Called `Task(Bash, manifest + framework.go combined)` (seq 51) + `TaskOutput` (seq 53)
10. Hit max-turns. Zero WIs emitted. `result_subtype: error_max_turns`. Cost: $0.89.

At no point did the PM try `Grep` on `framework.go` to extract just the registered resource names — which would have been sufficient.

## Why this matters

The PM needs `framework.go` to know what's already framework-registered (to avoid re-migrating). A single `Grep` for `"betterado_servicehook"` across the file would return the relevant lines in milliseconds without hitting the file-size barrier. Instead the PM burned 10+ tool calls on repeated Read/cat attempts, hit max-turns, and emitted nothing — costing $0.89 and requiring a full re-run.

## The fix point is the PM SKILL or PROMPT

The PM SKILL/PROMPT should include: when `Read` returns truncated/empty for a large file and you need to confirm whether specific resources are registered, use `Grep` on the file for the resource name pattern — do NOT retry `Read` or `cat` on the same large file more than once.

## Generalises to any large generated file

This applies to any project with a large auto-generated registration file (`provider.go`, `framework_provider.go`, registry files). The pattern is: PM needs to confirm one fact (is X registered?), gets stuck on file size, burns turns on retries.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook/events.jsonl` (PM run 2 tool_use seqs 19-53, pm.empty-decomposition event EV_mr2n01qv_ycgvtasp)
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-servicehook.md`
