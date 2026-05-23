---
title: Prompt caching — stable prefix first
description: >-
  Structuring system prompts with stable content first achieved 92% cache hits
  in v1 Cycle 3 (903M reads vs 363K fresh). The single largest cost lever in the
  token budget.
category: pattern
keywords:
  - prompt-caching
  - cache-hit-rate
  - stable-prefix
  - 92-percent
  - cost-reduction
  - cache-control
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes:
  - cost-aware-model-routing
  - claude-agent-sdk
  - conditional-core-values
---

# Prompt caching — stable prefix first

In v1 Cycle 3 (Apr 2–6 2026), forge processed ~978M total tokens with **903M as cache reads** and only 363K as fresh input — a **92% cache hit rate**. Prompt caching is high-leverage (Anthropic docs claim 50–70% input-cost reduction) when the system prompt is placed first and kept stable across invocations.

Discipline:

- **Static content first** (tools, system values, agent persona, brain-query-results context).
- **Dynamic content last** (work item context, file reads, fresh observations).
- Any reordering that puts volatile content before stable content **breaks caching**.

In v2, the Claude Agent SDK exposes explicit `cache_control` breakpoints when the heuristic isn't enough. The Ralph runner's PROMPT.md template + AGENT.md institutional memory pattern naturally produces a stable prefix (the work-item spec) followed by volatile state (fix_plan.md), so default behaviour is already cache-friendly.

Prompt caching and model routing together represent the two largest cost levers — complementary, both should be optimised before any architectural cost changes.

## Sources

- [`v1-themes-cost-and-cache.cycle.md`](../../_raw/v1-wiki/v1-themes-cost-and-cache.cycle.md) — full lesson + Cycle 3 stats.

## See also

- [[cost-aware-model-routing]] — the other major cost lever.
- [[claude-agent-sdk]] — how `cache_control` is exposed.
- [[conditional-core-values]] — keeps the stable prefix compact.
