---
title: Wiki API-shape bugs re-derived from scratch with brainReads=0 across all WIs
description: All 8 dev-loop WI sessions for the wiki migration had brainReads=0; three API-shape bugs known from prior work were re-derived from runtime error messages, costing ~4 extra iterations.
category: antipattern
keywords: [brainreads-zero, wiki-api, versiondescriptor, etag, project-cap, re-derived, zero-brain-reads]
related_themes: [ralph-brain-reads-index, ado-api-shapes-index]
created_at: 2026-07-03
updated_at: 2026-07-03
---

## What happened

Dev-loop (developer-ralph) for every WI in this cycle had `brainReads: 0` in the end-event metadata:

| WI | Run | brainReads | iterations |
|----|-----|-----------|------------|
| WI-1 | 1 | 0 | 1 |
| WI-2 | 1 | 0 | 2 |
| WI-3 | 1 | 0 | 2 |
| WI-4 | 1 | 0 | 4 |
| WI-1 | 2 | 0 | 1 |
| WI-2 | 2 | 0 | 1 |
| WI-3 | 2 | 0 | 1 |
| WI-4 | 2 | 0 | 1 |

Three bugs were re-derived from live ADO API errors (not from profile.md or brain):

1. **1000-project cap** — Hit in WI-2 (iter 0) and WI-3 (iter 1). `profile.md` section "Gotchas (C9)" and theme `2026-06-20-ado-org-project-limit-blocks-test-creates.md` document the fix: reuse `SharedFixtureProjectName`. ~40 log lines reference the error.
2. **`versionDescriptor` nil / `versionType: "branch"` required** — Wiki page Create fails without an explicit version descriptor. Re-derived in WI-4 iter 1 from the error string "The versionType should be 'branch' and version cannot not be null".
3. **`etag` inconsistency on refresh** — Provider produced inconsistent result after apply because `etag` changed between Create and the subsequent Read. Re-derived in WI-4 iter 2. Fix: suppress etag from plan.

Total extra iterations attributable: at least 4 (WI-2 iter 1, WI-3 iter 1, WI-4 iters 1-2).

## Why it recurs

The dev-loop only receives the WI file as context. Brain content read by the PM does not carry forward. This is the 7th documented cycle where `brainReads=0` in dev-loop sessions for this project (see theme `2026-07-01-ralph-zero-brain-reads-framework-migration-gotchas`).

## Fix direction

Work items for framework-migration resources should embed the relevant checklist items (profile.md §"Framework migration") inline in the WI body, or the dev-loop AGENT.md should include a mandatory link to `profile.md`.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-wiki/events.jsonl` — WI-end events showing brainReads=0, gate.fail events for WI-2 (EV_mr4ntw61), WI-3 (EV_mr4o9hcj), WI-4 (EV_mr4opvl3, EV_mr4owcni, EV_mr4p7o9a)
- `/home/parso/forge/brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-migrate-framework-wiki.md`
