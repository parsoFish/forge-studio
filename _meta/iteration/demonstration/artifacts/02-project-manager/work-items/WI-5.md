---
work_item_id: WI-5
feature_id: FEAT-3
initiative_id: INIT-2025-07-14-slugifier
status: complete
depends_on:
  - WI-1
acceptance_criteria:
  - given: 'slugify("Hello World", { separator: "_" })'
    when: called
    then: it returns "hello_world"
  - given: 'slugify("Hello World", { separator: "" })'
    when: called
    then: it returns "helloworld"
  - given: 'slugify("Hello World", { maxLength: 5 })'
    when: called
    then: it returns "hello" (truncated to 5 chars; no trailing separator)
  - given: 'slugify("Hello World", { maxLength: 6 })'
    when: called
    then: >-
      it returns "hello" (truncated at 6 = "hello-", trailing separator
      re-trimmed)
  - given: 'slugify("Hello World", { separator: "_", maxLength: 8 })'
    when: called
    then: it returns "hello_wo" (separator and maxLength compose correctly)
  - given: 'slugify("Hello, World!", {})'
    when: called with empty options object
    then: it returns "hello-world" (no-options behaviour unchanged)
  - given: 'slugify("", { maxLength: 10 })'
    when: called
    then: it returns "" (empty input still returns empty)
files_in_scope:
  - src/slugify.ts
estimated_iterations: 2
---

# WI-5: Configurable options — extend `src/slugify.ts`

Extend the existing `src/slugify.ts` (written by WI-1) to honour `SlugifyOptions`:

**`separator` option:**
- Replace the default hyphen (`-`) collapse character with the provided separator.
- The collapse step becomes: replace runs of non-alphanumeric characters with the custom separator.
- The trim step strips leading/trailing occurrences of the custom separator (handle empty-string separator: trim does nothing for empty separator since there is nothing to trim).
- If `separator` is `undefined`, behaviour is unchanged from WI-1 (defaults to `"-"`).

**`maxLength` option:**
- After the full transformation pipeline, slice the result to `maxLength` characters.
- Re-trim any trailing separator characters after truncation.
- If the result is empty after re-trimming, return `""`.
- Non-positive or non-integer values for `maxLength` are treated as no-limit (inferred; not specified in manifest — noted here).
- If `maxLength` is `undefined`, no truncation is applied.

**No-options invariant:** when both options are absent or `undefined`, the function must behave identically to WI-1's implementation. The existing FEAT-1 tests (WI-2) must continue to pass after this WI is merged.

This WI edits `src/slugify.ts`. It depends on WI-1 (file must exist). WI-3 reads from `src/slugify.ts` via import but does not edit it — no hidden coupling. WI-2 tests `src/slugify.ts` but only writes `tests/slugify.test.ts`, so there is no file-scope conflict between WI-2 and WI-5; however WI-5 must not break any WI-2 assertions.

## Inferred decisions (not in manifest)

- Empty-string separator: after pipeline, result is already lower-case alphanumeric with no separators to collapse (non-alphanumerics were collapsed to `""` → removed). Leading/trailing trim of `""` is a no-op. This naturally produces run-together output.
- Trailing-separator re-trim after `maxLength`: use `String.prototype.replace` with the separator as a literal suffix pattern, or a loop — avoid regex if the separator could contain regex special characters.

## Brain themes consulted

- `brain/forge/themes/spec-driven-work-items.md` — 1 file edited, all ACs are GWT, atomic scope.
- `brain/forge/themes/dependency-ordered-work.md` — parallel to WI-3 (different file: `src/batch.ts` vs `src/slugify.ts`); serialised behind WI-1.
- `brain/forge/themes/work-item-completion-by-domain.md` — slightly higher complexity than WI-1 due to option composition; `estimated_iterations: 2`.
