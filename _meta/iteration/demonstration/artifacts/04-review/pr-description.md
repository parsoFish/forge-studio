# PR: Canonical URL-safe slugifier package (INIT-2025-05-17-slugifier-package)

## Why

Two independent callers in the content pipeline (the index builder and the link renderer) each maintained their own slug logic, producing divergent slugs for the same title and causing dead links between them. This PR introduces a single shared slugifier package — `slugify`, `slugifyMany`, and `uniqueSlug` — that all callers can import, eliminating the source of drift and guaranteeing consistent URL-safe slugs across the pipeline.

## What

- **`src/slugify.ts`** — New file (53 lines). Exports `slugify(input, options?)` and `SlugifyOptions`.
  - Core transform: NFD-normalise → strip combining marks (Mn) → lowercase → replace non-`[a-z0-9]` with separator → collapse consecutive separators → trim leading/trailing separators.
  - `SlugifyOptions.separator` (default `"-"`) overrides the inter-word character.
  - `SlugifyOptions.maxLength` (positive integer) truncates the output and re-trims any trailing separator.
  - Handles accented Latin (NFD), emoji, non-Latin scripts (all drop to empty — no transliteration), and consecutive/leading/trailing punctuation.
- **`src/batch.ts`** — New file. Exports two batch helpers that layer over `slugify`:
  - `slugifyMany(inputs: string[]): string[]` — maps `slugify` over the array, preserving order (empty strings in → empty strings out, not dropped).
  - `uniqueSlug(slug: string, taken: string[]): string` — returns `slug` unchanged if not in `taken`; otherwise appends `-N` where N is the smallest integer ≥ 2 such that `slug-N` is not in `taken`. Exact string matching, no mutation of `taken`.
- **`tests/slugify.test.ts`** — New file (74 lines). 15 tests covering all 8 FEAT-1 ACs and all 6 FEAT-3 ACs via Node.js `node:test` + `node:assert/strict`.
- **`tests/batch.test.ts`** — New file (6 tests). Covers all 6 FEAT-2 ACs: `slugifyMany` order-preservation and all `uniqueSlug` suffix-disambiguation cases (`foo-2`, `foo-3`, `foo-5`, and no-collision).
- All 21 tests pass.

## How

The core transform is implemented as a single chained string pipeline using two Unicode-aware regexes (`/\p{Mn}/gu` for combining marks, `[^a-z0-9]` for non-slug chars). The separator is regex-escaped before use so callers can pass arbitrary strings (e.g. `"_"`, `"."`). `maxLength` is applied after the full transform; a trailing-separator re-trim follows the slice. `slugifyMany` is a thin `Array.prototype.map` wrapper. `uniqueSlug` uses a linear counter starting at 2 with `Array.prototype.includes` for exact-match collision detection. No runtime dependencies; the package uses only native Node.js with `--experimental-strip-types` for zero-build TypeScript execution.

## Demo

[recording.mp4](.forge/demos/INIT-2025-05-17-slugifier-package/recording.mp4)
