---
title: dev-loop.delivered fires for failed dev-loop runs — misleading event name
description: The dev-loop.delivered event (and branch-pushed) is emitted even when the dev-loop completed with 0/N WIs — honest payload (files_changed=0) but the event name implies success, creating ambiguity in log analysis.
category: antipattern
created_at: 2026-07-11
updated_at: 2026-07-11
---

## What happens

After each dev-loop run — whether successful or not — the orchestrator emits:

```json
{"event_type": "dev-loop.delivered", "metadata": {"files_changed": 0, "insertions": 0, "deletions": 0}}
```

In INIT-2026-07-10-framework-auth-parity, Cycles 1–2 both emitted `dev-loop.delivered` with `files_changed: 0` (gate-too-loose; no code written). The same event fired in Cycle 3 with `files_changed: 20` (the real delivery).

## Why it matters

- **Log analysis:** Grepping for `dev-loop.delivered` returns results for both success and failure runs. A reader scanning for "what landed" must check `metadata.files_changed` or cross-reference `metadata.status`.
- **Reflector guidance (cascade-v4 #1):** The directive "delivery truth = `dev-loop.delivered` event" is correct but assumes only successful runs emit it. If failed runs also emit it, the reflector must additionally check `files_changed > 0` to conclude real delivery occurred.
- **"branch-pushed" is equally ambiguous** — it fires for a branch with 0 commits.

## Observed in

- INIT-2026-07-10-framework-auth-parity, Cycles 1 and 2: `dev-loop.delivered` emitted 2× with `files_changed: 0` before the real delivery event in Cycle 3.

## Fix candidates

1. Gate the event on `files_changed > 0` — suppress it entirely for zero-delivery runs.
2. Rename the event to `dev-loop.run-closed` with a `status` field (`complete|failed`) and reserve `dev-loop.delivered` for `files_changed > 0` only.
3. Add a `delivery_status: failed|delivered` field to the existing event payload (lowest-cost change).

Option 2 is most semantically clear. Operator flagged this as a known issue post-merge.

## Sources

- `_logs/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity/events.jsonl` — Cycle 1 and 2 `dev-loop.delivered` events with `files_changed: 0`
- `brain/cycles/_raw/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity.md`
