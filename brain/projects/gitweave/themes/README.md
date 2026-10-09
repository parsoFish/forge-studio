# gitweave — Brain 3 theme pages

> Theme pages are short, durable facts the reflection phase distils from
> gitweave's cycles — the *navigable* layer of this project's knowledge
> base (mirrors `brain/cycles/themes/README.md`'s format, one level down).

## Format

```markdown
---
title: <short title>
description: <one-line description>
category: pattern | antipattern | decision | operation | reference
keywords: [list, of, search, terms]
created_at: <ISO-8601>
updated_at: <ISO-8601>
related_themes: [other-theme-slug-1]
---

# <Title>

<1-2 paragraphs: what happened, why it matters, when it applies.>
```

## Rules

- One theme per real cycle lesson — not a running log.
- 15-40 lines; split into sub-themes rather than growing one page.
- Slug = filename (`kebab-case.md`).

This directory starts empty (this file is the only placeholder) — the
reflection phase populates it after gitweave's first merged cycle.
