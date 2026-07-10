---
title: forge requeue has no PR-state guard
description: forge requeue spawns a new cycle even when the initiative's PR is already merged — generating a spurious second run after merge.
category: antipattern
created_at: 2026-06-07
updated_at: 2026-06-07
---

# forge requeue has no PR-state guard

## Pattern

`forge requeue` re-enqueues an initiative manifest without checking whether the initiative's PR is already merged on the remote. In this cycle, PR #14 merged at 2026-06-07T03:41:03Z; a requeue then spawned a second full cycle (`reflector.start` at 03:29:11 from the first run, second at 2026-06-23T21:46:01 and 2026-07-10T09:48:26) against work that was already done.

## Consequence

- Wasted compute + operator confusion: the spurious cycle's context (WIs already-complete, deliver diff $0) is misleading.
- The second reflector sees `status: pr-open` (stale) and tries to reflect on work that has already landed.
- Three `reflector.start` events in the same cycle's event log from separate invocations.

## Fix direction

`forge requeue` should check the PR state on the remote (via `gh pr view`) before re-enqueuing. If status is `MERGED`, refuse with a clear error. If status is `CLOSED`, warn and require `--force`. Only `OPEN` or no-PR state should allow silent re-queue.

## Confirmed instance

- betterado `INIT-2026-06-07-release-folder-data-source`: PR #14 merged; operator-reported spurious second cycle. Three `reflector.start` events in `events.jsonl` from three separate reflector invocations.

## Sources

- `_logs/2026-06-07T03-20-11_INIT-2026-06-07-release-folder-data-source/events.jsonl`
- `/home/parso/forge/brain/cycles/_raw/2026-06-07T03-20-11_INIT-2026-06-07-release-folder-data-source.md`
- `_logs/2026-06-07T03-20-11_INIT-2026-06-07-release-folder-data-source/user-feedback.md`
