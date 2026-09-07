# How-to guides

How-to guides are the **goal-directed** quadrant: a recipe for an operator who
already knows the domain and wants one specific outcome — no teaching, no
theory, just the steps. For a first-time, learning-oriented walkthrough, see
[`../tutorials/`](../tutorials/README.md); for why forge is built the way it
is, see [`../explanation/`](../explanation/).

Every page in this directory is **generated** by the story runner —
`npm run stories -- --story <id>` — from the story of the same name in
[`tests/stories/`](../../tests/stories). Do not hand-edit them: edit the story
and re-run it. There are no hand-written how-to pages: every recipe forge
ships is proven by a story first.

That is the point of the story harness ([`../roadmaps/1.0.md`](../roadmaps/1.0.md) §3):
one script yields the end-to-end verdict, the demo clip and frames, and this
usage documentation, so the tests, the demos and the docs cannot drift apart.
A page here describes a flow that was executed and asserted, beat by beat, on
the run that wrote it — and when a story does not pass, its page says so at the
top rather than presenting a broken flow as working usage. A story whose
`docs.kind` is `tutorial` writes to [`../tutorials/`](../tutorials/README.md)
instead.

| Page | Story | Title |
|---|---|---|
| [S3.md](./S3.md) | S3 | Reset a project contract |
| [S5.md](./S5.md) | S5 | Create a new agent |
| [S6.md](./S6.md) | S6 | Create a new knowledge base |
| [S7.md](./S7.md) | S7 | Create library components |
| [S8.md](./S8.md) | S8 | Install library components from the community |
| [S9.md](./S9.md) | S9 | Drive forge through the assistant |
| [proof.md](./proof.md) | proof | Onboard a project from the Projects pillar |
| [smoke.md](./smoke.md) | smoke | Find a project from Home |
