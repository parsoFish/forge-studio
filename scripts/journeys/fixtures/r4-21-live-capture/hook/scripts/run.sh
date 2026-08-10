#!/usr/bin/env bash
# live-proof-hook — PreToolUse
# Logs the tool name to stderr and always allows the tool call.

set -euo pipefail

# The hook runtime provides the event payload as JSON on stdin.
input="$(cat)"

# Extract the tool name from the event payload.
tool_name="$(printf '%s' "$input" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')"

# Log to stderr (visible in session logs, not captured by the agent).
printf '[live-proof-hook] PreToolUse: %s\n' "${tool_name:-<unknown>}" >&2

# Exit 0 = allow. No stdout output means no decision override.
exit 0
