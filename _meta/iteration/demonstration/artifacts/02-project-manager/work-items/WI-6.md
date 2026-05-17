---
work_item_id: WI-6
feature_id: FEAT-3
initiative_id: INIT-2025-07-14-slugifier
status: complete
depends_on:
  - WI-5
acceptance_criteria:
  - given: >-
      tests/slugify-options.test.ts exists and imports slugify from
      src/slugify.ts
    when: npm test is run
    then: all tests in tests/slugify-options.test.ts pass with exit code 0
  - given: >-
      the full suite of FEAT-3 option cases: separator underscore, empty
      separator, maxLength truncation, maxLength with trailing separator trim,
      separator and maxLength composed, empty options object, empty input with
      maxLength
    when: 'each case is a named node:test assertion'
    then: every assertion passes and 0 failures are reported
  - given: the full test suite (npm test) is run after WI-6 is applied
    when: >-
      all three test files (slugify.test.ts, batch.test.ts,
      slugify-options.test.ts) run together
    then: no regressions are introduced in slugify.test.ts or batch.test.ts
files_in_scope:
  - tests/slugify-options.test.ts
estimated_iterations: 1
---

# WI-6: Options tests (`tests/slugify-options.test.ts`)

Write `tests/slugify-options.test.ts` covering all FEAT-3 acceptance criteria. Use `node:test` + `node:assert/strict`, import from `../src/slugify.ts`.

Cover all seven manifest ACs:
1. `slugify("Hello World", { separator: "_" })` → `"hello_world"`
2. `slugify("Hello World", { separator: "" })` → `"helloworld"`
3. `slugify("Hello World", { maxLength: 5 })` → `"hello"`
4. `slugify("Hello World", { maxLength: 6 })` → `"hello"` (trailing hyphen trimmed)
5. `slugify("Hello World", { separator: "_", maxLength: 8 })` → `"hello_wo"`
6. `slugify("Hello, World!", {})` → `"hello-world"`
7. `slugify("", { maxLength: 10 })` → `""`

This WI only writes a new test file — `src/slugify.ts` is not modified. Depends on WI-5 (options must be implemented before tests can meaningfully pass). Parallel to WI-4 (different test file; no shared files between WI-4 and WI-6).

## Brain themes consulted

- `brain/forge/themes/spec-driven-work-items.md` — 1 file, GWT criteria directly mirror FEAT-3 ACs.
- `brain/forge/themes/dependency-ordered-work.md` — serialised behind WI-5; parallel to WI-4 (no file overlap).
