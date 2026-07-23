---
name: changelog-semver
description: Compute the next semantic version and a finalised changelog entry from a cycle's acceptance-criteria categories. Reads the draft Unreleased changelog section (or the cycle's AC list), maps categories to a semver bump (breaking-change marker → major; new capability / Added → minor; Changed / Fixed / docs → patch), determines the current version (from a declared version file or the latest changelog heading), and produces the next version + the dated changelog heading. Composed by the release-finalizer; never tags or publishes (that is CI's job).
library: true
phase: release-finalize
surface: unattended
model: claude-sonnet-4-6
---

# Changelog & semver — compute the bump

## What this skill is

The deterministic half of release finalisation: turn a set of categorised
changes into **one** decision — the next [semantic version](https://semver.org/)
— and the finalised changelog heading. The `release-finalizer` agent composes
this skill, then applies the result to the changelog + version file.

This skill **decides**; it does not tag, publish, or merge. Tagging the release
and publishing it are CI's job off merge-to-main — never run `git tag`,
`gh release create`, or `npm publish`.

## Inputs

- The draft changelog `## [Unreleased]` section (bullets the unifier wrote in
  cycle), OR the cycle's acceptance-criteria list when no draft exists.
- The current version — from the project's declared `versionFile` if present,
  else the most recent `## [X.Y.Z]` heading in the changelog. Absent both ⇒
  treat current as `0.0.0` (the first release is `0.1.0` for a feature).

## Bump rules (highest match wins)

1. **major** (`X.0.0`) — any change carrying a breaking-change marker
   (`BREAKING CHANGE`, `!` in a conventional-commit type, or an AC that removes
   or incompatibly changes a public surface).
2. **minor** (`x.Y.0`) — a new user-visible capability (an `Added` category, a
   `feat`, a new public API surface).
3. **patch** (`x.y.Z`) — `Changed` / `Fixed` / `docs` / internal-only changes
   with no new surface.

Pre-1.0.0 projects MAY soften a major to minor per semver §4 (initial
development) — prefer that only when the project's existing changelog shows the
convention.

## Output

- The next version string `X.Y.Z`.
- The finalised heading: `## [X.Y.Z] - <YYYY-MM-DD>` (today's date, ISO).
- The bump rationale (which rule fired, one line) so the release record is
  auditable.

## How to apply (the finalizer does this)

Rewrite the draft `## [Unreleased]` heading to the finalised heading, preserving
the bullets, and leave a fresh empty `## [Unreleased]` section above it for the
next cycle.
