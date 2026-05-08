---
title: Markdown artifacts flow phase-to-phase
description: All inter-phase data is markdown with YAML frontmatter. Greppable, debuggable, version-controllable. Inspired by gstack.
category: pattern
keywords: [markdown, artifacts, frontmatter, gstack, gray-matter, phase-boundary, greppable]
created_at: 2026-05-04T17:55:00Z
updated_at: 2026-05-04T17:55:00Z
related_themes: [spec-driven-work-items, gstack-conventions, six-phases-of-forge]
---

# Markdown artifacts flow phase-to-phase

Every phase boundary is a markdown document. The flow:

```
Roadmap (md) ──► Initiative manifest (md+frontmatter) ──► Feature spec (md) ──► Work item spec (md) ──► PR description (md) ──► Retro (md)
```

Every artifact:

- Lives in a known location (project repo for project artifacts; `_queue/` for orchestrator state; `brain/` for durable knowledge).
- Has YAML frontmatter declaring type, owner, dependencies, status.
- Is human-editable — humans can intervene at any boundary by editing the file.
- Is greppable — `grep -r 'work_item_id: WI-42' projects/` works.

Skills consume markdown via `gray-matter` for frontmatter parsing and emit markdown via direct file writes. Inspired by [gstack](https://github.com/garrytan/gstack).

Trade-off: no compile-time schema enforcement. Mitigated by lint skills and benchmarks that validate artifact shape.

## Sources

- [`adr-007-markdown-artifact-flow.docs.md`](../../_raw/docs/adr-007-markdown-artifact-flow.docs.md) — decision record.

## Related

- [Theme: Spec-driven work items](./spec-driven-work-items.md) — one of the artifacts.
- [Theme: gstack conventions](./gstack-conventions.md) — the inspiration.
