# mdtoc — roadmap (forge↔project contract C4)

> Machine-readable planning input. A focused, multi-feature roadmap the architect
> and PM decompose into work items. Each milestone is a coherent, independently
> shippable slice — not a single WI.

## North star

A tiny, dependency-free CLI that turns any Markdown document's headings into a
correct, GitHub-compatible table of contents — fast, deterministic, demonstrable
against a local fixture.

## Current state (v0.1.0 — shipped)

- Heading extraction (`src/headings.ts`), anchor slugs with dedupe (`src/anchor.ts`),
  TOC rendering with a level window (`src/toc.ts`), and the `mdtoc` CLI (`src/cli.ts`).
- Unit quality gate + creds-free acceptance gate against a non-default fixture.

## Milestone 1 — In-place TOC injection

Let `mdtoc --write <file>` insert (or refresh) the generated TOC between
`<!-- toc -->` / `<!-- /toc -->` marker comments, idempotently.

- **Feature 1a** — marker detection + slice replacement in a new `src/inject.ts`
  (pure: doc string + toc string → new doc string).
- **Feature 1b** — wire `--write` into the CLI; round-trip acceptance: inject,
  re-run, assert no diff (idempotency read-back).
- **Feature 1c** — `--check` mode that exits non-zero when the embedded TOC is
  stale (for use in CI), without writing.

## Milestone 2 — Anchor fidelity & link styles

- **Feature 2a** — emoji/unicode-aware slugging that matches GitHub's algorithm
  for non-ASCII headings.
- **Feature 2b** — `--links github|gitlab|plain` so anchors match the host's
  slug rules.
- **Feature 2c** — optional numbered lists (`--numbered`) instead of bullets.

## Milestone 3 — Multi-file & front-matter

- **Feature 3a** — skip YAML front-matter when counting headings.
- **Feature 3b** — `mdtoc <dir>` to generate a combined cross-file index with
  relative links.

## Non-goals

- Rendering Markdown to HTML (out of scope — this tool only reads headings).
- A long-running server or watch mode.
- Any runtime dependency: node builtins only.
