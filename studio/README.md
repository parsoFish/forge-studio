# `studio/` — Studio definitions (Scope 2: cycles / agents / flows)

> **Scope 2 — content, not code.** The Studio object definitions as **data**: flows,
> agents, the catalog, KBs, and project starters. The Scope-1 flow engine interprets
> them. **Rule: never assume a particular managed project.** Validated by
> `forge studio lint`.

Contents: `flows/` (the `forge-architect` / `forge-develop` / `forge-reflect` DAGs),
`catalog.yaml` (SDKs / models / tools / MCPs / hooks / community skills), `kb/`,
`starters/`.

## Three things called "studio" — don't confuse them

| Location | Scope | What it is |
|---|---|---|
| **`studio/`** (here) | 2 | The **definitions** as data. |
| [`orchestrator/studio/`](../orchestrator/studio/) | 1 | The Studio **engine** code that loads / lints / runs them. |
| [`forge-ui/`](../forge-ui/) | 1 | **Forge Studio** — the Next.js operator UI (`forge studio`). |

See [docs/repo-map.md](../docs/repo-map.md) for the full three-scope map.
