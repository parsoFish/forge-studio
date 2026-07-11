# Gitpulse — `tags` release-cadence command

Add a `gitpulse tags` analytics command summarising the repo's release cadence
from its git tags: one row per tag (newest first) with tag name, tag date,
commits since the previous tag, unique authors in that span, and days since the
previous tag — plus a footer line with the median inter-tag gap.

Scope (one cohesive initiative — functionality plus its tests together):

- `tags` wired into the CLI entrypoint alongside the existing commands, honouring
  the existing global flags where they make sense: `--json` (array of row objects
  + a `medianGapDays` field), `--csv`, and `--exclude` (excluded paths don't count
  toward the commits-since column). `--since`/`--until` scope which tags appear.
- Data comes from plain `git tag`/`git log` invocations via the existing git
  helper module (src/git.ts) — **no new runtime dependencies**, no date math
  library (day arithmetic on Unix timestamps is fine).
- Lightweight/annotated tags both supported; a repo with zero tags prints a
  clear "no tags" message and exits 0.
- Table output goes through the existing formatter (src/format.ts) so alignment
  and style match the other commands.

Constraints: unit tests for the span/median computation; the deterministic
temp-repo acceptance fixture gains tags at known timestamps so cadence
assertions are exact; honest output — row counts and commit counts must be
reproducible from raw git commands.
