---
work_item_id: WI-5
feature_id: FEAT-3
initiative_id: INIT-2025-05-17-slugifier-package
status: complete
depends_on:
  - WI-2
  - WI-4
acceptance_criteria:
  - given: >-
      tests/slugify.test.ts contains option-specific test cases and the extended
      slugify implementation is in place
    when: npm test is run
    then: >-
      all option test cases pass: separator override, maxLength truncation, both
      combined, empty options, and non-positive maxLength
  - given: the option test cases are added to tests/slugify.test.ts
    when: npm test is run
    then: >-
      the pre-existing core slugify test cases from WI-2 also continue to pass
      without modification
  - given: input 'Hello Beautiful World' with maxLength 11
    when: the maxLength test case runs
    then: it asserts the result is 'hello-beaut' with no trailing hyphen
files_in_scope:
  - tests/slugify.test.ts
estimated_iterations: 1
---

# WI-5: Option-specific test cases appended to `tests/slugify.test.ts`

Adds the FEAT-3 acceptance-criteria test cases to the existing `tests/slugify.test.ts` file (established in WI-2). This WI depends on both WI-2 (which creates the file and the core test cases) and WI-4 (which extends the `slugify` function with options support).

## Dependency rationale

- **Depends on WI-2**: `tests/slugify.test.ts` must exist before this WI can append to it. Two WIs editing the same file without a serialising edge would produce a merge conflict (`no_hidden_coupling` rule).
- **Depends on WI-4**: The extended `slugify(input, options)` signature must be in place for the new test cases to be meaningful. The Ralph loop runs the quality gate (`npm test`) at the end of every iteration — new tests importing option features that don't exist yet would cause test failures on every iteration.

## Test cases to add

Append 5 additional `test()` calls to the existing file (after the core test cases from WI-2):

1. `slugify('Hello World', { separator: '_' })` → `'hello_world'`
2. `slugify('Hello Beautiful World', { maxLength: 11 })` → `'hello-beaut'`
3. `slugify('Hello World', { maxLength: 6 })` → `'hello'` (trailing `-` re-trimmed; result ≤ 6 chars)
4. `slugify('Hello World', { separator: '_', maxLength: 9 })` → `'hello_wor'`
5. `slugify('Hello World', {})` → `'hello-world'`
6. `slugify('Hello World', { maxLength: 0 })` → `'hello-world'`

## Implementation notes

- Use `node:test` and `node:assert/strict` consistent with WI-2's test style.
- Do NOT rewrite WI-2's test cases — append after them.
- Do NOT delete `tests/placeholder.test.ts`.

## Brain themes consulted

- `brain/forge/themes/spec-driven-work-items.md` — serialising two WIs on the same file via depends_on is the correct resolution for shared-file coupling.
- `brain/forge/themes/work-item-completion-by-domain.md` — appending test cases to an existing file is the lightest possible WI; estimated_iterations: 1.
