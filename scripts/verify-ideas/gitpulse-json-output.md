# Gitpulse — a `--json` structured-output flag

Add a global `--json` flag to the gitpulse CLI so every analytics command (churn,
ownership, hotspots, authors) can emit its result as structured JSON in addition to the
human-readable table — letting downstream tools consume gitpulse programmatically.

Scope (one cohesive initiative — functionality plus its tests together):

- A `--json` flag, parsed once in the CLI entrypoint, that switches each command's
  renderer from the table writer to a `JSON.stringify` of the same computed model
  (no recomputation — the analytics functions already return plain data).
- Stable, documented JSON shapes per command (arrays of `{ … }` rows mirroring the
  table columns); `--top <n>` still bounds the JSON arrays.
- Errors stay on stderr + non-zero exit; `--json` only changes stdout.

Constraints: pure formatting over the existing analytics models, **no runtime
dependencies**, every command's `--json` path covered by unit tests plus the
deterministic temp-repo acceptance fixture. Honest output — the JSON must equal the
table's numbers.
