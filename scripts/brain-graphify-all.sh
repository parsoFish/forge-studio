#!/usr/bin/env bash
# brain-graphify-all.sh — rebuild graphify knowledge graphs for all three brains.
#
# Three-brain model (Tier 4 restructure 2026-05-26):
#   Brain 1 (forge-dev): forge code + ADRs + engineering notes
#                        graph at: brain/forge-dev/graphify-out/
#   Brain 2 (cycles):    cycle-derived patterns, antipatterns, operations, raw archives
#                        graph at: brain/cycles/graphify-out/
#   Brain 3 (per-project): lives inside each managed project
#                           graph at: projects/<name>/brain/graphify-out/
#
# Usage:
#   bash scripts/brain-graphify-all.sh          # rebuild Brain 1 + Brain 2
#   bash scripts/brain-graphify-all.sh --all    # rebuild Brain 1 + Brain 2 + all managed projects
#
# Requirements: graphify installed (uv tool install graphifyy)
# After modifying forge code, this is run automatically by the post-commit hook.
#
# Implementation notes:
#   graphify update <path> writes output to <path>/graphify-out/ by default.
#   The GRAPHIFY_OUT env var overrides the output subdirectory name,
#   but the output is always placed inside the scanned <path>.
#   Brain 1 therefore uses GRAPHIFY_OUT=brain/forge-dev/graphify-out so the
#   output lands at <forge-root>/brain/forge-dev/graphify-out/ rather than
#   the legacy <forge-root>/brain/graphify-out/ (symlink target).

set -euo pipefail

FORGE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_graphify() {
  local label="$1"
  local scan_path="$2"
  local graphify_out_subdir="$3"
  echo "[brain-graphify-all] rebuilding: $label"
  # GRAPHIFY_OUT controls the output subdirectory relative to the scan path.
  GRAPHIFY_OUT="$graphify_out_subdir" graphify update "$scan_path" 2>&1 | sed "s/^/  [$label] /"
  echo "[brain-graphify-all] done: $label"
}

# Brain 1 — forge-dev (forge TypeScript source + ADRs + engineering notes)
# Scan root is forge root; output lands at brain/forge-dev/graphify-out/.
# The .graphifyignore at forge root already excludes projects/, brain/_raw/,
# brain/cycles/, node_modules/ etc.
run_graphify \
  "Brain 1 (forge-dev)" \
  "$FORGE_ROOT" \
  "brain/forge-dev/graphify-out"

# Brain 2 — cycles (brain/cycles themes + _raw archives)
# Scan root is brain/cycles/; output lands at brain/cycles/graphify-out/.
run_graphify \
  "Brain 2 (cycles)" \
  "$FORGE_ROOT/brain/cycles" \
  "graphify-out"

if [[ "${1:-}" == "--all" ]]; then
  # Brain 3 — each managed project repo
  # Scan root is projects/<name>/brain/; output lands at projects/<name>/brain/graphify-out/.
  for proj_dir in "$FORGE_ROOT/projects"/*/; do
    proj_name="$(basename "$proj_dir")"
    if [[ -d "$proj_dir/brain" ]]; then
      run_graphify \
        "Brain 3 ($proj_name)" \
        "$proj_dir/brain" \
        "graphify-out"
    fi
  done
fi

echo "[brain-graphify-all] all graphs rebuilt successfully"
