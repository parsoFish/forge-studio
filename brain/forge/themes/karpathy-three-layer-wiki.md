---
title: Karpathy three-layer LLM wiki
description: Brain layout — immutable raw → 15-40-line theme pages → category indexes. Many small pages > few large summaries.
category: pattern
keywords: [karpathy, llm-wiki, three-layer, theme-pages, raw, indexes, obsidian]
created_at: 2026-05-04T17:55:00Z
updated_at: 2026-05-04T17:55:00Z
related_themes: [brain-first-research, theme-page-format, brain-gap-feedback-loop]
---

# Karpathy three-layer LLM wiki

The brain is a Karpathy-style LLM wiki with three layers:

1. **`brain/_raw/`** — immutable raw sources (research, logs, ingested docs). Append-only ground truth. Never modified, never deleted.
2. **`brain/forge/themes/` and `brain/projects/<name>/themes/`** — 15-40-line theme pages indexing the raw layer. Annotated source links *are* the index. No paraphrasing of summaries.
3. **`brain/INDEX.md` + `brain/forge/{patterns,antipatterns,decisions,operations}.md` + per-project `profile.md`** — category indexes pointing to theme pages.

The brain is rendered as an **Obsidian vault** so humans navigate the same graph the agents query. Three skills front it: `brain-ingest` (sole writer), `brain-lint` (structural integrity), `brain-query` (efficient lookup).

Karpathy's principle: many small navigable pages > few large summaries. A reader (human or agent) should arrive at the right raw source within 2-3 clicks.

## Sources

- [`adr-004-obsidian-wiki.docs.md`](../../_raw/docs/adr-004-obsidian-wiki.docs.md) — the brain's structural decision record.

## Related

- [Theme: Brain-first research](./brain-first-research.md) — why the wiki gets used.
- [Theme: Brain-gap feedback loop](./brain-gap-feedback-loop.md) — how it stays current.
