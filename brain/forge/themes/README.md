# Brain — Theme Pages

> Theme pages are 15-40-line markdown files that index the raw layer for a specific topic. They are the *navigable middle layer* of the wiki.

## Format

Every theme page has the following shape:

```markdown
---
title: <short title>
description: <one-line description; appears in category indexes>
category: pattern | antipattern | decision | operation | reference
keywords: [list, of, search, terms]
created_at: <ISO-8601>
updated_at: <ISO-8601>
related_themes: [other-theme-slug-1, other-theme-slug-2]
---

# <Title>

<One short paragraph framing the theme.>

<1-2 paragraphs of context — why this matters, when it applies.>

## Sources

- [`<path/to/raw-source.md>`](../../_raw/<path>) — one-line annotation describing what's in this source.
- [`<path/to/another.md>`](../../_raw/<path>) — annotation.

## Related

- [Theme: <name>](./<other-theme-slug>.md)
```

## Rules

- **15-40 lines.** If you need more, split into sub-themes and link them.
- **No summarisation of summaries.** Theme pages link to raw; they don't paraphrase other theme pages.
- **Annotated source links.** Each link gets a one-line description of what's *in* the linked file. The annotations are the index.
- **Mandatory frontmatter.** `brain-lint` rejects pages with missing fields.
- **Slug = filename.** `tdd-atomic-items.md`, not `TDD Atomic Items.md`.

## Why so small

Karpathy's principle: many small navigable pages beat few large summaries. The wiki's value is making the raw layer *reachable*, not condensing it. A reader (human or agent) should arrive at the right raw source within 2-3 clicks.
