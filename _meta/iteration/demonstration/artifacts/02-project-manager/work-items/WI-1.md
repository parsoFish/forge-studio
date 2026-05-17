---
work_item_id: WI-1
feature_id: FEAT-1
initiative_id: INIT-2025-05-17-slugifier-package
status: complete
depends_on: []
acceptance_criteria:
  - given: an empty string input
    when: slugify('') is called
    then: it returns an empty string ''
  - given: a plain ASCII title 'Hello World'
    when: slugify('Hello World') is called
    then: it returns 'hello-world'
  - given: a title with numbers 'ES2025 Release'
    when: slugify('ES2025 Release') is called
    then: it returns 'es2025-release' with numbers preserved
  - given: a Latin-accented title 'Ångström & Résumé'
    when: slugify('Ångström & Résumé') is called
    then: >-
      it returns 'angstrom-resume' with accents stripped via NFD and
      non-alphanumerics collapsed
  - given: "an emoji-only input '\U0001F680\U0001F389'"
    when: "slugify('\U0001F680\U0001F389') is called"
    then: >-
      it returns '' because all non-Latin/non-numeric chars are dropped and
      result trims to empty
  - given: a title with consecutive non-alphanumerics 'foo---bar  baz'
    when: slugify('foo---bar  baz') is called
    then: it returns 'foo-bar-baz' with consecutive separators collapsed to one
  - given: a title with leading and trailing punctuation '--hello--'
    when: slugify('--hello--') is called
    then: it returns 'hello' with leading and trailing hyphens trimmed
files_in_scope:
  - src/slugify.ts
estimated_iterations: 2
---

# WI-1: Core `slugify` function in `src/slugify.ts`

Implements the canonical URL-safe slug transform as the foundation for the entire slugifier package. This is the most load-bearing work item: FEAT-2 (batch helpers) and FEAT-3 (configurable options) both depend on this function being correct and exported.

## Transform pipeline (in order)

1. NFD-normalise the input string (`String.prototype.normalize('NFD')`).
2. Strip Unicode combining marks (Unicode category `Mn`) — use a regex against the NFD-normalised string.
3. Lowercase the result.
4. Replace any character that is not `[a-z0-9]` with a hyphen `-`.
5. Collapse runs of consecutive hyphens to a single hyphen.
6. Trim leading and trailing hyphens.
7. Return the result. Empty input → empty string.

## Implementation notes

- Export the function as a named export: `export function slugify(input: string): string`
- The project uses ESM (`"type": "module"` in package.json) with TypeScript strict mode and `NodeNext` module resolution — use `.ts` extension imports where needed.
- The smoke test in `tests/placeholder.test.ts` already imports `../src/slugify.ts` and checks `slugify('') === ''`; this WI makes that test pass.
- No third-party dependencies — use only the JS built-in `String.prototype.normalize`.

## Scope note

This WI touches ONLY `src/slugify.ts`. The test file `tests/slugify.test.ts` is written in WI-2 (independent). The options extension is added in WI-4 (depends on this WI).

## Brain themes consulted

- `brain/forge/themes/spec-driven-work-items.md` — atomic (≤3 files), Given-When-Then criteria, designed for iteration.
- `brain/forge/themes/design-is-the-bottleneck.md` — good decomposition prevents agent churn.
- `brain/forge/themes/work-item-completion-by-domain.md` — clean TypeScript stdlib domain → tight estimated_iterations distribution; set to 2.
