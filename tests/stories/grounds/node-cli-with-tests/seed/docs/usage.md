# gitpulse — CLI Flag Reference

`gitpulse` turns a git repository's history into commit-stats analytics.
This guide covers every flag in `--help` order, tracing each claim against
`src/cli.ts`.

```
gitpulse [repo-path] [flags]
gitpulse tags [repo-path] [flags]
gitpulse coupling [repo-path] [flags]
```

`repo-path` defaults to `.` (the current directory).

---

## `-h, --help`

Show the usage message and exit with code 0.

| Detail | Value |
|---|---|
| Accepted values | *(flag only)* |
| Default | off |
| Output stream | **stderr** (not stdout) |

> **Note:** `--help` output is written to **stderr**, not stdout. Piping
> `gitpulse --help` to a pager or `grep` requires redirecting stderr:
>
> ```sh
> gitpulse --help 2>&1 | grep sort
> ```

**Example:**

```sh
gitpulse --help
# Prints usage to stderr; stdout is empty.
```

---

## `--json`

Output the summary as JSON instead of the default text table.

| Detail | Value |
|---|---|
| Accepted values | *(flag only)* |
| Default | off — text table |
| Mutually exclusive with | `--csv`, `--markdown` |

**Example:**

```sh
gitpulse /path/to/repo --json
# {"totalCommits": 42, "byAuthor": [...], ...}
```

---

## `--csv`

Output the summary as RFC-4180 CSV instead of the default text table.

| Detail | Value |
|---|---|
| Accepted values | *(flag only)* |
| Default | off — text table |
| Mutually exclusive with | `--json`, `--markdown` |

**Example:**

```sh
gitpulse /path/to/repo --csv
# Author,Commits,Insertions,Deletions
# Alice,12,340,80
```

---

## `--markdown`

Output the summary as a GitHub-Flavoured Markdown (GFM) table instead of the
default text table.

| Detail | Value |
|---|---|
| Accepted values | *(flag only)* |
| Default | off — text table |
| Mutually exclusive with | `--json`, `--csv` |

Output begins directly with the GFM table header row; the second output line is
always a delimiter row (`| --- |`).

> **Known limitation — range annotation absent from markdown output:**
> When `--since-tag` or `--until-tag` is combined with `--markdown`, the range
> annotation (e.g. `(range v1.0..v2.0)`) that appears in text and CSV output is
> **absent** from the markdown output. This is because `renderSummaryMarkdown`
> receives but does not use the `tagRange` option (`_opts` parameter).

**Example:**

```sh
gitpulse /path/to/repo --markdown
# | Author | Commits | Insertions | Deletions |
# | --- | --- | --- | --- |
# | Alice | 12 | 340 | 80 |
```

---

## `--since <YYYY-MM-DD>`

Include only commits **on or after** the given date (inclusive).

| Detail | Value |
|---|---|
| Accepted values | `YYYY-MM-DD` (ISO 8601 date) |
| Default | no lower bound |
| Validation | exits 2 if date is malformed or missing |

**Example:**

```sh
gitpulse /path/to/repo --since 2024-01-01
# Only commits from 1 Jan 2024 onward appear in the report.
```

---

## `--until <YYYY-MM-DD>`

Include only commits **on or before** the given date (inclusive).

| Detail | Value |
|---|---|
| Accepted values | `YYYY-MM-DD` (ISO 8601 date) |
| Default | no upper bound |
| Validation | exits 2 if date is malformed, missing, or if `--since` > `--until` |

**Example:**

```sh
gitpulse /path/to/repo --since 2024-01-01 --until 2024-06-30
# Only commits within H1 2024 appear.
```

---

## `--top <n>`

Cap each ranked list to the top `n` entries (`n >= 1`).

| Detail | Value |
|---|---|
| Accepted values | positive integer ≥ 1 |
| Default | no cap — all entries shown |
| Validation | exits 2 if value is not a valid integer or is < 1 |

**Example:**

```sh
gitpulse /path/to/repo --top 5
# Shows only the top 5 authors by commit count.
```

---

## `--compare <ref>`

Compare HEAD commit history against a git ref (tag, branch, or SHA).
Produces a side-by-side delta view (head vs base) with per-author changes.

| Detail | Value |
|---|---|
| Accepted values | any valid git ref (tag name, branch name, SHA) |
| Default | off — single-snapshot mode |
| Validation | exits 2 if the ref is not found in the repository |

> **Known limitation — `--author` is silently ignored on the `--compare` path:**
> When `--compare` is used, any `--author` filter is **silently ignored**. The
> `filterAuthorCommits` function is not called in the compare branch of `runCli`
> — only include/exclude glob filtering and date windows are applied. Do not rely
> on `--author --compare` to narrow the delta output.

**Example:**

```sh
gitpulse /path/to/repo --compare v1.0.0
# Shows how HEAD differs from v1.0.0 across all authors.
```

---

## `--exclude <pattern>`

Exclude file paths matching a glob pattern from the analysis. Repeatable;
multiple patterns are OR'd (a file is excluded if it matches any pattern).

| Detail | Value |
|---|---|
| Accepted values | glob pattern string (see glob rules below) |
| Default | no exclusions |
| Repeatable | yes — use multiple `--exclude` flags |
| Validation | exits 2 if pattern is empty or missing |

**Glob rules for `--exclude` and `--include`:** supports `*` (any chars in one
path segment) and `**` (any chars across path separators). Patterns are matched
against the full file path.

**Example:**

```sh
gitpulse /path/to/repo --exclude "*.lock" --exclude "dist/**"
# Lock files and dist/ are removed from the analysis.
```

---

## `--include <pattern>`

Include **only** file paths matching a glob pattern. Repeatable; multiple
patterns are OR'd (a file is included if it matches any pattern). Commits
whose every file is excluded by the include filter are dropped entirely.

| Detail | Value |
|---|---|
| Accepted values | glob pattern string (same syntax as `--exclude`) |
| Default | no include filter — all files included |
| Repeatable | yes — use multiple `--include` flags |
| Validation | exits 2 if pattern is empty or missing |

> **Order when used with `--exclude`:** inclusions are applied **before**
> exclusions. This order is code-enforced (see `applyInclusions` then
> `applyExclusions` in `src/cli.ts`) and is **not configurable**.

**Example:**

```sh
gitpulse /path/to/repo --include "src/**" --exclude "src/vendor/**"
# First keeps only src/ files, then removes src/vendor/.
```

---

## `--sort <column>[:asc|:desc]`

Sort the output by a named column, with an optional direction suffix.

| Detail | Value |
|---|---|
| Accepted values | `<column>` or `<column>:asc` or `<column>:desc` |
| Default | natural order (no sorting) |
| Validation | exits 2 if column is unknown for the active command, or if direction is not `asc`/`desc` |

### Direction rule

- **Numeric columns** → default direction is `desc` (highest first).
- **Text columns** → default direction is `asc` (alphabetical).

Append `:asc` or `:desc` to override: `--sort commits:asc`.

### Valid columns per command context

**`gitpulse` (authors / single-snapshot):**

| Column | Type |
|---|---|
| `author` | text |
| `commits` | numeric |
| `insertions` | numeric |
| `deletions` | numeric |

**`gitpulse --compare` (compare mode):**

| Column | Type |
|---|---|
| `author` | text |
| `baseCommits` | numeric |
| `headCommits` | numeric |
| `deltaCommits` | numeric |
| `baseChurn` | numeric |
| `headChurn` | numeric |
| `deltaChurn` | numeric |

**`gitpulse tags` (tags subcommand):**

| Column | Type |
|---|---|
| `name` | text |
| `date` | text |
| `commitsSince` | numeric |
| `uniqueAuthors` | numeric |
| `daysSince` | numeric |

**Examples:**

```sh
# Sort authors by insertions descending (default for numeric):
gitpulse /path/to/repo --sort insertions

# Sort authors by name ascending (default for text):
gitpulse /path/to/repo --sort author

# Explicit direction override:
gitpulse /path/to/repo --sort commits:asc

# Tags sorted by most commits first:
gitpulse tags /path/to/repo --sort commitsSince:desc
```

---

## `--no-merges`

Exclude merge commits (commits with more than one parent) from the analysis.

| Detail | Value |
|---|---|
| Accepted values | *(flag only)* |
| Default | off — merge commits included |

**Example:**

```sh
gitpulse /path/to/repo --no-merges
# Merge commits are excluded; the commit count reflects only non-merge commits.
```

---

## `--author <pattern>`

Filter commits to those whose author name **or** email matches the pattern.
Repeatable; multiple patterns are OR'd.

| Detail | Value |
|---|---|
| Accepted values | glob pattern string |
| Default | no author filter |
| Repeatable | yes — use multiple `--author` flags |
| Validation | exits 2 if pattern is empty or missing |

### Glob syntax rules for `--author`

- **Wildcard:** `*` only. Double-star (`**`) is **not** supported (unlike
  `--include`/`--exclude`, which do support `**`).
- **Case-insensitive:** `alice` matches `Alice`, `ALICE`, etc.
- **Match target:** the pattern is matched against the author's **name OR
  email address** — a match on either is sufficient.

**Examples:**

```sh
gitpulse /path/to/repo --author "alice*"
# Matches commits by any author whose name or email starts with "alice".

gitpulse /path/to/repo --author "*@example.com"
# Matches all authors with an @example.com email address.

gitpulse /path/to/repo --author "alice*" --author "bob*"
# OR semantics: matches Alice or Bob.
```

> **`--author` is silently ignored when combined with `--compare`** — see the
> [`--compare`](#--compare-ref) section for details.

---

## `--since-tag <tag>`

Include only commits **after** the named tag's commit. The tagged commit
itself is **excluded** (exclusive lower bound).

| Detail | Value |
|---|---|
| Accepted values | a git tag name that exists in the repository |
| Default | no lower-bound tag filter |
| Validation | exits 2 if the tag is not found |

### Boundary behaviour

`--since-tag` is **exclusive**: the commit that carries the tag is NOT
included in the results. Only commits that are strictly newer (reachable after
the tag in git history) are included.

**Asymmetric boundary example:**

```sh
# Repository has commits: A -- B(v1.0) -- C -- D(v2.0) -- E
gitpulse /path/to/repo --since-tag v1.0 --until-tag v2.0
# --since-tag v1.0  → B (the v1.0 tagged commit) is EXCLUDED
# --until-tag v2.0  → D (the v2.0 tagged commit) is INCLUDED
# Result: commits C and D appear; B does not.
```

---

## `--until-tag <tag>`

Include only commits **up to and including** the named tag's commit. The
tagged commit itself is **included** (inclusive upper bound).

| Detail | Value |
|---|---|
| Accepted values | a git tag name that exists in the repository |
| Default | no upper-bound tag filter |
| Validation | exits 2 if the tag is not found |

### Boundary behaviour

`--until-tag` is **inclusive**: the commit that carries the tag IS included in
the results.

See the asymmetric boundary example in the [`--since-tag`](#--since-tag-tag)
section above.

---

## `tags` subcommand

```sh
gitpulse tags [repo-path] [flags]
```

Lists tag spans: for each annotated or lightweight tag, shows the commit count,
unique author count, and days since the previous tag.

### Flags accepted by `tags`

| Flag | Effect |
|---|---|
| `--json` | JSON output |
| `--csv` | CSV output |
| `--markdown` | GFM markdown table output |
| `--since <date>` | filter tags by date window (tag date, not commit date) |
| `--until <date>` | filter tags by date window |
| `--sort <column>[:dir]` | sort output (valid columns: `name`, `date`, `commitsSince`, `uniqueAuthors`, `daysSince`) |
| `--exclude <pattern>` | exclude file paths from per-span commit counts |
| `--include <pattern>` | include only matching file paths in per-span commit counts |
| `--author <pattern>` | filter per-span commits by author |
| `--no-merges` | **accepted but has no effect** on the tags subcommand |

### Flags that exit code 2 (unsupported)

| Flag | Reason |
|---|---|
| `--top` | not supported for the tags subcommand |
| `--compare` | not supported for the tags subcommand |

### Flags that exit code 2 despite their names

| Flag | Reason |
|---|---|
| `--since-tag` | not supported — tags operates on tag spans, not commit ranges |
| `--until-tag` | not supported — tags operates on tag spans, not commit ranges |

Despite the name similarity to `--since` and `--until`, the `--since-tag` and
`--until-tag` flags are **not** accepted by the `tags` subcommand. They exit
with code 2 with the message:
`gitpulse tags: --since-tag and --until-tag are not supported for the tags subcommand — tags operates on tag spans, not commit ranges`

**Example:**

```sh
gitpulse tags /path/to/repo --sort commitsSince:desc --csv
# Lists tags sorted by most commits first, as CSV.
```
