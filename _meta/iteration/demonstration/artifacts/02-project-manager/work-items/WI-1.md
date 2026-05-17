---
work_item_id: WI-1
feature_id: FEAT-1
initiative_id: INIT-2025-07-14-slugifier
status: complete
depends_on: []
acceptance_criteria:
  - given: 'the input "Hello, World!"'
    when: slugify is called with no options
    then: it returns "hello-world"
  - given: the input "Héllo Wörld" (Latin accents)
    when: slugify is called
    then: >-
      it returns "hello-world" (accents normalised via NFD + combining-mark
      strip)
  - given: the input "My 2nd Post" (contains a number)
    when: slugify is called
    then: it returns "my-2nd-post" (number preserved)
  - given: the input "日本語 title" (non-Latin script mixed with Latin)
    when: slugify is called
    then: 'it returns "title" (non-Latin characters dropped, Latin portion kept)'
  - given: "the input \"\U0001F389 Party time!\" (emoji)"
    when: slugify is called
    then: it returns "party-time" (emoji dropped)
  - given: the input "  --multiple---hyphens--  " (consecutive non-alphanumerics)
    when: slugify is called
    then: >-
      it returns "multiple-hyphens" (consecutive separators collapsed,
      leading/trailing trimmed)
  - given: the input "" (empty string)
    when: slugify is called
    then: it returns ""
  - given: slugify is imported from src/slugify.ts
    when: the module is loaded
    then: it exports both a slugify function and a SlugifyOptions type
files_in_scope:
  - src/slugify.ts
estimated_iterations: 2
---

# WI-1: Core slugify function (`src/slugify.ts`)

Create `src/slugify.ts` from scratch, exporting the `slugify(input: string, options?: SlugifyOptions): string` function and the `SlugifyOptions` type.

The transformation pipeline (in order):
1. Unicode NFD normalisation (`String.prototype.normalize('NFD')`)
2. Strip combining marks (characters in Unicode category Mn — i.e. `/\p{Mn}/gu`)
3. Lower-case (`toLowerCase()`)
4. Collapse runs of non-alphanumeric characters to a single hyphen
5. Trim leading/trailing hyphens
6. Return result (empty string for empty/whitespace-only input)

The `SlugifyOptions` type (exported) carries `separator?: string` and `maxLength?: number`. FEAT-3 (WI-5) will activate them; in this WI the base pipeline above must be stable and all FEAT-1 ACs must pass with no options supplied.

Numbers are preserved by the alphanumeric keep rule (`/[^a-z0-9]+/g` → hyphen). Non-Latin scripts and emoji are naturally dropped after NFD + Mn strip because they resolve to characters outside `[a-z0-9]`.

The placeholder test `tests/placeholder.test.ts` imports `src/slugify.ts` and asserts `slugify('') === ''`; this WI must satisfy that import for the smoke test to go green.

## Inferred decisions (not in manifest)

- `src/slugify.ts` does not exist yet; the `src/` directory contains only `.gitkeep`. This WI creates the file.
- The options parameter is accepted in the signature (for forward-compatibility with WI-5) but may be ignored in this WI — the no-options pipeline must be correct.

## Brain themes consulted

- `brain/forge/themes/spec-driven-work-items.md` — atomic scope (1 file), GWT criteria, designed for Ralph iteration.
- `brain/forge/themes/dependency-ordered-work.md` — this WI has no predecessors; it unblocks WI-2, WI-3, and WI-5 in parallel.
- `brain/forge/themes/work-item-completion-by-domain.md` — clean TypeScript stdlib domain; `estimated_iterations: 2` is conservative given Unicode regex work.
