#!/usr/bin/env bash
# block-protected-branch-push — PreToolUse guard for `git push`.
#
# Refuses a push made while HEAD is sitting on a protected branch, so work
# reaches the remote through a branch and a PR rather than straight from main.
#
# It checks the branch you are ON. It does not inspect the push's arguments or
# its remote target, and it draws no distinction between a fast-forward push and
# a force-push. That is deliberately narrower than it could be, and the id, the
# name, the description and this comment all say the same narrow thing — a guard
# whose label overstates what it enforces is worse than no guard.
#
# Reads nothing outside the repository, needs no environment variables, and
# makes no network call — which is exactly what its permission manifest
# declares, and what the pre-install security scan on the community browser's
# detail page reports before an operator installs it.
set -euo pipefail

protected_branches="main master release"
current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

for branch in $protected_branches; do
  if [ "$current" = "$branch" ]; then
    echo "block-protected-branch-push: HEAD is on the protected branch '$current' — branch first, then push." >&2
    exit 1
  fi
done

exit 0
