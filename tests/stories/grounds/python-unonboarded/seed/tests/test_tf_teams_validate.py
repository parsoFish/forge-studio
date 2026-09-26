"""
Terraform format and validation tests for GitHub Teams and Memberships.

Tests (unit layer — no GitHub API credentials required):
  - terraform fmt -check exits 0 for all files under infra/
  - terraform init -backend=false exits 0 (provider download, no remote backend)
  - terraform validate exits 0 after init (schema + syntax correctness)

These tests use the terraform CLI directly. They are skipped automatically
when terraform is not installed in the test environment.

All tests fail until the implementation is in place (TDD red phase).
"""

import os
import subprocess
import unittest


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
INFRA_DIR = os.path.join(REPO_ROOT, "infra")


def _terraform_available() -> bool:
    """Return True if the terraform CLI is on the PATH and responds to 'version'."""
    try:
        result = subprocess.run(
            ["terraform", "version"],
            capture_output=True,
            timeout=15,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _run(args: list, cwd: str = INFRA_DIR, timeout: int = 60) -> subprocess.CompletedProcess:
    """Run a subprocess command and return the completed process."""
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=cwd,
        timeout=timeout,
    )


def _terraform_init(cwd: str = INFRA_DIR) -> subprocess.CompletedProcess:
    """Run terraform init -backend=false (downloads providers, skips remote state)."""
    return _run(
        ["terraform", "init", "-backend=false", "-no-color"],
        cwd=cwd,
        timeout=180,
    )


# ---------------------------------------------------------------------------
# terraform fmt -check
# ---------------------------------------------------------------------------


@unittest.skipUnless(_terraform_available(), "terraform CLI not available — skipping fmt tests")
class TestTerraformFormat(unittest.TestCase):
    """
    All Terraform source files must pass 'terraform fmt -check'.

    This is a zero-tolerance quality gate: improperly formatted HCL is
    rejected, not auto-fixed, so that reviewers see pristine diffs.
    """

    def test_terraform_fmt_check_passes_recursively(self):
        """
        'terraform fmt -check -recursive .' must exit 0 for the entire infra/ tree.

        A non-zero exit means at least one file has formatting issues — run
        'terraform fmt -recursive infra/' to auto-fix, then re-stage.
        """
        result = _run(
            ["terraform", "fmt", "-check", "-recursive", "-no-color", "."],
            cwd=INFRA_DIR,
        )
        self.assertEqual(
            result.returncode,
            0,
            "terraform fmt -check -recursive failed. "
            f"Files needing formatting:\n{result.stdout}\nErrors:\n{result.stderr}",
        )

    def test_terraform_fmt_check_passes_for_teams_module_if_present(self):
        """
        If a modules/teams/ subdirectory exists, its files must also pass fmt -check.

        This test is vacuously true when the module directory doesn't exist yet.
        """
        teams_module = os.path.join(INFRA_DIR, "modules", "teams")
        if not os.path.isdir(teams_module):
            self.skipTest(
                "infra/modules/teams/ does not exist — "
                "test will apply once the module directory is created"
            )
        result = _run(["terraform", "fmt", "-check", "-no-color", "."], cwd=teams_module)
        self.assertEqual(
            result.returncode,
            0,
            f"terraform fmt -check failed in {teams_module}:\n"
            f"{result.stdout}\n{result.stderr}",
        )


# ---------------------------------------------------------------------------
# terraform init -backend=false
# ---------------------------------------------------------------------------


@unittest.skipUnless(_terraform_available(), "terraform CLI not available — skipping init tests")
class TestTerraformInit(unittest.TestCase):
    """
    'terraform init -backend=false' must succeed to confirm provider configuration
    is parseable and the required provider plugins can be downloaded.
    """

    def test_terraform_init_backend_false_exits_zero(self):
        """
        'terraform init -backend=false' must exit 0.

        This resolves provider version constraints without configuring a remote
        backend — suitable for CI environments without cloud credentials.
        """
        result = _terraform_init()
        self.assertEqual(
            result.returncode,
            0,
            "terraform init -backend=false failed:\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )


# ---------------------------------------------------------------------------
# terraform validate
# ---------------------------------------------------------------------------


@unittest.skipUnless(_terraform_available(), "terraform CLI not available — skipping validate tests")
class TestTerraformValidate(unittest.TestCase):
    """
    'terraform validate' must exit 0 after init, confirming the configuration
    is syntactically and semantically correct without contacting any provider API.
    """

    @classmethod
    def setUpClass(cls):
        """
        Run terraform init once before validation tests.

        If init fails the validate tests will report correctly — they depend
        on a successful init, which is itself tested in TestTerraformInit.
        """
        _terraform_init()

    def test_terraform_validate_exits_zero(self):
        """
        'terraform validate' must exit 0 — the configuration has no syntax errors,
        invalid resource types, or missing required arguments.
        """
        result = _run(["terraform", "validate", "-no-color"])
        self.assertEqual(
            result.returncode,
            0,
            "terraform validate failed:\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )

    def test_terraform_validate_reports_success(self):
        """
        'terraform validate' must include a success message in its output.

        This guards against edge cases where validate exits 0 but reports
        unexpected warnings that indicate a misconfigured resource.
        """
        result = _run(["terraform", "validate", "-no-color"])
        combined = result.stdout + result.stderr
        self.assertIn(
            "Success",
            combined,
            "terraform validate did not output a success message despite exit code 0:\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )

    def test_terraform_validate_reports_no_errors(self):
        """
        'terraform validate' must not mention 'Error' in its output
        (distinguishes partial success from clean validation).
        """
        result = _run(["terraform", "validate", "-no-color"])
        if result.returncode == 0:
            # Only assert no errors when validate reports success
            self.assertNotIn(
                "Error:",
                result.stdout,
                "terraform validate exited 0 but contains error messages:\n"
                f"STDOUT:\n{result.stdout}",
            )


if __name__ == "__main__":
    unittest.main()
