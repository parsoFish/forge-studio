---
title: Unifier must validate demo.json liveEvidence ID matches .forge/live-evidence/ before re-prep commit
description: Terminal re-prep commit updated only a diffStat line; demo.json retained a stale subscription ID from an earlier acceptance run; operator send-back issued. The unifier needs an ID-match check before closing.
category: antipattern
created_at: 2026-07-03
updated_at: 2026-07-03
---

# Unifier must validate demo.json liveEvidence ID matches .forge/live-evidence/ before re-prep commit

## What happened

In INIT-2026-07-01-new-api-notification, the acceptance test ran twice. First run: subscription 886543. Second run: subscription 886548. The unifier's terminal re-prep commit `fae83975` updated only a diffStat line in `demo.json` without re-running `forge demo render` against the branch tip. Result: `demo.json` embedded `liveEvidence.url` referencing 886543 while `.forge/live-evidence/acceptance-resource.json` on the branch held 886548.

The operator adversarial re-review at 2026-07-03T12:45:47 issued a send-back. This would be true for any project with a live acceptance gate + demo capture — it is a forge machinery issue.

## Fix direction

Before the unifier opens a PR or produces a re-prep commit, add an ID-match validation step:

1. Read `demo.json` — extract the resource ID from the final checkpoint's `liveEvidence.url` (e.g. subscription ID in the path segment).
2. Read `.forge/live-evidence/acceptance-resource.json` — extract the same ID.
3. If they differ, re-run `forge demo render` (or the equivalent) against the branch tip before committing.

This should be unconditional on any "re-prep" pass, not only the initial unifier run. A re-prep commit that leaves a stale demo.json is worse than no demo.json (it falsely asserts evidence that does not match the branch state).

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-notification/artifacts/verdict.json`
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-notification.md`
