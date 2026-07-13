# `_queue/` — Initiative Queue

> File-based state machine for the unattended scheduler. See [ADR 011](../docs/decisions/011-unattended-scheduler.md).

## State machine

```
pending  ──claim──►  in-flight  ──cycle ok──►  ready-for-review  ──user approve──►  done
                         │
                         ╰────cycle err───►  failed (human triage)
```

State transitions are atomic file moves (`mv pending/<id>.md in-flight/<id>.md`). On a single filesystem, `rename` is atomic — that is the entire claim mechanism.

## Subdirectories

| Dir | Contents |
|---|---|
| `pending/` | Initiative manifests waiting to be picked up by the scheduler. The architect emits here. |
| `in-flight/` | Currently being worked. Each manifest is paired with a `<id>.md.heartbeat` file. |
| `ready-for-review/` | Cycle complete; awaiting human review (a notification has fired). |
| `done/` | Approved, merged, retro complete. |
| `failed/` | Cycle failed or wedged; needs human triage. |

The directory contents are **gitignored** — they're runtime state, not source.

## Manifest format

Each initiative is one markdown file: frontmatter (YAML) + body (the initiative spec).

```yaml
---
initiative_id: INIT-2026-04-24-onboarding-v2
project: simplarr
created_at: 2026-04-24T15:30:00Z
iteration_budget: 50         # max Ralph iterations across the whole initiative
cost_budget_usd: 25.00       # initiative-level cap
phase: pending               # updated by orchestrator: pending | project-manager-complete | developer-complete | review-prep-complete
iteration: 0                 # updated by Ralph each iteration
worktree_path:               # set by scheduler on claim
# No features[] block — the initiative body's Given/When/Then ACs plus
# any initiative-level depends_on carry the intent the PM decomposes.
---

# <Initiative title>

<Markdown body — the initiative spec from the architect (LLM-Council-confirmed brief).>
```

## Recovery

On `forge serve` startup, the scheduler runs two sweeps over `in-flight/`:

1. **Stale heartbeat** — heartbeat older than `staleHeartbeatMs` (default 5 min) → manifest moved back to `pending/`.
2. **Missing worktree** — manifest's `worktree_path` no longer exists on disk → manifest moved back to `pending/`.

Both run again on a 5-min timer while the scheduler is up.

## Commands that touch `_queue/`

- The **architect** (via Forge Studio) emits initiative manifests into `pending/`; `POST /api/runs` on the bridge enqueues a run from the UI.
- `forge serve [--once]` — the unattended scheduler: claims, advances, recovers.
- Forge Studio reads `_queue/*` counts and `in-flight/*` for the live view (there is no `forge status` CLI — the UI is the operator surface, [ADR 031](../docs/decisions/031-studio-consolidation.md)).
- The architect and reflector skills, plus the scheduler and the operator verdict gate, move manifests through the state machine as part of their normal operation.

## Hand-edit caveat

If the user manually moves a manifest while the scheduler is running, the recovery sweep may bounce it. **Edit only when `forge serve` is stopped.**
