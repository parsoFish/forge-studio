"""
Unit and integration tests for scripts/apply-overlays.py —
the Python script that reads config/repos/*.yaml and applies each overlay
via Copier to the target repository.

These tests drive the specification for the script (TDD red phase). They verify:

  Script existence and importability:
    - scripts/apply-overlays.py must exist
    - The script must be importable without SyntaxError or ModuleNotFoundError
    - The script must accept --help without crashing

  Config loading (load_overlay_configs):
    - Returns an empty list when the directory does not exist
    - Returns an empty list when the directory contains no .yaml files
    - Returns one config dict per .yaml file found
    - Ignores files that do not end in .yaml
    - Raises a descriptive error when a YAML file cannot be parsed
    - Each returned dict contains the parsed YAML document

  Overlay application (apply_overlay):
    - Does NOT clone or run copier in dry-run mode
    - Returns a dry-run result describing what would happen (repo slug + modules list)
    - Clones the target repository using GITHUB_TOKEN for auth
    - Runs 'copier copy <module-path>' for each module in spec.modules
    - Returns a success result object when all operations succeed
    - Returns a failure result with an error message when clone fails
    - Returns a failure result with an error message when copier fails
    - Failure result always includes the repo slug and a non-empty error message

  Dry-run mode (--dry-run flag):
    - Prints what would be applied for each repo without executing
    - Exits 0 even when configs are present in dry-run mode
    - Does not call git, copier, or gh commands
    - Does NOT require GITHUB_TOKEN in dry-run mode

  Exit code behaviour:
    - Exits non-zero when GITHUB_TOKEN is absent in apply mode
    - Prints a descriptive error when GITHUB_TOKEN is absent
    - Exits 0 when configs are empty and dry-run is active

  Per-repo reporting:
    - Prints the repo slug in dry-run output
    - Prints module names in dry-run output
    - Includes a summary line after processing all repos

  CLI arguments:
    - Accepts --dry-run flag
    - Accepts --config-dir <path>
    - Accepts --modules-dir <path>
    - Defaults config-dir to config/repos/ relative to repo root

All tests will fail until scripts/apply-overlays.py is implemented.
"""

from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch

import yaml

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPT_PATH = os.path.join(REPO_ROOT, "scripts", "apply-overlays.py")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _run_script(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    """
    Invoke apply-overlays.py with the given arguments.
    Always captures stdout+stderr and never raises on non-zero exit.
    If env is provided, it is merged with (not replaces) os.environ.
    """
    run_env = os.environ.copy()
    if env is not None:
        run_env.update(env)
    return subprocess.run(
        [sys.executable, SCRIPT_PATH, *args],
        capture_output=True,
        text=True,
        env=run_env,
    )


def _load_script():
    """
    Import apply-overlays.py as a Python module so its public functions
    can be unit-tested directly without invoking a subprocess.

    Raises FileNotFoundError with a descriptive message when the script
    does not yet exist.
    """
    if not os.path.isfile(SCRIPT_PATH):
        raise FileNotFoundError(
            f"scripts/apply-overlays.py not found at {SCRIPT_PATH} — "
            "the script must be implemented before these unit tests can pass"
        )
    spec = importlib.util.spec_from_file_location("apply_overlays", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _write_yaml(directory: str, filename: str, doc: dict) -> str:
    """Write doc as YAML to directory/filename and return the full path."""
    path = os.path.join(directory, filename)
    with open(path, "w") as f:
        yaml.dump(doc, f, default_flow_style=False)
    return path


def _minimal_overlay(repo: str = "my-org/my-app", modules: list | None = None) -> dict:
    """Return the smallest valid RepositoryOverlay document."""
    doc: dict = {
        "apiVersion": "gitweave.io/v1",
        "kind": "RepositoryOverlay",
        "metadata": {"name": "my-app"},
        "spec": {"repository": repo},
    }
    if modules is not None:
        doc["spec"]["modules"] = modules
    return doc


# ---------------------------------------------------------------------------
# TestScriptExists
# ---------------------------------------------------------------------------


class TestScriptExists(unittest.TestCase):
    """Basic existence and importability checks."""

    def test_apply_overlays_script_exists(self):
        """scripts/apply-overlays.py must exist at the expected path."""
        self.assertTrue(
            os.path.isfile(SCRIPT_PATH),
            f"scripts/apply-overlays.py is missing — expected at {SCRIPT_PATH}. "
            "Cherry-pick the file from feat/GitWeave-dora-mttr before running these tests.",
        )

    def test_script_is_runnable_without_syntax_errors(self):
        """The script must accept --help without SyntaxError or ModuleNotFoundError."""
        result = _run_script("--help")
        self.assertNotIn(
            "SyntaxError",
            result.stderr,
            f"scripts/apply-overlays.py contains a SyntaxError:\n{result.stderr}",
        )
        self.assertNotIn(
            "ModuleNotFoundError",
            result.stderr,
            f"scripts/apply-overlays.py has an unresolvable import:\n{result.stderr}",
        )

    def test_script_exposes_load_overlay_configs_function(self):
        """The script must expose a callable load_overlay_configs(config_dir)."""
        mod = _load_script()
        self.assertTrue(
            callable(getattr(mod, "load_overlay_configs", None)),
            "scripts/apply-overlays.py does not expose a callable 'load_overlay_configs'",
        )

    def test_script_exposes_apply_overlay_function(self):
        """The script must expose a callable apply_overlay(config, modules_dir, ...)."""
        mod = _load_script()
        self.assertTrue(
            callable(getattr(mod, "apply_overlay", None)),
            "scripts/apply-overlays.py does not expose a callable 'apply_overlay'",
        )


# ---------------------------------------------------------------------------
# TestLoadOverlayConfigs
# ---------------------------------------------------------------------------


class TestLoadOverlayConfigs(unittest.TestCase):
    """Unit tests for the load_overlay_configs function."""

    def setUp(self):
        self.mod = _load_script()

    def test_returns_empty_list_when_directory_does_not_exist(self):
        """load_overlay_configs returns [] for a non-existent directory."""
        result = self.mod.load_overlay_configs("/nonexistent/path/config/repos")
        self.assertEqual(
            result,
            [],
            "load_overlay_configs should return [] when directory does not exist, "
            f"got: {result}",
        )

    def test_returns_empty_list_when_directory_has_no_yaml_files(self):
        """load_overlay_configs returns [] when no .yaml files are present."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with open(os.path.join(tmpdir, "README.md"), "w") as f:
                f.write("# not yaml\n")
            result = self.mod.load_overlay_configs(tmpdir)
        self.assertEqual(
            result,
            [],
            "load_overlay_configs should return [] for a directory with no .yaml files",
        )

    def test_returns_one_item_per_yaml_file(self):
        """load_overlay_configs returns one dict per .yaml file found."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "app-a.yaml", _minimal_overlay("org/app-a"))
            _write_yaml(tmpdir, "app-b.yaml", _minimal_overlay("org/app-b"))
            result = self.mod.load_overlay_configs(tmpdir)
        self.assertEqual(
            len(result),
            2,
            f"Expected 2 configs for 2 .yaml files, got {len(result)}: {result}",
        )

    def test_ignores_files_without_yaml_extension(self):
        """load_overlay_configs ignores .yml, .json, and other non-.yaml files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "app.yaml", _minimal_overlay("org/app"))
            with open(os.path.join(tmpdir, "app.yml"), "w") as f:
                yaml.dump(_minimal_overlay("org/other"), f)
            with open(os.path.join(tmpdir, "notes.txt"), "w") as f:
                f.write("plain text\n")
            result = self.mod.load_overlay_configs(tmpdir)
        self.assertEqual(
            len(result),
            1,
            f"load_overlay_configs should count only .yaml files, got {len(result)} configs",
        )

    def test_each_returned_dict_contains_parsed_yaml_document(self):
        """Each item returned by load_overlay_configs contains the parsed YAML doc."""
        overlay = _minimal_overlay("org/my-service", modules=[{"name": "lang-node"}])
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "my-service.yaml", overlay)
            result = self.mod.load_overlay_configs(tmpdir)
        self.assertEqual(len(result), 1)
        doc = result[0]
        self.assertEqual(
            doc.get("spec", {}).get("repository"),
            "org/my-service",
            f"Parsed config does not contain expected spec.repository: {doc}",
        )

    def test_raises_descriptive_error_for_unparseable_yaml(self):
        """load_overlay_configs raises an exception that mentions the failing file name."""
        with tempfile.TemporaryDirectory() as tmpdir:
            bad_path = os.path.join(tmpdir, "broken.yaml")
            with open(bad_path, "w") as f:
                f.write("apiVersion: gitweave.io/v1\n  bad_indent: [\n")
            with self.assertRaises(Exception) as ctx:
                self.mod.load_overlay_configs(tmpdir)
        self.assertIn(
            "broken.yaml",
            str(ctx.exception),
            f"Exception message does not mention 'broken.yaml': {ctx.exception}",
        )


# ---------------------------------------------------------------------------
# TestApplyOverlayDryRun
# ---------------------------------------------------------------------------


class TestApplyOverlayDryRun(unittest.TestCase):
    """Unit tests for dry-run behaviour of apply_overlay."""

    def setUp(self):
        self.mod = _load_script()

    @patch("subprocess.run")
    def test_dry_run_does_not_call_subprocess(self, mock_run: MagicMock):
        """apply_overlay in dry-run mode must not invoke any subprocess."""
        config = _minimal_overlay("org/my-app", modules=[{"name": "lang-node"}])
        self.mod.apply_overlay(
            config=config,
            modules_dir=os.path.join(REPO_ROOT, "modules"),
            github_token="fake-token",
            dry_run=True,
        )
        mock_run.assert_not_called()

    @patch("subprocess.run")
    def test_dry_run_returns_result_with_dry_run_true(self, mock_run: MagicMock):
        """apply_overlay in dry-run returns a result dict with dry_run=True."""
        config = _minimal_overlay("org/my-app", modules=[{"name": "lang-node"}])
        result = self.mod.apply_overlay(
            config=config,
            modules_dir=os.path.join(REPO_ROOT, "modules"),
            github_token="fake-token",
            dry_run=True,
        )
        self.assertTrue(
            result.get("dry_run"),
            f"Dry-run apply_overlay result should have dry_run=True: {result}",
        )

    @patch("subprocess.run")
    def test_dry_run_result_contains_repo_slug(self, mock_run: MagicMock):
        """apply_overlay dry-run result includes the repo slug."""
        config = _minimal_overlay("org/target-repo", modules=[{"name": "lang-node"}])
        result = self.mod.apply_overlay(
            config=config,
            modules_dir=os.path.join(REPO_ROOT, "modules"),
            github_token="fake-token",
            dry_run=True,
        )
        self.assertEqual(
            result.get("repo"),
            "org/target-repo",
            f"Dry-run result should include 'repo': {result}",
        )

    @patch("subprocess.run")
    def test_dry_run_result_lists_modules_that_would_be_applied(
        self, mock_run: MagicMock
    ):
        """apply_overlay dry-run result lists the modules that would be applied."""
        config = _minimal_overlay(
            "org/my-app",
            modules=[{"name": "lang-node"}, {"name": "ci-github-actions"}],
        )
        result = self.mod.apply_overlay(
            config=config,
            modules_dir=os.path.join(REPO_ROOT, "modules"),
            github_token="fake-token",
            dry_run=True,
        )
        modules_in_result = result.get("modules", [])
        self.assertIn(
            "lang-node",
            modules_in_result,
            f"Dry-run result should list 'lang-node' in modules: {result}",
        )
        self.assertIn(
            "ci-github-actions",
            modules_in_result,
            f"Dry-run result should list 'ci-github-actions' in modules: {result}",
        )

    @patch("subprocess.run")
    def test_dry_run_result_for_overlay_with_no_modules(self, mock_run: MagicMock):
        """apply_overlay dry-run result handles an overlay with no modules gracefully."""
        config = _minimal_overlay("org/bare-repo")  # no modules key
        result = self.mod.apply_overlay(
            config=config,
            modules_dir=os.path.join(REPO_ROOT, "modules"),
            github_token="fake-token",
            dry_run=True,
        )
        # Should still return a result with dry_run=True and the repo slug
        self.assertTrue(result.get("dry_run"), f"dry_run flag missing from result: {result}")
        self.assertEqual(
            result.get("repo"),
            "org/bare-repo",
            f"Result must contain repo slug: {result}",
        )
        # modules list should be empty or absent — but not raise an error
        modules_in_result = result.get("modules", [])
        self.assertIsInstance(
            modules_in_result,
            list,
            f"'modules' in result should be a list, got: {type(modules_in_result)}",
        )


# ---------------------------------------------------------------------------
# TestApplyOverlayFailures
# ---------------------------------------------------------------------------


class TestApplyOverlayFailures(unittest.TestCase):
    """Unit tests for failure cases in apply_overlay (non-dry-run with mocked subprocess)."""

    def setUp(self):
        self.mod = _load_script()
        self.config = _minimal_overlay("org/my-app", modules=[{"name": "lang-node"}])

    def _make_failed_run(self, stderr: str = "error occurred") -> MagicMock:
        """Return a mock CompletedProcess with returncode=1."""
        mock = MagicMock()
        mock.returncode = 1
        mock.stdout = ""
        mock.stderr = stderr
        return mock

    @patch("subprocess.run")
    @patch("tempfile.TemporaryDirectory")
    def test_returns_failure_result_when_clone_fails(
        self, mock_tmpdir: MagicMock, mock_run: MagicMock
    ):
        """apply_overlay returns success=False when git clone exits non-zero."""
        mock_tmpdir.return_value.__enter__ = MagicMock(return_value="/tmp/fakedir")
        mock_tmpdir.return_value.__exit__ = MagicMock(return_value=False)
        mock_run.return_value = self._make_failed_run("repository not found")

        result = self.mod.apply_overlay(
            config=self.config,
            modules_dir="/repo/modules",
            github_token="token",
            dry_run=False,
        )

        self.assertFalse(
            result.get("success"),
            f"apply_overlay should return success=False when clone fails: {result}",
        )

    @patch("subprocess.run")
    @patch("tempfile.TemporaryDirectory")
    def test_failure_result_includes_error_key(
        self, mock_tmpdir: MagicMock, mock_run: MagicMock
    ):
        """Failure result must contain a non-empty 'error' key."""
        mock_tmpdir.return_value.__enter__ = MagicMock(return_value="/tmp/fakedir")
        mock_tmpdir.return_value.__exit__ = MagicMock(return_value=False)
        mock_run.return_value = self._make_failed_run("authentication required")

        result = self.mod.apply_overlay(
            config=self.config,
            modules_dir="/repo/modules",
            github_token="token",
            dry_run=False,
        )

        self.assertIn(
            "error",
            result,
            f"Failure result must include an 'error' key: {result}",
        )
        self.assertTrue(
            bool(result.get("error")),
            f"Failure result 'error' must be non-empty: {result}",
        )

    @patch("subprocess.run")
    @patch("tempfile.TemporaryDirectory")
    def test_failure_result_contains_repo_slug(
        self, mock_tmpdir: MagicMock, mock_run: MagicMock
    ):
        """Failure result always includes the repo slug for identification."""
        mock_tmpdir.return_value.__enter__ = MagicMock(return_value="/tmp/fakedir")
        mock_tmpdir.return_value.__exit__ = MagicMock(return_value=False)
        mock_run.return_value = self._make_failed_run()

        result = self.mod.apply_overlay(
            config=self.config,
            modules_dir="/repo/modules",
            github_token="token",
            dry_run=False,
        )

        self.assertEqual(
            result.get("repo"),
            "org/my-app",
            f"Failure result must contain the repo slug 'org/my-app': {result}",
        )

    @patch("subprocess.run")
    @patch("tempfile.TemporaryDirectory")
    def test_returns_failure_when_copier_fails(
        self, mock_tmpdir: MagicMock, mock_run: MagicMock
    ):
        """apply_overlay returns success=False when copier exits non-zero."""
        mock_tmpdir.return_value.__enter__ = MagicMock(return_value="/tmp/fakedir")
        mock_tmpdir.return_value.__exit__ = MagicMock(return_value=False)

        def side_effect(cmd, **kwargs):
            result = MagicMock()
            if "clone" in str(cmd):
                result.returncode = 0
                result.stdout = ""
                result.stderr = ""
            elif "copier" in str(cmd):
                result.returncode = 1
                result.stdout = ""
                result.stderr = "template not found"
            else:
                result.returncode = 0
                result.stdout = ""
                result.stderr = ""
            return result

        mock_run.side_effect = side_effect

        result = self.mod.apply_overlay(
            config=self.config,
            modules_dir="/repo/modules",
            github_token="token",
            dry_run=False,
        )

        self.assertFalse(
            result.get("success"),
            f"apply_overlay should return success=False when copier fails: {result}",
        )


# ---------------------------------------------------------------------------
# TestScriptExitCodes
# ---------------------------------------------------------------------------


class TestScriptExitCodes(unittest.TestCase):
    """Subprocess-level integration tests that check exit codes."""

    def test_exits_zero_in_dry_run_with_empty_config_dir(self):
        """Script exits 0 in --dry-run when the config dir is absent."""
        result = _run_script(
            "--dry-run",
            "--config-dir",
            "/nonexistent/path",
        )
        self.assertEqual(
            result.returncode,
            0,
            f"Script should exit 0 in dry-run with no configs.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_zero_in_dry_run_with_valid_configs(self):
        """Script exits 0 in --dry-run even with overlay configs present."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(
                tmpdir, "app.yaml", _minimal_overlay("org/app", [{"name": "lang-node"}])
            )
            result = _run_script(
                "--dry-run",
                "--config-dir",
                tmpdir,
            )
        self.assertEqual(
            result.returncode,
            0,
            f"Script should exit 0 in dry-run with valid configs.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_dry_run_does_not_require_github_token(self):
        """Script must not require GITHUB_TOKEN when --dry-run is active."""
        env_without_token = {k: v for k, v in os.environ.items() if k != "GITHUB_TOKEN"}
        result = subprocess.run(
            [sys.executable, SCRIPT_PATH, "--dry-run", "--config-dir", "/nonexistent"],
            capture_output=True,
            text=True,
            env=env_without_token,
        )
        self.assertEqual(
            result.returncode,
            0,
            f"Script should exit 0 in dry-run without GITHUB_TOKEN.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_nonzero_without_github_token_in_apply_mode(self):
        """Script must exit non-zero when GITHUB_TOKEN is absent in apply mode."""
        env_without_token = {k: v for k, v in os.environ.items() if k != "GITHUB_TOKEN"}
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "app.yaml", _minimal_overlay("org/app"))
            result = subprocess.run(
                [sys.executable, SCRIPT_PATH, "--config-dir", tmpdir],
                capture_output=True,
                text=True,
                env=env_without_token,
            )
        self.assertNotEqual(
            result.returncode,
            0,
            f"Script should exit non-zero when GITHUB_TOKEN is absent in apply mode.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_error_message_mentions_github_token_when_absent(self):
        """The error output must mention GITHUB_TOKEN when the variable is missing."""
        env_without_token = {k: v for k, v in os.environ.items() if k != "GITHUB_TOKEN"}
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "app.yaml", _minimal_overlay("org/app"))
            result = subprocess.run(
                [sys.executable, SCRIPT_PATH, "--config-dir", tmpdir],
                capture_output=True,
                text=True,
                env=env_without_token,
            )
        combined = result.stdout + result.stderr
        self.assertIn(
            "GITHUB_TOKEN",
            combined,
            f"Script should mention 'GITHUB_TOKEN' in output when it is absent.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# TestDryRunOutput
# ---------------------------------------------------------------------------


class TestDryRunOutput(unittest.TestCase):
    """Tests for dry-run output content."""

    def test_dry_run_prints_repo_slug_in_output(self):
        """Dry-run output must include the repository slug for each configured repo."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(
                tmpdir,
                "my-service.yaml",
                _minimal_overlay("org/my-service", [{"name": "lang-node"}]),
            )
            result = _run_script(
                "--dry-run",
                "--config-dir",
                tmpdir,
            )
        combined = result.stdout + result.stderr
        self.assertIn(
            "org/my-service",
            combined,
            f"Dry-run output must include the repo slug 'org/my-service'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_dry_run_prints_module_names_in_output(self):
        """Dry-run output must include module names that would be applied."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(
                tmpdir,
                "svc.yaml",
                _minimal_overlay(
                    "org/svc",
                    [{"name": "lang-node"}, {"name": "ci-github-actions"}],
                ),
            )
            result = _run_script(
                "--dry-run",
                "--config-dir",
                tmpdir,
            )
        combined = result.stdout + result.stderr
        self.assertIn(
            "lang-node",
            combined,
            f"Dry-run output should mention module 'lang-node'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )
        self.assertIn(
            "ci-github-actions",
            combined,
            f"Dry-run output should mention module 'ci-github-actions'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_dry_run_prints_summary_line(self):
        """Output must include a summary line after processing all repos."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "app.yaml", _minimal_overlay("org/app"))
            result = _run_script(
                "--dry-run",
                "--config-dir",
                tmpdir,
            )
        combined = result.stdout + result.stderr
        has_summary = (
            "summary" in combined.lower()
            or "succeeded" in combined.lower()
            or "failed" in combined.lower()
            or re.search(r"\d+\s*repo", combined.lower())
            or re.search(r"\d+/\d+", combined)
        )
        self.assertTrue(
            has_summary,
            f"Output must include a summary of results.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_dry_run_lists_all_repos(self):
        """Dry-run output includes a status line for each configured repo."""
        with tempfile.TemporaryDirectory() as tmpdir:
            for name in ("app-a.yaml", "app-b.yaml"):
                repo = f"org/{name.replace('.yaml', '')}"
                _write_yaml(tmpdir, name, _minimal_overlay(repo))
            result = _run_script(
                "--dry-run",
                "--config-dir",
                tmpdir,
            )
        combined = result.stdout + result.stderr
        self.assertIn(
            "org/app-a",
            combined,
            f"Output should include 'org/app-a'.\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )
        self.assertIn(
            "org/app-b",
            combined,
            f"Output should include 'org/app-b'.\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# TestCliArguments
# ---------------------------------------------------------------------------


class TestCliArguments(unittest.TestCase):
    """Tests for the command-line interface argument contract."""

    def test_accepts_dry_run_flag(self):
        """Script must accept --dry-run without an 'unrecognized argument' error."""
        result = _run_script("--dry-run", "--config-dir", "/nonexistent")
        self.assertNotIn(
            "unrecognized argument",
            result.stderr,
            f"Script rejected --dry-run.\nstderr: {result.stderr}",
        )
        self.assertNotIn(
            "error: argument",
            result.stderr.lower(),
            f"Script reported argument error for --dry-run.\nstderr: {result.stderr}",
        )

    def test_accepts_config_dir_argument(self):
        """Script must accept --config-dir <path> without an argument error."""
        result = _run_script("--config-dir", "/nonexistent", "--dry-run")
        self.assertNotIn(
            "unrecognized argument",
            result.stderr,
            f"Script rejected --config-dir.\nstderr: {result.stderr}",
        )

    def test_accepts_modules_dir_argument(self):
        """Script must accept --modules-dir <path> so the modules directory can be overridden."""
        result = _run_script(
            "--dry-run",
            "--config-dir",
            "/nonexistent",
            "--modules-dir",
            "/nonexistent/modules",
        )
        self.assertNotIn(
            "unrecognized argument",
            result.stderr,
            f"Script rejected --modules-dir.\nstderr: {result.stderr}",
        )

    def test_defaults_config_dir_without_explicit_flag(self):
        """Without --config-dir, the script defaults instead of requiring an argument."""
        result = _run_script("--dry-run")
        self.assertNotIn(
            "required",
            result.stderr.lower(),
            f"Script requires --config-dir but should default it.\nstderr: {result.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
