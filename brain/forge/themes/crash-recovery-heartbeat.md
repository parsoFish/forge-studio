---
title: Crash recovery via worktree heartbeat + atomic claim
description: >-
  Two file-system passes at scheduler startup recover orphaned in-flight
  initiatives. No DB, no journaling, no leader election.
category: pattern
keywords:
  - crash-recovery
  - heartbeat
  - atomic-claim
  - restart
  - orphaned
  - mtime
  - sweep
created_at: 2026-05-04T17:55:00.000Z
updated_at: 2026-05-04T17:55:00.000Z
related_themes:
  - unattended-scheduler
  - file-based-state-machine
---

# Crash recovery via worktree heartbeat + atomic claim

`forge serve` is long-running. It will die — power loss, OOM, manual restart. Recovery is two file-system checks at startup:

1. **Stale-heartbeat sweep.** For each `_queue/in-flight/<id>.heartbeat`, check `mtime`. If older than `staleHeartbeatThreshold` (default 5 min), worktree is presumed orphaned. Move `_queue/in-flight/<id>.md` back to `_queue/pending/`, attempt `git worktree remove --force`, log a `recovery` event.
2. **Missing-worktree sweep.** For each `_queue/in-flight/<id>.md`, parse manifest's `worktree_path`. If worktree no longer exists on disk, treat as above.

Both run on `forge serve` startup before claiming new work. Also on a 5-minute timer. In-flight initiatives write their **current phase + iteration count** to manifest frontmatter on every Ralph iteration — recovery resumes from the same prompt state.

Trade-off: 5-minute window where a stuck initiative looks alive — acceptable for unattended cadence. If user manually moves a manifest while scheduler is running, weird things happen — manifest format documents this.

## Sources

- [`adr-012-crash-recovery.docs.md`](../../_raw/docs/adr-012-crash-recovery.docs.md) — decision record.

## See also

- [[unattended-scheduler]] — what this protects.
- [[file-based-state-machine]] — the underlying protocol.
