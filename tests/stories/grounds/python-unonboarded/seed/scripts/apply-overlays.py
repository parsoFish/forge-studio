"""
apply-overlays.py

Apply GitWeave overlay configurations to target repositories.

Usage:
    python scripts/apply-overlays.py [--dry-run] <config-path>

Arguments:
    config-path     Path to a GitWeave RepositoryOverlay YAML file
                    (e.g. config/repos/example.yaml)

Flags:
    --dry-run       Validate and print the overlay plan without making any
                    changes to external repositories.  Safe to run in CI
                    without credentials.
    --help, -h      Show this help message and exit.

Exit codes:
    0   Success (or successful dry-run)
    1   Invalid arguments or malformed config
    2   Module not found
"""

from __future__ import annotations

import argparse
import os
import sys

import yaml

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
MODULES_DIR = os.path.join(REPO_ROOT, "modules")

_REQUIRED_API_VERSION = "gitweave.io/v1"
_REQUIRED_KIND = "RepositoryOverlay"


# ---------------------------------------------------------------------------
# Dry-run summary helpers
# ---------------------------------------------------------------------------


def compute_dry_run_summary(configs: list[dict]) -> dict:
    """
    Aggregate metrics from a list of RepositoryOverlay config dicts.

    Returns a dict with:
      total_repos             — int, one per config
      total_modules           — int, sum of all module references across all repos
      total_estimated_actions — int, one copier action per module reference
      repos                   — list of per-repo dicts, each containing:
                                  repo (str), modules (int), estimated_actions (int),
                                  module_names (list[str])
    """
    repos = []
    for config in configs:
        repo = config.get("spec", {}).get("repository", "<unknown>")
        module_specs = config.get("spec", {}).get("modules") or []
        names = [m["name"] for m in module_specs if isinstance(m, dict) and "name" in m]
        repos.append({
            "repo": repo,
            "modules": len(names),
            "estimated_actions": len(names),
            "module_names": names,
        })

    total_modules = sum(r["modules"] for r in repos)
    return {
        "total_repos": len(repos),
        "total_modules": total_modules,
        "total_estimated_actions": total_modules,
        "repos": repos,
    }


def format_dry_run_table(summary: dict) -> str:
    """
    Render the summary dict from compute_dry_run_summary() as a formatted
    table string suitable for printing to stdout.

    Returns a string containing:
      - a header row with recognisable column names
      - one data row per repo with the slug, module count, estimated action count,
        and comma-separated module names
      - a separator line and a totals footer row
    """
    repos = summary.get("repos", [])
    total_repos = summary.get("total_repos", 0)
    total_modules = summary.get("total_modules", 0)
    total_actions = summary.get("total_estimated_actions", 0)

    w_repo = max([len("Repository")] + [len(r["repo"]) for r in repos])
    w_mod = max(len("Modules"), 7)
    w_act = max(len("Estimated Actions"), 17)
    w_names = max(
        [len("Module Names")]
        + [len(", ".join(r.get("module_names", []))) for r in repos]
    )

    sep = f"{'-' * w_repo}  {'-' * w_mod}  {'-' * w_act}  {'-' * w_names}"
    header = (
        f"{'Repository':<{w_repo}}  {'Modules':>{w_mod}}  "
        f"{'Estimated Actions':>{w_act}}  {'Module Names':<{w_names}}"
    )

    lines = [header, sep]
    for r in repos:
        names_str = ", ".join(r.get("module_names", []))
        lines.append(
            f"{r['repo']:<{w_repo}}  {r['modules']:>{w_mod}}  "
            f"{r['estimated_actions']:>{w_act}}  {names_str:<{w_names}}"
        )
    lines.append(sep)
    lines.append(
        f"TOTAL: {total_repos} repos | {total_modules} modules"
        f" | {total_actions} estimated actions"
    )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_config(path: str) -> dict:
    """Load and parse a YAML overlay config file."""
    try:
        with open(path) as f:
            doc = yaml.safe_load(f)
    except FileNotFoundError:
        print(f"[error] Config file not found: {path}", file=sys.stderr)
        sys.exit(1)
    except yaml.YAMLError as exc:
        print(f"[error] Failed to parse YAML config: {exc}", file=sys.stderr)
        sys.exit(1)

    if not isinstance(doc, dict):
        print(
            f"[error] Config file is not a YAML mapping: {path}",
            file=sys.stderr,
        )
        sys.exit(1)
    return doc


def _validate_config(doc: dict) -> None:
    """Validate required fields in the overlay config document."""
    api_version = doc.get("apiVersion", "")
    kind = doc.get("kind", "")

    if api_version != _REQUIRED_API_VERSION:
        print(
            f"[error] Unsupported apiVersion '{api_version}'. "
            f"Expected '{_REQUIRED_API_VERSION}'.",
            file=sys.stderr,
        )
        sys.exit(1)

    if kind != _REQUIRED_KIND:
        print(
            f"[error] Unsupported kind '{kind}'. Expected '{_REQUIRED_KIND}'.",
            file=sys.stderr,
        )
        sys.exit(1)

    spec = doc.get("spec", {})
    repository = spec.get("repository", "")
    if not repository or not isinstance(repository, str):
        print(
            "[error] 'spec.repository' is missing or empty in the overlay config.",
            file=sys.stderr,
        )
        sys.exit(1)


def _resolve_modules(modules: list[dict]) -> list[tuple[str, str]]:
    """
    Resolve each module name to its directory path.

    Returns a list of (name, path) tuples.
    Exits with code 2 if any module directory is missing.
    """
    resolved = []
    for entry in modules:
        if not isinstance(entry, dict):
            continue
        name = entry.get("name", "")
        if not name:
            continue
        module_path = os.path.join(MODULES_DIR, name)
        if not os.path.isdir(module_path):
            print(
                f"[error] Module directory not found: {module_path}\n"
                f"        Create modules/{name}/ to register this module.",
                file=sys.stderr,
            )
            sys.exit(2)
        resolved.append((name, module_path))
    return resolved


def _print_dry_run_plan(repository: str, resolved_modules: list[tuple[str, str]], doc: dict) -> None:
    """Print the overlay plan to stdout without applying any changes.

    Includes both the detailed per-module listing and the summary table.
    """
    print(f"[dry-run] Overlay plan for repository: {repository}")
    print(f"[dry-run] Modules to apply ({len(resolved_modules)}):")
    for name, path in resolved_modules:
        print(f"[dry-run]   - {name}  ({path})")

    summary = compute_dry_run_summary([doc])
    print()
    print(format_dry_run_table(summary))

    print("\n[dry-run] No changes applied. Run without --dry-run to apply.")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="apply-overlays.py",
        description="Apply GitWeave overlay configurations to target repositories.",
    )
    parser.add_argument(
        "config",
        metavar="CONFIG_PATH",
        help="Path to a GitWeave RepositoryOverlay YAML file.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print the overlay plan without making any changes.",
    )

    args = parser.parse_args(argv)

    doc = _load_config(args.config)
    _validate_config(doc)

    spec = doc.get("spec", {})
    repository: str = spec["repository"]
    modules: list[dict] = spec.get("modules", [])

    resolved = _resolve_modules(modules)

    if args.dry_run:
        _print_dry_run_plan(repository, resolved, doc)
    else:
        # Real apply path — requires credentials and external network access.
        # Not implemented yet; placeholder for future work.
        print(f"[apply] Applying overlays to repository: {repository}")
        for name, path in resolved:
            print(f"[apply]   Applying module: {name}")
        print("[apply] Done.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
