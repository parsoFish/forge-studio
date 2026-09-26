"""
Terraform format and validation tests for OIDC trust resources.

Tests (unit layer — no AWS API credentials required):
  - infra/oidc.tf exists
  - terraform fmt -check -recursive exits 0 for the entire infra/ tree
  - terraform init -backend=false exits 0 (provider download, no remote backend)
  - terraform validate exits 0 after adding oidc.tf
  - terraform validate output contains no aws_iam resource schema errors

These tests use the terraform CLI directly. They are skipped automatically
when terraform is not installed in the test environment.

All tests fail until the implementation is in place (TDD red phase).
"""

import os
import subprocess
import unittest


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
INFRA_DIR = os.path.join(REPO_ROOT, "infra")
OIDC_TF = os.path.join(INFRA_DIR, "oidc.tf")


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
# File existence (fails before implementation)
# ---------------------------------------------------------------------------


class TestOidcTfFileExists(unittest.TestCase):
    """infra/oidc.tf must exist before validate tests are meaningful."""

    def test_oidc_tf_file_exists(self):
        """
        infra/oidc.tf must exist — without this file terraform validate cannot
        check the OIDC resource schemas.
        """
        self.assertTrue(
            os.path.isfile(OIDC_TF),
            f"infra/oidc.tf not found at {OIDC_TF}",
        )

    def test_oidc_tf_is_non_empty(self):
        """infra/oidc.tf must not be an empty placeholder."""
        if not os.path.isfile(OIDC_TF):
            self.skipTest("infra/oidc.tf does not exist — handled by previous test")
        self.assertGreater(
            os.path.getsize(OIDC_TF),
            0,
            "infra/oidc.tf exists but is empty",
        )


# ---------------------------------------------------------------------------
# terraform fmt -check
# ---------------------------------------------------------------------------


@unittest.skipUnless(_terraform_available(), "terraform CLI not available — skipping fmt tests")
class TestOidcTerraformFormat(unittest.TestCase):
    """
    All Terraform source files (including oidc.tf) must pass 'terraform fmt -check'.

    Improperly formatted HCL is rejected — run 'terraform fmt infra/' to auto-fix.
    """

    def test_terraform_fmt_check_passes_recursively_with_oidc(self):
        """
        'terraform fmt -check -recursive .' must exit 0 for the entire infra/ tree
        after adding oidc.tf — the new file must use canonical HCL formatting.
        """
        result = _run(
            ["terraform", "fmt", "-check", "-recursive", "-no-color", "."],
            cwd=INFRA_DIR,
        )
        self.assertEqual(
            result.returncode,
            0,
            "terraform fmt -check -recursive failed after adding oidc.tf. "
            f"Files needing formatting:\n{result.stdout}\nErrors:\n{result.stderr}",
        )

    def test_terraform_fmt_check_passes_for_oidc_file_specifically(self):
        """
        oidc.tf specifically must pass fmt -check.
        Skipped when the file does not yet exist.
        """
        if not os.path.isfile(OIDC_TF):
            self.skipTest("oidc.tf does not exist — test applies once the file is created")

        result = _run(
            ["terraform", "fmt", "-check", "-no-color", "oidc.tf"],
            cwd=INFRA_DIR,
        )
        self.assertEqual(
            result.returncode,
            0,
            f"terraform fmt -check failed for oidc.tf:\n"
            f"{result.stdout}\n{result.stderr}",
        )


# ---------------------------------------------------------------------------
# terraform init -backend=false
# ---------------------------------------------------------------------------


@unittest.skipUnless(_terraform_available(), "terraform CLI not available — skipping init tests")
class TestOidcTerraformInit(unittest.TestCase):
    """
    'terraform init -backend=false' must succeed after adding oidc.tf —
    confirms that the AWS provider version constraints are satisfiable alongside
    the existing GitHub provider constraints.
    """

    def test_terraform_init_backend_false_exits_zero_with_oidc(self):
        """
        'terraform init -backend=false' must exit 0.

        If this fails after adding oidc.tf it typically means:
          - The hashicorp/aws provider is missing from required_providers
          - Provider version constraints conflict with existing constraints
        """
        result = _terraform_init()
        self.assertEqual(
            result.returncode,
            0,
            "terraform init -backend=false failed after adding oidc.tf:\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )


# ---------------------------------------------------------------------------
# terraform validate
# ---------------------------------------------------------------------------


@unittest.skipUnless(_terraform_available(), "terraform CLI not available — skipping validate tests")
class TestOidcTerraformValidate(unittest.TestCase):
    """
    'terraform validate' must exit 0 after adding the OIDC resources.

    Validates HCL syntax, resource schemas, and variable reference correctness
    without contacting any provider API.
    """

    @classmethod
    def setUpClass(cls):
        """Run terraform init once before the validate test suite."""
        _terraform_init()

    def test_terraform_validate_exits_zero_with_oidc_resources(self):
        """
        'terraform validate' must exit 0 after adding oidc.tf. A non-zero exit
        typically indicates:
          - An invalid argument name in aws_iam_openid_connect_provider or aws_iam_role
          - A missing required argument (e.g. assume_role_policy)
          - A broken cross-resource reference (e.g. provider ARN interpolation)
        """
        result = _run(["terraform", "validate", "-no-color"])
        self.assertEqual(
            result.returncode,
            0,
            "terraform validate failed after adding OIDC resources:\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )

    def test_terraform_validate_reports_success_message(self):
        """
        'terraform validate' must include a success message in its output —
        guards against edge cases where validate exits 0 but emits unexpected
        warnings.
        """
        result = _run(["terraform", "validate", "-no-color"])
        combined = result.stdout + result.stderr
        self.assertIn(
            "Success",
            combined,
            "terraform validate did not output a success message despite exit code 0:\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )

    def test_terraform_validate_reports_no_oidc_resource_schema_errors(self):
        """
        terraform validate output must not reference OIDC resource types alongside
        'Error' — this catches invalid argument names inside the resource blocks,
        which the AWS provider schema enforces at validate time.
        """
        result = _run(["terraform", "validate", "-no-color"])
        combined = result.stdout + result.stderr
        if (
            "aws_iam_openid_connect_provider" in combined
            or "aws_iam_role" in combined
        ) and "Error" in combined:
            self.fail(
                "terraform validate reports an error related to OIDC resources:\n"
                f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )

    def test_terraform_validate_reports_no_errors(self):
        """
        'terraform validate' must not emit any 'Error:' lines — distinguishes
        a fully clean validation from a partial success.
        """
        result = _run(["terraform", "validate", "-no-color"])
        if result.returncode == 0:
            self.assertNotIn(
                "Error:",
                result.stdout,
                "terraform validate exited 0 but contains error messages:\n"
                f"STDOUT:\n{result.stdout}",
            )


if __name__ == "__main__":
    unittest.main()
