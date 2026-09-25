#!/usr/bin/env python3
"""
generate_scale_fixtures.py — generate scale test overlay YAML fixtures.

Creates `count` valid RepositoryOverlay YAML files distributed across
subdirectory depths following the team/tier naming convention:

  depth 1 — output_dir/<repo>.yaml
  depth 2 — output_dir/team-<name>/<repo>.yaml
  depth 3 — output_dir/tier-<name>/team-<name>/<repo>.yaml

Every generated file satisfies schemas/overlay.schema.json.
Files are written to the caller-supplied output_dir only — never to
config/repos/ or any other project directory.

Public API:
    generate(output_dir: str | Path, count: int = 100) -> list[Path]
"""
from __future__ import annotations

from pathlib import Path

import yaml


# Depth distribution: 1/3 flat, 1/3 one team level, 1/3 two-level tier/team.
_TEAMS = [f"team-{c}" for c in ("alpha", "beta", "gamma", "delta", "epsilon")]
_TIERS = [f"tier-{c}" for c in ("gold", "silver", "bronze")]


def _make_doc(index: int) -> dict:
    """Return a minimal RepositoryOverlay document that satisfies the schema."""
    return {
        "apiVersion": "gitweave.io/v1",
        "kind": "RepositoryOverlay",
        "metadata": {
            "name": f"scale-fixture-repo-{index:04d}",
        },
        "spec": {
            "repository": f"gitweave-org/scale-fixture-repo-{index:04d}",
            "modules": [],
        },
    }


def _target_path(output_dir: Path, index: int, count: int) -> Path:
    """
    Distribute files across three depths so that every depth has at least
    one file regardless of count.

    Scheme (for count ≥ 3):
      index % 3 == 0  → depth 1 (flat)
      index % 3 == 1  → depth 2 (team subdirectory)
      index % 3 == 2  → depth 3 (tier/team subdirectory)

    For very small counts the first few files still cover all depths.
    """
    depth = index % 3
    filename = f"repo-{index:04d}.yaml"

    if depth == 0:
        return output_dir / filename
    elif depth == 1:
        team = _TEAMS[index % len(_TEAMS)]
        return output_dir / team / filename
    else:
        tier = _TIERS[index % len(_TIERS)]
        team = _TEAMS[index % len(_TEAMS)]
        return output_dir / tier / team / filename


def generate(output_dir: str | Path, count: int = 100) -> list[Path]:
    """
    Generate `count` valid RepositoryOverlay YAML files under output_dir.

    Files are distributed across three subdirectory depths following the
    team/tier naming convention.  Each file passes schemas/overlay.schema.json.

    Args:
        output_dir: Directory in which to write the fixtures (created if absent).
        count:      Number of YAML files to generate (default 100).

    Returns:
        List of pathlib.Path objects — one per generated file, in creation order.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    paths: list[Path] = []
    for i in range(count):
        target = _target_path(out, i, count)
        target.parent.mkdir(parents=True, exist_ok=True)
        doc = _make_doc(i)
        with open(target, "w") as fh:
            yaml.dump(doc, fh, default_flow_style=False, sort_keys=True)
        paths.append(target)

    return paths


if __name__ == "__main__":
    import sys
    import tempfile

    out_dir = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 100
    generated = generate(out_dir, count=n)
    print(f"Generated {len(generated)} fixture files in {out_dir}")
