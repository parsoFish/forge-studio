---
work_item_id: WI-3
feature_id: FEAT-2
initiative_id: INIT-2025-05-17-slugifier-package
status: complete
depends_on:
  - WI-1
acceptance_criteria:
  - given: 'an array [''Hello World'', ''ES2025'', '''']'
    when: 'slugifyMany([''Hello World'', ''ES2025'', '''']) is called'
    then: 'it returns [''hello-world'', ''es2025'', ''''] preserving order'
  - given: 'slug ''foo'' and taken []'
    when: 'uniqueSlug(''foo'', []) is called'
    then: it returns 'foo' because the slug is not in the taken list
  - given: 'slug ''foo'' and taken [''foo'']'
    when: 'uniqueSlug(''foo'', [''foo'']) is called'
    then: it returns 'foo-2' using the smallest integer suffix starting at 2
  - given: 'slug ''foo'' and taken [''foo'', ''foo-2'']'
    when: 'uniqueSlug(''foo'', [''foo'', ''foo-2'']) is called'
    then: it returns 'foo-3' skipping already-taken suffixed variants
  - given: 'slug ''foo'' and taken [''foo'', ''foo-2'', ''foo-3'', ''foo-4'']'
    when: 'uniqueSlug(''foo'', [''foo'', ''foo-2'', ''foo-3'', ''foo-4'']) is called'
    then: it returns 'foo-5'
  - given: 'slug ''bar'' and taken [''foo'', ''baz'']'
    when: 'uniqueSlug(''bar'', [''foo'', ''baz'']) is called'
    then: it returns 'bar' because 'bar' is not in the taken list
files_in_scope:
  - src/batch.ts
  - tests/batch.test.ts
estimated_iterations: 2
---

# WI-3: Batch helpers in `src/batch.ts` + `tests/batch.test.ts`

Implements the two batch helper functions that layer over the core `slugify` from FEAT-1, and their accompanying test suite. FEAT-2 depends on FEAT-1, so this WI depends on WI-1.

## Functions to export

```
export function slugifyMany(inputs: string[]): string[]
export function uniqueSlug(slug: string, taken: string[]): string
```

**`slugifyMany`**: Maps `slugify` over the input array. Preserves order. Returns an array of the same length. Empty strings in the input produce empty strings in the output (not dropped).

**`uniqueSlug`**: If `slug` is not in `taken`, return it unchanged. Otherwise, append `-N` where N is the smallest integer ≥ 2 such that `slug-N` is not in `taken`. Uses exact string matching (case-sensitive, no normalization at this layer — the caller is expected to pass already-slugified values).

## Implementation notes

- Import: `import { slugify } from './slugify.ts'` (ESM + NodeNext).
- `taken` comparison is exact string equality (`Array.prototype.includes`).
- The function does NOT mutate `taken`.

## Test file notes (`tests/batch.test.ts`)

- Use `node:test` and `node:assert/strict` matching project conventions.
- Cover all 6 acceptance-criteria cases above.
- Import from `'../src/batch.ts'`.

## File-scope discipline

This WI touches exactly 2 files: `src/batch.ts` (new) and `tests/batch.test.ts` (new). Neither file is touched by any other WI. No hidden coupling risk.

FEAT-2 and FEAT-3 are parallel features (both depend on FEAT-1 but not on each other). WI-3 (FEAT-2) and WI-4/WI-5 (FEAT-3) are therefore independent of each other — they may run concurrently after WI-1 completes.

## Brain themes consulted

- `brain/forge/themes/spec-driven-work-items.md` — 2 files in scope, all 6 criteria are Given-When-Then.
- `brain/forge/themes/work-item-completion-by-domain.md` — simple TypeScript stdlib domain; estimated_iterations: 2.
- `brain/forge/themes/design-is-the-bottleneck.md` — explicit file-scope discipline prevents merge conflicts.
