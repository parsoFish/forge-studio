---
source_type: docs
source_url: docs/decisions/010-brain-first.md
source_title: ADR 010 — Brain-first research
ingested_at: 2026-05-04T17:55:00Z
ingested_by: brain-ingest (Pass A, batch 2)
cycle_id: pass-a-bootstrap
---

# ADR 010 — Brain-first research

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

User principle 4: every component must use the brain as its first source of knowledge but must be able to research further when the brain is insufficient. Without enforcement, agents reach for whatever's familiar (web search, training data, ad-hoc reading) and the brain stops being useful — exactly what happened in v1's early cycles before the wiki existed.

## Decision

Every skill mandates `brain-query` as its first action. Every `SKILL.md` includes a "Required first action" section: invoke `brain-query` with a query relevant to the task; record what was found and what was missing.

`brain-query` itself logs **gaps** to `_logs/<cycle-id>/brain-gaps.jsonl` — questions it couldn't answer satisfactorily. `brain-ingest` reads `brain-gaps.jsonl` at the end of every cycle and either fills the gap or escalates it. The reflector includes brain-gap counts in cycle retros.

If a skill needs broader research (web, external docs, project-specific files outside the brain), it does so **after** brain-query and **logs the gap**. The brain's value compounds via this loop.

## Consequences

- The brain stays current — continuously stress-tested by every skill invocation.
- Gaps surface automatically.
- New users (and new skills) inherit accumulated knowledge by default.
- Trade-off: every skill pays a small upfront cost (one brain query). Mitigated by `brain-query` using a fast model (Haiku by default). Skills could lie about having queried — mitigated by event-log enforcement.

## Alternatives considered

- Optional brain consultation — observed in v1 to drift to "never queried."
- Brain queries as a hook injected by the runner — couples the runner to the brain too tightly.

## References

- v1's `.forge/wiki/` — proved the wiki concept; this ADR makes consultation mandatory
- Karpathy LLM-wiki gist — the philosophy
