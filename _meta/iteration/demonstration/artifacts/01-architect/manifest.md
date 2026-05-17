---
initiative_id: INIT-2025-07-14-slugifier
project: slugifier
project_repo_path: .
created_at: "2025-07-14T00:00:00Z"
iteration_budget: 8
cost_budget_usd: 0.50
phase: pending
origin: architect
features:
  - feature_id: FEAT-1
    title: "Core slugify function (src/slugify.ts)"
    depends_on: []
  - feature_id: FEAT-2
    title: "Batch helpers — slugifyMany and uniqueSlug (src/batch.ts)"
    depends_on: [FEAT-1]
  - feature_id: FEAT-3
    title: "Configurable options — separator and maxLength on slugify"
    depends_on: [FEAT-1]
---

# Slugifier — canonical URL-safe slug package

## Context

Two existing callers in the content pipeline (index builder and link renderer) each roll their own slug logic. Because neither shares code, identical titles produce divergent slugs and dead-link each other. This initiative introduces a single canonical `slugifier` package that all callers will import.

Brain sources consulted:
- `brain/forge/themes/spec-driven-work-items.md` — Given-When-Then criterion discipline.
- `brain/forge/themes/declarative-specs-vs-imperative.md` — target-state specification over procedural instructions.
- `brain/forge/themes/dependency-ordered-work.md` — FEAT-2 and FEAT-3 both depend on FEAT-1; they may run in parallel once FEAT-1 merges.

Out of scope: pluggable transliteration tables, locale-aware lowercasing, corpus-persisted uniqueness.

---

## FEAT-1 — Core slugify function (`src/slugify.ts`)

Deliver `src/slugify.ts` exporting `slugify(input: string): string` with the following transformation pipeline: Unicode NFD normalisation → combining-mark strip → lower-case → collapse non-alphanumeric runs to a single hyphen → trim leading/trailing hyphens → return. Numbers are preserved. Latin accents are normalised (é → e). Non-Latin scripts and emoji are dropped. Empty input returns empty string.

Also export `type SlugifyOptions = { separator?: string; maxLength?: number }`. The base `slugify` signature accepts an optional second argument of this type (used fully in FEAT-3), but in FEAT-1 it may be accepted and ignored — the no-options behaviour must be stable before FEAT-2 and FEAT-3 build on it.

Tests live under `tests/slugify.test.ts`.

### Acceptance criteria

**Given** the input `"Hello, World!"`, **when** `slugify` is called, **then** it returns `"hello-world"`.

**Given** the input `"Héllo Wörld"` (Latin accents), **when** `slugify` is called, **then** it returns `"hello-world"` (accents normalised via NFD + combining-mark strip).

**Given** the input `"My 2nd Post"` (number), **when** `slugify` is called, **then** it returns `"my-2nd-post"` (number preserved).

**Given** the input `"日本語 title"` (non-Latin script), **when** `slugify` is called, **then** it returns `"title"` (non-Latin characters dropped, Latin portion kept).

**Given** the input `"🎉 Party time!"` (emoji), **when** `slugify` is called, **then** it returns `"party-time"` (emoji dropped).

**Given** the input `"  --multiple---hyphens--  "` (consecutive non-alphanumerics), **when** `slugify` is called, **then** it returns `"multiple-hyphens"` (consecutive separators collapsed, leading/trailing trimmed).

**Given** the input `""` (empty string), **when** `slugify` is called, **then** it returns `""`.

---

## FEAT-2 — Batch helpers (`src/batch.ts`)

Deliver `src/batch.ts` exporting:

- `slugifyMany(inputs: string[]): string[]` — maps `slugify` over an array, preserving order. Empty array returns `[]`.
- `uniqueSlug(slug: string, taken: string[]): string` — returns `slug` if not in `taken`; otherwise returns the smallest `slug-N` (N ≥ 2) not in `taken`. The suffix search must be linear: try `-2`, `-3`, … until a free slot is found. The `taken` lookup is case-sensitive and exact.

Tests live under `tests/batch.test.ts`.

### Acceptance criteria

**Given** `inputs = ["Hello World", "Foo Bar"]`, **when** `slugifyMany(inputs)` is called, **then** it returns `["hello-world", "foo-bar"]`.

**Given** `inputs = []`, **when** `slugifyMany(inputs)` is called, **then** it returns `[]`.

**Given** `slug = "foo"` and `taken = []`, **when** `uniqueSlug` is called, **then** it returns `"foo"`.

**Given** `slug = "foo"` and `taken = ["foo"]`, **when** `uniqueSlug` is called, **then** it returns `"foo-2"`.

**Given** `slug = "foo"` and `taken = ["foo", "foo-2"]`, **when** `uniqueSlug` is called, **then** it returns `"foo-3"`.

**Given** `slug = "foo"` and `taken = ["foo", "foo-2", "foo-3"]`, **when** `uniqueSlug` is called, **then** it returns `"foo-4"`.

**Given** `slug = "foo"` and `taken = ["foo-2"]` (gap: foo is free), **when** `uniqueSlug` is called, **then** it returns `"foo"` (the base slug is free).

---

## FEAT-3 — Configurable options on `slugify`

Extend the `slugify(input, options?)` signature to honour:

- `options.separator` — replaces the default hyphen with any string (e.g. `"_"`). All internal collapses and trim operations apply to the custom separator. The separator may be empty string (produces a run-together slug with no separator).
- `options.maxLength` — positive integer. After the full transformation pipeline, the result is truncated to at most `maxLength` characters; any trailing separator characters are then re-trimmed. If the result would be entirely separators after truncation, return empty string. Non-positive or non-integer values for `maxLength` are treated as no-limit (inferred; not specified in brief — noted here).

No-options behaviour (both options absent or `undefined`) is unchanged from FEAT-1.

Tests live under `tests/slugify-options.test.ts`.

### Acceptance criteria

**Given** `slugify("Hello World", { separator: "_" })`, **when** called, **then** it returns `"hello_world"`.

**Given** `slugify("Hello World", { separator: "" })`, **when** called, **then** it returns `"helloworld"`.

**Given** `slugify("Hello World", { maxLength: 5 })`, **when** called, **then** it returns `"hello"` (truncated; no trailing separator).

**Given** `slugify("Hello World", { maxLength: 6 })`, **when** called, **then** it returns `"hello"` (truncated at 6 = `"hello-"`, trailing separator re-trimmed → `"hello"`).

**Given** `slugify("Hello World", { separator: "_", maxLength: 8 })`, **when** called, **then** it returns `"hello_wo"` — separator and maxLength compose correctly.

**Given** `slugify("Hello, World!", {})` (empty options object), **when** called, **then** it returns `"hello-world"` (no-options behaviour unchanged).

**Given** `slugify("", { maxLength: 10 })`, **when** called, **then** it returns `""` (empty input still returns empty).
