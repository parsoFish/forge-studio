# mdtoc — project brain (Brain 3 profile)

> The project's knowledge base, read by planners and reflectors through the
> `KbBackend` seam. Lives inside the project repo at `forge/brain/`
> (`artifactRoot: "forge"`).

## What this project is

`mdtoc` is a small, dependency-light TypeScript CLI that generates a GitHub-style
Markdown table of contents from a document's headings. It is forge's
out-of-the-box reference / showcase project: creds-free, self-contained, with an
observable local surface (run the CLI against a fixture, see the real TOC).

## Architecture

The pipeline is four pure modules plus a thin CLI shell:

- `src/headings.ts` — `extractHeadings(markdown)` → ordered frozen `Heading[]`.
  Skips fenced code blocks so a `# x` inside ``` is not a heading.
- `src/anchor.ts` — `slugBase(text)` + `createSlugger()` (stateful, to
  disambiguate duplicate headings with `-1`, `-2`, …).
- `src/toc.ts` — `renderToc(markdown, options)` composes the above into the
  nested list, filtered by a `--min`/`--max` level window, re-based to the
  shallowest kept heading.
- `src/cli.ts` — `runCli(argv, io)` is the pure core (IO injected for testing);
  `main` wires it to the real process. Argv is validated at the boundary,
  failing fast with a non-zero code.

## Toolchain

- Node 22 + `tsx` for running TS directly; `tsc` to build `dist/`.
- Tests: `node:test` + `node:assert/strict`. No test runner dependency.
- Quality gate: `npm test` (sub-second). Acceptance: `npm run acceptance`
  (runs the built CLI vs `test/fixtures/release-notes.md`).

## How a change is demonstrated

The demo is the acceptance gate run against the fixture: capture the real TOC the
built CLI prints, then read it back against the expected output (including the
`sentinel-7f3a9c` section and the duplicate-anchor `-1` suffix). Evidence is
written to `forge/history/<initiative-id>/demo/` for the PR.

## Conventions

- Immutable returns (frozen arrays/records); no input mutation.
- Files small + feature-organised; runtime deps stay at zero.
- Fixtures use non-default values (C9) so the read-back is discriminating.
