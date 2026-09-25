---
name: git-log-analysis
description: Read a repository's history through gitpulse's own git layer — never ad-hoc git parsing — and turn commits into the churn, ownership and coupling figures the CLI reports.
phase: develop
surface: unattended
---

# gitpulse — Git log analysis

## Single responsibility

Turn a git repository's history into the commit, churn, ownership and coupling
figures gitpulse reports, **through this project's own git layer** rather than
through ad-hoc parsing invented per work item.

## When to invoke

- A work item touches how history is **read** (`src/git.ts`) or how it is
  **aggregated** (`src/churn.ts`, `src/coupling.ts`, `src/compare.ts`,
  `src/author-filter.ts`).
- A work item adds a filter, a flag or an output column whose value is derived
  from commits.
- A demo or acceptance step needs figures out of a real repository.

Do **not** invoke it for output formatting alone (`src/format.ts`) or for CLI
argument plumbing that adds no new derived figure.

## The layer to use, and why it is not optional

`src/git.ts` is the only place that shells out. It runs

```
git log --numstat --date=short --format=<LOG_FORMAT>
```

via `execFileSync` with **array arguments and no shell**, so there is no
injection surface, and it calls `assertGitRepo(repoPath)` first so a
non-repository fails fast with a clear error instead of producing empty
analytics that look like a quiet repo.

Use its exports rather than re-deriving:

| export | what it gives you |
|---|---|
| `readCommits(repoPath)` | the parsed history, as immutable `Commit[]` |
| `parseLog(raw)` | the same parse, for a captured fixture |
| `assertGitRepo(path)` | the fail-fast guard |
| `LOG_ARGS` | the exact argv, so a fixture and the real read cannot drift (`LOG_FORMAT` is module-private and reachable through it) |
| `Commit`, `CommitFile` | the record shapes, including renames recorded under the NEW path |

**A second `git log` invocation anywhere else is a defect**, not a shortcut:
two parsers disagree the first time a format changes, and the fixtures then
prove whichever one the test happened to call.

## Inputs

- `repoPath` — an absolute path to a git repository. Validate at the boundary.
- Optional filters already modelled in the project: author include/exclude
  patterns (`*`-wildcard, case-insensitive, repeatable, OR-combined), and a
  revision range where the work item asks for one.

## Outputs

Immutable records and derived aggregates — never a mutated input:

- per-commit: hash, author, date, per-file added/deleted (`CommitFile`)
- churn: added/deleted/net per file or directory over a window
- ownership: per-author share of commits or of changed lines
- coupling: files that change together, and how often

## Constraints this project holds you to

- **Zero runtime dependencies** — node builtins only. `tsx` and `typescript`
  are the sole dev deps.
- **Immutability**: return new objects; never mutate an input array or record.
- **Small, feature-organised files**; validate argv and HTTP input at the
  boundary.
- **Never edit a test to make it pass.** Make the implementation satisfy the
  tests as written.

## How the work is checked

- local: `npm test` — the offline `node:test` unit suite.
- acceptance: the built CLI runs against a deterministic temp git-repo fixture
  and its stdout is read back. A figure that cannot be reproduced from that
  fixture is not a figure this project reports.

## Failure modes worth naming

- **A non-repo path** — `assertGitRepo` fails fast; do not "handle" it by
  returning empty analytics, which reads as a repository with no history.
- **Renames** — `--numstat` reports them with braces; `parseLog` already strips
  them and records the new path. Do not re-implement that rule.
- **An empty range** — zero commits is a real answer. Report it as zero rather
  than as an error, and never as a missing column.
