---
title: unifier demo.json gate reports "missing" when file exists in git HEAD
description: The pr_self_contained sub-check emits "demo.json missing" across all 15 unifier iterations despite demo.json being committed to HEAD; unifier cannot distinguish path error from schema/content error, so it loops until budget exhausted.
category: antipattern
created_at: 2026-07-09T22:03:49.533Z
updated_at: 2026-07-09T22:03:49.533Z
---

## What happened

Cycle `2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover`. Unifier ran 15 iterations (budget: 14, stop_reason: `iteration-budget`). The terminal blocker on every iteration:

```
unifier.gate.sub-check  check_id=pr_self_contained  pass=false
detail="demo.json errors: demo.json missing"
```

The unifier agent confirmed `demo/INIT-2026-07-01-mux-free-cutover/demo.json` was present in the filesystem and in `git show HEAD:demo/INIT-2026-07-01-mux-free-cutover/demo.json`. The file was committed (evidenced by unifier reading checkpoint counts from it). Yet the orchestrator-side gate sub-check returned `demo.json missing` every time.

## Root cause hypothesis

The gate sub-check likely validates schema/content (required fields, expected structure) beyond mere path existence. When content validation fails, the error message is always `"demo.json missing"` — a misleading generic. The unifier interprets this as a path problem, re-commits the file, and retries. It cannot distinguish:
- File not on branch (path problem)
- File present but schema-invalid (content problem)

## Impact

15 iterations × ~$1 = **$15.34 unifier cost**. PR creation blocked. Operator merged manually.

## Fix

The gate sub-check should emit the actual validation failure reason, not `"demo.json missing"` for all failure modes. E.g.: `"demo.json schema error: missing required field 'acEvaluations'"`. This would let the unifier (or operator) diagnose and fix the correct problem rather than looping on path re-commits.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover/events.jsonl` — lines 1399, 1998: `unifier.gate.sub-check` `pass=false` `"demo.json missing"`; line 2001: `unifier.failed` `iteration-budget`
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-mux-free-cutover.md`
