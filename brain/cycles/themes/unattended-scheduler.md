---
title: Unattended scheduler with file-based queue + worktree pool
description: >-
  ~150-line forge serve loop. _queue/ directories + atomic mv for claim +
  bounded git worktrees. The filesystem IS the protocol.
category: pattern
keywords:
  - scheduler
  - forge-serve
  - queue
  - worktree
  - atomic-claim
  - unattended
  - filesystem-protocol
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - file-based-state-machine
  - crash-recovery-heartbeat
  - gh-cli-and-worktrees
  - pluggable-notifications
---

# Unattended scheduler with file-based queue + worktree pool

Forge's load-bearing requirement is **unattended operation between human interaction points** — claim initiatives, drive each through PM → Developer Loop → Review-Prep, surface completed initiatives without prompting the user, for arbitrary durations.

`forge serve` is the persistent process. ~150 lines. Components:

- **`_queue/` state machine** — `pending/`, `in-flight/`, `ready-for-review/`, `done/`, `failed/`. Each subdir holds initiative manifests (markdown + frontmatter). Transitions are atomic file moves.
- **Bounded worktree pool** — up to `scheduler.maxConcurrentInitiatives` (default 2) `git worktree add` instances at any time.
- **Atomic claim** — `mv pending/<id>.md in-flight/<id>.md` on a single filesystem is atomic. That is the entire claim mechanism.
- **Heartbeat** — each in-flight initiative writes `<id>.heartbeat` every 30s.
- **Per-initiative iteration cap** — `iteration_budget` in manifest frontmatter bounds runaway loops. (The prior `cost_budget_usd` was removed by CONTRACTS.md C19 on 2026-05-23.)

CLI surface: `forge serve`, `forge serve --once`, `forge enqueue`, `forge status`. Total scheduler code ≈ 300 LOC vs v1's ~6,000 LOC equivalent.

## Sources

- [`adr-011-unattended-scheduler.docs.md`](../../_raw/docs/adr-011-unattended-scheduler.docs.md) — decision record.

## See also

- [[file-based-state-machine]] — the queue mechanism.
- [[crash-recovery-heartbeat]] — what makes it survive restarts.
- [[gh-cli-and-worktrees]] — what worktrees come from.
- [[pluggable-notifications]] — pluggable notifications on review-ready.
