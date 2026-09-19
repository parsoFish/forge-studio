# Fixture grounds

A fixture ground is a project the story harness provisions for one story run and removes afterwards. Stories
move to fixtures one PR at a time, not all at once — each story's own `ground` declaration says which it uses
TODAY: `ground.fixture` for a fixture, its absence for a real project. S2 creates its own project through the
product rather than starting from either. Real projects (gitpulse, GitWeave, terraform-provider-betterado,
trafficGame) are reserved for the real-ground gates, the capstones and the stranger run.

## Lifecycle of one run

1. The story declares `ground: { project: 'story-<id>', fixture: '<name>', … }`. The project id must be in the
   story's own `story-<id>` namespace, so the leading and trailing sweeps already own it.
2. After the leading sweep, the runner copies `tests/stories/grounds/<name>/seed/` to `projects/story-<id>`,
   makes it its own git repository with one deterministic commit, and refuses unless the copy's method-C digest
   equals the seed's. The seed is the pin; no `FORGE_GROUND_PIN` is needed.
3. Every real ground (`projects/*` outside the `story-` namespace, in every worktree) is hashed before the beats
   and again after them. Any change reds the run: a fixture run must never move a real ground.
4. The fixture's own drift is judged exactly as a real ground's is (produced, declared, ignored-born,
   undeclared), and only then is `projects/story-<id>` torn down.

## Adding a fixture

- Seed it from a real project's files at a named commit. Never hand-invent content.
- Write `PROVENANCE.md` beside `seed/`: the source and commit, the file list, every deviation with its reason,
  the traits the fixture carries and the learning each one encodes, and the stories it serves.
- A fixture is frozen on purpose. A story's premise checked against its seed stays true, because nothing moves
  the seed except a reviewed change to this directory.
