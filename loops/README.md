# `loops/` — retired directory

> **Scope 1 — framework** ([repo map](../docs/repo-map.md)). Until M4 this directory held the
> agentic loop runtimes and the runtime-adapter seam. Both now live in
> [`packages/agents/`](../packages/agents/) — the adapter registry is
> `packages/agents/_adapters/registry.ts`, the conformance suite
> `packages/agents/_adapters/conformance.ts`, and the SDK wrapper sits beside them.

There is no code here. The directory remains only because four spawn-site locks in the
test suite enumerate the directories they scan by name and still list `loops` — removing
the directory makes their `scandir` throw (by design: a missing scan root fails loud, not
vacuous). Dropping `loops` from that list and deleting this directory is bead `forge-8vfn.25`
(agents-owned, M5-A). Until then, nothing may be added here.
