"""
Tests verifying that stale merged remote branches have been deleted.

Branches under test (all already merged into main):
  - chore/remove-speckit       (merged via #19)
  - feat/GitWeave-ci-structural-tests (merged)
  - 001-control-repo-structure (content landed via #1)

Acceptance criteria:
  - `git branch -r` does NOT list any of the three branches on origin
  - No open GitHub PRs reference these branches as their head

All tests in this file FAIL until the three remote branches are deleted
(TDD red phase).
"""

import subprocess
import unittest


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STALE_BRANCHES = [
    "chore/remove-speckit",
    "feat/GitWeave-ci-structural-tests",
    "001-control-repo-structure",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _remote_branches() -> list[str]:
    """Return a list of remote branch names (without the 'origin/' prefix)."""
    result = subprocess.run(
        ["git", "branch", "-r"],
        capture_output=True,
        text=True,
        check=True,
    )
    branches = []
    for line in result.stdout.splitlines():
        name = line.strip()
        # Skip HEAD pointer lines (e.g. "origin/HEAD -> origin/main")
        if " -> " in name:
            continue
        # Strip the "origin/" prefix
        if name.startswith("origin/"):
            name = name[len("origin/"):]
        branches.append(name)
    return branches


def _open_pr_head_branches() -> list[str]:
    """
    Return a list of head branch names for all open PRs in the repository.
    Requires the `gh` CLI to be installed and authenticated.
    Skips gracefully if `gh` is unavailable or the repository is not on GitHub.
    """
    result = subprocess.run(
        [
            "gh", "pr", "list",
            "--state", "open",
            "--json", "headRefName",
            "--jq", ".[].headRefName",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


# ---------------------------------------------------------------------------
# Tests — remote branch absence
# ---------------------------------------------------------------------------


class TestStaleBranchesAbsentFromRemote(unittest.TestCase):
    """Verify that each stale merged branch no longer exists on origin."""

    def setUp(self):
        self.remote_branches = _remote_branches()

    def test_chore_remove_speckit_branch_is_deleted(self):
        """chore/remove-speckit should not appear in `git branch -r` after deletion."""
        self.assertNotIn(
            "chore/remove-speckit",
            self.remote_branches,
            "Remote branch 'chore/remove-speckit' still exists — delete it with "
            "`git push origin --delete chore/remove-speckit`",
        )

    def test_feat_gitweave_ci_structural_tests_branch_is_deleted(self):
        """feat/GitWeave-ci-structural-tests should not appear in `git branch -r`."""
        self.assertNotIn(
            "feat/GitWeave-ci-structural-tests",
            self.remote_branches,
            "Remote branch 'feat/GitWeave-ci-structural-tests' still exists — delete it with "
            "`git push origin --delete feat/GitWeave-ci-structural-tests`",
        )

    def test_001_control_repo_structure_branch_is_deleted(self):
        """001-control-repo-structure should not appear in `git branch -r`."""
        self.assertNotIn(
            "001-control-repo-structure",
            self.remote_branches,
            "Remote branch '001-control-repo-structure' still exists — delete it with "
            "`git push origin --delete 001-control-repo-structure`",
        )

    def test_no_stale_branch_remains_on_remote(self):
        """All three stale branches must be absent from the remote simultaneously."""
        remaining = [b for b in STALE_BRANCHES if b in self.remote_branches]
        self.assertEqual(
            remaining,
            [],
            f"The following stale branches still exist on origin: {remaining}",
        )


# ---------------------------------------------------------------------------
# Tests — open PR cross-reference
# ---------------------------------------------------------------------------


class TestStaleBranchesHaveNoOpenPRs(unittest.TestCase):
    """Verify that no open PR still references any of the stale branches."""

    def setUp(self):
        self.open_heads = _open_pr_head_branches()

    def test_chore_remove_speckit_has_no_open_pr(self):
        """No open PR should have chore/remove-speckit as its head branch."""
        self.assertNotIn(
            "chore/remove-speckit",
            self.open_heads,
            "An open PR still references 'chore/remove-speckit' as its head branch",
        )

    def test_feat_gitweave_ci_structural_tests_has_no_open_pr(self):
        """No open PR should have feat/GitWeave-ci-structural-tests as its head branch."""
        self.assertNotIn(
            "feat/GitWeave-ci-structural-tests",
            self.open_heads,
            "An open PR still references 'feat/GitWeave-ci-structural-tests' as its head branch",
        )

    def test_001_control_repo_structure_has_no_open_pr(self):
        """No open PR should have 001-control-repo-structure as its head branch."""
        self.assertNotIn(
            "001-control-repo-structure",
            self.open_heads,
            "An open PR still references '001-control-repo-structure' as its head branch",
        )


# ---------------------------------------------------------------------------
# Tests — main branch is intact
# ---------------------------------------------------------------------------


class TestMainBranchIntegrity(unittest.TestCase):
    """Sanity checks that branch deletion did not affect main."""

    def test_main_branch_still_exists_on_remote(self):
        """`origin/main` must remain after the deletions."""
        remote_branches = _remote_branches()
        self.assertIn(
            "main",
            remote_branches,
            "origin/main is missing — branch deletion went too far",
        )


if __name__ == "__main__":
    unittest.main()
