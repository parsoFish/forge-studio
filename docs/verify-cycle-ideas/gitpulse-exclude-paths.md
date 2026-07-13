# Gitpulse — `--exclude <glob>` path filtering

Add a repeatable global `--exclude <glob>` flag to the gitpulse CLI so every
analytics command (churn, ownership, hotspots, authors, compare) can ignore
vendored, generated, or lockfile paths — today a single `package-lock.json` or
`dist/` directory dominates churn and ownership numbers and drowns the signal.

Scope (one cohesive initiative — functionality plus its tests together):

- `--exclude <glob>` accepted multiple times in the CLI entrypoint (e.g.
  `--exclude 'dist/**' --exclude '*.lock'`); patterns apply to file paths before
  aggregation in every analytics command.
- Glob semantics: `*` (segment) and `**` (any depth) are enough — implement the
  tiny matcher in-repo; **no new runtime dependencies**.
- Omitted flag keeps today's behaviour byte-for-byte. Excluded-path count shown
  in the table header (and as an `excluded` field in `--json` output) so results
  are self-describing.
- An invalid/empty pattern surfaces a clear error on stderr + non-zero exit.

Constraints: both the matcher and the per-command filtering covered by unit
tests, plus the deterministic temp-repo acceptance fixture (commits touching
`dist/` + lockfile paths make exclusion assertions exact). Honest output — an
`--exclude` that matches nothing must equal the unfiltered run.
