---
name: brain-graph
description: Structural index over the brain — nodes for themes/profiles/raw sources, edges from related_themes/wikilinks/citations. Sits alongside the narrative wiki (C20 dual-index) and answers cross-file questions keyword grep cannot.
phase: brain
surface: unattended
model: claude-haiku-4-5
---

# Brain — Graph

## Single responsibility

Maintain `brain/graph.json` — the structural index of the brain wiki
(C21 canonical) — and answer structural queries against it.

Sits **alongside** the narrative wiki, not replacing it. Per C20:
- The Karpathy markdown wiki (themes + categories + INDEX.md) holds
  narrative knowledge.
- This graph holds structural relationships (god nodes, bridges,
  surprising cross-file connections).

`brain-query` consults the graph **first** for structural questions
and falls back to keyword scan over themes.

## Inputs

- A subcommand: `update | query | report | install-hook`.
- For `query`: an operation name + arguments (see below).

## Outputs

- `brain/graph.json` — committed, the canonical structural index (C21).
- Append entries to `brain/log.md` when a `update` runs.
- For `query`: JSON to stdout.

## Event-log entries to emit

- `brain-graph.update.start` — with corpus root.
- `brain-graph.update.end` — node + edge counts, generator, elapsed.
- `brain-graph.query` — one event per query with op + result count.
- `brain-graph.stale` — when freshness check fails.

## Benchmark suite

Shared with `brain-query` under [`benchmarks/brain/`](../../benchmarks/brain/).
The three structural questions (`Q19`-`Q21` in `questions.json`)
exercise this skill's contribution: they're answerable from the graph
but not from keyword scan alone.

## The four operations

### `update` — rebuild `brain/graph.json`

```bash
forge brain graph update
```

Walks `brain/` (excludes `_archive/`, dotfiles, render artefacts),
parses every markdown file's frontmatter + body, emits:

- nodes for every theme / profile / category index / raw source
  (excludes `README.md` navigation files)
- edges from:
  - `related_themes:` frontmatter → `related_to`
  - `[[wikilinks]]` in body → `wikilink`
  - markdown `[label](./path.md)` links → `wikilink` or `cites`
    (latter when the link sits under a `## Sources` heading)

Writes `brain/graph.json` matching the `graphifyy` schema (so a
future LLM-backed `npx graphify update brain/` can drop in without
churning consumers). Idempotent — same corpus → same graph.

**Operator escalation:** when an `ANTHROPIC_API_KEY` is set, replace
the deterministic walker with the LLM-backed `npx graphify update brain/
--backend anthropic --all` — same output path, richer semantic edges
(community labels, inferred relations). The forge skill defaults to
the deterministic walker so unattended runs never block on an API key.

### `query` — answer structural questions

```bash
forge brain graph query neighbours <id>             # direct neighbours
forge brain graph query reachable  <id> [hops]      # all reachable within N hops (default 2)
forge brain graph query bridges    <id-a> <id-b>    # nodes that bridge two
forge brain graph query node       <id>             # node detail
```

`<id>` is the relative posix path to a brain markdown file (e.g.
`brain/forge/themes/pr-as-sole-review-window.md`). All operations
return JSON on stdout.

### `report` — render the graph in human-readable form

Generates `brain/GRAPH_REPORT.md` (gitignored per C21) — a list of:

- **God nodes** (highest-degree themes; suggest places where the
  narrative may be over-coupling).
- **Orphans** (themes with no inbound + no outbound edges).
- **Communities** (rough clusters by `category` or by `project`).
- **Bridges** (high-betweenness nodes; suggest cross-cutting concerns).

The deterministic generator produces a coarse community view (by
`category` / `project`); the LLM-backed `graphify report` (when
available) produces Louvain communities.

### `install-hook` — wire freshness check into the lint pipeline

Once `brain-lint` lands as an executable (S1.2 — running in parallel
to S1.4), `brain-graph install-hook` registers a `checkGraphFreshness`
rule with the lint runtime. Until S1.2 lands, the same check is
available via `forge brain graph check`:

```bash
forge brain graph check    # exits 1 if any theme is newer than graph.json
```

## Process

1. **`update`** is the default; idempotent; always emits a node count + edge count summary.
2. **`query`** assumes `brain/graph.json` exists; emits a runner_error JSON object when missing.
3. **`report`** rebuilds the report markdown; never modifies `graph.json`.
4. **Freshness:** every update writes the `generated_at` timestamp into `graph.json`; the file's mtime is what `check` compares against theme mtimes.

## Constraints

- **Additive, not replacing.** The narrative wiki (themes + indexes) is
  the source of truth for *what* the brain knows. The graph is the
  source of truth for *how* the brain's knowledge is connected.
- **Cite, don't paraphrase.** Graph queries return node ids (paths);
  the caller reads the linked theme for the actual content.
- **Deterministic by default.** The structural walker requires zero
  external calls; LLM-backed graphify is an opt-in upgrade for richer
  semantic edges, never a dependency.
- **Idempotent.** Running `update` twice in a row produces the same
  graph file modulo the `generated_at` timestamp.
- **Per C21**, `brain/graph.json` is committed (canonical); render
  artefacts (`brain/graph.html`, `brain/GRAPH_REPORT.md`) are
  gitignored.
- **Render artefacts stay local.** Operators wanting the HTML view run
  `npx graphify export ...` against `brain/graph.json` and view the
  result locally; it does not enter version control.

## Why graphify-the-tool sits underneath this skill

Per the forge discipline of "use a battle-tested tool, don't reinvent
one" (CLAUDE.md "Never re-invent"), [graphifyy](https://github.com/safishamsi/graphify)
(51K★, MIT, YC S26) is the canonical knowledge-graph tool. Its
auto-installable Claude Code skill (`node_modules/graphifyy/src/skills/skill.md`)
is intentionally broader than forge needs — it spans code+docs+papers+
images+video and exposes ~15 operations. Per C22, forge does not adopt
the auto-skill as-is; this hand-authored skill exposes the 4 operations
forge actually uses against the brain, with a deterministic fallback
when no API key is configured. The auto-skill is preserved under
[`skills/graphify-disabled/`](../graphify-disabled/) for comparison
during the next operator review.
