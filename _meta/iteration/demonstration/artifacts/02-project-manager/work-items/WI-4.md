---
work_item_id: WI-4
feature_id: FEAT-2
initiative_id: INIT-2025-07-14-slugifier
status: complete
depends_on:
  - WI-3
acceptance_criteria:
  - given: >-
      tests/batch.test.ts exists and imports slugifyMany and uniqueSlug from
      src/batch.ts
    when: npm test is run
    then: all tests in tests/batch.test.ts pass with exit code 0
  - given: >-
      the full suite of FEAT-2 cases: slugifyMany with two strings, slugifyMany
      with empty array, uniqueSlug with free base, uniqueSlug with one
      collision, uniqueSlug with multiple consecutive collisions, uniqueSlug
      with a gap
    when: 'each case is a named node:test assertion'
    then: every assertion passes and 0 failures are reported
files_in_scope:
  - tests/batch.test.ts
estimated_iterations: 1
---

# WI-4: Batch helpers tests (`tests/batch.test.ts`)

Write `tests/batch.test.ts` covering all FEAT-2 acceptance criteria. Use the same `node:test` + `node:assert/strict` pattern as `tests/placeholder.test.ts`. Import from `../src/batch.ts`.

Cover all seven AC cases from the manifest:
1. `slugifyMany(["Hello World", "Foo Bar"])` → `["hello-world", "foo-bar"]`
2. `slugifyMany([])` → `[]`
3. `uniqueSlug("foo", [])` → `"foo"`
4. `uniqueSlug("foo", ["foo"])` → `"foo-2"`
5. `uniqueSlug("foo", ["foo", "foo-2"])` → `"foo-3"`
6. `uniqueSlug("foo", ["foo", "foo-2", "foo-3"])` → `"foo-4"`
7. `uniqueSlug("foo", ["foo-2"])` → `"foo"` (gap: base is free)

This WI only writes tests — no changes to `src/`. Depends on WI-3 (needs `src/batch.ts` to exist). Parallel to WI-6 (different test file, no file overlap).

## Brain themes consulted

- `brain/forge/themes/spec-driven-work-items.md` — 1 file, GWT criteria, minimal scope.
- `brain/forge/themes/dependency-ordered-work.md` — serialised behind WI-3; parallel to WI-6 (no shared files).
