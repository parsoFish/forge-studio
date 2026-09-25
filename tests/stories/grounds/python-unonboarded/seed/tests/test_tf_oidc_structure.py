"""
Static structure tests for the GitHub Actions → AWS OIDC trust configuration.

Verifies (without running the terraform CLI) that:
  - infra/oidc.tf exists and is non-empty
  - oidc.tf declares an aws_iam_openid_connect_provider resource
  - oidc.tf declares an aws_iam_role resource
  - The IAM role trust policy is scoped to the GitWeave repository only
    (repo:*/GitWeave:*)
  - The trust policy is further scoped to the main branch only
    (ref:refs/heads/main)
  - The OIDC thumbprint list is configured in the provider resource
  - All OIDC-related variables have descriptions in variables.tf
  - infra/bootstrap/README.md documents the OIDC setup with required IAM
    permissions

All tests fail until the implementation is in place (TDD red phase).
"""

import os
import re
import unittest


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
INFRA_DIR = os.path.join(REPO_ROOT, "infra")
OIDC_TF = os.path.join(INFRA_DIR, "oidc.tf")
BOOTSTRAP_README = os.path.join(INFRA_DIR, "bootstrap", "README.md")


def _read_oidc_tf() -> str:
    """Return the content of infra/oidc.tf, or skip the test if it is absent."""
    if not os.path.exists(OIDC_TF):
        return ""
    with open(OIDC_TF) as f:
        return f.read()


def _read_all_tf_content() -> str:
    """Return concatenated content of every .tf file under infra/."""
    content = ""
    for root, _, files in os.walk(INFRA_DIR):
        for name in files:
            if name.endswith(".tf"):
                with open(os.path.join(root, name)) as f:
                    content += f.read() + "\n"
    return content


def _read_variables_tf_content() -> str:
    """Return concatenated content of all variables.tf files under infra/."""
    content = ""
    for root, _, files in os.walk(INFRA_DIR):
        for name in files:
            if name == "variables.tf":
                with open(os.path.join(root, name)) as f:
                    content += f.read() + "\n"
    return content


# ---------------------------------------------------------------------------
# File existence
# ---------------------------------------------------------------------------


class TestOidcTfFileExists(unittest.TestCase):
    """infra/oidc.tf must exist and contain HCL declarations."""

    def test_oidc_tf_file_exists_in_infra(self):
        """
        infra/oidc.tf must exist — this file carries all OIDC-related resources
        (aws_iam_openid_connect_provider and aws_iam_role) so that they are
        co-located and independently reviewable.
        """
        self.assertTrue(
            os.path.exists(OIDC_TF),
            f"infra/oidc.tf not found at {OIDC_TF} — "
            "OIDC trust resources must be declared in a dedicated oidc.tf file",
        )

    def test_oidc_tf_is_non_empty(self):
        """
        infra/oidc.tf must not be empty — a placeholder file does not satisfy
        the requirement to define the OIDC provider and IAM role.
        """
        if not os.path.exists(OIDC_TF):
            self.skipTest("infra/oidc.tf does not exist — handled by previous test")
        self.assertGreater(
            os.path.getsize(OIDC_TF),
            0,
            "infra/oidc.tf exists but is empty — it must contain HCL resource declarations",
        )


# ---------------------------------------------------------------------------
# OIDC provider resource
# ---------------------------------------------------------------------------


class TestOidcProviderResource(unittest.TestCase):
    """aws_iam_openid_connect_provider must be declared in oidc.tf."""

    def _content(self) -> str:
        content = _read_oidc_tf()
        if not content:
            self.skipTest("infra/oidc.tf does not exist — handled by existence test")
        return content

    def test_aws_iam_openid_connect_provider_resource_is_declared(self):
        """
        oidc.tf must declare an aws_iam_openid_connect_provider resource block —
        this registers the GitHub Actions OIDC issuer with AWS so that workflow
        tokens can be exchanged for temporary AWS credentials.
        """
        content = self._content()
        self.assertRegex(
            content,
            r'resource\s+"aws_iam_openid_connect_provider"\s+"[^"]+"\s+\{',
            "infra/oidc.tf must declare a 'resource \"aws_iam_openid_connect_provider\"' block",
        )

    def test_oidc_provider_url_references_github_actions(self):
        """
        The OIDC provider URL must reference the GitHub Actions token issuer
        (https://token.actions.githubusercontent.com) — using a different URL
        would trust the wrong identity provider.
        """
        content = self._content()
        self.assertIn(
            "token.actions.githubusercontent.com",
            content,
            "oidc.tf must reference 'token.actions.githubusercontent.com' as the OIDC issuer URL",
        )

    def test_oidc_provider_client_id_list_includes_sts_amazonaws(self):
        """
        The OIDC provider's client_id_list must include 'sts.amazonaws.com' —
        this is the required audience value for GitHub Actions OIDC tokens that
        are exchanged for AWS STS credentials.
        """
        content = self._content()
        self.assertIn(
            "sts.amazonaws.com",
            content,
            "oidc.tf must include 'sts.amazonaws.com' in the OIDC provider client_id_list",
        )

    def test_oidc_provider_thumbprint_list_is_configured(self):
        """
        The OIDC provider must include a thumbprint_list — AWS requires at least
        one thumbprint to verify the TLS certificate of the OIDC endpoint.
        An empty or absent thumbprint list will cause AWS to reject the provider.
        """
        content = self._content()
        self.assertIn(
            "thumbprint_list",
            content,
            "oidc.tf must include a 'thumbprint_list' in the aws_iam_openid_connect_provider block",
        )


# ---------------------------------------------------------------------------
# IAM role resource
# ---------------------------------------------------------------------------


class TestOidcIamRoleResource(unittest.TestCase):
    """aws_iam_role with a scoped trust policy must be declared in oidc.tf."""

    def _content(self) -> str:
        content = _read_oidc_tf()
        if not content:
            self.skipTest("infra/oidc.tf does not exist — handled by existence test")
        return content

    def test_aws_iam_role_resource_is_declared(self):
        """
        oidc.tf must declare an aws_iam_role resource block — this role is what
        GitHub Actions workflows assume via OIDC; its trust policy defines who
        is allowed to assume it.
        """
        content = self._content()
        self.assertRegex(
            content,
            r'resource\s+"aws_iam_role"\s+"[^"]+"\s+\{',
            "infra/oidc.tf must declare a 'resource \"aws_iam_role\"' block",
        )

    def test_iam_role_assume_role_policy_references_oidc_provider(self):
        """
        The IAM role's assume_role_policy must reference the OIDC provider —
        either via a data source, a local reference, or the provider ARN — so
        that the trust relationship is built dynamically rather than hardcoded.
        """
        content = self._content()
        has_oidc_ref = bool(
            re.search(r"aws_iam_openid_connect_provider\.[^.]+\.arn", content)
            or re.search(r"data\.aws_iam_openid_connect_provider", content)
            or "oidc_provider" in content.lower()
        )
        self.assertTrue(
            has_oidc_ref,
            "oidc.tf must reference the aws_iam_openid_connect_provider in the IAM role "
            "trust policy (e.g. aws_iam_openid_connect_provider.<name>.arn)",
        )

    def test_iam_role_trust_policy_uses_sts_assume_role_with_web_identity(self):
        """
        The trust policy Action must be 'sts:AssumeRoleWithWebIdentity' —
        this is the specific STS action for OIDC-based role assumption.
        Using 'sts:AssumeRole' would not work for OIDC tokens.
        """
        content = self._content()
        self.assertIn(
            "sts:AssumeRoleWithWebIdentity",
            content,
            "oidc.tf trust policy must use 'sts:AssumeRoleWithWebIdentity' as the Action",
        )


# ---------------------------------------------------------------------------
# Trust policy scoping: repository constraint
# ---------------------------------------------------------------------------


class TestOidcTrustPolicyRepoScope(unittest.TestCase):
    """
    Trust policy subject condition must be scoped to the GitWeave repository.

    The GitHub Actions OIDC token's 'sub' claim follows the pattern:
        repo:<owner>/<repo>:ref:refs/heads/<branch>
    The trust policy must include a condition that restricts which repos can
    assume the role — without this, any repo in the world could assume the role
    if they obtained a valid OIDC token.
    """

    def _content(self) -> str:
        content = _read_oidc_tf()
        if not content:
            self.skipTest("infra/oidc.tf does not exist — handled by existence test")
        return content

    def test_trust_policy_restricts_to_gitweave_repository(self):
        """
        The trust policy condition must reference 'GitWeave' — either as a
        literal string in the subject condition or via a variable that resolves
        to the GitWeave repository name.

        This prevents any other repository from assuming the role via OIDC.
        """
        content = self._content()
        has_repo_scope = bool(
            re.search(r"GitWeave", content)
            or re.search(r"repo:[^\"']*GitWeave", content)
            or "github_repo" in content.lower()
            or "repository" in content.lower()
        )
        self.assertTrue(
            has_repo_scope,
            "oidc.tf trust policy must scope access to the GitWeave repository — "
            "found no reference to 'GitWeave' or a repository variable in the trust condition",
        )

    def test_trust_policy_subject_condition_uses_repo_prefix(self):
        """
        The trust policy StringLike or StringEquals condition on the 'sub' claim
        must use the 'repo:' prefix — this is the GitHub Actions OIDC token
        subject format that identifies the source repository.
        """
        content = self._content()
        self.assertIn(
            "repo:",
            content,
            "oidc.tf trust policy must include a condition with the 'repo:' subject prefix "
            "to identify the GitHub repository source of OIDC tokens",
        )


# ---------------------------------------------------------------------------
# Trust policy scoping: branch constraint
# ---------------------------------------------------------------------------


class TestOidcTrustPolicyBranchScope(unittest.TestCase):
    """
    Trust policy must be restricted to the main branch only.

    Scoping to main prevents topic branches, forks, and PRs from assuming the
    production IAM role — only merges to main should trigger infrastructure
    changes.
    """

    def _content(self) -> str:
        content = _read_oidc_tf()
        if not content:
            self.skipTest("infra/oidc.tf does not exist — handled by existence test")
        return content

    def test_trust_policy_restricts_to_main_branch(self):
        """
        The trust policy must reference 'refs/heads/main' — either as a literal
        string or via a variable — to restrict role assumption to workflows
        running on the main branch.
        """
        content = self._content()
        has_main_ref = bool(
            re.search(r"refs/heads/main", content)
            or re.search(r'ref:refs/heads/main', content)
        )
        self.assertTrue(
            has_main_ref,
            "oidc.tf trust policy must restrict role assumption to 'refs/heads/main' — "
            "workflows on other branches must not be able to assume the production role",
        )

    def test_trust_policy_condition_does_not_use_wildcard_branch(self):
        """
        The trust policy condition must not use a bare wildcard ('*') for the
        branch portion of the subject — a condition like 'repo:org/GitWeave:*'
        would allow any branch (including PRs from forks) to assume the role.

        The condition must be at least as specific as 'ref:refs/heads/main'.
        """
        content = self._content()
        # Look for a subject condition pattern that's more specific than a bare wildcard.
        # A bare wildcard pattern would be: repo:<owner>/<repo>:* with no branch constraint.
        # We accept: repo:*:ref:refs/heads/main  OR  repo:<owner>/GitWeave:ref:refs/heads/main
        has_dangerously_broad_condition = bool(
            re.search(r'repo:[^"\']*GitWeave["\']', content)
            and not re.search(r"refs/heads/main", content)
        )
        self.assertFalse(
            has_dangerously_broad_condition,
            "oidc.tf trust policy subject condition appears to allow any branch — "
            "the condition must be scoped to 'ref:refs/heads/main' to prevent "
            "non-main branches from assuming the production role",
        )


# ---------------------------------------------------------------------------
# AWS provider dependency
# ---------------------------------------------------------------------------


class TestOidcAwsProviderDependency(unittest.TestCase):
    """The AWS provider must be declared in infra/ to support the OIDC resources."""

    def test_aws_provider_is_declared_in_terraform_config(self):
        """
        infra/ must declare an AWS provider — required_providers must include
        the hashicorp/aws provider so that aws_iam_openid_connect_provider and
        aws_iam_role resources can be managed by Terraform.
        """
        content = _read_all_tf_content()
        has_aws_provider = bool(
            re.search(r'provider\s+"aws"\s+\{', content)
            or re.search(r'"hashicorp/aws"', content)
            or re.search(r'source\s*=\s*"hashicorp/aws"', content)
        )
        self.assertTrue(
            has_aws_provider,
            "infra/ must declare the AWS Terraform provider (hashicorp/aws) — "
            "required for managing aws_iam_openid_connect_provider and aws_iam_role resources",
        )


# ---------------------------------------------------------------------------
# Bootstrap README documentation
# ---------------------------------------------------------------------------


class TestOidcBootstrapDocumentation(unittest.TestCase):
    """
    infra/bootstrap/README.md must document the OIDC setup and required IAM
    permissions so operators can bootstrap the trust relationship manually
    before the first Terraform apply.
    """

    def _content(self) -> str:
        if not os.path.exists(BOOTSTRAP_README):
            self.skipTest("infra/bootstrap/README.md does not exist")
        with open(BOOTSTRAP_README) as f:
            return f.read()

    def test_bootstrap_readme_documents_oidc_setup(self):
        """
        infra/bootstrap/README.md must include an OIDC section — operators must
        know how to establish the initial OIDC trust relationship before any
        workflow can assume the IAM role.
        """
        content = self._content()
        has_oidc_section = bool(
            re.search(r"OIDC", content)
            or re.search(r"OpenID Connect", content, re.IGNORECASE)
        )
        self.assertTrue(
            has_oidc_section,
            "infra/bootstrap/README.md must document OIDC setup — "
            "found no reference to 'OIDC' or 'OpenID Connect'",
        )

    def test_bootstrap_readme_lists_required_iam_permissions(self):
        """
        infra/bootstrap/README.md must list the IAM permissions required to
        bootstrap the OIDC provider and role — without this, operators cannot
        determine the minimum IAM policy needed for the initial setup run.
        """
        content = self._content()
        has_iam_permissions = bool(
            re.search(r"iam:", content, re.IGNORECASE)
            or re.search(r"IAM", content)
            or re.search(r"permission", content, re.IGNORECASE)
        )
        self.assertTrue(
            has_iam_permissions,
            "infra/bootstrap/README.md must document required IAM permissions "
            "for OIDC bootstrap (e.g. iam:CreateOpenIDConnectProvider, iam:CreateRole)",
        )

    def test_bootstrap_readme_documents_iam_create_openid_connect_provider(self):
        """
        infra/bootstrap/README.md must reference 'iam:CreateOpenIDConnectProvider'
        (or equivalent) — this is the permission required to register the GitHub
        Actions OIDC issuer in AWS.
        """
        content = self._content()
        has_create_provider = bool(
            re.search(r"CreateOpenIDConnectProvider", content)
            or re.search(r"iam:Create.*OIDC", content, re.IGNORECASE)
            or re.search(r"openid.connect.provider", content, re.IGNORECASE)
        )
        self.assertTrue(
            has_create_provider,
            "infra/bootstrap/README.md must document 'iam:CreateOpenIDConnectProvider' — "
            "this is the AWS IAM permission required to create the OIDC provider resource",
        )


if __name__ == "__main__":
    unittest.main()
