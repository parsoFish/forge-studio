---
paths:
  - "apps/docs/**"
---

# Docs site rules (`apps/docs`)

The published site is for people using forge. Agent-dev material (SPEC,
DECISIONS, QUARRY, `dev/`) never goes here.

## Where pages live

| path | holds |
|---|---|
| `apps/docs/src/content/docs/guides/` | hand-written guides |
| `apps/docs/src/content/docs/guides/how-to/` | generated how-tos (never hand-edited) |
| `apps/docs/src/content/docs/reference/` | reference pages |
| `apps/docs/src/content/docs/how-forge-works.md` | the one explanation page |
| `apps/docs/src/pages/index.astro` | the landing page |
| `apps/docs/public/media/stories/` | story frames used by the how-tos |

Check a change with `npm run build --workspace=docs` (schema, links),
`node scripts/check-docs-budget.mjs --strict` and `vale apps/docs/src/content/docs`.

## Page types and word ceilings

| type | ceiling (prose words) |
|---|---|
| guide | 1,000 |
| how-to (generated from a story) | 800 |
| reference / explanation prose | 2,000 (tables unbounded) |
| landing | 600 |

These are ceilings, never targets. A shorter page that answers the reader
beats a longer one. After every draft, run a cut pass and record words
before/after in the PR body. Name in the PR body any page above 70 % of its
ceiling, with the reason it needs the length. `node scripts/check-docs-budget.mjs --report`
prints every page and the median. Over a ceiling, split the page by task or
move detail to reference. Never raise the ceiling.

## Every page

- Frontmatter: `title`, `description` (≤ 160 chars), `type`, `owner`,
  `last_verified`, `covers:` (the code globs the page describes).
- One page type per page. The first sentence says what the page is for.
- Say where, not every click.
- Vocabulary: "Knowledge" on published pages ("Brain" is in-product only).
  `node scripts/check-identity.mjs` gates retired terms.
- Generated how-tos (`generated_from:`) are never hand-edited: change the
  story under `tests/stories/` and re-run it.

## Banned on guides and reference

| pattern | instead |
|---|---|
| ADR numbers, decision-record paths | DECISIONS.md (unpublished) |
| milestone or bead ids | nowhere |
| history narration ("previously", "used to", "moved from", "no longer") | git / CHANGELOG |
| `data-*` attributes (guides) | the test code |
| `packages/…`, `apps/…` paths (guides) | reference, or nowhere |
| filler ("simply", "just", "easily", "in order to", "please note") | cut it |
| future promises ("will be", "coming soon", "planned") | ROADMAP.md |
