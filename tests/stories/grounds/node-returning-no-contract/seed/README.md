# gitpulse

A dependency-light TypeScript CLI that prints commit-stats analytics for a git
repository. Zero runtime dependencies — node builtins only.

## Install

```bash
npm install      # installs the dev toolchain (tsx + typescript)
npm run build    # compiles src/ → dist/ (the CLI binary)
```

## Usage

```bash
gitpulse [repo-path] [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--top N]
gitpulse --help        # show usage
```

Run it against any git work tree. A path that is not a git repository fails fast
with a non-zero exit and a clear message. For full flag reference and examples, see [docs/usage.md](docs/usage.md).

### Options

| Flag | Description |
|------|-------------|
| `--since YYYY-MM-DD` | Only include commits on or after this date (inclusive). |
| `--until YYYY-MM-DD` | Only include commits on or before this date (inclusive). |
| `--top N` | Cap every ranked list (authors, churn, files, ownership, hotspots) to the top `N` entries. Must be an integer ≥ 1. |
| `--compare <ref>` | Compare HEAD analytics to a base git ref (tag, branch, or SHA). Renders a signed delta report showing what changed since that ref. |
| `--include <glob>` | Include **only** file paths matching a glob pattern in all analytics output. Repeatable — multiple `--include` flags are OR'd together (a file matching **any** pattern is kept). Applied before `--exclude`. Passing `--include '**'` is a no-op: output is byte-identical to running without `--include`. When at least one path is filtered out the text report header is annotated with `(N paths excluded by include filter)`; JSON output gains a top-level `includeFiltered: N` field. An empty pattern (`--include ''`) exits 2 with `--include requires a non-empty pattern` on stderr. |
| `--exclude <glob>` | Exclude file paths matching a glob pattern from all analytics output. Repeatable — pass multiple `--exclude` flags to exclude multiple patterns. Supported wildcards: `*` (single path segment) and `**` (any depth). Excluded path count shown as `(N paths excluded)` in the text header; JSON output gains a top-level `excluded: N` field. |
| `--json` | Output analytics (or delta when combined with `--compare`) as JSON instead of a table. |
| `--csv` | Output analytics as RFC-4180 CSV. Mutually exclusive with `--json` and `--markdown`. |
| `--markdown` | Output analytics as GitHub-Flavoured Markdown (GFM) tables instead of the default plain-text table. Works with all table-producing commands: `gitpulse <repo> --markdown`, `gitpulse <repo> --compare <ref> --markdown`, `gitpulse <repo> tags --markdown`, `gitpulse <repo> coupling --markdown`. The output starts directly with the GFM table header row — `output.split('\n')[1]` is always a delimiter row (`\| --- \|`). File paths or author names containing literal `\|` characters are escaped as `\\\|` so the table remains valid. Mutually exclusive with `--json` and `--csv` (exits 1 with a descriptive error if combined). |
| `--no-merges` | Exclude merge commits (commits with more than one parent) from all analytics pipelines. When active, the text report header is annotated with `(N merge commits excluded)`; JSON output gains a top-level `mergesExcluded` field. Composes with `--since`, `--until`, `--exclude`, and `--sort`. |
| `--author <pattern>` | Filter commits by author name or email using a `*`-wildcard glob (case-insensitive). Repeatable — multiple `--author` flags are OR'd together (a commit matching any pattern is included). Zero-match is a valid result (not an error): the report shows `0 commits` and the text header carries a `(N commits excluded by author filter)` annotation; JSON output gains a top-level `authorsFiltered: N` field. Composes with `--no-merges`, `--since`, `--until`, `--exclude`, and `--sort`. Wildcard vocabulary: `*` only (no `**`). |
| `--since-tag <tag>` | Only include commits after the tagged commit (exclusive of the tag commit itself). Resolved by commit topology (uses the underlying commit SHA, not the tag date). Composes with `--until-tag`, `--compare`, `--author`, and all other filters. The `tags` subcommand rejects this flag (exit 2). An unknown tag name exits 2 and lists all known tags newest-first. |
| `--until-tag <tag>` | Only include commits up to and including the tagged commit (inclusive upper boundary). Resolved by commit topology. Composes with `--since-tag` and all other filters. An inverted range (`--since-tag` newer than `--until-tag`) yields zero commits (not an error). An unknown tag name exits 2 and lists all known tags newest-first. |

All flags are optional. Omitting them includes the full commit history and all entries.
An inverted window (`--since` later than `--until`) fails with exit 2.
An unknown `--compare <ref>` fails with exit 2 and a stderr message containing the ref name.

## Example output

```text
gitpulse — 4 commits (2021-03-01 → 2021-03-07)

commits  author
-------  ------
      3  Ada Lovelace
      1  Grace Hopper

churn (lines)  author
-------------  ------
        +3/-0  Ada Lovelace
        +1/-0  Grace Hopper

churn (lines)  file
-------------  ----
        +1/-0  compiler.ts
        +1/-0  engine.ts
        +1/-0  loom.ts
        +1/-0  notes.md

ownership
owner         bus-factor  file
------------  ----------  -----------
Ada Lovelace           1  engine.ts
Grace Hopper           1  compiler.ts

hotspots
 score  commits  last-date   file
------  -------  ----------  -----------
  0.00        1  2021-03-07  loom.ts
  0.00        1  2021-03-04  notes.md
```

The report has five sections:
- **Commit count table** — authors ranked by number of commits, descending.
- **Author churn table** — authors ranked by total lines changed (`+insertions/-deletions`), descending.
- **File churn table** — files ranked by total lines changed (`+insertions/-deletions`), descending; ties broken by file path ascending.
- **Ownership table** — per-file ownership: the author with the most surviving lines (`git blame`) and the bus-factor (distinct authors with ≥1 surviving line). Omitted when ownership data is unavailable.
- **Hotspots table** — per-file hotspot score (`commits / (daysSince + 1)`), sorted by score descending. Files touched recently score higher. Omitted when there are no commits.

### `--top N` example

```bash
gitpulse /path/to/repo --top 2
```

Shows only the top 2 entries in every ranked list. Useful for focusing on the
most active authors/files in large repositories.

### Windowed example

```bash
gitpulse /path/to/repo --since 2021-03-02 --until 2021-03-07
```

Restricts all analytics (counts, churn, date range) to commits whose author
date falls within the window.

### `--compare <ref>` example

```bash
gitpulse /path/to/repo --compare v1.0.0
```

Shows a signed delta report comparing HEAD analytics to the `v1.0.0` tag:
how many commits, lines added, and lines removed have been made since that
ref, with a per-author breakdown. Use `--json` to get the delta as structured
JSON with a top-level `delta` key containing `commits`, `linesAdded`, and
`linesRemoved` fields.

```bash
gitpulse /path/to/repo --compare v1.0.0 --json
```

Exits non-zero (code 2) if the ref does not exist; stderr contains the unknown ref name.

### Including only specific paths

```bash
gitpulse <repo> --include 'src/**'
```

Use `--include <glob>` to restrict analytics to file paths that match at least one
of the given patterns (OR-semantics). Files that do not match any pattern are
silently dropped from all analytics sections (file churn, ownership, hotspots,
author commit counts). Commits whose every file is dropped are removed entirely
from the commit count.

The flag is **repeatable**: pass multiple `--include` flags to widen the set of
included paths (OR'd together):

```bash
gitpulse <repo> --include 'src/**' --include 'lib/**'
```

**Composition with `--exclude`:**
`--include` runs first; `--exclude` then narrows the surviving set:

```bash
# Only count src/ files, excluding test files:
gitpulse <repo> --include 'src/**' --exclude '**/*.test.ts'
```

**Byte-identical invariant:** `--include '**'` matches every path and produces
output byte-identical to running without `--include`.

When at least one path is filtered out, the text report header is annotated with
`(N paths excluded by include filter)`:

```text
gitpulse — 3 commits (2023-01-15 → 2023-05-12) (3 paths excluded by include filter)
```

With `--json`, the output gains a top-level `includeFiltered: N` field.

An empty pattern is rejected: `--include ''` exits 2 with
`--include requires a non-empty pattern` on stderr.

### Excluding paths

```bash
gitpulse /path/to/repo --exclude 'dist/**' --exclude '*.lock'
```

Use `--exclude <glob>` (repeatable) to strip vendored, generated, or lock files
from all analytics sections (file churn, ownership, hotspots). Author totals
reflect only the non-excluded files.

**Supported wildcards:**
- `*` — matches any characters within a single path segment (e.g. `*.lock` matches `vendor.lock` but not `dir/vendor.lock`).
- `**` — matches any characters across any number of path segments (e.g. `dist/**` matches `dist/bundle.js` and `dist/sub/main.js`).

When at least one pattern is active, the text report header is annotated with
`(N paths excluded)` showing how many distinct file paths were filtered:

```text
gitpulse — 8 commits (2021-03-01 → 2021-04-11) (2 paths excluded)
```

With `--json`, the output gains a top-level `excluded` field:

```bash
gitpulse /path/to/repo --json --exclude 'dist/**' --exclude '*.lock'
```

```json
{
  "totalCommits": 8,
  "excluded": 2,
  "fileChurn": [...]
}
```

## Develop

```bash
npm test          # the quality gate — fast unit suite (node:test), < 1s
npm run acceptance # builds if needed, runs the BUILT CLI vs a temp fixture repo
npm run demo       # acceptance + writes captured evidence to demo/pulse-capture.md
```

## License

AGPL-3.0.
