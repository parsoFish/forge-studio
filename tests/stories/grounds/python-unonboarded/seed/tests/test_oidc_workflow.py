"""
Static structure tests for the gitweave-infra.yaml GitHub Actions workflow
after migration from static AWS credentials to OIDC-based role assumption.

Verifies (without executing the workflow) that:
  - gitweave-infra.yaml uses aws-actions/configure-aws-credentials@v4
  - The 'role-to-assume' parameter is present (OIDC role assumption)
  - No static credential references remain (AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY)
  - Workflow-level permissions declare id-token: write and contents: read
  - The configure-aws-credentials step sets 'aws-region'

All tests fail until the implementation is in place (TDD red phase).
"""

import os
import re
import unittest

try:
    import yaml  # PyYAML — used for semantic YAML parsing where available
    _YAML_AVAILABLE = True
except ImportError:
    _YAML_AVAILABLE = False


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORKFLOW_FILE = os.path.join(REPO_ROOT, ".github", "workflows", "gitweave-infra.yaml")


def _read_workflow() -> str:
    """Return the raw content of gitweave-infra.yaml."""
    if not os.path.exists(WORKFLOW_FILE):
        return ""
    with open(WORKFLOW_FILE) as f:
        return f.read()


def _load_workflow_yaml() -> dict:
    """
    Return the parsed YAML of gitweave-infra.yaml, or an empty dict if
    PyYAML is unavailable or the file is missing.
    """
    if not _YAML_AVAILABLE or not os.path.exists(WORKFLOW_FILE):
        return {}
    with open(WORKFLOW_FILE) as f:
        return yaml.safe_load(f) or {}


# ---------------------------------------------------------------------------
# Workflow file existence
# ---------------------------------------------------------------------------


class TestWorkflowFileExists(unittest.TestCase):
    """gitweave-infra.yaml must exist at .github/workflows/gitweave-infra.yaml."""

    def test_gitweave_infra_workflow_file_exists(self):
        """
        .github/workflows/gitweave-infra.yaml must exist — this is the workflow
        that runs Terraform and therefore must be updated to use OIDC credentials.
        """
        self.assertTrue(
            os.path.exists(WORKFLOW_FILE),
            f".github/workflows/gitweave-infra.yaml not found at {WORKFLOW_FILE}",
        )


# ---------------------------------------------------------------------------
# OIDC permissions block
# ---------------------------------------------------------------------------


class TestWorkflowOidcPermissions(unittest.TestCase):
    """
    The workflow must declare the OIDC-required permissions at the top level
    so that the workflow token can be exchanged for an AWS STS credential.
    """

    def _content(self) -> str:
        content = _read_workflow()
        if not content:
            self.skipTest("gitweave-infra.yaml does not exist — handled by existence test")
        return content

    def test_workflow_declares_id_token_write_permission(self):
        """
        The workflow (or the terraform job) must declare 'id-token: write' —
        this permission is required for the workflow token to be exchanged for
        an OIDC token that AWS STS will accept.
        Without it, aws-actions/configure-aws-credentials fails silently or
        falls back to environment-variable credentials.
        """
        content = self._content()
        self.assertRegex(
            content,
            r"id-token:\s*write",
            ".github/workflows/gitweave-infra.yaml must declare 'id-token: write' permission",
        )

    def test_workflow_declares_contents_read_permission(self):
        """
        The workflow must declare 'contents: read' — the minimum permission
        required for actions/checkout to clone the repository.
        """
        content = self._content()
        self.assertRegex(
            content,
            r"contents:\s*read",
            ".github/workflows/gitweave-infra.yaml must declare 'contents: read' permission",
        )


# ---------------------------------------------------------------------------
# configure-aws-credentials step
# ---------------------------------------------------------------------------


class TestWorkflowAwsCredentialsStep(unittest.TestCase):
    """
    The workflow must use aws-actions/configure-aws-credentials@v4 with
    OIDC-based role assumption — not static credentials.
    """

    def _content(self) -> str:
        content = _read_workflow()
        if not content:
            self.skipTest("gitweave-infra.yaml does not exist — handled by existence test")
        return content

    def test_workflow_uses_configure_aws_credentials_v4(self):
        """
        The workflow must use 'aws-actions/configure-aws-credentials@v4' —
        v4 is required for OIDC support and uses the GitHub Actions OIDC token
        endpoint to exchange credentials without static secrets.
        """
        content = self._content()
        self.assertIn(
            "aws-actions/configure-aws-credentials",
            content,
            "gitweave-infra.yaml must use the 'aws-actions/configure-aws-credentials' action",
        )

    def test_workflow_configure_aws_credentials_is_version_4(self):
        """
        The configure-aws-credentials action must be pinned to @v4 (or a later
        version) — earlier versions do not support OIDC-based role assumption.
        """
        content = self._content()
        # Matches @v4, @v4.x, @v4.x.x or a commit SHA (40 hex chars)
        has_v4 = bool(
            re.search(r"configure-aws-credentials@v[4-9]", content)
            or re.search(r"configure-aws-credentials@[0-9a-f]{40}", content)
        )
        self.assertTrue(
            has_v4,
            "aws-actions/configure-aws-credentials must be pinned to @v4 or later "
            "— versions prior to v4 do not support OIDC token exchange",
        )

    def test_workflow_configure_aws_credentials_uses_role_to_assume(self):
        """
        The configure-aws-credentials step must include 'role-to-assume' in its
        'with' block — this is the parameter that triggers OIDC-based role
        assumption instead of static credential injection.
        """
        content = self._content()
        self.assertIn(
            "role-to-assume",
            content,
            "gitweave-infra.yaml must set 'role-to-assume' in the "
            "aws-actions/configure-aws-credentials step",
        )

    def test_workflow_configure_aws_credentials_sets_aws_region(self):
        """
        The configure-aws-credentials step must set 'aws-region' — the AWS
        provider and STS endpoint selection both depend on the region being
        explicitly configured rather than relying on environment defaults.
        """
        content = self._content()
        self.assertIn(
            "aws-region",
            content,
            "gitweave-infra.yaml must set 'aws-region' in the "
            "aws-actions/configure-aws-credentials step",
        )


# ---------------------------------------------------------------------------
# Static credential removal
# ---------------------------------------------------------------------------


class TestWorkflowNoStaticCredentials(unittest.TestCase):
    """
    Static AWS credential secrets must be removed from the workflow.

    Retaining AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY in the workflow
    after the OIDC migration creates confusion and may cause configure-aws-
    credentials to use static credentials rather than OIDC tokens.
    """

    def _content(self) -> str:
        content = _read_workflow()
        if not content:
            self.skipTest("gitweave-infra.yaml does not exist — handled by existence test")
        return content

    def test_workflow_does_not_reference_aws_access_key_id(self):
        """
        gitweave-infra.yaml must not reference AWS_ACCESS_KEY_ID — static
        access key credentials must be fully replaced by OIDC role assumption.
        """
        content = self._content()
        self.assertNotIn(
            "AWS_ACCESS_KEY_ID",
            content,
            "gitweave-infra.yaml still references AWS_ACCESS_KEY_ID — "
            "static credentials must be removed and replaced with OIDC role assumption",
        )

    def test_workflow_does_not_reference_aws_secret_access_key(self):
        """
        gitweave-infra.yaml must not reference AWS_SECRET_ACCESS_KEY — static
        secret credentials must be fully replaced by OIDC role assumption.
        """
        content = self._content()
        self.assertNotIn(
            "AWS_SECRET_ACCESS_KEY",
            content,
            "gitweave-infra.yaml still references AWS_SECRET_ACCESS_KEY — "
            "static credentials must be removed and replaced with OIDC role assumption",
        )

    def test_workflow_does_not_set_aws_access_key_as_env_var(self):
        """
        The workflow must not inject AWS credentials via the 'env:' block —
        this is a secondary vector by which static credentials could leak in
        even if configure-aws-credentials is correctly using OIDC.
        """
        content = self._content()
        # Match env: blocks that set AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY
        has_env_creds = bool(
            re.search(r"env:\s*\n\s*AWS_ACCESS_KEY_ID", content, re.MULTILINE)
            or re.search(r"AWS_ACCESS_KEY_ID\s*:", content)
        )
        self.assertFalse(
            has_env_creds,
            "gitweave-infra.yaml must not inject AWS_ACCESS_KEY_ID via an env: block",
        )


# ---------------------------------------------------------------------------
# Semantic YAML validation (requires PyYAML)
# ---------------------------------------------------------------------------


@unittest.skipUnless(_YAML_AVAILABLE, "PyYAML not installed — skipping semantic YAML tests")
class TestWorkflowSemanticStructure(unittest.TestCase):
    """
    Semantic validation of the workflow YAML structure using PyYAML.

    These tests parse the YAML and navigate its structure, providing more
    precise assertions than raw-text regex matching.
    """

    def _workflow(self) -> dict:
        workflow = _load_workflow_yaml()
        if not workflow:
            self.skipTest("gitweave-infra.yaml does not exist or is empty")
        return workflow

    def test_workflow_permissions_block_contains_id_token_write(self):
        """
        The top-level 'permissions' block must map 'id-token' to 'write'.

        Parsed YAML check is more precise than regex — confirms the value is
        actually 'write' rather than appearing in a comment or string value.
        """
        workflow = self._workflow()
        permissions = workflow.get("permissions", {})
        self.assertEqual(
            permissions.get("id-token"),
            "write",
            f"workflow 'permissions.id-token' must be 'write', got: {permissions.get('id-token')!r}",
        )

    def test_workflow_permissions_block_contains_contents_read(self):
        """
        The top-level 'permissions' block must map 'contents' to 'read'.
        """
        workflow = self._workflow()
        permissions = workflow.get("permissions", {})
        self.assertEqual(
            permissions.get("contents"),
            "read",
            f"workflow 'permissions.contents' must be 'read', got: {permissions.get('contents')!r}",
        )

    def test_workflow_has_configure_aws_credentials_step(self):
        """
        At least one step in the terraform job must use
        'aws-actions/configure-aws-credentials' — the YAML parser confirms
        the action key is present at the correct nesting level.
        """
        workflow = self._workflow()
        jobs = workflow.get("jobs", {})
        all_steps = []
        for job in jobs.values():
            all_steps.extend(job.get("steps", []))

        has_configure_step = any(
            "aws-actions/configure-aws-credentials" in str(step.get("uses", ""))
            for step in all_steps
        )
        self.assertTrue(
            has_configure_step,
            "No step using 'aws-actions/configure-aws-credentials' found in "
            "any job in gitweave-infra.yaml",
        )

    def test_configure_aws_credentials_step_has_role_to_assume(self):
        """
        The configure-aws-credentials step's 'with' block must include
        'role-to-assume' as a key — parsed YAML confirms the parameter is
        present at the correct nesting level.
        """
        workflow = self._workflow()
        jobs = workflow.get("jobs", {})
        all_steps = []
        for job in jobs.values():
            all_steps.extend(job.get("steps", []))

        for step in all_steps:
            if "aws-actions/configure-aws-credentials" in str(step.get("uses", "")):
                with_block = step.get("with", {})
                self.assertIn(
                    "role-to-assume",
                    with_block,
                    "configure-aws-credentials step 'with' block must include 'role-to-assume'",
                )
                return  # Found and checked — done

        self.skipTest(
            "No configure-aws-credentials step found — "
            "handled by test_workflow_has_configure_aws_credentials_step"
        )


if __name__ == "__main__":
    unittest.main()
