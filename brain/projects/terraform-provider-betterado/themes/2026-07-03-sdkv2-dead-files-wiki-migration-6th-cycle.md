---
title: SDKv2 dead files not deleted — wiki migration (6th documented cycle)
description: The wiki migration PR did not delete the superseded SDKv2 resource/data-source files despite profile.md checklist 3b; this is the 6th cycle where this omission has recurred.
category: antipattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

## What happened

The delivered diff (61 files changed, 1987 insertions, 841 deletions) includes additions for `resource_wiki_framework.go`, `resource_wiki_page_framework.go`, and related test updates. No deletion events for the original SDKv2 resource files were observed in the event log.

Profile.md checklist item 3b: **"Dedup = deregister AND delete"** — the SDKv2 `.go` files, data-source `.go` files, `_test.go` files, and now-unused shared helpers must be DELETED in the same WI, not left orphaned.

Prior documented occurrences:
- 2026-07-03 theme `2026-07-03-build-package-sdkv2-dead-files-not-deleted` (general)
- 2026-07-03 theme `2026-07-03-sdkv2-dead-files-omission-4th-cycle`
- 2026-07-03 theme `2026-07-03-sdkv2-dead-files-5th-cycle-dashboard-extension`

This is the 6th known occurrence. The WI bodies must explicitly name the files to delete; "deregister from provider.go" alone is not sufficient.

## Fix direction

PM should include an explicit `files_to_delete` list in each migration WI — listing the SDKv2 file, data-source file, and their `_test.go` counterparts. The gate command should include a negative assertion (e.g., `! grep -r 'ResourceWiki\b' azuredevops/provider.go`) in addition to the positive acceptance test.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-wiki/events.jsonl` — dev-loop.delivered events (no deletions of SDKv2 wiki files observed)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-wiki.md`
