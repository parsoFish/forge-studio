---
title: Ralph agent crash (exit code 1) with committed delivery — status vs diff truth
description: WI-6 ralph crashed (exit code 1) mid-iteration but its git commits had already landed; dev-loop.delivered captured the work; per-WI status:failed was stale — the diff was authoritative.
category: pattern
created_at: 2026-06-20
updated_at: 2026-06-20
---

# Ralph agent crash with committed delivery — status vs diff truth

## What happened

Cycle INIT-2026-06-19-framework-release-definition, WI-6. Ralph finished committing UseStateForUnknown changes and was about to log completion when Claude Code process exited with code 1 (OOM or internal error). Event log:

```json
{"message":"ralph.end","metadata":{"status":"failed","iterations":0,"stop_reason":"crashed","runner_error":{"kind":"agent_threw","message":"Claude Code process exited with code 1"}}}
```

Immediately after:
```json
{"message":"dev-loop.delivered","metadata":{"work_item_id":"WI-6","files_changed":10,"insertions":976,"deletions":440,"commits":3}}
```

`dev-loop.delivered` fires on the git diff-stat against base — it sees what actually landed in the branch, regardless of agent status. WI-6 status = `failed` was stale; 10 files and 3 commits had already shipped.

## The authoritative rule

`dev-loop.delivered.files_changed > 0` wins over `status: failed`. If status and diff disagree, the diff is reality. The antipattern is concluding "nothing delivered" from per-WI status counts alone when dev-loop.delivered shows otherwise.

## Operational implication

Agents that crash after git commit complete their task; the crash is a process issue, not a delivery issue. The cycle continuation logic (boundary event → unifier) correctly handled this. Reflectors MUST cross-check `dev-loop.delivered` before any "WI failed" narrative.

## Sources

- `_logs/2026-06-19T23-10-22_INIT-2026-06-19-framework-release-definition/events.jsonl` line 3588 (`ralph.end`, status=failed), line 3589 (`dev-loop.delivered`, files_changed=10)
- `/home/parso/forge/brain/cycles/_raw/2026-06-19T23-10-22_INIT-2026-06-19-framework-release-definition.md`
