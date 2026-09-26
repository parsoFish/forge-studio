# gitpulse — project brain (Brain 3 profile)

> The project's knowledge base, read by planners and reflectors through the
> `KbBackend` seam. Forge-owned + CENTRAL (ADR-035) at `brain/projects/gitpulse/`
> — NOT in the managed project's repo.

## What this project is

`gitpulse` is a dependency-free TypeScript CLI (and, by milestone 3, a local
HTTP dashboard) that turns any git repo's history into honest engineering
analytics — commit/churn/ownership/hotspot insight. It is a forge showcase /
reference project: creds-free, self-contained, with an observable local surface
(run the CLI or the dashboard against a real repo, see real analytics) so demos
are visual evidence rather than test-name tables.

## Architecture

A git-truth seam + pure analytics modules + thin shells:

- `src/git.ts` — `readCommits(repoPath)` shells `git -C <repo> log --no-merges
  --numstat --date=short --format=…` (execFileSync), validates the repo with
  `git rev-parse`, and parses into immutable `Commit` records. The ONLY place
  git is spawned. Binary files (`-` numstat) count as a touched file with 0
  added/removed.
- `src/stats.ts` — `summarize(commits)` → pure `Summary` (totals, per-author
  descending with name tie-break, date range). No I/O — the unit-tested core.
- `src/format.ts` — `renderSummary(summary)` → deterministic plain-text report.
- `src/cli.ts` — argv boundary → read → summarize → render → stdout; `--help`;
  fail-fast on a non-repo path.

Successor analytics (churn, ownership, hotspots, dashboard, export) follow the
same shape: a pure module over `Commit[]`, read back through the built artifact.

## Conventions (load-bearing)

- **Zero runtime dependencies** — node builtins only (the dashboard uses
  `node:http` + inline SVG). `tsx`/`typescript` are the only dev deps.
- **One git-truth seam** (`src/git.ts`); **pure, unit-tested aggregation**.
- **Read-back acceptance** against a deterministic temp fixture repo (fixed
  `GIT_AUTHOR_DATE` + author names + sentinel files) — assert the BUILT
  artifact's output, non-default sentinels (C9).
- **Read-only** on analysed repos; **never edit a test to pass**.
- Deterministic ordering + tie-breaks so reports + demos are reproducible.

## Current state

v0.1.0 shipped: commit-stats summary (`gitpulse <repo>`) — totals, per-author,
date range — with the unit + acceptance gates green. The roadmap (`roadmap.md`)
adds churn (M1), ownership/hotspots (M2), a local dashboard (M3), and export (M4).
