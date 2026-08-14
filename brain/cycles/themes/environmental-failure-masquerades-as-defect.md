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

**The failing checks were the *last three routes*, all failing together, including a trivial `renders [data-page=...]` check.** All-of-a-page's-checks-failing-at-once, including the trivial render, is a **dead-page signature** — the page never rendered, so nothing is a code defect. Reproduced in **3 minutes** with `ui:deadpaths` (died with `page.evaluate: Target crashed`, last routes failing the identical check), not 45 minutes of blind journey re-runs.

Cause: a **foreign** idle session had leaked a `tokensave serve` MCP child sitting at **10.3 GB RSS on a 13 GB box** — ~580 MiB available, load ~9. The kernel OOM-killer reaped Chromium mid-run. Same commit, memory recovered → `ui:deadpaths` 465/0, the "broken" page 109/109. Nothing was ever wrong with the code; the two-reopen-stop rightly never fired and no beat was re-scoped.

## The rule

- **Run `free -h` before any `ui:journey` / `ui:deadpaths` pass.** If available memory is low, stop and reclaim it first.
- A browser page whose checks **all** fail together — especially the trivial render check — is a **crashed/dead page**, not N independent beat defects. Confirm with the cheap tool (`deadpaths`, `Target crashed` in the log) before touching code.
- On a shared host, the memory hog may not be yours. Identify it (`ps aux --sort=-rss | head`), and if it is a foreign leaked process, surface it — do not silently kill another session's work.
- Do not let an environmental false-defect trigger a real code change (a re-scoped beat, a "robustness" workaround). That bakes a phantom fix around a healthy path — the inverse of [[suppression-env-fakes-the-pass]].
