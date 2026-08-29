# How-to guides

Every page in this directory is **generated** by the story runner —
`npm run stories -- --story <id>` — from the story of the same name in
[`tests/stories/`](../../tests/stories). Do not hand-edit them: edit the story
and re-run it.

That is the point of the story harness ([`../roadmaps/1.0.md`](../roadmaps/1.0.md) §3):
one script yields the end-to-end verdict, the demo clip and frames, and this
usage documentation, so the tests, the demos and the docs cannot drift apart.
A page here describes a flow that was executed and asserted, beat by beat, on
the run that wrote it — and when a story does not pass, its page says so at the
top rather than presenting a broken flow as working usage.

A story whose `docs.kind` is `tutorial` writes to `docs/tutorials/` instead;
that directory appears when the first tutorial story lands.
