---
title: Brain-first research
description: Every skill mandates brain-query as its first action. Broader research only when the brain is insufficient — and the gap is logged.
category: pattern
keywords: [brain-query, brain-first, gaps, research, skill-discipline, self-improving]
created_at: 2026-05-04T17:55:00Z
updated_at: 2026-05-04T17:55:00Z
related_themes: [karpathy-three-layer-wiki, brain-gap-feedback-loop, skills-as-agent-surface]
---

# Brain-first research

User principle 4: every component must use the brain as its first source of knowledge but must be able to research further when the brain is insufficient. Without enforcement, agents reach for whatever's familiar (web search, training data) and the brain stops being useful — exactly what happened in v1's early cycles before the wiki existed.

Implementation:

- Every `SKILL.md` includes a "Required first action" section: invoke `brain-query` with a query relevant to the task; record what was found and what was missing.
- `brain-query` itself logs **gaps** to `_logs/<cycle-id>/brain-gaps.jsonl` — questions it couldn't answer satisfactorily.
- `brain-ingest` reads `brain-gaps.jsonl` at the end of every cycle and either fills the gap or escalates it.
- The reflector includes brain-gap counts in cycle retros.

Skills could lie about having queried the brain. Mitigated by event-log enforcement — the orchestrator can reject skill outputs that don't have a corresponding `brain-query` event.

## Sources

- [`adr-010-brain-first.docs.md`](../../_raw/docs/adr-010-brain-first.docs.md) — decision record.
- [`forge-v2-principles.docs.md`](../../_raw/docs/forge-v2-principles.docs.md) — principle 4.

## Related

- [Theme: Karpathy three-layer wiki](./karpathy-three-layer-wiki.md) — the wiki being queried.
- [Theme: Brain-gap feedback loop](./brain-gap-feedback-loop.md) — how gaps surface and get filled.
- [Theme: Skills as agent surface](./skills-as-agent-surface.md) — every one of these mandates brain-query.
