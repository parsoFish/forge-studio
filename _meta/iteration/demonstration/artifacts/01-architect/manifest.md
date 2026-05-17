---
initiative_id: INIT-2025-05-17-slugifier-package
project: slugifier
project_repo_path: .
created_at: "2025-05-17T00:00:00Z"
iteration_budget: 6
cost_budget_usd: 2.00
phase: pending
features:
  - feature_id: FEAT-1
    title: Core slugify function in src/slugify.ts
    depends_on: []
  - feature_id: FEAT-2
    title: Batch helpers in src/batch.ts
    depends_on: [FEAT-1]
  - feature_id: FEAT-3
    title: Configurable options on slugify (separator, maxLength)
    depends_on: [FEAT-1]
---

# Initiative: Canonical URL-safe slugifier package

## Context

Two callers in the content pipeline — the index builder and the link renderer — each maintain independent slug logic. They produce divergent slugs for the same title, causing dead links between them. This initiative introduces one shared package that all callers import. No more drift.

Brain reference consulted: `brain/forge/themes/spec-driven-work-items.md` (atomic features with Given-When-Then criteria) and `brain/forge/themes/declarative-specs-vs-imperative.md` (describe desired state; let the agent iterate). The brain index at `brain/INDEX.md` was the navigation entry point.

## Out of scope

- Pluggable transliteration tables
- Locale-aware lowercasing (e.g. Turkish dotless-i)
- Corpus-persisted uniqueness (database-backed dedup)

---

## FEAT-1 — Core slugify function in `src/slugify.ts`

**What to build:** Export a single function `slugify(input: string): string` implementing the canonical slug transform.

**Transform rules (in order):**
1. NFD-normalise the input string.
2. Strip Unicode combining marks (category `Mn`).
3. Lowercase the result.
4. Replace any character that is not `[a-z0-9]` with a hyphen.
5. Collapse runs of consecutive hyphens to a single hyphen.
6. Trim leading and trailing hyphens.
7. Return the result. Empty input → empty string.

Also add `tests/slugify.test.ts` with full coverage of the cases below.

### Acceptance criteria

**Given** an empty string
**When** `slugify("")` is called
**Then** it returns `""`

**Given** a plain ASCII title `"Hello World"`
**When** `slugify("Hello World")` is called
**Then** it returns `"hello-world"`

**Given** a title with numbers `"ES2025 Release"`
**When** `slugify("ES2025 Release")` is called
**Then** it returns `"es2025-release"` (numbers preserved)

**Given** a Latin-accented title `"Ångström & Résumé"`
**When** `slugify("Ångström & Résumé")` is called
**Then** it returns `"angstrom-resume"` (accents stripped via NFD, `&` collapsed)

**Given** an emoji-only input `"🚀🎉"`
**When** `slugify("🚀🎉")` is called
**Then** it returns `""` (non-Latin/emoji dropped, result trims to empty)

**Given** a non-Latin script `"日本語タイトル"`
**When** `slugify("日本語タイトル")` is called
**Then** it returns `""` (no transliteration; all chars dropped)

**Given** a title with consecutive non-alphanumerics `"foo---bar  baz"`
**When** `slugify("foo---bar  baz")` is called
**Then** it returns `"foo-bar-baz"` (consecutive separators collapsed)

**Given** a title with leading/trailing punctuation `"--hello--"`
**When** `slugify("--hello--")` is called
**Then** it returns `"hello"` (leading/trailing hyphens trimmed)

---

## FEAT-2 — Batch helpers in `src/batch.ts`

**What to build:** Export two helpers that layer over `slugify`.

```ts
export function slugifyMany(inputs: string[]): string[]
export function uniqueSlug(slug: string, taken: string[]): string
```

**`slugifyMany`**: Maps `slugify` over the array; preserves order.

**`uniqueSlug`**: If `slug` is not in `taken`, return it unchanged. Otherwise append `-N` where N is the smallest integer ≥ 2 such that `slug-N` is not in `taken`. The `taken` list uses exact string matching.

Also add `tests/batch.test.ts`.

### Acceptance criteria

**Given** an array `["Hello World", "ES2025", ""]`
**When** `slugifyMany(["Hello World", "ES2025", ""])` is called
**Then** it returns `["hello-world", "es2025", ""]` in the same order

**Given** `slug = "foo"` and `taken = []`
**When** `uniqueSlug("foo", [])` is called
**Then** it returns `"foo"` (not in taken, no suffix needed)

**Given** `slug = "foo"` and `taken = ["foo"]`
**When** `uniqueSlug("foo", ["foo"])` is called
**Then** it returns `"foo-2"` (smallest suffix starting at 2)

**Given** `slug = "foo"` and `taken = ["foo", "foo-2"]`
**When** `uniqueSlug("foo", ["foo", "foo-2"])` is called
**Then** it returns `"foo-3"` (skips taken entries, finds next free slot)

**Given** `slug = "foo"` and `taken = ["foo", "foo-2", "foo-3", "foo-4"]`
**When** `uniqueSlug("foo", ["foo", "foo-2", "foo-3", "foo-4"])` is called
**Then** it returns `"foo-5"`

**Given** `slug = "bar"` and `taken = ["foo", "baz"]`
**When** `uniqueSlug("bar", ["foo", "baz"])` is called
**Then** it returns `"bar"` (slug not in taken, no collision)

---

## FEAT-3 — Configurable options on `slugify`

**What to build:** Extend `slugify` to accept an optional second argument and export the options type.

```ts
export type SlugifyOptions = {
  separator?: string    // default: "-"
  maxLength?: number    // positive integer; cap total output length
}

export function slugify(input: string, options?: SlugifyOptions): string
```

**Behaviour:**
- `separator`: replaces the default `-` between words. The core transform replaces non-alphanumerics with this separator, collapses consecutive occurrences, and trims leading/trailing occurrences.
- `maxLength`: after the full transform, truncate to `maxLength` characters, then re-trim any trailing occurrence of the separator (to avoid a slug ending with `-`). Must be a positive integer; non-positive values are ignored (treat as unset).
- Calling `slugify(input)` with no options is unchanged from FEAT-1 behaviour.

Update `tests/slugify.test.ts` to add option-specific cases.

### Acceptance criteria

**Given** input `"Hello World"` and `options = { separator: "_" }`
**When** `slugify("Hello World", { separator: "_" })` is called
**Then** it returns `"hello_world"` (custom separator used throughout)

**Given** input `"Hello Beautiful World"` and `options = { maxLength: 11 }`
**When** `slugify("Hello Beautiful World", { maxLength: 11 })` is called
**Then** it returns `"hello-beaut"` (truncated at 11 chars; no trailing separator)

**Given** input `"Hello World"` and `options = { maxLength: 6 }`
**When** `slugify("Hello World", { maxLength: 6 })` is called
**Then** it returns `"hello"` (truncated to 6; trailing `-` re-trimmed → 5 chars is acceptable as long as no trailing separator remains — the cap is a maximum, not an exact length)

**Given** input `"Hello World"` and `options = { separator: "_", maxLength: 9 }`
**When** `slugify("Hello World", { separator: "_", maxLength: 9 })` is called
**Then** it returns `"hello_wor"` (both options applied; trailing `_` trimmed if present)

**Given** input `"Hello World"` and `options = {}`
**When** `slugify("Hello World", {})` is called
**Then** it returns `"hello-world"` (defaults apply; identical to no-options call)

**Given** input `"Hello World"` and `options = { maxLength: 0 }`
**When** `slugify("Hello World", { maxLength: 0 })` is called
**Then** it returns `"hello-world"` (non-positive maxLength ignored)
