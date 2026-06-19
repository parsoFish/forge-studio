# Changelog

All notable changes to **mdtoc** are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and the project adheres to
[Semantic Versioning](https://semver.org/). The `## [Unreleased]` section is the
in-cycle draft (forge's release contract C10); forge's release-finalizer promotes
it to a versioned heading at pre-merge, and CI tags + cuts the release on merge.

## [Unreleased]

## [0.1.0] - 2026-06-19

### Added

- Heading extraction from Markdown (`src/headings.ts`) — ATX headings `#`..`######`,
  with fenced code blocks (``` and `~~~`) skipped.
- GitHub-style anchor slugs (`src/anchor.ts`) with duplicate-heading
  disambiguation (`-1`, `-2`, …).
- Table-of-contents renderer (`src/toc.ts`) with a `--min`/`--max` level window,
  configurable indent + bullet, re-based to the shallowest kept heading.
- `mdtoc` CLI (`src/cli.ts`) — read a file or stdin, print the TOC; fail-fast
  argv validation.
- Unit quality gate (`npm test`) and a creds-free acceptance gate that runs the
  built CLI against a fixture and asserts the real generated TOC.
