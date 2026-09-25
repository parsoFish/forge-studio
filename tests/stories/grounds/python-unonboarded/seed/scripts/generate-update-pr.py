"""
generate-update-pr.py

Helper script for the module-update-propagation workflow.

Public API (importable by unit tests):
    build_pr_title(module_name, version) -> str
    build_pr_body(module_name, version, repo_slug, diff_output) -> str | None
    has_changes(diff_output) -> bool
    find_consumers(module_name, config_dir) -> list[str]
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import yaml

# ---------------------------------------------------------------------------
# No-op messages emitted by copier when the template is already up-to-date.
# Any diff output matching one of these patterns is treated as "no changes".
# ---------------------------------------------------------------------------
_COPIER_NOOP_MESSAGES = (
    "Nothing to do.",
    "No changes made.",
    "No changes to apply.",
    "Everything is up to date.",
)


def has_changes(diff_output: str) -> bool:
    """Return True when diff_output represents a real change.

    Returns False for:
    - empty or whitespace-only strings
    - copier no-op messages ("Nothing to do.", etc.)
    """
    stripped = diff_output.strip()
    if not stripped:
        return False
    if stripped in _COPIER_NOOP_MESSAGES:
        return False
    return True


def build_pr_title(module_name: str, version: str) -> str:
    """Return 'chore: update <module_name> to <version>'."""
    return f"chore: update {module_name} to {version}"


def build_pr_body(
    module_name: str,
    version: str,
    repo_slug: str,
    diff_output: str,
) -> str | None:
    """Return a Markdown PR body, or None/empty when there are no changes.

    The body includes:
    - A section header identifying the updated module
    - A link to the module tag in the source repository
    - The copier diff wrapped in a fenced code block
    """
    if not has_changes(diff_output):
        return None

    tag_ref = f"modules/{module_name}@{version}"
    tag_url = f"https://github.com/{repo_slug}/releases/tag/{tag_ref}"

    body = (
        f"## Module update: {module_name}\n\n"
        f"This PR applies the changes from [{tag_ref}]({tag_url}) "
        f"({repo_slug}) to this repository.\n\n"
        "### Changed files\n\n"
        "```diff\n"
        f"{diff_output.rstrip()}\n"
        "```\n"
    )
    return body


def find_consumers(module_name: str, config_dir: str) -> list[str]:
    """Return repo slugs from config_dir/**/*.yaml that reference module_name.

    Scans .yaml files at any subdirectory depth so that team/tier subdirectory
    conventions are fully supported.

    Each YAML file is expected to follow the RepositoryOverlay schema:
        spec.repository: <org/repo>
        spec.modules:
          - name: <module-name>

    Module name matching is case-sensitive and exact (no partial matches).
    """
    consumers: list[str] = []
    root = Path(config_dir)
    if not root.is_dir():
        return []

    for path in sorted(root.rglob("*.yaml")):
        try:
            with open(path) as f:
                doc = yaml.safe_load(f)
        except Exception:
            continue

        if not isinstance(doc, dict):
            continue

        spec = doc.get("spec", {}) or {}
        repo = spec.get("repository")
        modules = spec.get("modules") or []

        if not repo or not modules:
            continue

        if any(m.get("name") == module_name for m in modules if isinstance(m, dict)):
            consumers.append(repo)

    return consumers


# ---------------------------------------------------------------------------
# CLI entry point (invoked by the GitHub Actions workflow)
# ---------------------------------------------------------------------------


def _parse_tag(tag_ref: str) -> tuple[str, str]:
    """Parse 'refs/tags/modules/<name>@<version>' -> (name, version).

    Also accepts the short form 'modules/<name>@<version>'.
    """
    ref = tag_ref.removeprefix("refs/tags/")
    if "@" not in ref:
        raise ValueError(f"Tag ref '{tag_ref}' does not contain '@' separator")
    module_part, version = ref.rsplit("@", 1)
    name = module_part.removeprefix("modules/")
    return name, version


def main() -> int:
    import argparse
    import subprocess

    parser = argparse.ArgumentParser(
        description="Open PRs in consumer repos when a module tag is pushed"
    )
    parser.add_argument("--tag", required=True, help="Full tag ref, e.g. modules/python-service@20260305.0")
    parser.add_argument("--config-dir", default="config/repos", help="Directory containing overlay YAML files")
    parser.add_argument("--control-repo", required=True, help="GitHub slug of this control repo, e.g. my-org/gitweave")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without executing them")
    args = parser.parse_args()

    try:
        module_name, version = _parse_tag(args.tag)
    except ValueError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    consumers = find_consumers(module_name, args.config_dir)
    if not consumers:
        print(f"No consumers found for module '{module_name}' in {args.config_dir}")
        return 0

    print(f"Module: {module_name}  Version: {version}")
    print(f"Consumers: {consumers}")

    exit_code = 0
    for repo_slug in consumers:
        print(f"\n--- Processing consumer: {repo_slug} ---")

        if args.dry_run:
            print(f"[dry-run] Would clone {repo_slug}, run copier update, open PR if changes exist")
            continue

        import tempfile

        with tempfile.TemporaryDirectory() as workdir:
            clone_url = f"https://github.com/{repo_slug}.git"
            result = subprocess.run(
                ["git", "clone", "--depth=1", clone_url, workdir],
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                print(f"ERROR: Failed to clone {repo_slug}: {result.stderr}", file=sys.stderr)
                exit_code = 1
                continue

            copier_result = subprocess.run(
                ["copier", "update", "--defaults", "--skip-if-exists"],
                cwd=workdir,
                capture_output=True,
                text=True,
            )
            diff_output = copier_result.stdout + copier_result.stderr

            if not has_changes(diff_output):
                print(f"No changes for {repo_slug} — skipping PR")
                continue

            branch = f"chore/update-{module_name}-{version}"
            subprocess.run(["git", "checkout", "-b", branch], cwd=workdir, check=True)
            subprocess.run(["git", "add", "-A"], cwd=workdir, check=True)
            subprocess.run(
                ["git", "commit", "-m", build_pr_title(module_name, version)],
                cwd=workdir,
                check=True,
            )
            subprocess.run(["git", "push", "origin", branch], cwd=workdir, check=True)

            title = build_pr_title(module_name, version)
            body = build_pr_body(module_name, version, args.control_repo, diff_output)
            subprocess.run(
                ["gh", "pr", "create", "--repo", repo_slug, "--title", title, "--body", body or ""],
                check=True,
            )
            print(f"PR opened in {repo_slug}: {title}")

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
