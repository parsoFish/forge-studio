#!/usr/bin/env bash
# post-merge-brain-ingest — SessionEnd guard queuing a reflector pass once a
# session's PR has merged.
#
# Read-only detection; the actual reflector dispatch is the orchestrator's
# job (this hook only signals the need by printing to stdout for the
# in-harness session log).
set -euo pipefail

pr_number="${FORGE_PR_NUMBER:-}"

if [ -n "$pr_number" ]; then
  echo "post-merge-brain-ingest: PR #${pr_number} merged — queue a reflector pass."
else
  echo "post-merge-brain-ingest: no merged PR detected for this session — nothing to queue."
fi

exit 0
