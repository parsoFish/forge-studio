---
title: anchor-slug fidelity is the load-bearing correctness surface
description: For a TOC generator the links must resolve; slug drift (host slugging rules) and duplicate-heading disambiguation are the two dominant failure modes, both invisible to a "does it produce a list" test — so the acceptance fixture carries a duplicated heading + a fenced fake heading and the read-back asserts the -1 suffix and the fenced exclusion.
category: pattern
keywords: [anchor, slug, toc, github, heading, slugger, acceptance-fixture, fidelity, read-back]
created_at: 2026-06-19T00:00:00.000Z
updated_at: 2026-06-19T00:00:00.000Z
related_themes: []
---

# Theme: anchor-slug fidelity is the load-bearing correctness surface

## Pattern

For a TOC generator, the *links must resolve*. Two failure modes dominate, and
both are invisible to a "does it produce a list" test:

1. **Slug drift** — the anchor `mdtoc` emits (`#hello-world`) must match the slug
   the Markdown host (GitHub) computes for that heading. Punctuation stripping,
   lowercasing, and space→hyphen collapsing all have to agree. The rules live in
   `src/anchor.ts` (`slugBase`).
2. **Duplicate headings** — two `## Setup` sections produce two `#setup` anchors
   on a naive implementation; the first link works, the second silently jumps to
   the wrong section. GitHub disambiguates with `-1`, `-2`, …; `createSlugger()`
   in `src/anchor.ts` mirrors that, which is why slugging is a *stateful factory*
   rather than a free function.

## Why the acceptance fixture is shaped the way it is

`test/fixtures/release-notes.md` deliberately contains a duplicated
`Rotate the signing key` heading and a fenced `## Fake Heading` code block. The
acceptance read-back (`test/acceptance/run.ts`) asserts the `-1` suffix appears
and the fenced line does NOT — so a regression in either path fails the gate
against the actually-running CLI, not just a unit.

## Implication for planners

Any change touching `src/anchor.ts` or `src/headings.ts` must update the
acceptance expectation in lock-step and keep a non-default sentinel heading in
the fixture (C9). A green unit suite is necessary but not sufficient — the
read-back against the built binary is the real done-signal.
