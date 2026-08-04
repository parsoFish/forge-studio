#!/usr/bin/env bash
# pre-pr-security-review — PreToolUse guard for `gh pr create`.
#
# Reminds the operator/agent to run a security-review pass over auth-touching
# diffs before a PR is opened. Read-only: inspects the git diff against the
# merge-base and prints a reminder when the diff looks auth-related. The
# security-review judgement itself is a human/agent call — this script only
# surfaces the prompt, it never blocks the command it fires alongside.
set -euo pipefail

base="$(git merge-base HEAD origin/main 2>/dev/null || echo HEAD)"
changed="$(git diff --name-only "$base" 2>/dev/null || true)"

if printf '%s' "$changed" | grep -Eiq '(auth|login|session|token|credential|secret)'; then
  echo "pre-pr-security-review: diff touches auth-related paths — run a security-review pass before opening the PR." >&2
fi

exit 0
