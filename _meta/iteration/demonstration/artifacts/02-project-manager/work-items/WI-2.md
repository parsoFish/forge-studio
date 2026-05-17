---
work_item_id: WI-2
feature_id: FEAT-1
initiative_id: INIT-2025-05-17-slugifier-package
status: complete
depends_on: []
acceptance_criteria:
  - given: >-
      the test file tests/slugify.test.ts exists and the core slugify
      implementation is in place
    when: npm test is run
    then: >-
      all core slugify test cases pass including empty string, ASCII, numbers,
      accents, emoji, non-Latin, consecutive separators, and leading/trailing
      punctuation
  - given: a non-Latin script input '日本語タイトル'
    when: slugify('日本語タイトル') is called
    then: >-
      it returns '' because no transliteration is performed and all chars are
      dropped
  - given: an empty string is passed
    when: slugify('') is called
    then: it returns '' confirming the smoke test contract is met
files_in_scope:
  - tests/slugify.test.ts
estimated_iterations: 1
---

# WI-2: Core slugify test suite in `tests/slugify.test.ts`

Creates the comprehensive test file for the core `slugify` function covering all 8 acceptance-criteria cases specified in FEAT-1. This WI is independent of WI-1 (the test file can be written before the implementation — the Ralph loop will iterate until both WI-1's impl and WI-2's tests are green together).

## Test cases to cover

Write individual `test()` calls using `node:test` and `node:assert/strict` (matching the project's existing test infrastructure as seen in `tests/placeholder.test.ts`):

1. Empty string → `""`
2. ASCII title `"Hello World"` → `"hello-world"`
3. Numbers `"ES2025 Release"` → `"es2025-release"`
4. Latin accents `"Ångström & Résumé"` → `"angstrom-resume"`
5. Emoji-only `"🚀🎉"` → `""`
6. Non-Latin `"日本語タイトル"` → `""`
7. Consecutive non-alphanumerics `"foo---bar  baz"` → `"foo-bar-baz"`
8. Leading/trailing punctuation `"--hello--"` → `"hello"`

## Implementation notes

- Use `import { test } from 'node:test'` and `import assert from 'node:assert/strict'`.
- Import slugify: `import { slugify } from '../src/slugify.ts'` (NodeNext requires `.ts` extension in source).
- Do NOT delete `tests/placeholder.test.ts` — it's the permanent smoke check.
- This file coexists with `tests/batch.test.ts` (created in WI-3) and the existing placeholder test.

## File-scope discipline

This WI touches ONLY `tests/slugify.test.ts`. The option-specific test cases are appended in WI-5 (which depends on this WI and WI-4). Two WIs that would both edit this file are serialised via `depends_on`.

## Brain themes consulted

- `brain/forge/themes/spec-driven-work-items.md` — test files count as files-in-scope; atomic scope (1 file).
- `brain/forge/themes/design-is-the-bottleneck.md` — writing tests before impl catches spec ambiguities early.
- `brain/forge/themes/work-item-completion-by-domain.md` — test-only WI with clear cases → estimated_iterations: 1.
