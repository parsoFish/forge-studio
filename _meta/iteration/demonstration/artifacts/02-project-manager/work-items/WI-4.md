---
work_item_id: WI-4
feature_id: FEAT-3
initiative_id: INIT-2025-05-17-slugifier-package
status: complete
depends_on:
  - WI-1
acceptance_criteria:
  - given: 'input ''Hello World'' and options { separator: ''_'' }'
    when: 'slugify(''Hello World'', { separator: ''_'' }) is called'
    then: it returns 'hello_world' using the custom separator throughout
  - given: 'input ''Hello Beautiful World'' and options { maxLength: 11 }'
    when: 'slugify(''Hello Beautiful World'', { maxLength: 11 }) is called'
    then: it returns 'hello-beaut' truncated at 11 chars with no trailing separator
  - given: 'input ''Hello World'' and options { maxLength: 6 }'
    when: 'slugify(''Hello World'', { maxLength: 6 }) is called'
    then: >-
      it returns 'hello' truncated to at most 6 chars with any trailing
      separator re-trimmed
  - given: 'input ''Hello World'' and options { separator: ''_'', maxLength: 9 }'
    when: 'slugify(''Hello World'', { separator: ''_'', maxLength: 9 }) is called'
    then: it returns 'hello_wor' with both options applied and no trailing separator
  - given: 'input ''Hello World'' and options {}'
    when: 'slugify(''Hello World'', {}) is called'
    then: >-
      it returns 'hello-world' applying all defaults identically to the
      no-options call
  - given: 'input ''Hello World'' and options { maxLength: 0 }'
    when: 'slugify(''Hello World'', { maxLength: 0 }) is called'
    then: it returns 'hello-world' because non-positive maxLength is ignored
files_in_scope:
  - src/slugify.ts
estimated_iterations: 2
---

# WI-4: Configurable options on `slugify` in `src/slugify.ts`

Extends the `slugify` function (built in WI-1) to accept an optional second `SlugifyOptions` argument. This WI modifies `src/slugify.ts` in place — WI-1 must be complete first (`depends_on: [WI-1]`).

## Type to export

```
export type SlugifyOptions = {
  separator?: string    // default: "-"
  maxLength?: number    // positive integer; cap output length
}
```

## Updated function signature

```
export function slugify(input: string, options?: SlugifyOptions): string
```

## Behaviour rules

**`separator`** (default `"-"`):
- Replaces `-` everywhere in the core transform pipeline: the replacement step (rule 4), the collapse step (rule 5), and the trim step (rule 6).
- Calling `slugify(input)` with no options must produce identical output to the FEAT-1 baseline (verified by existing tests in WI-2).

**`maxLength`** (default: no cap):
- Applied AFTER the full transform pipeline.
- Truncate the result string to `maxLength` characters.
- After truncation, re-trim any trailing occurrence(s) of the separator from the truncated result.
- Only applied when `maxLength` is a positive integer (> 0). Non-positive values (`0`, negative) are treated as unset.

## Backward compatibility

All existing tests from WI-2 (`tests/slugify.test.ts`) must continue to pass after this change. The function signature is a strict superset — the second argument is optional with typed defaults.

## File-scope discipline

This WI touches ONLY `src/slugify.ts`. The option test cases are written separately in WI-5 (which depends on this WI and WI-2). WI-3 (batch.ts) is parallel — no coupling.

## Brain themes consulted

- `brain/forge/themes/spec-driven-work-items.md` — single file in scope; criteria define observable output not implementation strategy.
- `brain/forge/themes/design-is-the-bottleneck.md` — options are additive; backward compat is an explicit constraint in the spec, not assumed.
- `brain/forge/themes/work-item-completion-by-domain.md` — extending an existing function with typed options; estimated_iterations: 2.
