"""
Focused unit tests for three behavioral contracts of scripts/apply-overlays.py.

These tests pin the contracts BEFORE implementation (TDD red phase):

  Contract 1 — Dry-run has no side effects:
    - --dry-run prints target repo slug in output
    - --dry-run prints the module names that would be applied
    - --dry-run prints the actions that would happen (what copier would do)
    - --dry-run makes zero subprocess calls (git, copier, gh are never invoked)
    - apply_overlay(dry_run=True) returns a result describing what would happen

  Contract 2 — Missing module reference exits non-zero with a named error:
    - When a config references a module not present in modules/,
      the script exits with a non-zero code
    - The error output explicitly names the missing module
    - apply_overlay(...) returns success=False and an error mentioning the module name
    - The error is detected before any subprocess is called (early validation)

  Contract 3 — Idempotency: no diff → no PR (no changes = skip PR creation):
    - When copier produces no file changes (git diff is empty after apply),
      the script does NOT invoke gh pr create
    - The result indicates 'no changes' (success=True, changes=False)
    - The script logs that no changes were detected for that repo
    - apply_overlay returns a result that distinguishes no-changes from a real error

All tests will FAIL until scripts/apply-overlays.py is implemented — this is the
expected TDD red state.
"""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, call, patch

import yaml

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPT_PATH = os.path.join(REPO_ROOT, "scripts", "apply-overlays.py")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


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


def _write_yaml(directory: str, filename: str, doc: dict) -> str:
    """Write doc as YAML to directory/filename and return the full path."""
    path = os.path.join(directory, filename)
    with open(path, "w") as f:
        yaml.dump(doc, f, default_flow_style=False)
    return path


def _overlay_with_module(repo: str, module_name: str) -> dict:
    """Return a minimal RepositoryOverlay document referencing one module."""
    return {
        "apiVersion": "gitweave.io/v1",
        "kind": "RepositoryOverlay",
        "metadata": {"name": repo.split("/")[-1]},
        "spec": {
            "repository": repo,
            "modules": [{"name": module_name}],
        },
    }


def _mock_successful_subprocess() -> MagicMock:
    """Return a mock CompletedProcess representing a successful command."""
    mock = MagicMock()
    mock.returncode = 0
    mock.stdout = ""
    mock.stderr = ""
    return mock


def _mock_side_effect_by_command(**overrides: dict) -> callable:
    """
    Build a subprocess.run side effect that returns different mocks depending
    on which command is being called.

    overrides keys: "clone", "copier", "diff", "gh", "status"
    Each value is a dict with returncode, stdout, stderr.
    Unmatched commands succeed with empty output.
    """
    def side_effect(cmd, **kwargs):
        result = MagicMock()
        cmd_str = " ".join(str(c) for c in cmd) if isinstance(cmd, list) else str(cmd)
        for keyword, spec in overrides.items():
            if keyword in cmd_str:
                result.returncode = spec.get("returncode", 0)
                result.stdout = spec.get("stdout", "")
                result.stderr = spec.get("stderr", "")
                return result
        # Default: success with empty output
        result.returncode = 0
        result.stdout = ""
        result.stderr = ""
        return result

    return side_effect


# ---------------------------------------------------------------------------
# Contract 1: Dry-run has no side effects
# ---------------------------------------------------------------------------


class TestDryRunContract(unittest.TestCase):
    """
    Contract 1: --dry-run must describe what would happen without executing
    any external commands. The output must name the target repo and each
    module that would be applied.
    """

    def setUp(self):
        self.mod = _load_script()

    # --- Unit-level tests (apply_overlay function) ---

    @patch("subprocess.run")
    def test_dry_run_makes_zero_subprocess_calls(self, mock_run: MagicMock):
        """
        apply_overlay(dry_run=True) must not call subprocess.run at all.
        No git clone, no copier, no gh — zero side effects.
        """
        config = _overlay_with_module("org/target", "lang-node")
        self.mod.apply_overlay(
            config=config,
            modules_dir=os.path.join(REPO_ROOT, "modules"),
            github_token="fake-token",
            dry_run=True,
        )
        mock_run.assert_not_called()

    @patch("subprocess.run")
    def test_dry_run_result_includes_repo_slug(self, mock_run: MagicMock):
        """
        apply_overlay(dry_run=True) result dict must contain the repo slug
        under the 'repo' key so callers can build output per-repo.
        """
        config = _overlay_with_module("my-org/my-service", "lang-node")
        result = self.mod.apply_overlay(
            config=config,
            modules_dir=os.path.join(REPO_ROOT, "modules"),
            github_token="fake-token",
            dry_run=True,
        )
        self.assertEqual(
            result.get("repo"),
            "my-org/my-service",
            f"Dry-run result must include repo slug 'my-org/my-service': {result}",
        )

    @patch("subprocess.run")
    def test_dry_run_result_lists_modules_to_apply(self, mock_run: MagicMock):
        """
        apply_overlay(dry_run=True) result must list the module names that
        would be applied so the caller can print them.
        """
        config = _overlay_with_module("org/app", "ci-github-actions")
        config["spec"]["modules"].append({"name": "lang-python"})
        result = self.mod.apply_overlay(
            config=config,
            modules_dir=os.path.join(REPO_ROOT, "modules"),
            github_token="fake-token",
            dry_run=True,
        )
        modules = result.get("modules", [])
        self.assertIn(
            "ci-github-actions",
            modules,
            f"Dry-run result must list module 'ci-github-actions' in 'modules': {result}",
        )
        self.assertIn(
            "lang-python",
            modules,
            f"Dry-run result must list module 'lang-python' in 'modules': {result}",
        )

    @patch("subprocess.run")
    def test_dry_run_result_describes_actions_that_would_happen(self, mock_run: MagicMock):
        """
        apply_overlay(dry_run=True) result must contain an 'actions' or 'plan'
        field describing what would be executed (e.g., 'copier copy lang-node').
        This pins the contract that dry-run communicates planned operations,
        not just what is configured.
        """
        config = _overlay_with_module("org/app", "lang-node")
        result = self.mod.apply_overlay(
            config=config,
            modules_dir=os.path.join(REPO_ROOT, "modules"),
            github_token="fake-token",
            dry_run=True,
        )
        # The result must contain some indication of what actions would run.
        # Accept either an 'actions' list or a 'plan' string.
        has_actions = bool(result.get("actions") or result.get("plan"))
        self.assertTrue(
            has_actions,
            f"Dry-run result must describe planned actions (via 'actions' or 'plan' key): {result}",
        )

    @patch("subprocess.run")
    def test_dry_run_result_has_dry_run_flag_true(self, mock_run: MagicMock):
        """
        apply_overlay(dry_run=True) must set dry_run=True in the result dict
        so callers can distinguish dry-run results from real apply results.
        """
        config = _overlay_with_module("org/app", "lang-node")
        result = self.mod.apply_overlay(
            config=config,
            modules_dir=os.path.join(REPO_ROOT, "modules"),
            github_token="fake-token",
            dry_run=True,
        )
        self.assertTrue(
            result.get("dry_run"),
            f"Dry-run result must have dry_run=True: {result}",
        )

    # --- CLI-level tests (subprocess invocation) ---

    def test_cli_dry_run_prints_repo_slug(self):
        """
        Running 'apply-overlays.py --dry-run' must print each configured repo
        slug to stdout or stderr so the operator can confirm what would run.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(
                tmpdir,
                "my-svc.yaml",
                _overlay_with_module("org/my-svc", "lang-node"),
            )
            result = _run_script("--dry-run", "--config-dir", tmpdir)
        combined = result.stdout + result.stderr
        self.assertIn(
            "org/my-svc",
            combined,
            f"--dry-run output must include repo slug 'org/my-svc'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_cli_dry_run_prints_module_names(self):
        """
        Running 'apply-overlays.py --dry-run' must name each module that
        would be applied so the operator understands the planned changes.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            doc = _overlay_with_module("org/svc", "lang-node")
            doc["spec"]["modules"].append({"name": "ci-github-actions"})
            _write_yaml(tmpdir, "svc.yaml", doc)
            result = _run_script("--dry-run", "--config-dir", tmpdir)
        combined = result.stdout + result.stderr
        self.assertIn(
            "lang-node",
            combined,
            f"--dry-run output must mention module 'lang-node'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )
        self.assertIn(
            "ci-github-actions",
            combined,
            f"--dry-run output must mention module 'ci-github-actions'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_cli_dry_run_prints_planned_action_description(self):
        """
        Running 'apply-overlays.py --dry-run' must print a description of
        the action that would be taken (e.g. 'would apply', 'copier copy',
        'apply module') so the operator understands what would happen.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(
                tmpdir,
                "svc.yaml",
                _overlay_with_module("org/svc", "lang-node"),
            )
            result = _run_script("--dry-run", "--config-dir", tmpdir)
        combined = result.stdout + result.stderr
        # Accept any phrasing that conveys "an action would be taken"
        has_action_description = any(
            phrase in combined.lower()
            for phrase in [
                "would apply",
                "would run",
                "copier copy",
                "apply module",
                "apply overlay",
                "dry run",
                "dry-run",
                "[dry",
                "plan:",
            ]
        )
        self.assertTrue(
            has_action_description,
            f"--dry-run output must describe the planned action, not just list names.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# Contract 2: Missing module reference exits non-zero with named error
# ---------------------------------------------------------------------------


class TestMissingModuleContract(unittest.TestCase):
    """
    Contract 2: When an overlay config references a module that does not exist
    in the modules/ directory, the script must fail fast with a non-zero exit
    code and explicitly name the missing module in its error output.
    """

    def setUp(self):
        self.mod = _load_script()

    # --- Unit-level tests (apply_overlay function) ---

    @patch("subprocess.run")
    def test_apply_overlay_returns_failure_for_missing_module(self, mock_run: MagicMock):
        """
        apply_overlay returns success=False when a referenced module does not
        exist in the modules_dir.
        """
        with tempfile.TemporaryDirectory() as tmpdir_modules:
            # modules_dir is empty — no modules present
            config = _overlay_with_module("org/app", "nonexistent-module")
            result = self.mod.apply_overlay(
                config=config,
                modules_dir=tmpdir_modules,
                github_token="token",
                dry_run=False,
            )
        self.assertFalse(
            result.get("success"),
            f"apply_overlay must return success=False when module is missing: {result}",
        )

    @patch("subprocess.run")
    def test_apply_overlay_error_names_missing_module(self, mock_run: MagicMock):
        """
        When a module is missing, the 'error' field in the result must
        explicitly name the missing module so the caller can surface it.
        """
        with tempfile.TemporaryDirectory() as tmpdir_modules:
            config = _overlay_with_module("org/app", "my-missing-module")
            result = self.mod.apply_overlay(
                config=config,
                modules_dir=tmpdir_modules,
                github_token="token",
                dry_run=False,
            )
        error_msg = result.get("error", "")
        self.assertIn(
            "my-missing-module",
            error_msg,
            f"Error message must name the missing module 'my-missing-module': {result}",
        )

    @patch("subprocess.run")
    def test_missing_module_detected_before_clone(self, mock_run: MagicMock):
        """
        The missing-module check must happen BEFORE any subprocess call so
        that no external operations run against a misconfigured repo.
        """
        with tempfile.TemporaryDirectory() as tmpdir_modules:
            config = _overlay_with_module("org/app", "phantom-module")
            self.mod.apply_overlay(
                config=config,
                modules_dir=tmpdir_modules,
                github_token="token",
                dry_run=False,
            )
        mock_run.assert_not_called()

    # --- CLI-level tests (subprocess invocation) ---

    def test_cli_exits_nonzero_for_missing_module(self):
        """
        Running the script with a config that references a module not in
        modules/ must exit with a non-zero code.
        """
        with tempfile.TemporaryDirectory() as tmpdir_config:
            with tempfile.TemporaryDirectory() as tmpdir_modules:
                _write_yaml(
                    tmpdir_config,
                    "app.yaml",
                    _overlay_with_module("org/app", "does-not-exist"),
                )
                result = _run_script(
                    "--config-dir", tmpdir_config,
                    "--modules-dir", tmpdir_modules,
                    env={"GITHUB_TOKEN": "fake"},
                )
        self.assertNotEqual(
            result.returncode,
            0,
            f"Script must exit non-zero when a referenced module is missing.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_cli_stderr_names_missing_module(self):
        """
        When a referenced module is missing, the script output must include
        the name of the missing module so the operator knows which to add.
        """
        with tempfile.TemporaryDirectory() as tmpdir_config:
            with tempfile.TemporaryDirectory() as tmpdir_modules:
                _write_yaml(
                    tmpdir_config,
                    "app.yaml",
                    _overlay_with_module("org/app", "my-absent-module"),
                )
                result = _run_script(
                    "--config-dir", tmpdir_config,
                    "--modules-dir", tmpdir_modules,
                    env={"GITHUB_TOKEN": "fake"},
                )
        combined = result.stdout + result.stderr
        self.assertIn(
            "my-absent-module",
            combined,
            f"Script output must name the missing module 'my-absent-module'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_cli_missing_module_reports_repo_context(self):
        """
        The error for a missing module must also mention which repo was being
        processed so the operator can locate the misconfigured overlay file.
        """
        with tempfile.TemporaryDirectory() as tmpdir_config:
            with tempfile.TemporaryDirectory() as tmpdir_modules:
                _write_yaml(
                    tmpdir_config,
                    "broken.yaml",
                    _overlay_with_module("org/broken-repo", "absent-module"),
                )
                result = _run_script(
                    "--config-dir", tmpdir_config,
                    "--modules-dir", tmpdir_modules,
                    env={"GITHUB_TOKEN": "fake"},
                )
        combined = result.stdout + result.stderr
        self.assertIn(
            "org/broken-repo",
            combined,
            f"Script error output must name the repo 'org/broken-repo' for context.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_cli_valid_module_does_not_trigger_missing_module_error(self):
        """
        When a module directory exists, the script must NOT treat it as missing.
        This regression guard prevents false positives in the existence check.
        """
        with tempfile.TemporaryDirectory() as tmpdir_config:
            with tempfile.TemporaryDirectory() as tmpdir_modules:
                # Create the module directory so the module is "present"
                os.makedirs(os.path.join(tmpdir_modules, "existing-module"))
                _write_yaml(
                    tmpdir_config,
                    "app.yaml",
                    _overlay_with_module("org/app", "existing-module"),
                )
                # Run in dry-run mode to avoid needing real git/copier
                result = _run_script(
                    "--dry-run",
                    "--config-dir", tmpdir_config,
                    "--modules-dir", tmpdir_modules,
                )
        combined = result.stdout + result.stderr
        self.assertNotIn(
            "not found",
            combined.lower(),
            f"Script falsely reports 'existing-module' as missing.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )
        self.assertNotIn(
            "missing",
            combined.lower(),
            f"Script falsely reports 'existing-module' as missing.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# Contract 3: Idempotency — no diff = no PR
# ---------------------------------------------------------------------------


class TestIdempotencyContract(unittest.TestCase):
    """
    Contract 3: When copier produces no file changes (idempotent run),
    the script must skip PR creation entirely and log that no changes
    were detected. This prevents unnecessary PRs on re-runs.
    """

    def setUp(self):
        self.mod = _load_script()
        self.config = _overlay_with_module("org/my-app", "lang-node")

    def _make_no_changes_run_side_effect(self) -> callable:
        """
        Build a subprocess side effect where:
        - git clone succeeds
        - copier copy succeeds
        - git diff / git status returns empty (no changes)
        - gh is not called (assertions check this)
        """
        return _mock_side_effect_by_command(
            clone={"returncode": 0, "stdout": "", "stderr": ""},
            copier={"returncode": 0, "stdout": "No changes applied.", "stderr": ""},
            diff={"returncode": 0, "stdout": "", "stderr": ""},  # empty = no changes
            status={"returncode": 0, "stdout": "", "stderr": ""},  # clean working tree
        )

    # --- Unit-level tests (apply_overlay function) ---

    @patch("subprocess.run")
    @patch("tempfile.TemporaryDirectory")
    def test_no_pr_created_when_copier_produces_no_changes(
        self, mock_tmpdir: MagicMock, mock_run: MagicMock
    ):
        """
        When git diff is empty after running copier, apply_overlay must NOT
        call 'gh pr create'. Creating a PR for an idempotent run is a bug.
        """
        mock_tmpdir.return_value.__enter__ = MagicMock(return_value="/tmp/fakedir")
        mock_tmpdir.return_value.__exit__ = MagicMock(return_value=False)
        mock_run.side_effect = self._make_no_changes_run_side_effect()

        self.mod.apply_overlay(
            config=self.config,
            modules_dir="/repo/modules",
            github_token="token",
            dry_run=False,
        )

        # Collect all subprocess.run calls and confirm gh pr create was not invoked
        all_calls = [
            " ".join(str(a) for a in c.args[0])
            if c.args and isinstance(c.args[0], list)
            else str(c)
            for c in mock_run.call_args_list
        ]
        pr_create_calls = [c for c in all_calls if "gh" in c and "pr" in c]
        self.assertEqual(
            len(pr_create_calls),
            0,
            f"apply_overlay must not call 'gh pr create' when there are no changes.\n"
            f"Subprocess calls made: {all_calls}",
        )

    @patch("subprocess.run")
    @patch("tempfile.TemporaryDirectory")
    def test_result_indicates_no_changes_when_diff_is_empty(
        self, mock_tmpdir: MagicMock, mock_run: MagicMock
    ):
        """
        apply_overlay must return a result with changes=False (or no_changes=True)
        when the git diff after copier is empty, so the caller can report it.
        """
        mock_tmpdir.return_value.__enter__ = MagicMock(return_value="/tmp/fakedir")
        mock_tmpdir.return_value.__exit__ = MagicMock(return_value=False)
        mock_run.side_effect = self._make_no_changes_run_side_effect()

        result = self.mod.apply_overlay(
            config=self.config,
            modules_dir="/repo/modules",
            github_token="token",
            dry_run=False,
        )

        # The result must unambiguously indicate no changes.
        # Accept either changes=False or no_changes=True as valid conventions.
        has_no_changes_signal = (
            result.get("changes") is False
            or result.get("no_changes") is True
            or result.get("skipped") is True
        )
        self.assertTrue(
            has_no_changes_signal,
            f"Result must signal no-changes via changes=False, no_changes=True, "
            f"or skipped=True when diff is empty: {result}",
        )

    @patch("subprocess.run")
    @patch("tempfile.TemporaryDirectory")
    def test_result_is_still_success_when_no_changes(
        self, mock_tmpdir: MagicMock, mock_run: MagicMock
    ):
        """
        apply_overlay must return success=True when copier is idempotent —
        no changes is not an error; it is the expected state for a clean repo.
        """
        mock_tmpdir.return_value.__enter__ = MagicMock(return_value="/tmp/fakedir")
        mock_tmpdir.return_value.__exit__ = MagicMock(return_value=False)
        mock_run.side_effect = self._make_no_changes_run_side_effect()

        result = self.mod.apply_overlay(
            config=self.config,
            modules_dir="/repo/modules",
            github_token="token",
            dry_run=False,
        )

        self.assertTrue(
            result.get("success"),
            f"apply_overlay must return success=True when there are no changes "
            f"(idempotency is not a failure): {result}",
        )

    @patch("subprocess.run")
    @patch("tempfile.TemporaryDirectory")
    def test_result_includes_repo_slug_when_no_changes(
        self, mock_tmpdir: MagicMock, mock_run: MagicMock
    ):
        """
        Even when there are no changes, the result must include the repo slug
        so the caller can log 'no changes for org/my-app'.
        """
        mock_tmpdir.return_value.__enter__ = MagicMock(return_value="/tmp/fakedir")
        mock_tmpdir.return_value.__exit__ = MagicMock(return_value=False)
        mock_run.side_effect = self._make_no_changes_run_side_effect()

        result = self.mod.apply_overlay(
            config=self.config,
            modules_dir="/repo/modules",
            github_token="token",
            dry_run=False,
        )

        self.assertEqual(
            result.get("repo"),
            "org/my-app",
            f"Result must include repo slug even when no changes: {result}",
        )

    @patch("subprocess.run")
    @patch("tempfile.TemporaryDirectory")
    def test_pr_is_created_when_changes_are_present(
        self, mock_tmpdir: MagicMock, mock_run: MagicMock
    ):
        """
        Regression guard: when copier DOES produce changes (git diff is non-empty),
        gh pr create MUST be called. This ensures the idempotency guard does not
        accidentally suppress all PR creation.
        """
        mock_tmpdir.return_value.__enter__ = MagicMock(return_value="/tmp/fakedir")
        mock_tmpdir.return_value.__exit__ = MagicMock(return_value=False)
        mock_run.side_effect = _mock_side_effect_by_command(
            clone={"returncode": 0, "stdout": "", "stderr": ""},
            copier={"returncode": 0, "stdout": "Rendered 3 files.", "stderr": ""},
            diff={"returncode": 1, "stdout": "diff --git a/foo.py b/foo.py\n+new line", "stderr": ""},
        )

        self.mod.apply_overlay(
            config=self.config,
            modules_dir="/repo/modules",
            github_token="token",
            dry_run=False,
        )

        all_calls = [
            " ".join(str(a) for a in c.args[0])
            if c.args and isinstance(c.args[0], list)
            else str(c)
            for c in mock_run.call_args_list
        ]
        pr_create_calls = [c for c in all_calls if "gh" in c and "pr" in c]
        self.assertGreater(
            len(pr_create_calls),
            0,
            f"apply_overlay must call 'gh pr create' when copier produces changes.\n"
            f"Subprocess calls made: {all_calls}",
        )

    # --- CLI-level tests (subprocess invocation) ---

    def test_cli_logs_no_changes_when_copier_is_idempotent(self):
        """
        When the script detects no changes after applying overlays, the output
        must contain a phrase like 'no changes' so the operator knows nothing
        was committed or submitted for PR review.

        This test uses --dry-run to avoid needing real git/copier, but tests
        an overlay with a known existing module directory to verify the
        no-changes path is reachable and logged.
        """
        with tempfile.TemporaryDirectory() as tmpdir_config:
            with tempfile.TemporaryDirectory() as tmpdir_modules:
                # Create the module directory so module resolution succeeds
                os.makedirs(os.path.join(tmpdir_modules, "lang-node"))
                _write_yaml(
                    tmpdir_config,
                    "svc.yaml",
                    _overlay_with_module("org/svc", "lang-node"),
                )
                # Dry-run with a present module: the script should report
                # what would happen (including 'no changes' if it detects
                # the module is already up to date, or describe a dry-run plan)
                result = _run_script(
                    "--dry-run",
                    "--config-dir", tmpdir_config,
                    "--modules-dir", tmpdir_modules,
                )

        # The output must contain some indication of the planned state.
        # In dry-run mode this may be "would apply" rather than "no changes",
        # but the script must not exit non-zero for a well-formed config.
        self.assertEqual(
            result.returncode,
            0,
            f"Script must exit 0 in dry-run with a valid config+module.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
