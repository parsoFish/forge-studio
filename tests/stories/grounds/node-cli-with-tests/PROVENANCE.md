# Fixture ground `node-cli-with-tests`

**Shape.** A small, dependency-free TypeScript command-line tool with a forge contract already in
place: `.forge/project.json`, one project skill resolved from `.forge/skills/`, an offline unit
suite and a separate acceptance runner that exercises the built CLI against a deterministic temp
git repo. S4 (create a new flow) needs a project with real commit history and a real test suite to
plan a genuine test-coverage change against; it does not need that project to change.

**Source.** `projects/gitpulse`, `parsoFish/gitpulse`, at `8d853dc9e83ad30edddb7a6fcbfa90b1b1753054`
(plan D3; this SHA was re-pinned by T1 ruling 1460) — extracted with
`git -C projects/gitpulse archive 8d853dc9e83ad30edddb7a6fcbfa90b1b1753054`, tracked files only.
Method-C digest of `seed/`: `0d0dff0bc55c0d07`. No earlier ratified pin exists for this exact SHA
(the campaign's other recorded gitpulse numbers — `3f4d76708ff073b3` at `1f1193a`, `e12d66d463e094eb`
at a later live commit — are different trees), so this digest is the one this fixture stands on.

**Files.** All 100 tracked files of the source, byte-identical, under `seed/` beside this file.
Regenerate the list with:

```
git -C projects/gitpulse archive 8d853dc9e83ad30edddb7a6fcbfa90b1b1753054 | tar -tf -
```

**Deviations from the source.** None. `git archive` of a tracked tree already excludes
`node_modules/`, `dist/`, `coverage/` and every session-scratch directory
(`_architect/`, `_demo/`, `_instructions/`, `_preflight-fix/`, `_project-brain/`) — all of them
untracked or `.gitignore`d at this commit, so none of them was ever in the archive to drop.
`.forge/project.json` and `forge/history/` are both tracked and both carried whole. Two paths the
brief named as things to keep, `.forge/quality_gate_cmd` and `.forge/demo`, do not exist as their
own files at this SHA: the quality-gate command (`npm test`) lives in `.forge/project.json`'s
`testProcess.local.cmd`, and the demo shape (`cli-diff`, `npm run demo`) lives in the same file's
`demo` block. Both are carried because `.forge/project.json` is carried whole.

**Quality gate, checked before freezing.** `testProcess.local.cmd` is `["npm", "test"]`, which
`package.json` resolves to `node --import tsx --test test/unit.test.ts`. Run inside a temp copy of
`seed/` (`npm ci --no-audit --no-fund && npm test`): 16/16 passed, exit 0. The seed is a green
ground.

**Traits carried, and the learning each encodes.**

- S4's IDEA premise — test coverage for `--compare` combined with `--since`, so the two window
  filters are proven to work together rather than only apart — is FROZEN by the fixture. Checked
  directly against the pinned tree: every existing test that combines a window flag with `--compare`
  uses `--since-tag`, never plain `--since` (`test/cli-tag-range.test.ts`, `test/acceptance/run.ts`);
  no test runs `--since` and `--compare` together. The premise holds at `8d853dc9`, and holds
  permanently now that the ground stops moving — closing the "story aged out of its premise" class,
  §15.205, for this idea. (The brief's own illustrative example of an aged-out premise, `--exclude-author`,
  also does not exist in this tree — checked with `git grep -i exclude-author 8d853dc9`, no hits — so
  freezing here does not silently resolve that one either; it is not, in fact, what this story's live
  IDEA constant tests. See the session report for that discrepancy.)
- A committed contract with a project skill at `.forge/skills/git-log-analysis/SKILL.md` that
  resolves `ok` — the same "one live binding" shape `node-library` and S3's real ground both carry.
- Zero runtime dependencies (`tsx`/`typescript` are the only dev deps), a real `.git` history of
  merged initiatives under `forge/history/`, and a separate acceptance tier — this is a materially
  bigger, more real project than `node-library`, which is what S4's flow (an architect planning
  against an evolving CLI) needs and `node-library` does not offer.
- `.gitignore` rules `dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`, and the session-kind
  dirs `_architect/`, `_demo/`, `_instructions/`, `_preflight-fix/`, `_project-brain/` — S4's own
  architect session (minted at `story-s4/_architect/<sessionId>/`) lands inside an ignored path, so
  it is classified as ignored-born rather than a containment failure, the same rule `node-library`
  already exercises (bead `forge-8vfn.7.6.52`).
- Provisioned as its OWN git repository (the harness runs `git init` on the copy). Its source is a
  plain directory inside this repo, where `git -C projects/gitpulse status` walks up and reports the
  forge worktree — a dirty ground read clean. A provisioned fixture answers for itself.

**Stories served.** S4.
