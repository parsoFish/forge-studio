---
title: report.md diff inverts delivery on resume
description: On a resume-from-failed cycle, report.md's diff section shows the added files as deleted because the diff snapshot is captured before the unifier's final commit — dev-loop.delivered is authoritative.
category: antipattern
keywords: [report-diff, resume, stale-diff, dev-loop-delivered, unifier-commit, cycle-recovery]
related_themes: [cycle-recovery-index]
created_at: '2026-06-06T09:41:00Z'
updated_at: '2026-07-10T09:46:00Z'
---

## Antipattern

On a resume-from-failed cycle, `report.md` may contain a unified diff that inverts the actual delivery direction. In INIT-2026-06-06-shared-acceptance-fixture:

- `report.md` diff showed `shared_fixtures.go` as a **deleted** file (−484 lines)
- `dev-loop.delivered` event recorded **+1141 insertions** across 6 files

Root cause: the report renderer captures `git diff` from a stale worktree state — the unifier had already committed and pushed the new files, but the diff snapshot in `report.md` was taken before that commit landed.

## Rule

**`dev-loop.delivered` is the authoritative delivery signal.** If `report.md` diff contradicts `dev-loop.delivered`, the diff is wrong. Never conclude "nothing delivered" or "files deleted" from a `report.md` diff alone — always cross-check with the `dev-loop.delivered` event and `git diff main...HEAD`.

Also applies: per-WI `status: failed` can be stale on resume. If `dev-loop.delivered.files_changed > 0`, work landed regardless of status metadata.

## Sources

- `_logs/2026-06-06T09-32-34_INIT-2026-06-06-shared-acceptance-fixture/events.jsonl` (EV_mq25q8m9_10kf7p0v: `dev-loop.delivered`, 6 files, 1141 ins)
- `/home/parso/forge/brain/cycles/_raw/2026-06-06T09-32-34_INIT-2026-06-06-shared-acceptance-fixture.md`
