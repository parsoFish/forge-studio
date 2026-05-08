---
title: Episodic-not-cumulative learnings antipattern
description: 5 identical learnings files generated in a single day for the same observation, because cross-cycle context was truncated. The wiki is the architectural fix; deduplication-at-write is a tactical patch.
category: antipattern
keywords: [episodic, cumulative, duplicate-learnings, institutional-memory, truncation, 2000-char]
created_at: 2026-05-04T19:30:00Z
updated_at: 2026-05-04T19:30:00Z
related_themes: [wiki-over-truncated-context, karpathy-three-layer-wiki, brain-gap-feedback-loop]
---

# Episodic-not-cumulative learnings antipattern

On 2026-04-03 in v1, **5 identical** `merge-order-GitWeave.md` files were generated in a single day. Each agent session independently rediscovered the same insight and wrote a new timestamped file. The learning system was *episodic* — a snapshot of that run — not *cumulative* — an accumulation across runs.

Root symptom: cycle-to-cycle context was truncated to 2000 characters, so prior learnings weren't available when new ones were generated. Without cross-cycle context, the same insights got regenerated every cycle.

Two layers of fix:

- **Tactical** — deduplicate at write time (check for same-day prefix before creating new file). A patch on the symptom.
- **Strategic** — the wiki. Raw logs accumulate freely; theme pages index the durable insights once; agents search rather than regenerate. This is the architectural fix and the load-bearing argument for v2's brain layer.

In v2, the brain-first principle (every skill mandates `brain-query` first) makes this discipline structural: an agent that's about to "discover" a known insight will hit the brain first and find the existing theme page.

## Sources

- [`v1-themes-failure-modes.cycle.md`](../../_raw/v1-wiki/v1-themes-failure-modes.cycle.md) — episodic-not-cumulative section + duplicate-learnings example.

## Related

- [Theme: Wiki over truncated context](./wiki-over-truncated-context.md) — the strategic fix.
- [Theme: Karpathy three-layer wiki](./karpathy-three-layer-wiki.md) — the underlying structure.
- [Theme: Brain-gap feedback loop](./brain-gap-feedback-loop.md) — what keeps the brain accumulating instead of regenerating.
