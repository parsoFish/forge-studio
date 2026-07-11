# Gitpulse — `--sort <column>` output ordering flag

Add a global `--sort <column>[:asc|:desc]` flag to the gitpulse CLI so every
analytics command (churn, ownership, hotspots, authors, compare, tags) can be
re-ordered by any of its own output columns instead of each command's fixed
default ordering.

Scope (one cohesive initiative — functionality plus its tests together):

- `--sort` parsed once in the CLI entrypoint; column names are validated
  against the invoked command's actual columns (unknown column → clear stderr
  error listing valid names + non-zero exit). Direction suffix optional,
  default `:desc` for numeric columns and `:asc` for text columns.
- Sorting happens on the computed records before formatting, so table, `--json`
  and `--csv` output all honour it identically (single code path — no separate
  per-format sorting).
- Numeric columns sort numerically, text columns lexicographically (locale-
  independent, stable). Omitted flag keeps today's per-command default ordering
  byte-for-byte.
- **No new runtime dependencies** — Array.prototype.sort with a tiny comparator
  helper.

Constraints: comparator helper unit-tested (numeric/text/stability/direction);
per-command sort covered against the deterministic temp-repo acceptance
fixture; honest output — sorted row multiset must equal the unsorted run's.
