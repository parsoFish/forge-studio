# Fixture ground `node-library`

**Shape.** A small, dependency-light TypeScript command-line library with a forge contract already in place:
`.forge/project.json`, one project skill resolved from `.forge/skills/`, a unit suite and an acceptance runner.
The Studio-authoring stories (S5–S9) need a project to anchor sessions, agents, knowledge bases and library
components to; none of them needs that project to change.

**Source.** `projects/mdtoc`, the reference project tracked in this repository, at `parsoFish/forge-studio`
`9db91ef5` — extracted with `git archive 9db91ef5 projects/mdtoc`. Method-C digest of `seed/`:
`bcb1c45a7fe99b04`, equal to the ratified pristine-ground pin of `projects/mdtoc` at that commit.

**Files.** All 19 tracked files of the source, byte-identical, under `seed/` beside this file:

```text
seed/.forge/project.json                      seed/.gitignore        seed/docs/cli.md          seed/src/anchor.ts
seed/.forge/skills/toc-anchor-rules/SKILL.md  seed/CHANGELOG.md      seed/package-lock.json    seed/src/cli.ts
seed/.github/workflows/release.yml            seed/CLAUDE.md         seed/package.json         seed/src/headings.ts
seed/README.md                                seed/roadmap.md        seed/src/toc.ts           seed/test/acceptance/run.ts
seed/test/fixtures/release-notes.md           seed/test/unit.test.ts seed/tsconfig.json
```

**Deviations from the source.** None.

**Traits carried, and the learning each encodes.**

- A committed contract with a project skill at `.forge/skills/` that resolves `ok` — S3's "one live binding"
  comparison was copied from this ground's live page.
- `.gitignore` rules `dist/`, `coverage/`, `*.tsbuildinfo` — the ground's own toolchain output is classified
  as ignored-born rather than as a containment failure (bead `forge-8vfn.7.6.52`).
- Provisioned as its OWN git repository (the harness runs `git init` on the copy). Its source is a plain
  directory inside this repo, where `git -C projects/mdtoc status` walks up and reports the forge worktree —
  a dirty ground read clean. A provisioned fixture answers for itself.

**Stories served.** S8. S5, S6, S7 and S9 still stand on `projects/mdtoc` and are planned to move to this fixture.
