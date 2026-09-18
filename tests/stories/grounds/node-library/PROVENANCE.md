# Fixture ground `node-library`

**Shape.** A small, dependency-light TypeScript command-line library with a forge contract already in place:
`.forge/project.json`, one project skill resolved from `.forge/skills/`, a unit suite and an acceptance runner.
The Studio-authoring stories (S5–S9) need a project to anchor sessions, agents, knowledge bases and library
components to; none of them needs that project to change.

**Source.** `projects/mdtoc`, the reference project tracked in this repository, at `parsoFish/forge-studio`
`9db91ef5` — extracted with `git archive 9db91ef5 projects/mdtoc`. Method-C digest of `seed/`:
`bcb1c45a7fe99b04`, equal to the ratified pristine-ground pin of `projects/mdtoc` at that commit.

**Files.** All 19 tracked files of the source, byte-identical:

```text
.forge/project.json                      .gitignore        docs/cli.md          src/anchor.ts
.forge/skills/toc-anchor-rules/SKILL.md  CHANGELOG.md      package-lock.json    src/cli.ts
.github/workflows/release.yml            CLAUDE.md         package.json         src/headings.ts
README.md                                roadmap.md        src/toc.ts           test/acceptance/run.ts
test/fixtures/release-notes.md           test/unit.test.ts tsconfig.json
```

**Deviations from the source.** None.

**Traits carried, and the learning each encodes.**

- A committed contract with a project skill at `.forge/skills/` that resolves `ok` — S3's "one live binding"
  comparison was copied from this ground's live page.
- `.gitignore` rules `dist/`, `coverage/`, `*.tsbuildinfo` — the ground's own toolchain output is classified
  as ignored-born rather than as a containment failure (bead `forge-8vfn.7.6.52`).
- Provisioned as its OWN git repository (the harness runs `git init` on the copy). Its source is a plain
  directory inside this repo, where `git -C projects/mdtoc status` walks up and reports the forge worktree —
  a dirty ground read clean (measured lesson §15.331). A provisioned fixture answers for itself.

**Stories served.** S8 (from PR D1); S5, S6, S7, S9 (from PR D2).
