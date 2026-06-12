---
title: Dev-loop agents persistently read zero brain pages — PM brain reads do not substitute for dev-loop reads
description: Across multiple cycles, dev-loop (developer-ralph) agents show brainReads:0 while PM agents read 3-5 brain pages. Work items are the only context the dev-loop agents receive; brain knowledge present in the PM phase does not carry forward to the dev-loop phase.
category: antipattern
project: null
created_at: 2026-06-08T12:00:00Z
updated_at: 2026-06-08T12:00:00Z
related_themes:
  - brain-read-policy
  - brain-gap-feedback-loop
---

# Dev-loop zero brain reads — persistent pattern

## Observation

In `INIT-2026-06-08-release-definition-schema-audit`:

```
developer-ralph (WI-1): 0 brain read(s)
developer-ralph (WI-2): 0 brain read(s)
developer-ralph (WI-3): 0 brain read(s)
project-manager:        5 brain read(s)
```

This pattern is consistent across multiple betterado cycles. The PM correctly reads the brain (theme pages, profile) and incorporates findings into work item specs. But dev-loop agents start with isolated context containing only the WI + PROMPT.md — no brain carries forward unless the PM explicitly embeds the relevant knowledge into the WI body.

## Why it matters

Brain knowledge that only reached the PM phase is effectively lost for dev-loop execution. Example from this cycle: the work item WI-3 cited `brain/cycles/themes/quality-gate-cmd-must-assert-new-work.md` and `projects/terraform-provider-betterado/brain/profile.md` in its "Brain themes consulted" section (these are metadata written by PM), but the dev-loop agent never read them — it read only the WI body. For WI-3 the cost was zero (gate-errored immediately), but for implementation WIs the agent may miss project-specific constraints that the PM knew about.

## Root cause

`brain-read-policy` specifies dev-loop MUST NOT read the brain (intent is in work items). This is correct for normal cases — dev-loop agents should execute, not research. The gap is that PM synthesis of brain knowledge into WI bodies is incomplete; the brain themes section in WIs is metadata, not embedded content.

## Fix signal

If a dev-loop agent needs brain knowledge, the PM must embed the relevant excerpt directly into the WI body (not just reference the theme slug). The "Brain themes consulted" section in WI markdown is documentation, not context injection.

## Sources

- `_logs/2026-06-08T11-00-43_INIT-2026-06-08-release-definition-schema-audit/events.jsonl` (ralph.end events: WI-1 `EV_mq53yru1_n283hggn` brainReads:0, WI-2 `EV_mq543302_aze7789n` brainReads:0, WI-3 `EV_mq5433l8_3hzockrq` brainReads:0; PM: 5 brain reads)
- `brain/cycles/_raw/2026-06-08T11-00-43_INIT-2026-06-08-release-definition-schema-audit.md`
