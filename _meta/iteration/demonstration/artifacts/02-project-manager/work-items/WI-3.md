---
work_item_id: WI-3
feature_id: FEAT-2
initiative_id: INIT-2025-07-14-slugifier
status: complete
depends_on:
  - WI-1
acceptance_criteria:
  - given: 'inputs = ["Hello World", "Foo Bar"]'
    when: slugifyMany(inputs) is called
    then: 'it returns ["hello-world", "foo-bar"] in the same order'
  - given: 'inputs = [] (empty array)'
    when: slugifyMany(inputs) is called
    then: 'it returns []'
  - given: 'slug = "foo" and taken = []'
    when: 'uniqueSlug(slug, taken) is called'
    then: it returns "foo" (base slug is free)
  - given: 'slug = "foo" and taken = ["foo"]'
    when: 'uniqueSlug(slug, taken) is called'
    then: it returns "foo-2"
  - given: 'slug = "foo" and taken = ["foo", "foo-2", "foo-3"]'
    when: 'uniqueSlug(slug, taken) is called'
    then: it returns "foo-4"
  - given: 'slug = "foo" and taken = ["foo-2"] (gap: foo is free)'
    when: 'uniqueSlug(slug, taken) is called'
    then: it returns "foo" (base slug is free despite higher suffixes being taken)
files_in_scope:
  - src/batch.ts
estimated_iterations: 2
---

# WI-3: Batch helpers implementation (`src/batch.ts`)

Create `src/batch.ts` exporting:

- `slugifyMany(inputs: string[]): string[]` — maps `slugify` over the array preserving order. Import `slugify` from `./slugify.ts`.
- `uniqueSlug(slug: string, taken: string[]): string` — returns the base `slug` if it is not in `taken`; otherwise tries `slug-2`, `slug-3`, … (linear search) until a free suffix is found. The search starts at 2 and increments by 1. The `taken` lookup is case-sensitive and exact (simple `includes` or `Set.has`).

`src/batch.ts` is a new file; `src/` currently holds only `.gitkeep`. This WI creates it. It depends on WI-1 because it imports from `./slugify.ts`.

This WI is parallel to WI-5 (which extends `src/slugify.ts` for FEAT-3). The two WIs touch different files (`src/batch.ts` vs `src/slugify.ts`) so there is no hidden coupling.

## Inferred decisions (not in manifest)

- `uniqueSlug` uses a `Set` for O(1) membership testing on large `taken` arrays, but a plain `Array.prototype.includes` is acceptable given the scope constraint.
- The suffix separator in `uniqueSlug` is always a hyphen (`-`), regardless of any `SlugifyOptions.separator` in the slug itself — the manifest specifies `slug-N` literally.

## Brain themes consulted

- `brain/forge/themes/spec-driven-work-items.md` — 1 new file, all ACs are GWT, atomic scope.
- `brain/forge/themes/dependency-ordered-work.md` — parallel to WI-5; no file overlap; depends only on WI-1.
- `brain/forge/themes/work-item-completion-by-domain.md` — clean TypeScript utility domain; `estimated_iterations: 2` to allow for edge-case iteration.
