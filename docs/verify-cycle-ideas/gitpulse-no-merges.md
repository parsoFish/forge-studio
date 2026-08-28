# Gitpulse — a `--no-merges` commit filter

Add a global `--no-merges` flag to the gitpulse CLI so every analytics command can exclude
merge commits from its numbers. On a repo with a merge-heavy history a merge commit
attributes the whole merged range's churn to whoever pressed the button, which skews
authors, churn, ownership and hotspots at once — today there is no way to ask gitpulse for
the first-parent-only picture.

Scope (one cohesive initiative — functionality plus its tests together):

- A `--no-merges` flag, parsed once in the CLI entrypoint alongside the existing global
  flags, that filters merge commits out of the commit set **before** aggregation, so every
  command (authors, churn, ownership, hotspots, coupling, compare) sees the filtered set
  without each one re-implementing the filter.
- A commit is a merge when it has more than one parent — read the parent count in the git
  layer rather than inferring it from the subject line.
- The text header reports the filter the way `--exclude` already does (e.g.
  `(N merge commits excluded)`); JSON output gains a top-level `mergesExcluded: N` field so
  the two renderers agree.
- `--no-merges` composes with the existing `--since` / `--until` / `--exclude` / `--top`
  filters rather than replacing any of them.

Constraints: pure filtering over the existing analytics models, **no runtime dependencies**,
covered by unit tests plus the deterministic temp-repo acceptance fixture — the fixture needs
a real merge commit so the excluded and included counts are both asserted, not just the
happy path. Honest output — the reported excluded count must equal the number actually
dropped, and with no merge commits present the numbers must be byte-identical to a run
without the flag.
