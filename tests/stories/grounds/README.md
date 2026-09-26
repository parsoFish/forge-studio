# Fixture grounds

A fixture ground is a project the story harness provisions for one story run and removes afterwards. Each story's
own `ground` declaration says which kind it stands on: `ground.fixture` for a fixture, its absence for a real project.

Today one story runs on a fixture: S8, on `node-library`. The rest still stand on real projects — S1 on gitweave, S3
on terraform-provider-betterado, S4 and S10 on gitpulse, and S5–S7, S9, smoke, proof and ignored-born on the tracked
`projects/mdtoc`. S2 creates its own `story-s2` project through the product rather than starting from either. Stories
move to fixtures one PR at a time (bead `forge-1rk5.1`).

## Lifecycle of one run

1. The story declares `ground: { project: 'story-<id>', fixture: '<name>', … }`. The project id must be in the
   story's own `story-<id>` namespace, so the leading and trailing sweeps already own it.
2. After the leading sweep, the runner copies `tests/stories/grounds/<name>/seed/` to `projects/story-<id>`,
   makes it its own git repository with one commit, and refuses unless the copy's method-C digest equals the
   seed's. The commit's sha depends only on the seed's files, the fixture name and a frozen author, committer and
   date, so every story that provisions the same seed gets the same sha. The seed is the pin; no
   `FORGE_GROUND_PIN` is needed. A seed may hold only regular files and directories, and no `.git` entry.
3. Every real ground (`projects/*` outside the `story-` namespace, in this tree and every other worktree of the
   repository) is hashed before the beats and again after them. A ground that changed, appeared or vanished reds
   the run, and so does one that could not be hashed. A worktree added or removed while the run was in progress is
   named on its own line and not judged: its grounds came or went with the worktree, not with this run.
4. The fixture's own drift is judged exactly as a real ground's is (produced, declared, ignored-born,
   undeclared), and only then is `projects/story-<id>` torn down.

## Adding a fixture

- Seed it from a real project's files at a named commit. Never hand-invent content.
- Write `PROVENANCE.md` beside `seed/`: the source and commit, the file list, every deviation with its reason,
  the traits the fixture carries and the learning each one encodes, and the stories it serves.
- A fixture is frozen on purpose. A story's premise checked against its seed stays true, because nothing moves
  the seed except a reviewed change to this directory.

## Out of story scope

ADRs and brain themes named here were reviewed and judged not to need a story's `aligns` entry — named with a
one-line reason so `node scripts/stories/alignment.mjs --intake <since-sha>` stops reporting them as unaligned.

(none yet)

## Alignment authoring targets

ADRs and brain themes a story SHOULD cite in its `<id>.aligns.json` sidecar but does not yet — tracked here so
`node scripts/stories/alignment.mjs --intake <since-sha>` keeps naming them (report-only) until a sidecar picks
them up, at which point this list drops them.

- `docs/decisions/033-studio-first-flow-ux.md` — S1/S2's install-to-first-flow subject, uncited.
- `docs/decisions/031-studio-consolidation.md` — Studio as the sole operator surface, every story's premise.
- `docs/decisions/051-change-class-and-typed-acceptance-criteria.md` and `brain/forge-dev/themes/class-blind-gates.md` — S1–S3's readiness clauses assert no change-class gate.
- `docs/decisions/012-crash-recovery.md` — S10 beat 7's claim race is adjacent; no crash path is exercised.
- `brain/forge-dev/themes/agent-authored-gates-are-self-grading.md` — S7/S8's scan-then-trust shape.
- `docs/decisions/029-runtime-adapters.md` — S9 beat 5's per-session SDK/effort control.
