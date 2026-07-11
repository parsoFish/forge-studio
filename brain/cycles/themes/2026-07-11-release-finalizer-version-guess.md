---
title: Release finalizer guesses version when ENHANCEMENTS category is unmapped or staged version not honored
description: The release-finalizer skill guesses the next version from the changelog category (ENHANCEMENTS unmapped → major bump → 3.0.0) instead of reading the staged PROVIDER_VERSION.txt value, requiring operator correction and a re-cut.
category: antipattern
created_at: 2026-07-11
updated_at: 2026-07-11
---

## What happens

After a dev-loop delivers changes under the `ENHANCEMENTS` category heading in `CHANGELOG.md`, the release-finalizer:

1. Reads the CHANGELOG to infer the bump type.
2. ENHANCEMENTS category was not mapped in the skill's bump table → defaulted to **major** bump.
3. Guessed `3.0.0` (from the current `2.0.0` base) instead of reading `PROVIDER_VERSION.txt` which already staged `2.0.1`.
4. Left the `## [Unreleased]` CHANGELOG heading unpromoted (should have become `## [2.0.1]`).

Operator had to:
- Delete the stale `v3.0.0` git tag that was created.
- Manually edit CHANGELOG and PROVIDER_VERSION.txt.
- Re-cut the `v2.0.1` release.

## Fix (forge 9970cc4)

- Map the ENHANCEMENTS category to a minor bump (not major).
- Honor `PROVIDER_VERSION.txt` as the authoritative staged version — read it first, bump only if it matches the calculated bump direction.
- Promote the `## [Unreleased]` heading to `## [<version>]` as part of the same finalize operation.

## Observed in

INIT-2026-07-10-framework-auth-parity: `release-finalizer.start` → `release.finalized` version=`3.0.0` despite `PROVIDER_VERSION.txt=2.0.1`.

## Operator signal

> "best-effort stance masked the systematic crash as an environment flake — worth a distinct signal when capture fails on EVERY cycle"

Same class of issue: a best-effort / silent-default path that picks a plausible but wrong answer and doesn't alert the operator until a human checks.

## Sources

- `_logs/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity/events.jsonl` — `release-finalizer.start` / `release.finalized` events; operator `user-feedback.md` item (b)
- `brain/cycles/_raw/2026-07-10T23-53-00_INIT-2026-07-10-framework-auth-parity.md`
