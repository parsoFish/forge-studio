# `orchestrator/studio/` — Studio engine (Scope 1: framework)

> **Scope 1 — the hot path.** The Studio **engine**: definition loading,
> `forge studio lint`, the object registry, run-model derivation. It interprets the
> Scope-2 definitions in [`studio/`](../../studio/); it must **never** special-case a
> project or a specific cycle-agent.

## Three things called "studio" — don't confuse them

| Location | Scope | What it is |
|---|---|---|
| [`studio/`](../../studio/) | 2 | The **definitions** as data (flows / agents / catalog / KBs). |
| **`orchestrator/studio/`** (here) | 1 | The Studio **engine** code. |
| [`forge-ui/`](../../forge-ui/) | 1 | **Forge Studio** — the Next.js operator UI. |

See [docs/repo-map.md](../../docs/repo-map.md).
