# Gitpulse — `coupling` change-coupling command

Add a `gitpulse coupling` analytics command that surfaces **temporal coupling**:
pairs of files that tend to change together in the same commit. For each file
pair, report how many commits touched both files (the co-change count) and the
coupling ratio — co-changes divided by the number of commits touching the more
frequently changed file of the pair — so tightly-coupled pairs (a change to one
almost always drags in the other) rank above merely-busy files. Output is one
row per pair (strongest coupling first): file A, file B, co-changes, and the
coupling ratio as a percentage.

Scope (one cohesive initiative — functionality plus its tests together):

- `coupling` wired into the CLI entrypoint alongside the existing commands,
  honouring the existing global flags where they make sense: `--top <n>` (bound
  the ranked list, default a sensible small N so the output stays readable on
  large repos), `--json` (array of `{ fileA, fileB, coChanges, couplingPct }`
  row objects), `--csv`, `--exclude <glob>` (an excluded file never appears in a
  pair), and `--since`/`--until` (scope which commits are counted).
- Data comes from plain `git log --numstat` invocations via the existing git
  helper module (src/git.ts) — **no new runtime dependencies**, no graph
  library. The pair aggregation stays a PURE function over the parsed commit →
  files mapping (per-commit changed-file sets → pair counts), unit-tested in
  isolation.
- Deterministic ordering: ties (equal co-change count) break by coupling ratio,
  then lexicographically by `fileA` then `fileB`, so the same repo always
  produces the same rows.
- A commit that touches only one file contributes no pair; a repo where no two
  files ever change together prints a clear "no coupled file pairs" message and
  exits 0.
- Table output goes through the existing formatter (src/format.ts) so column
  alignment and style match the other commands.

Constraints: unit tests for the pair-counting + ratio computation over a small
hand-built commit→files fixture (including the single-file-commit and
no-coupling edge cases); the deterministic temp-repo acceptance fixture gains a
few commits that co-change known file pairs so the ranked output is asserted
exactly via a read-back of the BUILT CLI's stdout, using non-default sentinel
filenames. Honest output — every co-change count must be reproducible from the
raw `git log` of the fixture repo.
