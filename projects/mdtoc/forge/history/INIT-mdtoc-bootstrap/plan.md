# INIT-mdtoc-bootstrap — plan

> Development-history record (forge↔project contract). Each initiative leaves a
> browsable `plan.md` + `demo/` + `verdict.json` under
> `forge/history/<initiative-id>/`.

## Brief

Bootstrap `mdtoc`: a dependency-light TypeScript CLI that generates a
GitHub-compatible Markdown table of contents from a document's headings, and
serve as forge's out-of-the-box, creds-free reference project.

## Approach

1. **Heading extraction** (`src/headings.ts`) — parse ATX headings, skip fenced
   code blocks, return frozen records.
2. **Anchor slugs** (`src/anchor.ts`) — GitHub-style slug + stateful duplicate
   disambiguation (`createSlugger`).
3. **TOC render** (`src/toc.ts`) — compose the above into a nested list with a
   `--min`/`--max` level window, re-based to the shallowest kept heading.
4. **CLI** (`src/cli.ts`) — pure `runCli(argv, io)` core (IO injected for
   testing) + a thin `main` wrapper; argv validated at the boundary.
5. **Gates** — `npm test` (unit quality gate) + `npm run acceptance` (runs the
   BUILT CLI against `test/fixtures/release-notes.md` and reads back the exact
   TOC, with a non-default sentinel section + a duplicate heading).

## Acceptance criteria

- `npm test` green: every src module unit-pinned (headings, anchor, toc, cli).
- `npm run acceptance` green: the built CLI's TOC for the fixture matches the
  expected output exactly (sentinel section present, `#rotate-the-signing-key-1`
  present, fenced `## Fake Heading` absent).
- `forge preflight mdtoc` passes its HARD clauses (C1/C2/C4).

## Demo

`npm run demo` runs the acceptance driver and writes the captured TOC + read-back
result to `demo/toc-capture.md` in this directory.
