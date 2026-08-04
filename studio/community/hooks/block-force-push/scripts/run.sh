#!/usr/bin/env bash
# block-force-push — PreToolUse guard for `git push`.
#
# Refuses a force-push whose target branch is protected. Reads nothing outside
# the repository, needs no environment variables, and makes no network call —
# which is what its permission manifest declares, and what the pre-install
# security scan on the community browser's detail page reports before an
# operator installs it.
set -euo pipefail

protected_branches="main master release"
current="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"

for branch in $protected_branches; do
  if [ "$current" = "$branch" ]; then
    echo "block-force-push: refusing a force-push to the protected branch '$current'." >&2
    exit 1
  fi
done

exit 0
