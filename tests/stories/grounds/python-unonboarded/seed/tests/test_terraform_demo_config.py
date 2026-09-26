"""
Tests for the Terraform local-demo configuration fixtures and Makefile targets.

Acceptance criteria under test:
  - infra/demo.tfvars.example exists with placeholder values (demo org, mock token ref)
  - Makefile exists at repo root with tf-plan-demo and tf-validate targets
  - tf-validate target invokes 'terraform validate' in the infra/ directory
  - tf-plan-demo target invokes 'terraform plan -var-file=demo.tfvars.example'
  - terraform validate passes against the existing infra/ HCL configuration
  - infra/ Terraform configuration declares github_team resource types
  - infra/ Terraform configuration declares github_branch_protection resource types
  - demo.tfvars.example uses placeholder/example values, not real GitHub credentials

All tests in this file FAIL until the files are created (TDD red phase).
"""

import os
import re
import shutil
import subprocess
import unittest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DEMO_TFVARS = os.path.join(REPO_ROOT, "infra", "demo.tfvars.example")
MAKEFILE = os.path.join(REPO_ROOT, "Makefile")
INFRA_DIR = os.path.join(REPO_ROOT, "infra")
MAIN_TF = os.path.join(INFRA_DIR, "main.tf")
BRANCH_PROTECTION_TF = os.path.join(INFRA_DIR, "branch_protection.tf")


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------


def _terraform_available() -> bool:
    return shutil.which("terraform") is not None


def _read_file(path: str) -> str:
    with open(path) as f:
        return f.read()


# ---------------------------------------------------------------------------
# 1. Structural presence tests — fail until files are created
# ---------------------------------------------------------------------------


class TestDemoTfvarsFileExists(unittest.TestCase):
    """infra/demo.tfvars.example must be present in the repository."""

    def test_demo_tfvars_example_file_exists(self):
        """infra/demo.tfvars.example must exist so 'terraform plan -var-file=demo.tfvars.example' works locally."""
        self.assertTrue(
            os.path.isfile(DEMO_TFVARS),
            "infra/demo.tfvars.example is missing. "
            "Create this file with placeholder values so developers can run "
            "'terraform plan -var-file=demo.tfvars.example' without real credentials.",
        )

    def test_demo_tfvars_example_is_not_empty(self):
        """infra/demo.tfvars.example must contain at least one variable assignment."""
        if not os.path.isfile(DEMO_TFVARS):
            self.skipTest("infra/demo.tfvars.example not yet created — TDD red phase")
        content = _read_file(DEMO_TFVARS)
        self.assertGreater(
            len(content.strip()),
            0,
            "infra/demo.tfvars.example is empty — it must contain variable assignments.",
        )


class TestMakefileExists(unittest.TestCase):
    """Makefile must be present at the repository root."""

    def test_makefile_exists_at_repo_root(self):
        """Makefile must exist at the repository root to provide developer-facing convenience targets."""
        self.assertTrue(
            os.path.isfile(MAKEFILE),
            "Makefile is missing at the repository root. "
            "Create a Makefile with at least 'tf-validate' and 'tf-plan-demo' targets.",
        )


# ---------------------------------------------------------------------------
# 2. Content tests for demo.tfvars.example
# ---------------------------------------------------------------------------


class TestDemoTfvarsContent(unittest.TestCase):
    """demo.tfvars.example must contain appropriate placeholder values."""

    def setUp(self):
        if not os.path.isfile(DEMO_TFVARS):
            self.skipTest("infra/demo.tfvars.example not yet created — TDD red phase")
        self.content = _read_file(DEMO_TFVARS)

    def test_demo_tfvars_contains_github_org_assignment(self):
        """demo.tfvars.example must assign the required 'github_org' variable."""
        self.assertIn(
            "github_org",
            self.content,
            "demo.tfvars.example must define 'github_org'. "
            "This is a required variable in infra/variables.tf.",
        )

    def test_github_org_value_is_a_placeholder(self):
        """
        The github_org value must be a placeholder (e.g. 'demo-org', 'example-org',
        'your-org-here') — not a real GitHub organisation slug.

        A real slug would couple demo fixtures to a live organisation, making
        plan runs unpredictable for contributors without access to that org.
        """
        # Extract the github_org assignment value
        match = re.search(r'github_org\s*=\s*"([^"]+)"', self.content)
        self.assertIsNotNone(
            match,
            "demo.tfvars.example does not contain a quoted github_org assignment. "
            "Expected: github_org = \"<placeholder-org>\"",
        )
        org_value = match.group(1)
        # Placeholder values use descriptive names, not real org slugs
        # Accept any value containing 'demo', 'example', 'your', 'placeholder', 'fake', 'mock'
        placeholder_indicators = ("demo", "example", "your", "placeholder", "fake", "mock", "test")
        is_placeholder = any(indicator in org_value.lower() for indicator in placeholder_indicators)
        self.assertTrue(
            is_placeholder,
            f"github_org value '{org_value}' does not look like a placeholder. "
            "Use a descriptive value like 'demo-org', 'example-org', or 'your-org-name-here' "
            "so the file clearly communicates it must be replaced before real use.",
        )

    def test_demo_tfvars_does_not_hardcode_real_github_token(self):
        """
        demo.tfvars.example must NOT hardcode a GitHub token value.

        Tokens must be supplied via environment variables (GITHUB_TOKEN).
        Hardcoding a token in a committed file, even an example file, is a
        security risk and violates GitWeave's secret management policy.
        """
        # Check for anything that looks like a real GitHub token:
        # classic: ghp_<39 alphanumeric chars>
        # fine-grained: github_pat_<...>
        # or any string starting with 'ghp_', 'ghs_', 'gho_', 'ghu_', 'github_pat_'
        real_token_pattern = re.compile(
            r'(ghp_[A-Za-z0-9]{36,}|ghs_[A-Za-z0-9]{36,}|gho_[A-Za-z0-9]{36,}'
            r'|ghu_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]+)'
        )
        match = real_token_pattern.search(self.content)
        self.assertIsNone(
            match,
            f"demo.tfvars.example appears to contain a real GitHub token: "
            f"'{match.group(0) if match else ''}'. "
            "Never commit tokens to source. Use the GITHUB_TOKEN environment variable instead.",
        )

    def test_demo_tfvars_contains_comment_or_env_var_hint_for_token(self):
        """
        demo.tfvars.example should document how to provide the GitHub token
        via the GITHUB_TOKEN environment variable — either via a comment or a
        token variable assignment pointing at the env var reference.

        This guides developers who copy the example file on how to authenticate
        without hardcoding a secret.
        """
        # Accept: a comment mentioning GITHUB_TOKEN, or a token = ... line with env var reference
        has_token_hint = (
            "GITHUB_TOKEN" in self.content
            or "token" in self.content.lower()
        )
        self.assertTrue(
            has_token_hint,
            "demo.tfvars.example should document the GITHUB_TOKEN environment variable "
            "or include a 'token' variable hint so developers know how to authenticate. "
            "Add a comment like: # Set GITHUB_TOKEN env var; the provider picks it up automatically",
        )


# ---------------------------------------------------------------------------
# 3. Content tests for Makefile
# ---------------------------------------------------------------------------


class TestMakefileTargets(unittest.TestCase):
    """Makefile must define tf-validate and tf-plan-demo targets."""

    def setUp(self):
        if not os.path.isfile(MAKEFILE):
            self.skipTest("Makefile not yet created — TDD red phase")
        self.content = _read_file(MAKEFILE)

    def test_makefile_defines_tf_validate_target(self):
        """Makefile must define a 'tf-validate' target."""
        self.assertIn(
            "tf-validate",
            self.content,
            "Makefile is missing the 'tf-validate' target. "
            "Add: tf-validate:\n\tcd infra && terraform validate",
        )

    def test_makefile_defines_tf_plan_demo_target(self):
        """Makefile must define a 'tf-plan-demo' target."""
        self.assertIn(
            "tf-plan-demo",
            self.content,
            "Makefile is missing the 'tf-plan-demo' target. "
            "Add: tf-plan-demo:\n\tcd infra && terraform plan -var-file=demo.tfvars.example",
        )

    def test_tf_validate_target_invokes_terraform_validate(self):
        """
        The tf-validate target must invoke 'terraform validate' — the command
        that validates the Terraform configuration for syntactic and semantic
        correctness without requiring cloud credentials.
        """
        # Find the tf-validate target block
        lines = self.content.splitlines()
        in_tf_validate = False
        target_body_lines = []
        for line in lines:
            if re.match(r'^tf-validate\s*:', line):
                in_tf_validate = True
                continue
            if in_tf_validate:
                # Target body is indented with a tab; stop at the next target or blank line
                if line.startswith("\t"):
                    target_body_lines.append(line)
                elif line.strip() == "":
                    continue
                elif not line.startswith(" ") and ":" in line and not line.startswith("#"):
                    break

        target_body = "\n".join(target_body_lines)
        self.assertIn(
            "terraform validate",
            target_body,
            f"tf-validate target does not call 'terraform validate'. "
            f"Found body:\n{target_body or '(empty)'}",
        )

    def test_tf_validate_target_runs_in_infra_directory(self):
        """
        The tf-validate target must operate in the infra/ directory where
        the Terraform configuration lives — running it from the repo root
        would fail because there are no .tf files there.
        """
        lines = self.content.splitlines()
        in_tf_validate = False
        target_body_lines = []
        for line in lines:
            if re.match(r'^tf-validate\s*:', line):
                in_tf_validate = True
                continue
            if in_tf_validate:
                if line.startswith("\t"):
                    target_body_lines.append(line)
                elif line.strip() == "":
                    continue
                elif not line.startswith(" ") and ":" in line and not line.startswith("#"):
                    break

        target_body = "\n".join(target_body_lines)
        runs_in_infra = "infra" in target_body or "-chdir=infra" in target_body
        self.assertTrue(
            runs_in_infra,
            f"tf-validate target must run in the infra/ directory. "
            "Use 'cd infra && terraform validate' or 'terraform -chdir=infra validate'. "
            f"Found body:\n{target_body or '(empty)'}",
        )

    def test_tf_plan_demo_target_invokes_terraform_plan(self):
        """
        The tf-plan-demo target must invoke 'terraform plan' — not just
        'terraform validate' — to exercise the full planning phase.
        """
        lines = self.content.splitlines()
        in_tf_plan_demo = False
        target_body_lines = []
        for line in lines:
            if re.match(r'^tf-plan-demo\s*:', line):
                in_tf_plan_demo = True
                continue
            if in_tf_plan_demo:
                if line.startswith("\t"):
                    target_body_lines.append(line)
                elif line.strip() == "":
                    continue
                elif not line.startswith(" ") and ":" in line and not line.startswith("#"):
                    break

        target_body = "\n".join(target_body_lines)
        self.assertIn(
            "terraform plan",
            target_body,
            f"tf-plan-demo target does not call 'terraform plan'. "
            f"Found body:\n{target_body or '(empty)'}",
        )

    def test_tf_plan_demo_target_uses_demo_tfvars_file(self):
        """
        The tf-plan-demo target must pass '-var-file=demo.tfvars.example' to
        terraform plan so developers test against the committed placeholder fixtures,
        not against a local untracked tfvars file.
        """
        lines = self.content.splitlines()
        in_tf_plan_demo = False
        target_body_lines = []
        for line in lines:
            if re.match(r'^tf-plan-demo\s*:', line):
                in_tf_plan_demo = True
                continue
            if in_tf_plan_demo:
                if line.startswith("\t"):
                    target_body_lines.append(line)
                elif line.strip() == "":
                    continue
                elif not line.startswith(" ") and ":" in line and not line.startswith("#"):
                    break

        target_body = "\n".join(target_body_lines)
        self.assertIn(
            "demo.tfvars.example",
            target_body,
            f"tf-plan-demo target must reference 'demo.tfvars.example' via -var-file. "
            f"Found body:\n{target_body or '(empty)'}",
        )

    def test_tf_plan_demo_target_runs_in_infra_directory(self):
        """
        The tf-plan-demo target must operate in the infra/ directory where
        the Terraform configuration files reside.
        """
        lines = self.content.splitlines()
        in_tf_plan_demo = False
        target_body_lines = []
        for line in lines:
            if re.match(r'^tf-plan-demo\s*:', line):
                in_tf_plan_demo = True
                continue
            if in_tf_plan_demo:
                if line.startswith("\t"):
                    target_body_lines.append(line)
                elif line.strip() == "":
                    continue
                elif not line.startswith(" ") and ":" in line and not line.startswith("#"):
                    break

        target_body = "\n".join(target_body_lines)
        runs_in_infra = "infra" in target_body or "-chdir=infra" in target_body
        self.assertTrue(
            runs_in_infra,
            f"tf-plan-demo target must run in the infra/ directory. "
            "Use 'cd infra && terraform plan ...' or 'terraform -chdir=infra plan ...'. "
            f"Found body:\n{target_body or '(empty)'}",
        )


# ---------------------------------------------------------------------------
# 4. Terraform validate integration test — runs real terraform
# ---------------------------------------------------------------------------


class TestTerraformValidate(unittest.TestCase):
    """
    'terraform validate' must pass against the infra/ configuration.

    This verifies that the HCL files are syntactically and semantically
    valid — no credentials required, just the provider plugin cache.
    """

    def setUp(self):
        if not _terraform_available():
            self.skipTest("terraform binary not found on PATH — skipping integration tests")
        terraform_dir = os.path.join(INFRA_DIR, ".terraform")
        if not os.path.isdir(terraform_dir):
            self.skipTest(
                "infra/.terraform directory not present — run 'terraform init' in infra/ first"
            )

    def test_terraform_validate_exits_zero_in_infra_dir(self):
        """
        'terraform validate' must exit 0 in the infra/ directory.

        A non-zero exit means the Terraform configuration has errors that
        would prevent any plan or apply from succeeding.
        """
        result = subprocess.run(
            ["terraform", "validate"],
            cwd=INFRA_DIR,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(
            result.returncode,
            0,
            f"terraform validate failed with exit code {result.returncode}.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_terraform_validate_reports_success_message(self):
        """
        Terraform validate output must confirm success — typically 'Success! The
        configuration is valid.' This guards against a zero exit with misleading output.
        """
        result = subprocess.run(
            ["terraform", "validate"],
            cwd=INFRA_DIR,
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode != 0:
            self.skipTest("terraform validate failed — covered by previous test")
        combined = result.stdout + result.stderr
        self.assertIn(
            "valid",
            combined.lower(),
            f"terraform validate output does not contain 'valid'. "
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# 5. Terraform resource type declaration tests — static analysis of .tf files
# ---------------------------------------------------------------------------


class TestTerraformResourceTypeDeclarations(unittest.TestCase):
    """
    The infra/ Terraform configuration must declare github_team and
    github_branch_protection resource types.

    These tests verify the plan acceptance criterion — that a plan against
    this configuration will produce github_team and github_branch_protection
    resource actions — without requiring live GitHub credentials.

    Static analysis of the .tf source files is used because:
      - It requires no authentication
      - It confirms the resource types are declared and will appear in any plan
      - It is deterministic and fast
    """

    def test_main_tf_declares_github_team_resource(self):
        """
        infra/main.tf must declare at least one 'resource \"github_team\"' block.

        This is required for the plan to contain team resource actions, which
        satisfies the acceptance criterion: 'plan output contains expected team
        resource types'.
        """
        self.assertTrue(
            os.path.isfile(MAIN_TF),
            f"infra/main.tf is missing — cannot verify resource declarations",
        )
        content = _read_file(MAIN_TF)
        self.assertRegex(
            content,
            r'resource\s+"github_team"',
            "infra/main.tf does not declare a 'github_team' resource. "
            "The plan must include team resources to satisfy the acceptance criterion.",
        )

    def test_branch_protection_tf_declares_github_branch_protection_resource(self):
        """
        infra/branch_protection.tf must declare at least one
        'resource \"github_branch_protection\"' block.

        This is required for the plan to contain branch protection resource
        actions, satisfying the acceptance criterion: 'plan output contains
        expected branch-protection resource types'.
        """
        self.assertTrue(
            os.path.isfile(BRANCH_PROTECTION_TF),
            f"infra/branch_protection.tf is missing — cannot verify resource declarations",
        )
        content = _read_file(BRANCH_PROTECTION_TF)
        self.assertRegex(
            content,
            r'resource\s+"github_branch_protection"',
            "infra/branch_protection.tf does not declare a 'github_branch_protection' resource. "
            "The plan must include branch protection resources to satisfy the acceptance criterion.",
        )

    def test_infra_dir_contains_at_least_one_tf_file(self):
        """infra/ must contain Terraform configuration files to be a valid module."""
        tf_files = [
            f for f in os.listdir(INFRA_DIR)
            if f.endswith(".tf")
        ]
        self.assertGreater(
            len(tf_files),
            0,
            f"infra/ contains no .tf files — Terraform has nothing to plan.",
        )

    def test_variables_tf_declares_github_org_variable(self):
        """
        infra/variables.tf must declare a 'github_org' variable so that
        demo.tfvars.example can assign a value to it.

        Without this declaration, terraform plan -var-file=demo.tfvars.example
        will fail with 'Value for undeclared variable'.
        """
        variables_tf = os.path.join(INFRA_DIR, "variables.tf")
        self.assertTrue(
            os.path.isfile(variables_tf),
            "infra/variables.tf is missing",
        )
        content = _read_file(variables_tf)
        self.assertRegex(
            content,
            r'variable\s+"github_org"',
            "infra/variables.tf does not declare the 'github_org' variable. "
            "demo.tfvars.example must be able to set this variable.",
        )


# ---------------------------------------------------------------------------
# 6. make tf-validate integration test
# ---------------------------------------------------------------------------


class TestMakeTfValidate(unittest.TestCase):
    """
    'make tf-validate' must run 'terraform validate' successfully.

    This is the CI entry point for validating the Terraform configuration
    without applying any changes.
    """

    def setUp(self):
        if not os.path.isfile(MAKEFILE):
            self.skipTest("Makefile not yet created — TDD red phase")
        if not _terraform_available():
            self.skipTest("terraform binary not found on PATH")
        terraform_dir = os.path.join(INFRA_DIR, ".terraform")
        if not os.path.isdir(terraform_dir):
            self.skipTest(
                "infra/.terraform directory not present — run 'terraform init' first"
            )

    def test_make_tf_validate_exits_zero(self):
        """
        'make tf-validate' must exit 0, confirming the Terraform configuration
        in infra/ is valid.
        """
        result = subprocess.run(
            ["make", "tf-validate"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assertEqual(
            result.returncode,
            0,
            f"make tf-validate failed with exit code {result.returncode}.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# 7. make tf-plan-demo integration test
# ---------------------------------------------------------------------------


class TestMakeTfPlanDemo(unittest.TestCase):
    """
    'make tf-plan-demo' must invoke 'terraform plan -var-file=demo.tfvars.example'
    in the infra/ directory.

    This test verifies that the Makefile target is wired correctly.  Because
    terraform plan contacts the GitHub API (via the data source in
    branch_protection.tf), this test only validates the command is invoked with
    the correct arguments; it does NOT assert a successful plan exit code, since
    that would require live credentials.
    """

    def setUp(self):
        if not os.path.isfile(MAKEFILE):
            self.skipTest("Makefile not yet created — TDD red phase")
        if not os.path.isfile(DEMO_TFVARS):
            self.skipTest("infra/demo.tfvars.example not yet created — TDD red phase")
        if not _terraform_available():
            self.skipTest("terraform binary not found on PATH")
        terraform_dir = os.path.join(INFRA_DIR, ".terraform")
        if not os.path.isdir(terraform_dir):
            self.skipTest(
                "infra/.terraform directory not present — run 'terraform init' first"
            )

    def test_make_tf_plan_demo_invokes_correct_terraform_command(self):
        """
        Running 'make tf-plan-demo' (dry-run mode: -n flag) must produce a
        command line that references 'terraform plan' and 'demo.tfvars.example'.

        Using make -n avoids actually running terraform while confirming the
        target is wired to the right command.
        """
        result = subprocess.run(
            ["make", "-n", "tf-plan-demo"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
        )
        combined = result.stdout + result.stderr
        self.assertIn(
            "terraform plan",
            combined,
            f"'make -n tf-plan-demo' did not produce a 'terraform plan' command.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )
        self.assertIn(
            "demo.tfvars.example",
            combined,
            f"'make -n tf-plan-demo' does not reference 'demo.tfvars.example'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_make_tf_validate_dry_run_invokes_terraform_validate(self):
        """
        'make -n tf-validate' must produce a command line that references
        'terraform validate' — confirming the target is wired correctly.
        """
        result = subprocess.run(
            ["make", "-n", "tf-validate"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=30,
        )
        combined = result.stdout + result.stderr
        self.assertIn(
            "terraform validate",
            combined,
            f"'make -n tf-validate' did not produce a 'terraform validate' command.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# 8. Security: demo.tfvars.example must not encode secrets
# ---------------------------------------------------------------------------


class TestDemoTfvarsSecurityConstraints(unittest.TestCase):
    """
    demo.tfvars.example is committed to source control and must not contain
    any real credentials, tokens, or sensitive values.
    """

    def setUp(self):
        if not os.path.isfile(DEMO_TFVARS):
            self.skipTest("infra/demo.tfvars.example not yet created — TDD red phase")
        self.content = _read_file(DEMO_TFVARS)

    def test_demo_tfvars_does_not_contain_real_github_pat(self):
        """
        demo.tfvars.example must not contain a GitHub Personal Access Token.

        Classic PATs start with 'ghp_'; fine-grained tokens start with 'github_pat_'.
        Either format in a committed file would expose credentials.
        """
        forbidden_prefixes = ("ghp_", "ghs_", "gho_", "ghu_", "github_pat_")
        for prefix in forbidden_prefixes:
            self.assertNotIn(
                prefix,
                self.content,
                f"demo.tfvars.example appears to contain a GitHub token starting with '{prefix}'. "
                "Never commit real tokens to source control.",
            )

    def test_demo_tfvars_file_name_matches_expected_path(self):
        """
        The example file must be named 'demo.tfvars.example' (not 'demo.tfvars')
        so it is clearly marked as a non-functional example and not accidentally
        picked up by terraform as a real var file.
        """
        basename = os.path.basename(DEMO_TFVARS)
        self.assertEqual(
            basename,
            "demo.tfvars.example",
            f"Expected 'demo.tfvars.example', found '{basename}'. "
            "The '.example' suffix signals this file must be copied and customised "
            "before use — it should never be used directly as a real tfvars file.",
        )


if __name__ == "__main__":
    unittest.main()
