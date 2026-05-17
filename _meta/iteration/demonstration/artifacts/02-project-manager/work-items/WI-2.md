---
work_item_id: WI-2
feature_id: FEAT-1
initiative_id: INIT-2025-07-14-slugifier
status: complete
depends_on:
  - WI-1
acceptance_criteria:
  - given: tests/slugify.test.ts exists and imports from src/slugify.ts
    when: npm test is run
    then: all tests in tests/slugify.test.ts pass with exit code 0
  - given: >-
      the full suite of FEAT-1 transformation cases (Hello World, accents,
      numbers, non-Latin, emoji, consecutive separators, empty)
    when: 'each case is exercised as a named node:test assertion'
    then: every assertion passes and the test file reports 0 failures
  - given: tests/placeholder.test.ts (the seed smoke test)
    when: npm test is run after WI-1 is implemented
    then: the placeholder test also passes (slugify('') returns '')
files_in_scope:
  - tests/slugify.test.ts
estimated_iterations: 1
---

# WI-2: Core slugify tests (`tests/slugify.test.ts`)

Write the test file `tests/slugify.test.ts` covering all seven FEAT-1 acceptance criteria. Use Node's built-in `node:test` runner (already used in `tests/placeholder.test.ts`) and `node:assert/strict`.

The test runner command is `node --test --experimental-strip-types 'tests/**/*.test.ts'` (from `package.json`). Import from `../src/slugify.ts` (relative, `.ts` extension, because `allowImportingTsExtensions` is enabled in tsconfig and the runner strips types natively).

Each of the seven FEAT-1 transformation cases must be a separate named `test(...)` call so that individual failures surface clearly in the runner output.

This WI only writes tests — it does not modify `src/slugify.ts`. WI-1 must be merged before this WI runs (hence `depends_on: [WI-1]`).

## Brain themes consulted

- `brain/forge/themes/spec-driven-work-items.md` — one file in scope, GWT criteria directly mirror FEAT-1 ACs.
- `brain/forge/themes/dependency-ordered-work.md` — serialised behind WI-1 (needs the implementation to import); independent from WI-3 and WI-5 (different files).
