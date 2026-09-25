"""
Integration smoke tests for the apply-overlays.py --dry-run end-to-end pipeline.

This is the integration/smoke layer — real script execution against real fixture
files with no mocks.  These tests prove AC-6: the dry-run completes successfully
and demonstrates the complete overlay loop.

The tests verify:
  1. scripts/apply-overlays.py exists and is runnable by Python
  2. config/repos/example.yaml exists and references the example-template module
  3. Running 'apply-overlays.py --dry-run config/repos/example.yaml' exits 0
  4. stdout contains the repository name declared in config/repos/example.yaml
  5. stdout contains the string 'example-template'

All tests fail until scripts/apply-overlays.py and config/repos/example.yaml
are implemented (TDD red phase).
"""

import os
import subprocess
import sys
import unittest

import yaml

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPT_PATH = os.path.join(REPO_ROOT, "scripts", "apply-overlays.py")
EXAMPLE_OVERLAY_PATH = os.path.join(REPO_ROOT, "config", "repos", "example.yaml")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _run_dry_run(config_path: str) -> subprocess.CompletedProcess:
    """Invoke apply-overlays.py --dry-run <config_path>. Never raises on failure."""
    return subprocess.run(
        [sys.executable, SCRIPT_PATH, "--dry-run", config_path],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


def _run_script_with_args(*args: str) -> subprocess.CompletedProcess:
    """Invoke apply-overlays.py with arbitrary arguments. Never raises on failure."""
    return subprocess.run(
        [sys.executable, SCRIPT_PATH, *args],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


def _load_example_overlay() -> dict:
    """Parse config/repos/example.yaml and return the document dict."""
    with open(EXAMPLE_OVERLAY_PATH) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------


class TestApplyOverlaysScriptExists(unittest.TestCase):
    """Baseline: the script must exist before any functional tests can run."""

    def test_apply_overlays_script_exists_at_expected_path(self):
        """scripts/apply-overlays.py must exist at scripts/apply-overlays.py."""
        self.assertTrue(
            os.path.isfile(SCRIPT_PATH),
            f"scripts/apply-overlays.py is missing — expected at {SCRIPT_PATH}. "
            "Create the script so the dry-run CI job can invoke it.",
        )

    def test_script_is_runnable_by_python_without_syntax_errors(self):
        """The script must load without SyntaxError so Python can execute it."""
        result = _run_script_with_args("--help")
        self.assertNotIn(
            "SyntaxError",
            result.stderr,
            f"scripts/apply-overlays.py has a SyntaxError:\n{result.stderr}",
        )

    def test_script_is_runnable_by_python_without_import_errors(self):
        """The script must not have unresolvable imports."""
        result = _run_script_with_args("--help")
        self.assertNotIn(
            "ModuleNotFoundError",
            result.stderr,
            f"scripts/apply-overlays.py has an unresolvable import:\n{result.stderr}",
        )


class TestExampleOverlayFileExists(unittest.TestCase):
    """config/repos/example.yaml must exist with the required content."""

    def test_config_repos_directory_exists(self):
        """config/repos/ directory must exist to house overlay configurations."""
        repos_dir = os.path.join(REPO_ROOT, "config", "repos")
        self.assertTrue(
            os.path.isdir(repos_dir),
            "config/repos/ directory is missing. "
            "Create the directory and add example.yaml inside it.",
        )

    def test_example_yaml_exists_in_config_repos(self):
        """config/repos/example.yaml must exist as the fixture for the smoke test."""
        self.assertTrue(
            os.path.isfile(EXAMPLE_OVERLAY_PATH),
            f"config/repos/example.yaml is missing — expected at {EXAMPLE_OVERLAY_PATH}. "
            "Create this file referencing the example-template module.",
        )

    def test_example_yaml_is_valid_yaml(self):
        """config/repos/example.yaml must parse as a valid YAML mapping."""
        doc = _load_example_overlay()
        self.assertIsInstance(
            doc,
            dict,
            "config/repos/example.yaml did not parse as a YAML mapping — "
            "check the file for syntax errors.",
        )

    def test_example_yaml_has_spec_repository(self):
        """config/repos/example.yaml must declare spec.repository."""
        doc = _load_example_overlay()
        repo = doc.get("spec", {}).get("repository")
        self.assertIsNotNone(
            repo,
            "config/repos/example.yaml is missing 'spec.repository'. "
            "The dry-run output must include the repository name so CI can grep for it.",
        )
        self.assertIsInstance(
            repo,
            str,
            f"spec.repository must be a non-empty string, got {type(repo).__name__!r}.",
        )
        self.assertTrue(
            repo.strip(),
            "spec.repository is an empty string — it must be a valid owner/repo value.",
        )

    def test_example_yaml_references_example_template_module(self):
        """
        config/repos/example.yaml must list example-template in spec.modules.
        This is required so the dry-run output contains 'example-template',
        which the CI grep step asserts.
        """
        doc = _load_example_overlay()
        modules = doc.get("spec", {}).get("modules", [])
        module_names = [m.get("name", "") for m in modules if isinstance(m, dict)]
        self.assertIn(
            "example-template",
            module_names,
            f"config/repos/example.yaml spec.modules does not include 'example-template'. "
            f"Found: {module_names!r}. "
            "Add '- name: example-template' to spec.modules.",
        )

    def test_example_template_module_exists_in_modules_directory(self):
        """
        modules/example-template/ must exist so apply-overlays.py can resolve
        the module when processing config/repos/example.yaml.
        """
        module_dir = os.path.join(REPO_ROOT, "modules", "example-template")
        self.assertTrue(
            os.path.isdir(module_dir),
            "modules/example-template/ directory is missing. "
            "The script must be able to locate this module during the dry-run.",
        )


class TestDryRunExitCode(unittest.TestCase):
    """apply-overlays.py --dry-run must exit 0 for a valid overlay (AC-6)."""

    def test_dry_run_exits_zero_for_example_overlay(self):
        """
        'apply-overlays.py --dry-run config/repos/example.yaml' must exit 0,
        proving the full pipeline completes without errors (AC-6).
        The CI job fails the merge if this exits non-zero.
        """
        result = _run_dry_run(EXAMPLE_OVERLAY_PATH)
        self.assertEqual(
            result.returncode,
            0,
            f"apply-overlays.py --dry-run exited {result.returncode} — expected 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_dry_run_does_not_raise_uncaught_exception(self):
        """
        The script must not crash with an unhandled exception.
        A Traceback in stderr with a non-zero exit is a script bug, not a
        valid validation failure.
        """
        result = _run_dry_run(EXAMPLE_OVERLAY_PATH)
        if result.returncode != 0:
            self.assertNotIn(
                "Traceback",
                result.stderr,
                f"apply-overlays.py --dry-run crashed with an uncaught exception:\n"
                f"stderr: {result.stderr}",
            )


class TestDryRunOutputContainsRepositoryName(unittest.TestCase):
    """
    The dry-run output must contain the repository name so the CI grep step
    can assert the correct overlay was processed.
    """

    def test_dry_run_stdout_contains_repository_name_from_example_yaml(self):
        """
        stdout (or stderr) must include the spec.repository value from
        config/repos/example.yaml.  The CI job greps for this string after the
        dry-run to confirm the right overlay was processed.
        """
        doc = _load_example_overlay()
        repo_name = doc.get("spec", {}).get("repository", "")
        self.assertTrue(
            repo_name,
            "Cannot verify repository name in output — "
            "config/repos/example.yaml spec.repository is missing or empty.",
        )
        result = _run_dry_run(EXAMPLE_OVERLAY_PATH)
        combined = result.stdout + result.stderr
        self.assertIn(
            repo_name,
            combined,
            f"apply-overlays.py --dry-run output does not contain the repository name "
            f"'{repo_name}' from config/repos/example.yaml.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}\n"
            "The script must log the target repository in its dry-run output so "
            "the CI grep step can assert it.",
        )


class TestDryRunOutputContainsExampleTemplate(unittest.TestCase):
    """
    The dry-run output must contain 'example-template' so the CI grep step
    can confirm the module was identified and processed.
    """

    def test_dry_run_stdout_contains_example_template_string(self):
        """
        stdout (or stderr) must include the string 'example-template'.
        The CI job greps for 'example-template' after the dry-run.
        """
        result = _run_dry_run(EXAMPLE_OVERLAY_PATH)
        combined = result.stdout + result.stderr
        self.assertIn(
            "example-template",
            combined,
            f"apply-overlays.py --dry-run output does not contain 'example-template'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}\n"
            "The script must log the module name in its dry-run output.",
        )

    def test_dry_run_output_is_non_empty(self):
        """
        The dry-run must produce visible output.  A silent exit 0 is not
        sufficient — the CI grep steps require inspectable stdout.
        """
        result = _run_dry_run(EXAMPLE_OVERLAY_PATH)
        combined = result.stdout + result.stderr
        self.assertTrue(
            combined.strip(),
            "apply-overlays.py --dry-run produced no output. "
            "The script must emit visible output so the CI grep steps have "
            "something to inspect.",
        )


class TestDryRunDoesNotModifyExternalRepos(unittest.TestCase):
    """
    The --dry-run flag must guarantee no external changes occur.
    This is the safety contract that allows the job to run without credentials.
    """

    def test_dry_run_flag_is_accepted_by_script(self):
        """
        The script must accept --dry-run as a valid flag and not fail with
        'unrecognized argument' or 'invalid option'.
        """
        result = _run_dry_run(EXAMPLE_OVERLAY_PATH)
        combined = result.stderr.lower()
        self.assertNotIn(
            "unrecognized argument",
            combined,
            "apply-overlays.py does not recognise --dry-run as a valid argument. "
            "Add --dry-run support so the CI smoke job can invoke it safely.",
        )
        self.assertNotIn(
            "invalid option",
            combined,
            "apply-overlays.py rejected --dry-run. "
            "The flag must be accepted for safe CI usage.",
        )


if __name__ == "__main__":
    unittest.main()
