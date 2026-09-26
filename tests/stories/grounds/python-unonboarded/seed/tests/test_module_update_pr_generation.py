"""
Unit tests for the PR title and body generation logic used by the
module-update-propagation workflow.

These tests verify that scripts/generate-update-pr.py (or the importable
functions it exposes) correctly:

  PR title generation (build_pr_title):
    - Returns the canonical format: 'chore: update <module-name> to <version>'
    - Preserves hyphenated module names (e.g. python-service, terraform-module)
    - Preserves the full CalVer version string (e.g. 20260305.1)

  PR body generation (build_pr_body):
    - Includes a link to the module tag in the GitHub repository
    - Embeds the copier diff output in a fenced code block
    - Returns None (or empty string) when the diff output is empty so that
      no PR is opened for idempotent updates
    - Includes a section header that identifies the changed module
    - The tag link uses the canonical 'modules/<name>@<version>' anchor format

  Idempotency guard (has_changes):
    - Returns False when copier diff output is empty or whitespace-only
    - Returns True when copier diff output contains non-whitespace content
    - Returns False when copier exits 0 with no-op output ("Nothing to do")

  Consumer discovery (find_consumers):
    - Returns a list of repo slugs from all config/repos/*.yaml files where
      spec.modules[].name matches the updated module name
    - Returns an empty list when no consumer YAML files reference the module
    - Ignores YAML files where spec.modules is absent
    - Ignores module entries whose name does not match (case-sensitive)
    - Handles a single consumer and multiple consumers correctly

All tests in this file fail until scripts/generate-update-pr.py is created
and implements the expected public functions (TDD red phase).
"""

import importlib.util
import os
import textwrap
import unittest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPT_PATH = os.path.join(REPO_ROOT, "scripts", "generate-update-pr.py")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_script():
    """
    Import generate-update-pr.py as a Python module so its public functions
    can be unit-tested directly without invoking a subprocess.

    Raises FileNotFoundError with a descriptive message when the script does
    not yet exist, so each test that calls this helper fails with a clear
    explanation rather than an AttributeError on a None spec.
    """
    if not os.path.isfile(SCRIPT_PATH):
        raise FileNotFoundError(
            f"scripts/generate-update-pr.py not found at {SCRIPT_PATH} — "
            "the script must be implemented before these unit tests can pass"
        )
    spec = importlib.util.spec_from_file_location("generate_update_pr", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# TestPRTitleGeneration
# ---------------------------------------------------------------------------


class TestPRTitleGeneration(unittest.TestCase):
    """
    build_pr_title(module_name, version) must return a string that exactly
    matches the canonical PR title format required by the acceptance criteria.
    """

    def setUp(self):
        self.script = _load_script()

    def test_title_follows_chore_update_format(self):
        """PR title must be 'chore: update <module-name> to <version>'."""
        title = self.script.build_pr_title(
            module_name="python-service",
            version="20260305.0",
        )
        self.assertEqual(
            title,
            "chore: update python-service to 20260305.0",
            f"Expected canonical PR title format, got {title!r}",
        )

    def test_title_preserves_hyphenated_module_name(self):
        """Hyphenated module names must appear verbatim in the title."""
        title = self.script.build_pr_title(
            module_name="terraform-module",
            version="20260305.2",
        )
        self.assertEqual(
            title,
            "chore: update terraform-module to 20260305.2",
            "Hyphenated module name must be preserved exactly in the title",
        )

    def test_title_preserves_full_calver_version_with_patch(self):
        """The full YYYYMMDD.Patch version string must appear in the title."""
        title = self.script.build_pr_title(
            module_name="python-service",
            version="20260305.12",
        )
        self.assertIn(
            "20260305.12",
            title,
            f"Full CalVer version '20260305.12' not found in title: {title!r}",
        )

    def test_title_starts_with_chore_prefix(self):
        """PR title must start with 'chore: ' to follow conventional commits."""
        title = self.script.build_pr_title(
            module_name="example-template",
            version="20260305.0",
        )
        self.assertTrue(
            title.startswith("chore: "),
            f"PR title must start with 'chore: ', got {title!r}",
        )

    def test_title_contains_module_name(self):
        """The module name must appear in the title after 'update'."""
        module_name = "my-custom-module"
        title = self.script.build_pr_title(
            module_name=module_name,
            version="20260305.0",
        )
        self.assertIn(
            module_name,
            title,
            f"Module name '{module_name}' not found in PR title: {title!r}",
        )

    def test_title_contains_version(self):
        """The version string must appear in the title after 'to'."""
        version = "20260305.99"
        title = self.script.build_pr_title(
            module_name="python-service",
            version=version,
        )
        self.assertIn(
            version,
            title,
            f"Version '{version}' not found in PR title: {title!r}",
        )


# ---------------------------------------------------------------------------
# TestPRBodyGeneration
# ---------------------------------------------------------------------------


class TestPRBodyGeneration(unittest.TestCase):
    """
    build_pr_body(module_name, version, repo_slug, diff_output) must return
    a Markdown-formatted body that includes a tag link, the diff, and a
    module section header.  It must return None (or empty string) when the
    diff is empty so that the caller can skip opening a PR.
    """

    def setUp(self):
        self.script = _load_script()
        self.sample_diff = textwrap.dedent("""\
            --- a/.copier-answers.yml
            +++ b/.copier-answers.yml
            @@ -1,3 +1,3 @@
            -_commit: modules/python-service@20260304.0
            +_commit: modules/python-service@20260305.0
             python_version: '3.12'
        """)

    def test_body_includes_link_to_module_tag(self):
        """
        The PR body must contain a GitHub URL or Markdown link that points
        to the module tag so reviewers can inspect the change.
        """
        body = self.script.build_pr_body(
            module_name="python-service",
            version="20260305.0",
            repo_slug="my-org/gitweave-modules",
            diff_output=self.sample_diff,
        )
        self.assertIsNotNone(body, "build_pr_body must not return None for non-empty diff")
        # Accept either a raw GitHub tag URL or a Markdown hyperlink containing the tag ref.
        tag_ref = "modules/python-service@20260305.0"
        self.assertIn(
            tag_ref,
            body,
            f"PR body must contain the module tag reference '{tag_ref}'",
        )

    def test_body_embeds_diff_in_fenced_code_block(self):
        """
        The diff output must be wrapped in a fenced code block (``` or ~~~)
        so GitHub renders it with monospace formatting.
        """
        body = self.script.build_pr_body(
            module_name="python-service",
            version="20260305.0",
            repo_slug="my-org/gitweave-modules",
            diff_output=self.sample_diff,
        )
        self.assertIsNotNone(body)
        self.assertIn(
            "```",
            body,
            "PR body must wrap the diff in a fenced code block (```)",
        )

    def test_body_contains_diff_content(self):
        """The actual diff text must appear inside the PR body."""
        body = self.script.build_pr_body(
            module_name="python-service",
            version="20260305.0",
            repo_slug="my-org/gitweave-modules",
            diff_output=self.sample_diff,
        )
        self.assertIsNotNone(body)
        self.assertIn(
            ".copier-answers.yml",
            body,
            "PR body must include the diff content referencing changed files",
        )

    def test_body_includes_module_name_in_header(self):
        """
        The PR body must identify which module was updated so reviewers
        understand the scope without reading the diff.
        """
        body = self.script.build_pr_body(
            module_name="python-service",
            version="20260305.0",
            repo_slug="my-org/gitweave-modules",
            diff_output=self.sample_diff,
        )
        self.assertIsNotNone(body)
        self.assertIn(
            "python-service",
            body,
            "PR body must mention the module name for reviewer context",
        )

    def test_body_returns_none_or_empty_when_diff_is_empty_string(self):
        """
        When copier produces no changes (empty diff), build_pr_body must
        return None or an empty string so the caller knows not to open a PR.
        """
        body = self.script.build_pr_body(
            module_name="python-service",
            version="20260305.0",
            repo_slug="my-org/gitweave-modules",
            diff_output="",
        )
        self.assertFalse(
            bool(body),
            f"build_pr_body must return None/empty for an empty diff, got {body!r}",
        )

    def test_body_returns_none_or_empty_when_diff_is_whitespace_only(self):
        """
        Whitespace-only diff output must also be treated as 'no changes'
        to prevent opening empty PRs.
        """
        body = self.script.build_pr_body(
            module_name="python-service",
            version="20260305.0",
            repo_slug="my-org/gitweave-modules",
            diff_output="   \n\t\n  ",
        )
        self.assertFalse(
            bool(body),
            f"build_pr_body must return None/empty for whitespace-only diff, got {body!r}",
        )

    def test_body_uses_canonical_tag_format_modules_slash_name_at_version(self):
        """
        The tag reference in the body must use the canonical format
        'modules/<name>@<version>' — not a custom separator or missing prefix.
        """
        body = self.script.build_pr_body(
            module_name="terraform-module",
            version="20260305.3",
            repo_slug="my-org/gitweave-modules",
            diff_output=self.sample_diff,
        )
        self.assertIsNotNone(body)
        self.assertIn(
            "modules/terraform-module@20260305.3",
            body,
            "Tag reference must follow 'modules/<name>@<version>' format in PR body",
        )

    def test_body_includes_repo_slug_link(self):
        """
        The PR body must include the repo slug so the tag link anchors to
        the correct repository when opened in GitHub.
        """
        repo_slug = "my-org/gitweave-modules"
        body = self.script.build_pr_body(
            module_name="python-service",
            version="20260305.0",
            repo_slug=repo_slug,
            diff_output=self.sample_diff,
        )
        self.assertIsNotNone(body)
        self.assertIn(
            repo_slug,
            body,
            f"PR body must reference the source repo slug '{repo_slug}'",
        )


# ---------------------------------------------------------------------------
# TestIdempotencyGuard
# ---------------------------------------------------------------------------


class TestIdempotencyGuard(unittest.TestCase):
    """
    has_changes(diff_output) is the single-responsibility predicate that
    decides whether to open a PR.  It must return False for empty / no-op
    diffs and True for any real change.
    """

    def setUp(self):
        self.script = _load_script()

    def test_has_changes_returns_false_for_empty_string(self):
        """No PR should be opened when copier diff output is completely empty."""
        self.assertFalse(
            self.script.has_changes(""),
            "has_changes must return False for an empty diff string",
        )

    def test_has_changes_returns_false_for_whitespace_only(self):
        """Whitespace-only output is not a change."""
        self.assertFalse(
            self.script.has_changes("   \n  \t\n"),
            "has_changes must return False for whitespace-only diff output",
        )

    def test_has_changes_returns_true_for_unified_diff_output(self):
        """A unified diff with +/- lines must be recognised as a real change."""
        diff = textwrap.dedent("""\
            --- a/.copier-answers.yml
            +++ b/.copier-answers.yml
            @@ -1 +1 @@
            -_commit: modules/python-service@20260304.0
            +_commit: modules/python-service@20260305.0
        """)
        self.assertTrue(
            self.script.has_changes(diff),
            "has_changes must return True for a non-empty diff",
        )

    def test_has_changes_returns_true_for_any_non_whitespace_output(self):
        """Even a single non-whitespace character counts as a change."""
        self.assertTrue(
            self.script.has_changes("x"),
            "has_changes must return True for any non-whitespace content",
        )

    def test_has_changes_returns_false_for_copier_nothing_to_do_message(self):
        """
        Copier may output 'Nothing to do.' when the template is already
        up to date.  This must be treated as no change so no PR is opened.
        """
        self.assertFalse(
            self.script.has_changes("Nothing to do."),
            "has_changes must return False for copier's 'Nothing to do.' message",
        )

    def test_has_changes_returns_false_for_copier_no_changes_message(self):
        """
        Copier may also output variants like 'No changes made.' or
        'No changes to apply.' — all must suppress PR creation.
        """
        for no_op_msg in [
            "No changes made.",
            "No changes to apply.",
            "Everything is up to date.",
        ]:
            with self.subTest(msg=no_op_msg):
                self.assertFalse(
                    self.script.has_changes(no_op_msg),
                    f"has_changes must return False for no-op message: {no_op_msg!r}",
                )


# ---------------------------------------------------------------------------
# TestConsumerDiscovery
# ---------------------------------------------------------------------------


class TestConsumerDiscovery(unittest.TestCase):
    """
    find_consumers(module_name, config_dir) scans config/repos/*.yaml and
    returns a list of repository slugs (spec.repository) whose module list
    includes an entry matching module_name.

    Tests use in-memory YAML fixtures written to a temp directory so they
    are self-contained and do not depend on the live config/repos/ contents.
    """

    def setUp(self):
        self.script = _load_script()

    def _make_overlay(self, repo: str, modules: list) -> dict:
        """Return a minimal RepositoryOverlay dict for a given repo and module list."""
        return {
            "apiVersion": "gitweave.io/v1",
            "kind": "RepositoryOverlay",
            "metadata": {"name": repo.split("/")[-1]},
            "spec": {
                "repository": repo,
                "modules": [{"name": m} for m in modules],
            },
        }

    def _write_yaml(self, tmp_dir: str, filename: str, data: dict) -> None:
        import yaml

        path = os.path.join(tmp_dir, filename)
        with open(path, "w") as f:
            yaml.dump(data, f)

    def test_finds_single_consumer_with_matching_module(self):
        """find_consumers returns the repo when exactly one overlay references the module."""
        import tempfile

        with tempfile.TemporaryDirectory() as tmp_dir:
            self._write_yaml(
                tmp_dir,
                "app-alpha.yaml",
                self._make_overlay("my-org/app-alpha", ["python-service", "ci-github-actions"]),
            )
            consumers = self.script.find_consumers("python-service", config_dir=tmp_dir)
            self.assertEqual(
                consumers,
                ["my-org/app-alpha"],
                f"Expected ['my-org/app-alpha'], got {consumers!r}",
            )

    def test_finds_multiple_consumers_referencing_same_module(self):
        """find_consumers returns all repos that reference the updated module."""
        import tempfile

        with tempfile.TemporaryDirectory() as tmp_dir:
            self._write_yaml(
                tmp_dir,
                "app-alpha.yaml",
                self._make_overlay("my-org/app-alpha", ["python-service"]),
            )
            self._write_yaml(
                tmp_dir,
                "app-beta.yaml",
                self._make_overlay("my-org/app-beta", ["python-service", "terraform-module"]),
            )
            consumers = self.script.find_consumers("python-service", config_dir=tmp_dir)
            self.assertIn(
                "my-org/app-alpha",
                consumers,
                "app-alpha should be a consumer of python-service",
            )
            self.assertIn(
                "my-org/app-beta",
                consumers,
                "app-beta should be a consumer of python-service",
            )
            self.assertEqual(len(consumers), 2, f"Expected 2 consumers, got {consumers!r}")

    def test_returns_empty_list_when_no_overlay_references_module(self):
        """find_consumers returns [] when no config file references the module."""
        import tempfile

        with tempfile.TemporaryDirectory() as tmp_dir:
            self._write_yaml(
                tmp_dir,
                "app-alpha.yaml",
                self._make_overlay("my-org/app-alpha", ["terraform-module"]),
            )
            consumers = self.script.find_consumers("python-service", config_dir=tmp_dir)
            self.assertEqual(
                consumers,
                [],
                f"Expected empty list when no consumer references python-service, got {consumers!r}",
            )

    def test_returns_empty_list_when_config_dir_is_empty(self):
        """find_consumers returns [] when there are no YAML files in config_dir."""
        import tempfile

        with tempfile.TemporaryDirectory() as tmp_dir:
            consumers = self.script.find_consumers("python-service", config_dir=tmp_dir)
            self.assertEqual(
                consumers,
                [],
                "Expected empty list for an empty config directory",
            )

    def test_ignores_overlays_without_modules_key(self):
        """
        Overlay files with no spec.modules section must be skipped without
        error — the module list is optional in the overlay schema.
        """
        import tempfile
        import yaml

        with tempfile.TemporaryDirectory() as tmp_dir:
            no_modules_overlay = {
                "apiVersion": "gitweave.io/v1",
                "kind": "RepositoryOverlay",
                "metadata": {"name": "app-gamma"},
                "spec": {"repository": "my-org/app-gamma"},
            }
            path = os.path.join(tmp_dir, "app-gamma.yaml")
            with open(path, "w") as f:
                yaml.dump(no_modules_overlay, f)

            consumers = self.script.find_consumers("python-service", config_dir=tmp_dir)
            self.assertEqual(
                consumers,
                [],
                "Overlay with no modules must not raise and must return empty list",
            )

    def test_module_name_matching_is_case_sensitive(self):
        """
        'Python-Service' must NOT match 'python-service' — module names are
        case-sensitive identifiers and must be matched exactly.
        """
        import tempfile

        with tempfile.TemporaryDirectory() as tmp_dir:
            self._write_yaml(
                tmp_dir,
                "app-alpha.yaml",
                self._make_overlay("my-org/app-alpha", ["Python-Service"]),
            )
            consumers = self.script.find_consumers("python-service", config_dir=tmp_dir)
            self.assertEqual(
                consumers,
                [],
                "Module name matching must be case-sensitive; 'Python-Service' != 'python-service'",
            )

    def test_partial_module_name_does_not_match(self):
        """
        A module named 'python-service-extra' must NOT be returned when
        find_consumers is called with 'python-service'.
        """
        import tempfile

        with tempfile.TemporaryDirectory() as tmp_dir:
            self._write_yaml(
                tmp_dir,
                "app-alpha.yaml",
                self._make_overlay("my-org/app-alpha", ["python-service-extra"]),
            )
            consumers = self.script.find_consumers("python-service", config_dir=tmp_dir)
            self.assertEqual(
                consumers,
                [],
                "'python-service-extra' must not match when searching for 'python-service'",
            )

    def test_does_not_include_consumer_that_only_uses_other_modules(self):
        """
        A repo that uses other modules but not the updated one must be excluded.
        """
        import tempfile

        with tempfile.TemporaryDirectory() as tmp_dir:
            self._write_yaml(
                tmp_dir,
                "app-alpha.yaml",
                self._make_overlay("my-org/app-alpha", ["terraform-module", "ci-github-actions"]),
            )
            consumers = self.script.find_consumers("python-service", config_dir=tmp_dir)
            self.assertNotIn(
                "my-org/app-alpha",
                consumers,
                "Repo not using python-service must not appear in consumers list",
            )


if __name__ == "__main__":
    unittest.main()
