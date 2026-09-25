#!/usr/bin/env bash
set -euo pipefail
if [ ! -f docs/usage.md ]; then
  echo "FAIL: docs/usage.md does not exist" >&2
  exit 1
fi
echo "PASS: docs/usage.md exists"
