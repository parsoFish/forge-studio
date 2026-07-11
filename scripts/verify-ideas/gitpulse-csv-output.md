# Gitpulse — `--csv` output flag

Add a global `--csv` flag to the gitpulse CLI so every analytics command (churn,
ownership, hotspots, authors, compare) can emit its table as RFC-4180 CSV on
stdout — for piping into spreadsheets and data tools without JSON wrangling.

Scope (one cohesive initiative — functionality plus its tests together):

- `--csv` parsed once in the CLI entrypoint, mutually exclusive with `--json`
  (using both is a clear stderr error + non-zero exit).
- Each command emits a header row matching its table columns, then one row per
  record; fields containing commas/quotes/newlines are quoted + escaped per
  RFC 4180. Implement the tiny escaper in-repo; **no new runtime dependencies**.
- Row content must be value-identical to the human table and the `--json`
  output (same source aggregation — no separate computation path).
- Omitted flag keeps today's behaviour byte-for-byte.

Constraints: escaper covered by unit tests (comma, quote, newline, unicode);
per-command CSV covered against the deterministic temp-repo acceptance fixture;
honest output — CSV row counts must equal the table's.
