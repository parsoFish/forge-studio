---
title: Brain-gap feedback loop
description: brain-query logs unanswered questions to brain-gaps.jsonl; brain-ingest fills them at end of cycle. The brain learns from its own failures.
category: pattern
keywords: [brain-gaps, feedback-loop, self-improving, brain-query, brain-ingest, jsonl]
created_at: 2026-05-04T17:55:00Z
updated_at: 2026-05-04T17:55:00Z
related_themes: [brain-first-research, karpathy-three-layer-wiki, jsonl-event-log]
---

# Brain-gap feedback loop

When `brain-query` can't satisfactorily answer a question (no source found, low confidence, only off-topic matches), it logs a **gap** to `_logs/<cycle-id>/brain-gaps.jsonl`. The gap event includes the question, the search performed, and the confidence score.

At end of cycle, `brain-ingest` reads `brain-gaps.jsonl` and either:

- **Fills the gap** by ingesting external sources that answer it (web fetch, doc download, etc.) and creating new theme pages, or
- **Escalates** the gap to the human in the retro when external sources can't address it.

The reflector skill counts brain-gap-rate per cycle. A rising gap rate = brain coverage degrading; a falling rate = brain converging on the project's actual knowledge needs.

This is what makes the brain a self-improving loop rather than a static document store. Every skill invocation that hits a gap is a free signal of where the brain should grow next.

## Sources

- [`adr-010-brain-first.docs.md`](../../_raw/docs/adr-010-brain-first.docs.md) — gap-logging discipline.
- [`adr-008-jsonl-event-log.docs.md`](../../_raw/docs/adr-008-jsonl-event-log.docs.md) — log substrate.

## Related

- [Theme: Brain-first research](./brain-first-research.md) — why gaps are forced into existence.
- [Theme: JSONL event log](./jsonl-event-log.md) — the log family.
- [Theme: Karpathy three-layer wiki](./karpathy-three-layer-wiki.md) — what gets grown.
