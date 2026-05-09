---
initiative_id: INIT-2026-05-09-slugifier-basic
project: slugifier
project_repo_path: /tmp/slugifier
created_at: 2026-05-09T11:00:00Z
iteration_budget: 50
cost_budget_usd: 25
phase: in-flight
features:
  - feature_id: FEAT-1
    title: slugify(input) -> URL-safe slug
    depends_on: []
---

# Initiative: `slugify(input)` URL-safe slug helper

Add a `slugify(input: string): string` function to `src/slugify.ts` that converts an arbitrary
string to a URL-safe slug:

- Lower-case ASCII output.
- Words separated by hyphens.
- Numbers preserved.
- Latin accents normalised (`é → e`, `ñ → n`, etc.).
- Non-Latin characters and emoji dropped (not transliterated).
- Multiple consecutive non-alphanumeric runs collapse to a single hyphen.
- Leading and trailing hyphens trimmed.
- Empty input returns empty string (not throw, not null).

Tests live in `tests/slugify.test.ts` using `node:test`.

## Why now

The downstream content pipeline indexes each post by a URL slug derived from its title. Without a
canonical slugifier, two callers (the index builder and the link renderer) produce divergent slugs
for the same title — producing dead links. A single deterministic helper is the smallest unblocking
change.

## Out of scope

- Pluggable transliteration tables (we drop non-Latin; future work).
- Locale-aware lowercasing (ASCII fold is sufficient for v0).
- Slug uniqueness across a corpus (caller's responsibility).
