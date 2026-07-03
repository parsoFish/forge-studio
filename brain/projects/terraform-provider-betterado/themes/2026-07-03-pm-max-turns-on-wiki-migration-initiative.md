---
title: PM max-turns failure on wiki framework-migration initiative
description: First PM run for the wiki migration hit error_max_turns before writing any WI files; required operator re-queue; second run succeeded in 3.8 min by writing sooner.
category: antipattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

## What happened

PM first invocation (2026-07-01T22:14) spent all turns reading `provider.go`, `framework_provider.go`, `provider_test.go`, `resource_wiki_page.go`, and headroom-retrieval calls trying to build context — but exhausted the turn budget before calling `Write` on any WI file. Emitted `pm.empty-decomposition` with `result_subtype: error_max_turns`. Orchestrator classified failure as `terminal`. Operator re-queued.

Second invocation (2026-07-03T04:41) read the manifest, read the acceptance test file, glanced at `provider.go`, then wrote WI-1 through WI-4 in sequence. Completed in 3.8 min, 5 brainReads, cost $0.85.

## Pattern

PM used ~31 coalesced tool calls before writing a single WI. Complex multi-resource framework-migration initiatives trigger deep exploration loops when the PM tries to understand the full surface before decomposing.

## Fix direction

- Prompt/budget: PM should write WIs incrementally as it discovers scope, not after full exploration.
- Alternatively: lower per-invocation turn budget forces earlier output commitment.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-wiki/events.jsonl` — events EV_mr2mxviv_z048wsgz (error_max_turns), EV_mr2mxviw_ncmwjg9i (PM end cost $0.88, brainReads 6, writes 0)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-wiki.md`
