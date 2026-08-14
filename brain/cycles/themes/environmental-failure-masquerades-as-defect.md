---
title: An environmental failure masquerades as a code defect — check the host before you chase the beat
description: Browser-journey / e2e failures that look exactly like code defects (a page's checks all failing together, "Target crashed") are often the host running out of memory, not the code. Run free -h before any ui:journey / ui:deadpaths pass; a foreign process on a shared box can OOM your run and cost a 45-minute blind re-run to diagnose what free -h shows in 3 seconds.
category: operation
keywords:
  - environmental-failure
  - false-defect
  - oom
  - target-crashed
  - ui-journey
  - deadpaths
  - free-h-preflight
  - shared-host
created_at: 2026-08-14
updated_at: 2026-08-14
related_themes:
  - suppression-env-fakes-the-pass
---

# An environmental failure masquerades as a code defect

Batch F, R6-07's recovery. A ui:journey run ended with `fails=3, terr=1` deep in the run order and then wedged. The obvious read — and the prior lane's optimistic self-report — was "3 journey beats are broken; diagnose and fix the code." Both were wrong.

**The failures clustered on the *last* journey to run and then the run wedged** — a whole trailing segment failing together at the tail of the run order, not scattered across unrelated beats. That clustering-at-the-tail-then-wedge is the tell: a healthy code defect fails one specific beat and the run continues; a crashing host takes out whatever was rendering when memory ran out. Reproduced in **3 minutes** with `ui:deadpaths` — it died with `page.evaluate: Target crashed`, the trailing routes failing the identical way — not 45 minutes of blind journey re-runs. (Do not over-read the exact failing checks: the *specific* beats that fail depend on what was mid-render at the OOM moment, so confirm the crash with `deadpaths` + `Target crashed`, don't infer it from which checks happened to be red.)

Cause: a **foreign** idle session had leaked a `tokensave serve` MCP child sitting at **10.3 GB RSS on a 13 GB box** — ~580 MiB available, load ~9. The kernel OOM-killer reaped Chromium mid-run. Same commit, memory recovered → `ui:deadpaths` 465/0, the "broken" page 109/109. Nothing was ever wrong with the code; the two-reopen-stop rightly never fired and no beat was re-scoped.

## The rule

- **Run `free -h` before any `ui:journey` / `ui:deadpaths` pass.** If available memory is low, stop and reclaim it first.
- A trailing cluster of browser-check failures that ends in a wedged run — the tail of the run order failing together — is a **crashed host**, not N independent beat defects. Confirm with the cheap tool (`deadpaths`, `Target crashed` in the log) before touching code; do not infer the cause from *which* checks are red (that depends on what was mid-render when memory ran out).
- On a shared host, the memory hog may not be yours. Identify it (`ps aux --sort=-rss | head`), and if it is a foreign leaked process, surface it — do not silently kill another session's work.
- Do not let an environmental false-defect trigger a real code change (a re-scoped beat, a "robustness" workaround). That bakes a phantom fix around a healthy path — the inverse of [[suppression-env-fakes-the-pass]].
