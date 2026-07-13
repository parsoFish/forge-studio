# `forge-ui/` — Forge Studio, the operator UI (Scope 1: framework)

> **Scope 1 — the hot path.** The Next.js operator UI launched by `forge studio` — the
> **sole operator surface** ([ADR 031](../docs/decisions/031-studio-consolidation.md)).
> Every load-bearing state is mirrored to `data-*` attributes (DOM-as-metrics) so
> automation can drive the page by reading structured state. It talks to the
> orchestrator **only** through the bridge (`cli/bridge-studio.ts`) — it never imports
> orchestrator internals directly.

Run it via `forge studio` (fixed ports: bridge 4123, UI 4124). The `data-*` convention
is documented in [CLAUDE.md](../CLAUDE.md).

## Three things called "studio" — don't confuse them

| Location | Scope | What it is |
|---|---|---|
| [`studio/`](../studio/) | 2 | The **definitions** as data. |
| [`orchestrator/studio/`](../orchestrator/studio/) | 1 | The Studio **engine** code. |
| **`forge-ui/`** (here) | 1 | **Forge Studio** — the operator UI. |

See [docs/repo-map.md](../docs/repo-map.md).
