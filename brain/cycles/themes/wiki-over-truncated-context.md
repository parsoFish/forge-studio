---
title: Wiki over truncated learning-context
description: >-
  Forge v1 truncated cross-cycle learnings to 2000 chars per cycle, producing
  episodic-not-cumulative memory. The Karpathy three-layer wiki is the
  architectural fix — and the load-bearing argument for v2's brain.
category: pattern
keywords:
  - wiki
  - truncated-context
  - episodic
  - cumulative
  - karpathy
  - brain
  - motivation
created_at: 2026-05-04T19:30:00.000Z
updated_at: 2026-05-04T19:30:00.000Z
related_themes:
  - karpathy-three-layer-wiki
  - brain-read-policy
  - brain-gap-feedback-loop
  - episodic-not-cumulative-learnings
---

# Wiki over truncated learning-context

Before v1 had a wiki, learning context was injected into each cycle as a truncated 2000-char excerpt of the latest learning file. This meant:

1. Most of the insight was lost.
2. The same files were re-read each cycle without accumulating cross-cycle context.
3. Each architect agent started from near-scratch every cycle.

The wiki inverts this: generate raw insights freely (no size pressure), build lightweight theme pages that index the raw layer, and search cheaply at agent invocation time. Agents navigate index → theme page → raw file, loading only the context relevant to their current task.

This is **Karpathy's LLM-wiki model** applied to forge: *"minimal summarisation, maximal indexation."* Many small focused pages beat few large summaries. The raw layer is immutable ground truth; theme pages are navigational aids, not summaries.

This theme is the **load-bearing argument for v2's brain** — the brain isn't a "nice-to-have." It's the architectural fix for the failure mode v1 directly observed: same insight regenerated 5 times in a single day because cross-cycle context didn't survive truncation.

## Sources

- [`v1-themes-failure-modes.cycle.md`](../../_raw/v1-wiki/v1-themes-failure-modes.cycle.md) — episodic-not-cumulative section.
- [`karpathy-llm-wiki.md`](../../_raw/web/karpathy-llm-wiki.md) — the canonical gist ([gist.github.com/karpathy/442a6bf555914893e9891c11519de94f](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)).

## See also

- [[karpathy-three-layer-wiki]] — what the structural fix is.
- [[brain-read-policy]] — what enforces use of the wiki.
- [[brain-gap-feedback-loop]] — what prevents the wiki from going stale.
- [[episodic-not-cumulative-learnings]] — antipattern this fixes.
