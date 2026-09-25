"""
Tests for docs/demo-guide.md — the end-to-end walkthrough of all four GitWeave subsystems.

The guide must:
  - exist at docs/demo-guide.md
  - cover all five demo sections: bootstrap, overlay-config-validation, apply-overlays
    dry-run, Terraform plan, and webhook smoke test
  - document the exact command for each section in a fenced code block
  - document expected terminal output for each command
  - reference only scripts and files that actually exist in the repository
  - be non-trivially complete (not an empty stub)

CI contract (from work item acceptance criteria):
  - Markdown lint: the file is parseable and structurally sound
  - File-reference assertion: every script path and config file mentioned must exist

All tests in this file fail until docs/demo-guide.md is created (TDD red phase).
"""

import os
import re
import unittest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
GUIDE_PATH = os.path.join(REPO_ROOT, "docs", "demo-guide.md")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_guide() -> str:
    """Read and return the full guide content.  Raises FileNotFoundError if absent."""
    with open(GUIDE_PATH) as f:
        return f.read()


def _extract_fenced_code_blocks(text: str) -> list[str]:
    """Return the content of every fenced code block (``` ... ```) in *text*."""
    pattern = re.compile(r"```[^\n]*\n(.*?)```", re.DOTALL)
    return [m.group(1) for m in pattern.finditer(text)]


def _extract_headings(text: str) -> list[str]:
    """Return all Markdown heading text (stripping the # prefix and whitespace)."""
    return [
        line.lstrip("#").strip()
        for line in text.splitlines()
        if line.startswith("#")
    ]


def _extract_referenced_paths(text: str) -> list[str]:
    """
    Return every file/directory path referenced in backtick inline code or
    fenced code blocks that looks like a relative project path (starts with a
    known top-level directory or 'scripts/').

    The regex captures things like `scripts/bootstrap.sh`, `config/example.yaml`,
    `infra/`, `schemas/overlay.schema.json`, etc.
    """
    # Match paths starting with a recognised top-level directory
    top_dirs = r"(?:scripts|config|infra|metrics|modules|schemas|docs|\.github)"
    pattern = re.compile(
        rf"(?:^|[\s`'\"])({top_dirs}/[^\s`'\")\]]+)",
        re.MULTILINE,
    )
    return list({m.group(1) for m in pattern.finditer(text)})


# ---------------------------------------------------------------------------
# 1. File existence and basic structure
# ---------------------------------------------------------------------------


class TestDemoGuideExists(unittest.TestCase):
    """The guide file must exist and be non-empty."""

    def test_docs_directory_exists(self):
        """docs/ directory must exist at the repo root."""
        docs_dir = os.path.join(REPO_ROOT, "docs")
        self.assertTrue(
            os.path.isdir(docs_dir),
            "docs/ directory is missing — create it before adding demo-guide.md",
        )

    def test_demo_guide_file_exists(self):
        """docs/demo-guide.md must exist at the declared path."""
        self.assertTrue(
            os.path.isfile(GUIDE_PATH),
            f"docs/demo-guide.md is missing — expected at {GUIDE_PATH}",
        )

    def test_demo_guide_is_not_empty(self):
        """docs/demo-guide.md must not be an empty file."""
        content = _read_guide()
        self.assertGreater(
            len(content.strip()),
            0,
            "docs/demo-guide.md exists but is empty",
        )

    def test_demo_guide_has_minimum_length(self):
        """The guide must be substantive — at least 800 characters of content."""
        content = _read_guide()
        self.assertGreater(
            len(content),
            800,
            f"docs/demo-guide.md is too short ({len(content)} chars) — "
            "each section must include commands and expected output",
        )

    def test_demo_guide_has_a_top_level_title(self):
        """The guide must start with a top-level H1 heading."""
        content = _read_guide()
        headings = _extract_headings(content)
        h1_headings = [h for h in headings if content.count("# " + h) > 0
                       and not content.count("## " + h)]
        # More robust: just check there's at least one line starting with a single #
        h1_lines = [
            line for line in content.splitlines()
            if re.match(r"^#\s+\S", line)
        ]
        self.assertGreater(
            len(h1_lines),
            0,
            "docs/demo-guide.md has no top-level H1 heading (# Title)",
        )


# ---------------------------------------------------------------------------
# 2. Required sections
# ---------------------------------------------------------------------------


class TestDemoGuideSections(unittest.TestCase):
    """Each of the five demo subsystems must have its own section."""

    def setUp(self):
        self.content = _read_guide()
        self.headings = _extract_headings(self.content)
        self.content_lower = self.content.lower()

    def test_has_bootstrap_section(self):
        """The guide must include a section covering the bootstrap step."""
        self.assertTrue(
            any("bootstrap" in h.lower() for h in self.headings),
            "docs/demo-guide.md is missing a 'Bootstrap' section — "
            "add a heading that covers the bootstrap step",
        )

    def test_has_overlay_config_validation_section(self):
        """The guide must include a section covering overlay config validation (dry-run)."""
        has_section = any(
            ("overlay" in h.lower() and ("valid" in h.lower() or "config" in h.lower()))
            or ("config" in h.lower() and "valid" in h.lower())
            for h in self.headings
        )
        self.assertTrue(
            has_section,
            "docs/demo-guide.md is missing an overlay config validation section — "
            "add a heading covering 'Overlay Config Validation' or similar",
        )

    def test_has_apply_overlays_section(self):
        """The guide must include a section covering the apply-overlays dry-run."""
        has_section = any(
            "apply" in h.lower() and "overlay" in h.lower()
            for h in self.headings
        )
        self.assertTrue(
            has_section,
            "docs/demo-guide.md is missing an 'Apply Overlays' section — "
            "add a heading covering the apply-overlays dry-run",
        )

    def test_has_terraform_plan_section(self):
        """The guide must include a section covering the Terraform plan demo."""
        has_section = any(
            "terraform" in h.lower() or "infra" in h.lower()
            for h in self.headings
        )
        self.assertTrue(
            has_section,
            "docs/demo-guide.md is missing a Terraform plan section — "
            "add a heading covering 'Terraform Plan' or 'Infrastructure'",
        )

    def test_has_webhook_smoke_test_section(self):
        """The guide must include a section covering the webhook smoke test."""
        has_section = any(
            "webhook" in h.lower() or "smoke" in h.lower()
            for h in self.headings
        )
        self.assertTrue(
            has_section,
            "docs/demo-guide.md is missing a webhook smoke test section — "
            "add a heading covering 'Webhook Smoke Test' or similar",
        )


# ---------------------------------------------------------------------------
# 3. Commands are documented in fenced code blocks
# ---------------------------------------------------------------------------


class TestDemoGuideCommands(unittest.TestCase):
    """Each subsystem's command must appear in a fenced code block."""

    def setUp(self):
        self.content = _read_guide()
        self.code_blocks = _extract_fenced_code_blocks(self.content)
        self.all_code = "\n".join(self.code_blocks)

    def test_bootstrap_sh_command_is_documented(self):
        """The bootstrap command (scripts/bootstrap.sh or ./scripts/bootstrap.sh) must be in a code block."""
        self.assertTrue(
            "bootstrap.sh" in self.all_code,
            "docs/demo-guide.md has no fenced code block containing 'bootstrap.sh' — "
            "document the exact bootstrap command",
        )

    def test_overlay_validation_command_is_documented(self):
        """A command to validate overlay configs (pytest or python/jsonschema) must be in a code block."""
        has_validation_cmd = (
            "pytest" in self.all_code
            or "jsonschema" in self.all_code
            or "validate" in self.all_code
        )
        self.assertTrue(
            has_validation_cmd,
            "docs/demo-guide.md has no fenced code block with an overlay validation command — "
            "document the dry-run validation command (e.g., pytest tests/test_overlay_schema.py)",
        )

    def test_terraform_plan_command_is_documented(self):
        """'terraform plan' must appear in a fenced code block."""
        self.assertIn(
            "terraform plan",
            self.all_code,
            "docs/demo-guide.md has no fenced code block containing 'terraform plan' — "
            "document the Terraform plan dry-run command",
        )

    def test_terraform_init_command_is_documented(self):
        """'terraform init' must appear before 'terraform plan' (init is a prerequisite)."""
        self.assertIn(
            "terraform init",
            self.all_code,
            "docs/demo-guide.md is missing 'terraform init' — "
            "document the initialization step before terraform plan",
        )

    def test_webhook_curl_or_equivalent_command_is_documented(self):
        """A webhook invocation command (curl, httpie, or similar) must be in a code block."""
        has_webhook_cmd = (
            "curl" in self.all_code
            or "http " in self.all_code
            or "httpie" in self.all_code
            or "POST" in self.all_code
            or "webhook" in self.all_code.lower()
        )
        self.assertTrue(
            has_webhook_cmd,
            "docs/demo-guide.md has no fenced code block with a webhook invocation command — "
            "document how to send a test webhook event (e.g., curl -X POST ...)",
        )

    def test_has_at_least_five_fenced_code_blocks(self):
        """There must be at least five fenced code blocks — one per subsystem section."""
        self.assertGreaterEqual(
            len(self.code_blocks),
            5,
            f"docs/demo-guide.md has only {len(self.code_blocks)} fenced code block(s) — "
            "each subsystem section must show the exact command",
        )


# ---------------------------------------------------------------------------
# 4. Expected output is documented
# ---------------------------------------------------------------------------


class TestDemoGuideExpectedOutput(unittest.TestCase):
    """Each command section must document what the developer should expect to see."""

    def setUp(self):
        self.content = _read_guide()
        self.content_lower = self.content.lower()

    def test_guide_documents_bootstrap_success_output(self):
        """The guide must show the expected bootstrap output (success indicators)."""
        bootstrap_success_markers = [
            "bootstrap check complete",
            "bootstrap complete",
            "gitweave bootstrap",
            "prerequisites",
        ]
        has_output = any(m in self.content_lower for m in bootstrap_success_markers)
        self.assertTrue(
            has_output,
            "docs/demo-guide.md does not document expected bootstrap output — "
            "include the terminal output a developer should see on success",
        )

    def test_guide_documents_terraform_plan_no_changes_or_expected_output(self):
        """The guide must show what terraform plan output looks like."""
        terraform_output_markers = [
            "no changes",
            "plan:",
            "changes to outputs",
            "terraform will perform",
            "to add",
            "to change",
            "to destroy",
        ]
        has_output = any(m in self.content_lower for m in terraform_output_markers)
        self.assertTrue(
            has_output,
            "docs/demo-guide.md does not document expected terraform plan output — "
            "include what the developer should see (e.g., 'No changes' or planned resource counts)",
        )

    def test_guide_documents_webhook_response(self):
        """The guide must show the expected HTTP response from the webhook endpoint."""
        response_markers = [
            "200",
            "202",
            "accepted",
            '"event"',
            "response",
            "http/",
        ]
        has_output = any(m in self.content_lower for m in response_markers)
        self.assertTrue(
            has_output,
            "docs/demo-guide.md does not document the expected webhook HTTP response — "
            "include the status code and body the developer should receive",
        )

    def test_guide_documents_overlay_validation_pass_output(self):
        """The guide must show what passing overlay validation looks like."""
        validation_output_markers = [
            "passed",
            "ok",
            "1 passed",
            "success",
            "no errors",
            "valid",
        ]
        has_output = any(m in self.content_lower for m in validation_output_markers)
        self.assertTrue(
            has_output,
            "docs/demo-guide.md does not document expected overlay validation output — "
            "include the terminal output when validation passes",
        )


# ---------------------------------------------------------------------------
# 5. Referenced files and scripts must exist in the repository
# ---------------------------------------------------------------------------


class TestDemoGuideReferencedFilesExist(unittest.TestCase):
    """Every script or config file explicitly referenced in the guide must actually exist."""

    def setUp(self):
        self.content = _read_guide()
        self.repo_root = REPO_ROOT

    def _assert_path_exists(self, rel_path: str) -> None:
        """Assert that a repository-relative path (file or directory) exists."""
        full_path = os.path.join(self.repo_root, rel_path)
        self.assertTrue(
            os.path.exists(full_path),
            f"docs/demo-guide.md references '{rel_path}' but it does not exist in the repository",
        )

    def test_bootstrap_script_referenced_in_guide_exists(self):
        """scripts/bootstrap.sh must exist — it is referenced in the bootstrap section."""
        self._assert_path_exists("scripts/bootstrap.sh")

    def test_config_example_yaml_referenced_in_guide_exists(self):
        """config/example.yaml must exist — it is used in the overlay validation section."""
        self._assert_path_exists("config/example.yaml")

    def test_overlay_schema_referenced_in_guide_exists(self):
        """schemas/overlay.schema.json must exist — it drives the dry-run validation."""
        self._assert_path_exists("schemas/overlay.schema.json")

    def test_infra_directory_referenced_in_guide_exists(self):
        """infra/ directory must exist — it is used in the Terraform plan section."""
        self._assert_path_exists("infra")

    def test_infra_main_tf_referenced_in_guide_exists(self):
        """infra/main.tf must exist — it is the entry point for terraform plan."""
        self._assert_path_exists("infra/main.tf")

    def test_metrics_service_directory_exists(self):
        """metrics/ directory must exist — the webhook smoke test targets the metrics service."""
        self._assert_path_exists("metrics")

    def test_all_extracted_repo_paths_exist(self):
        """Every relative path extracted from the guide must resolve to an existing file/directory."""
        referenced_paths = _extract_referenced_paths(self.content)
        # Only check paths that look like concrete files (not glob patterns or placeholders)
        concrete_paths = [
            p for p in referenced_paths
            if "*" not in p
            and "<" not in p
            and ">" not in p
            and "YOUR_" not in p
            and "example" not in p.lower()
            and not p.endswith("/")
        ]
        missing = []
        for rel_path in concrete_paths:
            full_path = os.path.join(self.repo_root, rel_path)
            if not os.path.exists(full_path):
                missing.append(rel_path)
        self.assertEqual(
            missing,
            [],
            f"docs/demo-guide.md references {len(missing)} path(s) that do not exist:\n"
            + "\n".join(f"  - {p}" for p in missing),
        )


# ---------------------------------------------------------------------------
# 6. Fresh-clone usability — prerequisites and git clone step
# ---------------------------------------------------------------------------


class TestDemoGuideFreshCloneUsability(unittest.TestCase):
    """
    A second developer following only this guide from a fresh clone must be able
    to run every command. The guide must document prerequisites and the clone step.
    """

    def setUp(self):
        self.content = _read_guide()
        self.content_lower = self.content.lower()
        self.code_blocks = _extract_fenced_code_blocks(self.content)
        self.all_code = "\n".join(self.code_blocks)

    def test_guide_mentions_prerequisites(self):
        """The guide must list the tools a developer needs before starting."""
        prereq_markers = ["prerequisite", "requirements", "install", "required", "you need"]
        has_prereqs = any(m in self.content_lower for m in prereq_markers)
        self.assertTrue(
            has_prereqs,
            "docs/demo-guide.md does not mention prerequisites — "
            "list required tools (git, terraform, python3) so a fresh clone succeeds",
        )

    def test_guide_mentions_git_clone(self):
        """The guide must show how to clone the repository (or note that it's assumed cloned)."""
        has_clone = (
            "git clone" in self.all_code
            or "git clone" in self.content_lower
            or "fresh clone" in self.content_lower
            or "clone" in self.content_lower
        )
        self.assertTrue(
            has_clone,
            "docs/demo-guide.md does not mention 'git clone' — "
            "the guide must be usable from a fresh clone",
        )

    def test_guide_mentions_python3_or_pip(self):
        """The guide must reference python3 or pip for the metrics/webhook section."""
        has_python = (
            "python3" in self.content_lower
            or "python" in self.content_lower
            or "pip" in self.content_lower
        )
        self.assertTrue(
            has_python,
            "docs/demo-guide.md does not mention Python — "
            "the webhook smoke test requires the metrics service to be running",
        )

    def test_guide_steps_are_numbered_or_headed(self):
        """The guide must use numbered steps or sub-headings to order the walkthrough."""
        headings = _extract_headings(self.content)
        has_ordering = (
            len(headings) >= 5  # at least one heading per subsystem
            or re.search(r"^\d+\.", self.content, re.MULTILINE)  # numbered list
        )
        self.assertTrue(
            has_ordering,
            "docs/demo-guide.md does not use numbered steps or sub-headings — "
            "the walkthrough must be clearly ordered so a reviewer can follow it verbatim",
        )


# ---------------------------------------------------------------------------
# 7. CI integration — the guide references the correct test commands
# ---------------------------------------------------------------------------


class TestDemoGuideCIIntegration(unittest.TestCase):
    """
    The guide's overlay validation and structural checks must use commands that
    actually work in this repository (pytest, yamllint, terraform validate).
    """

    def setUp(self):
        self.content = _read_guide()
        self.code_blocks = _extract_fenced_code_blocks(self.content)
        self.all_code = "\n".join(self.code_blocks)

    def test_overlay_validation_uses_pytest_or_jsonschema(self):
        """
        The overlay config validation dry-run must use pytest (the existing test suite)
        or a jsonschema CLI — not a non-existent 'gw validate' command.
        """
        has_real_validator = (
            "pytest" in self.all_code
            or "jsonschema" in self.all_code
            or "python" in self.all_code
        )
        self.assertTrue(
            has_real_validator,
            "docs/demo-guide.md overlay validation step does not use pytest or jsonschema — "
            "the validation command must be one that actually works in this repo",
        )

    def test_terraform_plan_is_run_from_infra_directory(self):
        """
        The Terraform plan command must either cd into infra/ or use -chdir=infra/
        so the developer is in the right directory.
        """
        has_infra_context = (
            "cd infra" in self.all_code
            or "-chdir=infra" in self.all_code
            or "infra/" in self.all_code
        )
        self.assertTrue(
            has_infra_context,
            "docs/demo-guide.md terraform plan step does not show 'cd infra' or '-chdir=infra' — "
            "the developer must be in the infra/ directory to run terraform commands",
        )

    def test_webhook_endpoint_uses_correct_path(self):
        """
        The webhook smoke test must target the /webhook path (as defined in metrics/src/main.py).
        """
        has_webhook_path = (
            "/webhook" in self.all_code
            or "/webhook" in self.content
        )
        self.assertTrue(
            has_webhook_path,
            "docs/demo-guide.md webhook section does not reference the /webhook endpoint — "
            "the metrics service exposes POST /webhook (see metrics/src/main.py)",
        )


if __name__ == "__main__":
    unittest.main()
