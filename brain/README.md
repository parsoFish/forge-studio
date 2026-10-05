# `brain/` — the compounding engineering wiki

> Three scoped knowledge graphs (Karpathy three-layer: raw → themes → indexes).
> `forge brain lint` gates structural integrity; `forge brain index --write`
> regenerates [`INDEX.md`](./INDEX.md).

| Sub-wiki | Scope | What it holds |
|---|---|---|
| [`forge-dev/`](./forge-dev/) | 2 | Brain 1 — forge engineering knowledge |
| [`cycles/`](./cycles/) | 2 | Brain 2 — cross-cycle patterns + `_raw/` archives |
| [`projects/<name>/`](./projects/) | 3 | Brain 3 — per-project themes (forge-owned central, SPEC §4) |

**Who reads what:** planners (architect / project-manager) + the reflector query Brains
2+3; the **dev-loop and reviewer do NOT** read the forge brain (they may consult the
cycle's Brain 3 for supplemental project context). See
SPEC §4.

See [docs/explanation/architecture.md](../docs/explanation/architecture.md).
