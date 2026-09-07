# Tutorials

Tutorials are the **learning-oriented** quadrant: a tutorial takes an operator
who has never met a flow before through it end to end, beat by beat, until
they have done the thing once with their own hands. It teaches by doing, not
by explaining — for why forge is built the way it is, see
[`../explanation/`](../explanation/); for a recipe aimed at someone who
already knows the ground, see [`../how-to/`](../how-to/README.md).

## Getting started (hand-written)

| Page | What it covers |
|---|---|
| [Getting started](./getting-started.md) | Install to first merged PR: bring a project under forge, preflight it, author or reuse a flow, kick off the architect, review and merge. |

## Generated from the operator stories

Every other page in this directory is **generated** by the story runner —
`npm run stories -- --story <id>` — from the story of the same name in
[`tests/stories/`](../../tests/stories). Do not hand-edit them: edit the story
and re-run it.

That is the point of the story harness ([`../roadmaps/1.0.md`](../roadmaps/1.0.md) §3):
one script yields the end-to-end verdict, the demo clip and frames, and this
usage documentation, so the tests, the demos and the docs cannot drift apart.
A page here describes a flow that was executed and asserted, beat by beat, on
the run that wrote it — and when a story does not pass, its page says so at the
top rather than presenting a broken flow as working usage. A story whose
`docs.kind` is `how-to` writes to [`../how-to/`](../how-to/README.md) instead.

| Page | Story | Title |
|---|---|---|
| [S1.md](./S1.md) | S1 | Onboard an existing project |
| [S2.md](./S2.md) | S2 | Create a new project from scratch |
| [S4.md](./S4.md) | S4 | Create a new flow |
