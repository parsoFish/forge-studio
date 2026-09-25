# TOC Anchor Rules Skill

## Purpose

Encode mdtoc's GitHub-compatible anchor-slug rules so the dev-loop produces (and
verifies) links that actually resolve. This is the project's half of the demo
contract: a TOC is only "done" when every generated `#anchor` matches the slug
the Markdown host computes for that heading.

## When to use

- Adding or changing heading parsing (`src/headings.ts`).
- Changing slug generation or duplicate-disambiguation (`src/anchor.ts`).
- Adding a new heading shape to the acceptance fixture.

## The rules (must stay in sync with `src/anchor.ts`)

1. **Lowercase** the heading text.
2. **Strip** every character that is not a word character, space, or hyphen
   (drops `,.:;!?()[]{}"'` and similar).
3. **Collapse** runs of whitespace to a single hyphen; collapse runs of hyphens;
   trim leading/trailing hyphens.
4. **Disambiguate duplicates** within one document: the first occurrence of a
   slug is bare, the second gets `-1`, the third `-2`, … (GitHub's rule). This
   requires a *stateful* slugger (`createSlugger()`), never a pure free function.
5. **Skip fenced code** (``` and `~~~`): a `#`-prefixed line inside a fence is
   never a heading.

## Verification workflow

1. Run the unit gate: `npm test` (pins each rule above).
2. Run the acceptance gate: `npm run acceptance` — it runs the BUILT CLI against
   `test/fixtures/release-notes.md` and reads back the exact TOC, including:
   - the non-default sentinel section `Quickstart sentinel-7f3a9c`;
   - the duplicated `Rotate the signing key` heading → `#rotate-the-signing-key`
     and `#rotate-the-signing-key-1`;
   - the fenced `## Fake Heading` correctly absent.
3. If you changed a rule, update BOTH `src/anchor.ts` and the `EXPECTED` constant
   in `test/acceptance/run.ts` in the same change — never weaken the assertion to
   make it pass.
