---
title: demo.json liveEvidence subscription ID must match .forge/live-evidence/ at PR time
description: Terminal unifier re-prep updated only a diffStat line; demo.json retained subscription 886543 while branch held 886548 — ID mismatch caused operator send-back.
category: antipattern
keywords: [demo-json, liveevidence, subscription-id, evidence-mismatch, unifier-reprep, send-back]
related_themes: [live-evidence-demo-index]
created_at: 2026-07-03
updated_at: 2026-07-03
---

# demo.json liveEvidence ID must match .forge/live-evidence/ at PR time

## What happened

The acceptance test ran twice during the notification initiative. The first run created subscription 886543 (capturedAt 2026-07-03T06:37:04Z). A later iteration corrected an issue and ran again, producing subscription 886548. The unifier's terminal re-prep commit `fae83975` updated only a diffStat line in `demo.json`; it did not re-run `forge demo render` against the branch tip. Result: `demo.json` embedded liveEvidence for 886543 while `.forge/live-evidence/acceptance-resource.json` on the branch held 886548.

The operator adversarial re-review at 2026-07-03T12:45:47 caught this as a first-class send-back criterion: "demo.json cites live-evidence subscription 886543 while the branch artifact holds subscription 886548."

## Rule

Before the unifier opens a PR (or produces a re-prep commit), validate that the `liveEvidence.url` embedded in `demo.json` (specifically the subscription/resource ID) matches the ID in `.forge/live-evidence/acceptance-resource.json`. If they differ, re-run `forge demo render` with the branch tip's live-evidence file to regenerate the checkpoint. The unifier must not skip this check even on a "re-prep only" pass.

## Sources

- `_logs/2026-07-01T08-39-27_INIT-2026-07-01-new-api-notification/artifacts/verdict.json`
- `brain/cycles/_raw/2026-07-01T08-39-27_INIT-2026-07-01-new-api-notification.md`
