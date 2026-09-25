# gitpulse — roadmap (forge↔project contract C4)

> Machine-readable planning input. A focused, multi-feature roadmap the architect
> and PM decompose into work items. Each milestone is a coherent, independently
> shippable slice — not a single WI.

## North star

A fast, dependency-free CLI + local dashboard that turns any git repo's history
into honest, demonstrable engineering analytics — commit, churn, ownership, and
hotspot insight — proven against deterministic fixtures, runtime deps at zero.

## Current state (v0.1.0 — shipped)

- Git-history reading (`src/git.ts`: `readCommits` via `git -C <repo> log
  --no-merges --numstat`), pure aggregation (`src/stats.ts`: `summarize` →
  totals + per-author + date range), deterministic text rendering
  (`src/format.ts`), and the `gitpulse <repo>` CLI (`src/cli.ts`).
- Unit quality gate (`npm test`, pure) + creds-free acceptance gate
  (`npm run acceptance`) against a deterministic temp fixture repo.

## Milestone 1 — Code churn ✓ (v0.2.0)

Surface how much each file/author *changes*, not just commit counts.

- **Feature 1a** ✓ — per-file churn in a new `src/churn.ts` (pure: `Commit[]` →
  `{ file, insertions, deletions, commits }[]`, descending by total lines).
- **Feature 1b** ✓ — per-author churn (lines added/removed per author) folded into
  the summary + the rendered report.
- **Feature 1c** ✓ — a `--since <date>` / `--until <date>` window so churn (and all
  analytics) can be scoped to a range; validated at the argv boundary.

## Milestone 2 — Ownership & hotspots

- **Feature 2a** — file ownership in `src/ownership.ts` (who authored the most
  lines of each file; the "owner" + the bus-factor count of contributors).
- **Feature 2b** — hotspot detection: files ranked by churn × recency (frequently
  + recently changed) — the change-risk surface.
- **Feature 2c** — `--top <n>` to bound every ranked list (authors, churn,
  hotspots) for large repos.

## Milestone 3 — Local dashboard

- **Feature 3a** — `gitpulse serve <repo>` starts a zero-dependency local HTTP
  server (node:http) rendering the analytics as a single self-contained HTML page
  (inline SVG bar charts; no runtime deps, no external assets).
- **Feature 3b** — a `GET /api/summary` JSON endpoint behind the page (so the
  acceptance gate can read back the dashboard's analytics over HTTP — the local
  "live evidence").
- **Feature 3c** — author/file drill-down routes on the dashboard.

## Milestone 4 — Reporting & export

- **Feature 4a** — `gitpulse report <repo> --format json|html|md` writes a
  shareable analytics report to a file.
- **Feature 4b** ✓ — a `--compare <ref>` mode: analytics delta between two git refs
  (what changed between two releases).
- **Feature 4c** ✓ — `--exclude <glob>` flag (repeatable) to filter vendored/generated
  paths from analytics output. Supports `*` (single segment) and `**` (any depth)
  wildcards. Filtered path count shown as `(N paths excluded)` in the text header
  and as `excluded` in JSON output.
- **Feature 4d** ✓ [shipped] — `--author <pattern>` flag (repeatable, OR'd) to filter
  commits by author name or email using `*`-wildcard glob patterns (case-insensitive).
  Zero-match is a valid result (not an error). Text header carries `(N commits excluded
  by author filter)` annotation; JSON output gains top-level `authorsFiltered: N` field.
  Composes with `--no-merges`, `--since`, `--until`, `--exclude`, `--sort`, and
  all subcommands.

## Non-goals

- Any runtime dependency: node builtins only (tsx/typescript stay dev-only).
- A hosted/multi-user service, auth, or a database — gitpulse reads a local repo.
- Rewriting git history or mutating the analysed repo (read-only always).
- Language-aware static analysis (it analyses git metadata, not source ASTs).
