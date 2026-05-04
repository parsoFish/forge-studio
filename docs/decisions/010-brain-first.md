# ADR 010 — Brain-first research

**Status:** Accepted (scaffold)
**Date:** 2026-04-24

## Context

User principle 4: every component must use the brain as its first source of knowledge but must be able to research further when the brain is insufficient. Without enforcement, agents will reach for whatever's familiar (web search, training data, ad-hoc reading) and the brain stops being useful — exactly what happened in v1's early cycles before the wiki existed.

## Decision

**Every skill mandates `brain-query` as its first action.**

Implementation:
- Every `SKILL.md` includes a "Required first action" section that says: invoke `brain-query` with a query relevant to the task; record what was found and what was missing.
- `brain-query` itself logs **gaps** to `_logs/<cycle-id>/brain-gaps.jsonl` — questions it couldn't answer satisfactorily.
- `brain-ingest` reads `brain-gaps.jsonl` at the end of every cycle and either fills the gap or escalates it to the human.
- The reflector skill includes brain-gap counts in cycle retros.

If a skill needs broader research (web, external docs, project-specific files outside the brain), it does so **after** brain-query and **logs the gap**. The brain's value compounds via this loop: every gap becomes a future answer.

## Consequences

**Positive:**
- The brain stays current — it's continuously stress-tested by every skill invocation.
- Gaps surface automatically.
- New users (and new skills) inherit the project's accumulated knowledge by default.

**Negative / accepted trade-offs:**
- Every skill pays a small upfront cost (one brain query). Mitigated by `brain-query` using a fast model (Haiku by default).
- Skills could lie about having queried the brain. Mitigated by event-log enforcement — the orchestrator can reject skill outputs that don't have a corresponding `brain-query` event.

## Alternatives considered

- **Optional brain consultation** — observed in v1 to drift to "never queried." Rejected.
- **Brain queries as a hook injected by the runner** — couples the runner to the brain too tightly; better to keep it in the skill where it's visible.

## References

- v1's `.forge/wiki/` — proved the wiki concept; this ADR makes consultation mandatory
- [Karpathy LLM-wiki gist](https://gist.github.com/karpathy/) — the philosophy
