---
name: dependency-diff-review
description: Review a branch's dependency changes before merge — new direct and transitive packages, version jumps, and lockfile churn that the code diff alone does not show.
library: true
allowed-tools: Bash(git diff), Bash(npm ls), Read
runtime:
  sdk: claude
  strategy: fixed
  model: claude-haiku-4-5
---

# Dependency diff review

> A community-seed package shipped with forge (`studio/community/skills/`).
> Its `runtime:` and `allowed-tools:` frontmatter is
> **permanently quarantined at install** — installing a community package
> can never grant it a runtime or its own tool permissions. Making it
> runnable is a separate, explicit act in the Agent Builder.

## When to use

Before merging any branch whose diff touches `package.json`, `package-lock.json`,
`go.mod`, `requirements.txt`, or an equivalent manifest.

## What to do

1. **Diff the manifest, not just the lockfile.** `git diff <base>...HEAD -- package.json`
   shows intent; the lockfile shows consequence. Report both.
2. **Name every NEW direct dependency** with the reason the branch needs it. A
   dependency with no stated reason is a finding, not a detail.
3. **Name every new transitive package** the lockfile pulled in. This is the
   part a code review never sees.
4. **Flag version jumps across a major boundary** and say what changed, sourced
   from the package's own changelog — never guessed.
5. **Flag a removed dependency whose imports survive.** A manifest deletion with
   live call sites is a build break waiting for a clean install.

## What to report

A short list, one line per finding, each naming the package and the evidence
that produced it. If the branch adds nothing, say "no dependency change" — an
empty report and an unrun review must never look the same.
