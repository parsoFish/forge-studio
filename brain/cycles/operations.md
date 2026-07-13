# Forge — Operations

> Category index. Lists theme pages describing **how to run, monitor, recover, and maintain forge** — operational know-how that compounds across cycles.

`brain-lint` ensures every theme page with `category: operation` appears here exactly once.

## Theme pages

- [`theme-page-format`](./themes/theme-page-format.md) — 15-40 line markdown file with mandatory frontmatter, ≥1 source link, ≤60 lines (warn) / 100 (error).
- [`health-check-protocol`](./themes/health-check-protocol.md) — Post-merge test discovery + worktree-isolated execution; halts the merge train on failure.
- [`forge-never-self-modifies`](./themes/forge-never-self-modifies.md) — Reflection outputs recommendations; humans implement forge changes in a separate session after `forge serve` is stopped.
- [`audit-live-state-not-captured-snapshot`](./themes/audit-live-state-not-captured-snapshot.md) — Forge's captured artifacts (local clones, reflection archives, retro cost figures) go stale silently; any audit must re-derive facts from the live source of truth (origin, current _queue/done, raw events.jsonl).

## Operational entry points

- `forge serve` — start the unattended scheduler.
- `forge enqueue` — drop an initiative into `_queue/pending/`.
- `forge status` — print queue counts and in-flight phase/iteration info.
- `forge bench <phase>` — run a phase's benchmark suite.
- `forge metrics` — cost / iterations / duration aggregations.
- `monitor/tmux.sh` — launch tmux + Obsidian + log tail layout.

## Format

Each entry on this index is one line:

```markdown
- [`<theme-slug>`](./themes/<theme-slug>.md) — one-line hook from the theme page's `description` frontmatter.
```
