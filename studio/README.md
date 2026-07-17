# `studio/` — Studio definitions (Scope 2: cycles / agents / flows)

> **Scope 2 — content, not code.** The Studio object definitions as **data**: flows,
> agents, the catalog, KBs, and project starters. The Scope-1 flow engine interprets
> them. **Rule: never assume a particular managed project.** Validated by
> `forge studio lint`.

Contents: `flows/` (the `forge-architect` / `forge-develop` / `forge-reflect` DAGs),
`catalog.yaml` (SDKs / models / tools / MCPs / hooks / community skills),
`artifact-templates/` (per-artifact-type markdown templates: plan / PR /
verdict / work-items / WI-branches), `demo-elements/` (reusable demo-page
element templates: screenshot / CLI-capture / code-diff / API-verify /
test-evidence / narrative), `demo/` (shared demo-page CSS), `starters/`
(new-project scaffolds: starter agents/flows + `project.json`/release-workflow
examples). *(Corrected 2026-07-17, R5-07-F5 — the prior list named a `kb/`
that doesn't exist and omitted the four directories above.)*

## Three things called "studio" — don't confuse them

| Location | Scope | What it is |
|---|---|---|
| **`studio/`** (here) | 2 | The **definitions** as data. |
| [`orchestrator/studio/`](../orchestrator/studio/) | 1 | The Studio **engine** code that loads / lints / runs them. |
| [`forge-ui/`](../forge-ui/) | 1 | **Forge Studio** — the Next.js operator UI (`forge studio`). |

See [docs/repo-map.md](../docs/repo-map.md) for the full three-scope map.
