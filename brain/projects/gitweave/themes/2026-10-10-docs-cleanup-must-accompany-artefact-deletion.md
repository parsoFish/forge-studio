---
title: Docs cleanup must accompany artefact deletion in same initiative
description: docs/demo-guide.md was not in any initial WI scope; caught by adversarial review in rounds 1 and 2 (two consecutive send-backs), requiring WI-8 to fully fix.
category: antipattern
keywords: [docs, demo-guide, metrics, deletion, scope, send-back, adversarial-review, gitweave, i1, cleanup]
created_at: 2026-10-10T08:47:25Z
updated_at: 2026-10-10T08:47:25Z
related_themes: [2026-10-10-failing-test-audit-must-be-exhaustive, 2026-10-10-verbatim-legal-text-needs-url-anchor]
---

# Docs cleanup must accompany artefact deletion in same initiative

## What happened

I1 deleted the metrics service (`metrics/` directory, docker-compose, workflows). The WI-1 spec explicitly excluded docs files. But `docs/demo-guide.md` contained a full "Webhook Smoke Test" walkthrough section referencing the metrics service (uvicorn commands, `cd metrics`, curl to `:8000/webhook`, a bootstrap summary table row for "✅ metrics exists").

Adversarial review round 1 (C-5) flagged: "docs/demo-guide.md, README.md and .github/copilot-context.md reference removed paths." WI-7 was supposed to fix this but only did a partial job — round 2 (C-6) re-flagged docs/demo-guide.md with the specific section still present at head 1d228b1. WI-8 (3 files, +127, -197) finally completed the fix.

The same pattern applies: `.github/copilot-context.md` also needed cleanup and was caught in the same sweep.

## Why it matters

When large directories are deleted, every document that describes or walks through those directories becomes a broken reference. Docs cleanup is not a separate initiative — it is part of the deletion work. Leaving it out guarantees adversarial-review send-backs.

## Fix for gitweave

Any initiative that deletes a named service, module, or workflow MUST include a WI for:
```bash
grep -rn "<service-name>" docs/ .github/copilot-context.md README.md | grep -v ".pyc"
```
Remove or update every match. The WI gate can be a test asserting `grep -rn "metrics" docs/` returns nothing.

## See also

- [[2026-10-10-failing-test-audit-must-be-exhaustive]] — companion scope gap (test files not audited)
- [[2026-10-10-verbatim-legal-text-needs-url-anchor]] — third send-back root cause

## Sources

- `_logs/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline/events.jsonl` (review-comments C-5 at 07:23, C-6 at 08:02; WI-8 dev-loop.delivered)
- `_logs/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline/review-comments.json`
- `brain/cycles/_raw/2026-10-10T01-55-59_INIT-2026-10-10-i1-honest-baseline.md`
