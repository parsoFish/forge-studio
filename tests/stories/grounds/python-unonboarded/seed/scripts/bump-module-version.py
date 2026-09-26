#!/usr/bin/env python3
"""
Compute and output the next CalVer (YYYYMMDD.Patch) version for a GitWeave module.

Usage:
    python scripts/bump-module-version.py <MODULE_NAME>

Queries the current git repository for tags matching modules/<MODULE_NAME>@<date>.<patch>
and outputs the next version to stdout. On the first release of a new day the patch
resets to 0; otherwise it increments to max_existing_patch + 1.

Tag format: modules/python-service@20260304.0
"""

import re
import subprocess
import sys


# ---------------------------------------------------------------------------
# Core logic
# ---------------------------------------------------------------------------

_TAG_RE = re.compile(r"^modules/([^@]+)@(\d{8})\.(\d+)$")


def parse_module_tag_patch(tag: str, module_name: str, date_str: str) -> int | None:
    """
    Extract the integer patch from a single tag string.

    Returns None if the tag does not match module_name + date_str exactly,
    or if the tag is structurally malformed.

    Rejects:
    - Tags for a different module (including prefix-only matches like 'python-service-extra')
    - Tags with a date component that does not match date_str
    - Tags missing the 'modules/' prefix
    - Tags missing the '@' separator
    - Tags missing the patch component
    - Tags with a non-numeric or negative patch
    - Tags with a date shorter than 8 digits
    """
    m = _TAG_RE.match(tag)
    if not m:
        return None

    tag_module, tag_date, tag_patch_str = m.group(1), m.group(2), m.group(3)

    if tag_module != module_name:
        return None
    if tag_date != date_str:
        return None

    patch = int(tag_patch_str)
    # Negative patches are structurally impossible via the regex (only digits matched),
    # but guard explicitly in case the regex ever relaxes.
    if patch < 0:
        return None

    return patch


def compute_next_version(module_name: str, date_str: str, existing_tags: list[str]) -> str:
    """
    Compute the next CalVer string for module_name on date_str.

    Scans existing_tags for tags matching this module on today's date.
    Returns YYYYMMDD.0 if none exist, or YYYYMMDD.(max_patch + 1) otherwise.
    Tags from other dates or other modules are ignored.
    """
    patches = [
        parse_module_tag_patch(tag, module_name, date_str)
        for tag in existing_tags
    ]
    today_patches = [p for p in patches if p is not None]

    next_patch = max(today_patches) + 1 if today_patches else 0
    return f"{date_str}.{next_patch}"


# ---------------------------------------------------------------------------
# Git integration
# ---------------------------------------------------------------------------

def _list_git_tags(repo_root: str = ".") -> list[str]:
    """Return all git tags in the repository as a list of strings."""
    result = subprocess.run(
        ["git", "tag", "--list"],
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    if result.returncode != 0:
        return []
    return [t.strip() for t in result.stdout.splitlines() if t.strip()]


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    if len(sys.argv) < 2:
        print(
            "Usage: bump-module-version.py <MODULE_NAME>\n"
            "  MODULE_NAME — the module directory name (e.g. python-service)",
            file=sys.stderr,
        )
        sys.exit(1)

    module_name = sys.argv[1]

    import datetime
    date_str = datetime.date.today().strftime("%Y%m%d")

    existing_tags = _list_git_tags()
    version = compute_next_version(module_name, date_str, existing_tags)
    print(version)


if __name__ == "__main__":
    main()
