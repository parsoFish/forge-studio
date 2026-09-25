"""
Unit tests for the terraform-module Copier template.

Tests (static layer — no CLI required):
  - modules/terraform-module/copier.yaml exists and is parseable YAML
  - copier.yaml _metadata satisfies schemas/copier-module.schema.json
  - copier.yaml declares the four required question variables:
      module_name, description, required_providers, author
  - _metadata.name is 'terraform_module' (snake_case)
  - _metadata.version follows CalVer YYYYMMDD.Patch

Tests (render layer — requires copier CLI):
  - 'copier copy --defaults --data ...' exits 0 for the template
  - All required output files are generated:
      main.tf, variables.tf, outputs.tf, README.md,
      examples/complete/main.tf, .github/workflows/ci.yaml,
      .gitignore, .copier-answers.yaml
  - Generated Terraform files contain expected HCL structure:
      terraform block, required_providers block
  - Generated README.md contains terraform-docs compatible markers
  - Generated .github/workflows/ci.yaml is valid YAML with terraform
      validate and fmt steps
  - Generated .gitignore excludes .terraform/ and *.tfstate
  - Generated .copier-answers.yaml records the supplied module_name

All tests fail until modules/terraform-module/ and its copier.yaml are created.
"""

import json
import os
import re
import subprocess
import tempfile
import unittest

import yaml

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
TEMPLATE_DIR = os.path.join(REPO_ROOT, "modules", "terraform-module")
COPIER_YAML = os.path.join(TEMPLATE_DIR, "copier.yaml")
SCHEMA_PATH = os.path.join(REPO_ROOT, "schemas", "copier-module.schema.json")

# Known inputs used for all render-based tests.
# These cover all four required copier variables.
KNOWN_INPUTS = {
    "module_name": "my_test_module",
    "description": "A test Terraform module for unit testing",
    "author": "test_author",
    "required_providers": "hashicorp/null:~> 3.0",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _copier_available() -> bool:
    """Return True if the copier CLI is on the PATH and responds to --version."""
    try:
        result = subprocess.run(
            ["copier", "--version"],
            capture_output=True,
            timeout=15,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def _render_template(dst_dir: str, data: dict | None = None) -> subprocess.CompletedProcess:
    """
    Render the terraform-module template to dst_dir using 'copier copy'.

    --overwrite avoids prompts when re-running in the same directory.
    --defaults fills in any questions not covered by --data with their defaults.
    Each key/value pair from data is passed as a separate --data flag.
    """
    if data is None:
        data = {}
    cmd = [
        "copier", "copy",
        "--overwrite",
        "--defaults",
    ]
    for key, value in data.items():
        cmd.extend(["--data", f"{key}={value}"])
    cmd.extend([TEMPLATE_DIR, dst_dir])
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=60,
    )


# ---------------------------------------------------------------------------
# Template file existence
# ---------------------------------------------------------------------------


class TestTerraformModuleTemplateFileExists(unittest.TestCase):
    """Sanity checks: the template directory and copier.yaml must exist."""

    def test_terraform_module_directory_exists_under_modules(self):
        """modules/terraform-module/ must be present as a subdirectory of modules/."""
        self.assertTrue(
            os.path.isdir(TEMPLATE_DIR),
            f"modules/terraform-module/ is missing — expected at {TEMPLATE_DIR}",
        )

    def test_copier_yaml_exists_inside_template_directory(self):
        """modules/terraform-module/copier.yaml must be present."""
        self.assertTrue(
            os.path.isfile(COPIER_YAML),
            f"modules/terraform-module/copier.yaml is missing — expected at {COPIER_YAML}",
        )

    def test_copier_yaml_is_parseable_yaml_mapping(self):
        """copier.yaml must parse as a YAML mapping (dict) without errors."""
        with open(COPIER_YAML) as f:
            doc = yaml.safe_load(f)
        self.assertIsInstance(
            doc,
            dict,
            "modules/terraform-module/copier.yaml did not parse as a YAML mapping",
        )

    def test_copier_yaml_passes_copier_module_schema_validation(self):
        """
        copier.yaml must satisfy schemas/copier-module.schema.json.

        This enforces the shared metadata contract applied to all GitWeave modules.
        """
        self.assertTrue(
            os.path.isfile(SCHEMA_PATH),
            f"schemas/copier-module.schema.json is missing — expected at {SCHEMA_PATH}",
        )
        import jsonschema

        with open(SCHEMA_PATH) as f:
            schema = json.load(f)
        with open(COPIER_YAML) as f:
            doc = yaml.safe_load(f)
        jsonschema.validate(instance=doc, schema=schema)  # must not raise


# ---------------------------------------------------------------------------
# Template metadata
# ---------------------------------------------------------------------------


class TestTerraformModuleMetadata(unittest.TestCase):
    """
    The _metadata block in copier.yaml must identify this module correctly
    and follow the naming and versioning conventions shared by all GitWeave modules.
    """

    def setUp(self):
        with open(COPIER_YAML) as f:
            self.doc = yaml.safe_load(f)

    def test_metadata_name_is_terraform_module(self):
        """_metadata.name must be 'terraform_module' (snake_case identifier)."""
        name = self.doc.get("_metadata", {}).get("name", "")
        self.assertEqual(
            name,
            "terraform_module",
            f"Expected _metadata.name 'terraform_module', got '{name}'",
        )

    def test_metadata_version_follows_calver_yyyymmdd_patch(self):
        """_metadata.version must match the CalVer YYYYMMDD.Patch pattern."""
        version = str(self.doc.get("_metadata", {}).get("version", ""))
        self.assertRegex(
            version,
            r"^\d{8}\.\d+$",
            f"_metadata.version '{version}' does not match CalVer YYYYMMDD.Patch (e.g. 20260305.0)",
        )

    def test_metadata_description_is_non_empty_string(self):
        """_metadata.description must be a non-empty string."""
        description = self.doc.get("_metadata", {}).get("description", "")
        self.assertIsInstance(description, str, "_metadata.description must be a string")
        self.assertGreater(
            len(description.strip()),
            0,
            "_metadata.description must not be empty or blank",
        )


# ---------------------------------------------------------------------------
# Required copier question variables
# ---------------------------------------------------------------------------


class TestTerraformModuleRequiredQuestions(unittest.TestCase):
    """
    The copier.yaml must declare the four required question variables.
    These are the inputs that callers must (or may) supply at generation time.
    """

    def setUp(self):
        with open(COPIER_YAML) as f:
            self.doc = yaml.safe_load(f)

    def test_module_name_question_is_declared(self):
        """copier.yaml must declare a 'module_name' question variable."""
        self.assertIn(
            "module_name",
            self.doc,
            "copier.yaml is missing the 'module_name' question variable",
        )

    def test_description_question_is_declared(self):
        """copier.yaml must declare a 'description' question variable."""
        self.assertIn(
            "description",
            self.doc,
            "copier.yaml is missing the 'description' question variable",
        )

    def test_required_providers_question_is_declared(self):
        """
        copier.yaml must declare a 'required_providers' question variable.

        This accepts provider source and version info (e.g. 'hashicorp/aws:~> 5.0')
        that the template inlines into the generated terraform block.
        """
        self.assertIn(
            "required_providers",
            self.doc,
            "copier.yaml is missing the 'required_providers' question variable",
        )

    def test_author_question_is_declared(self):
        """copier.yaml must declare an 'author' question variable."""
        self.assertIn(
            "author",
            self.doc,
            "copier.yaml is missing the 'author' question variable",
        )

    def test_module_name_question_has_a_help_text(self):
        """The 'module_name' question should have a 'help' key to guide the user."""
        question = self.doc.get("module_name", {})
        self.assertIsInstance(question, dict, "'module_name' question must be a mapping")
        self.assertIn(
            "help",
            question,
            "The 'module_name' question is missing a 'help' key",
        )

    def test_required_providers_question_has_a_help_text_mentioning_version(self):
        """
        The 'required_providers' question must have help text.

        Users need guidance on the accepted format (e.g. 'hashicorp/aws:~> 5.0').
        """
        question = self.doc.get("required_providers", {})
        self.assertIsInstance(question, dict, "'required_providers' question must be a mapping")
        self.assertIn(
            "help",
            question,
            "The 'required_providers' question is missing a 'help' key",
        )

    def test_module_name_question_type_is_str_or_omitted(self):
        """
        The 'module_name' question type must be 'str' (or omitted, which defaults to str).

        'str' is the only Copier type that makes sense for a module name.
        """
        question = self.doc.get("module_name", {})
        question_type = question.get("type", "str")  # Copier default is str
        self.assertEqual(
            question_type,
            "str",
            f"Expected 'module_name' question type 'str', got '{question_type}'",
        )


# ---------------------------------------------------------------------------
# Rendered file existence
# ---------------------------------------------------------------------------


@unittest.skipUnless(_copier_available(), "copier CLI not available — skipping render tests")
class TestTerraformModuleRenderedFilesExist(unittest.TestCase):
    """
    Render the template to a temporary directory and assert that every required
    output file is generated.  Each file represents a non-negotiable deliverable
    defined in the work item specification.
    """

    @classmethod
    def setUpClass(cls):
        """Render the template once; all tests in this class share the output."""
        cls._tmp = tempfile.TemporaryDirectory()
        cls.output_dir = cls._tmp.name
        cls.render_result = _render_template(cls.output_dir, data=KNOWN_INPUTS)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def _path(self, *parts: str) -> str:
        return os.path.join(self.output_dir, *parts)

    def test_copier_copy_exits_zero(self):
        """'copier copy' must complete without error for the template."""
        self.assertEqual(
            self.render_result.returncode,
            0,
            "copier copy failed:\n"
            f"STDOUT:\n{self.render_result.stdout}\n"
            f"STDERR:\n{self.render_result.stderr}",
        )

    def test_main_tf_is_generated(self):
        """main.tf must be generated at the project root."""
        self.assertTrue(
            os.path.isfile(self._path("main.tf")),
            "main.tf was not generated by the template",
        )

    def test_variables_tf_is_generated(self):
        """variables.tf must be generated at the project root."""
        self.assertTrue(
            os.path.isfile(self._path("variables.tf")),
            "variables.tf was not generated by the template",
        )

    def test_outputs_tf_is_generated(self):
        """outputs.tf must be generated at the project root."""
        self.assertTrue(
            os.path.isfile(self._path("outputs.tf")),
            "outputs.tf was not generated by the template",
        )

    def test_readme_md_is_generated(self):
        """README.md must be generated at the project root."""
        self.assertTrue(
            os.path.isfile(self._path("README.md")),
            "README.md was not generated by the template",
        )

    def test_examples_complete_main_tf_is_generated(self):
        """
        examples/complete/main.tf must be generated to provide a working usage example.

        The examples/complete/ pattern is the Terraform module ecosystem convention
        for demonstrating how to call the module.
        """
        self.assertTrue(
            os.path.isfile(self._path("examples", "complete", "main.tf")),
            "examples/complete/main.tf was not generated by the template",
        )

    def test_github_workflows_ci_yaml_is_generated(self):
        """
        .github/workflows/ci.yaml must be generated to automate terraform
        validate and fmt checks for the generated module.
        """
        self.assertTrue(
            os.path.isfile(self._path(".github", "workflows", "ci.yaml")),
            ".github/workflows/ci.yaml was not generated by the template",
        )

    def test_gitignore_is_generated(self):
        """
        .gitignore must be generated to prevent Terraform artefacts (.terraform/,
        *.tfstate, *.tfstate.backup) from being accidentally committed.
        """
        self.assertTrue(
            os.path.isfile(self._path(".gitignore")),
            ".gitignore was not generated by the template",
        )

    def test_copier_answers_yaml_is_generated(self):
        """
        .copier-answers.yaml must be written to the generated project root.

        Copier writes this file automatically to record the answers used during
        generation, enabling future 'copier update' runs to apply template upgrades.
        """
        self.assertTrue(
            os.path.isfile(self._path(".copier-answers.yaml")),
            ".copier-answers.yaml was not generated by the template",
        )


# ---------------------------------------------------------------------------
# Rendered Terraform content
# ---------------------------------------------------------------------------


@unittest.skipUnless(_copier_available(), "copier CLI not available — skipping content tests")
class TestTerraformModuleRenderedTerraformContent(unittest.TestCase):
    """
    Assert that generated Terraform files contain the expected HCL structure.

    These tests define the minimum required content — the implementation may
    include additional blocks without causing failures.
    """

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.output_dir = cls._tmp.name
        _render_template(cls.output_dir, data=KNOWN_INPUTS)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def _read(self, *parts: str) -> str:
        with open(os.path.join(self.output_dir, *parts)) as f:
            return f.read()

    def test_main_tf_contains_terraform_block(self):
        """main.tf must contain a 'terraform {' block — the root Terraform configuration."""
        content = self._read("main.tf")
        self.assertIn(
            "terraform {",
            content,
            "main.tf does not contain a 'terraform {' block",
        )

    def test_main_tf_contains_required_providers_block(self):
        """
        main.tf must contain a 'required_providers' block inside the terraform block.

        This is the canonical location for declaring provider sources and versions
        in a Terraform module.
        """
        content = self._read("main.tf")
        self.assertIn(
            "required_providers",
            content,
            "main.tf does not contain a 'required_providers' block",
        )

    def test_variables_tf_contains_at_least_one_variable_block(self):
        """variables.tf must contain at least one 'variable' block declaration."""
        content = self._read("variables.tf")
        self.assertIn(
            "variable ",
            content,
            "variables.tf does not contain any 'variable \"...\" {' block",
        )

    def test_outputs_tf_contains_at_least_one_output_block(self):
        """outputs.tf must contain at least one 'output' block declaration."""
        content = self._read("outputs.tf")
        self.assertIn(
            "output ",
            content,
            "outputs.tf does not contain any 'output \"...\" {' block",
        )

    def test_examples_complete_main_tf_references_module_source(self):
        """
        examples/complete/main.tf must include a module block with a 'source' argument
        pointing back to the generated module root.
        """
        content = self._read("examples", "complete", "main.tf")
        self.assertIn(
            "source",
            content,
            "examples/complete/main.tf does not contain a 'source' argument "
            "(required for the module call to the generated module)",
        )


# ---------------------------------------------------------------------------
# Rendered README.md content
# ---------------------------------------------------------------------------


@unittest.skipUnless(_copier_available(), "copier CLI not available — skipping README tests")
class TestTerraformModuleRenderedReadmeContent(unittest.TestCase):
    """
    Generated README.md must include terraform-docs compatible markers so that
    'terraform-docs' can inject inputs/outputs documentation automatically.
    """

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.output_dir = cls._tmp.name
        _render_template(cls.output_dir, data=KNOWN_INPUTS)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def _read_readme(self) -> str:
        with open(os.path.join(self.output_dir, "README.md")) as f:
            return f.read()

    def test_readme_contains_terraform_docs_begin_marker(self):
        """
        README.md must include '<!-- BEGIN_TF_DOCS -->' so terraform-docs can
        insert the generated inputs/outputs table.
        """
        content = self._read_readme()
        self.assertIn(
            "<!-- BEGIN_TF_DOCS -->",
            content,
            "README.md is missing the '<!-- BEGIN_TF_DOCS -->' terraform-docs marker",
        )

    def test_readme_contains_terraform_docs_end_marker(self):
        """README.md must include '<!-- END_TF_DOCS -->' to close the terraform-docs section."""
        content = self._read_readme()
        self.assertIn(
            "<!-- END_TF_DOCS -->",
            content,
            "README.md is missing the '<!-- END_TF_DOCS -->' terraform-docs marker",
        )

    def test_readme_contains_module_name_supplied_at_render_time(self):
        """README.md must include the module_name passed as a copier variable."""
        content = self._read_readme()
        self.assertIn(
            KNOWN_INPUTS["module_name"],
            content,
            f"README.md does not reference module_name '{KNOWN_INPUTS['module_name']}'",
        )

    def test_readme_contains_description_supplied_at_render_time(self):
        """README.md must include the description passed as a copier variable."""
        content = self._read_readme()
        self.assertIn(
            KNOWN_INPUTS["description"],
            content,
            f"README.md does not include description '{KNOWN_INPUTS['description']}'",
        )


# ---------------------------------------------------------------------------
# Rendered CI workflow content
# ---------------------------------------------------------------------------


@unittest.skipUnless(_copier_available(), "copier CLI not available — skipping CI workflow tests")
class TestTerraformModuleRenderedCIWorkflow(unittest.TestCase):
    """
    The generated .github/workflows/ci.yaml must be a valid GitHub Actions
    workflow that runs terraform validate and terraform fmt -check.
    """

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.output_dir = cls._tmp.name
        _render_template(cls.output_dir, data=KNOWN_INPUTS)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def _read_ci(self) -> str:
        with open(os.path.join(self.output_dir, ".github", "workflows", "ci.yaml")) as f:
            return f.read()

    def test_ci_yaml_is_parseable_yaml_mapping(self):
        """.github/workflows/ci.yaml must be valid YAML that parses as a mapping."""
        content = self._read_ci()
        doc = yaml.safe_load(content)
        self.assertIsInstance(
            doc,
            dict,
            ".github/workflows/ci.yaml did not parse as a YAML mapping",
        )

    def test_ci_yaml_contains_terraform_validate_step(self):
        """
        .github/workflows/ci.yaml must include a step that runs 'terraform validate'.

        This is the primary correctness gate for the generated module in CI.
        """
        content = self._read_ci()
        self.assertIn(
            "terraform validate",
            content,
            ".github/workflows/ci.yaml does not contain a 'terraform validate' step",
        )

    def test_ci_yaml_contains_terraform_fmt_check_step(self):
        """
        .github/workflows/ci.yaml must include a step that runs 'terraform fmt'.

        The -check flag (used in CI) rejects improperly formatted HCL without modifying files.
        """
        content = self._read_ci()
        self.assertIn(
            "terraform fmt",
            content,
            ".github/workflows/ci.yaml does not contain a 'terraform fmt' step",
        )


# ---------------------------------------------------------------------------
# Rendered .gitignore content
# ---------------------------------------------------------------------------


@unittest.skipUnless(_copier_available(), "copier CLI not available — skipping .gitignore tests")
class TestTerraformModuleRenderedGitignore(unittest.TestCase):
    """
    The generated .gitignore must exclude Terraform artefacts that must never
    be committed: the .terraform/ provider cache, state files, and lock overrides.
    """

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.output_dir = cls._tmp.name
        _render_template(cls.output_dir, data=KNOWN_INPUTS)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def _read_gitignore(self) -> str:
        with open(os.path.join(self.output_dir, ".gitignore")) as f:
            return f.read()

    def test_gitignore_excludes_terraform_provider_cache_directory(self):
        """
        .gitignore must exclude .terraform/ to prevent provider binaries (potentially
        hundreds of MB) from being accidentally committed to the repository.
        """
        content = self._read_gitignore()
        self.assertIn(
            ".terraform",
            content,
            ".gitignore does not exclude .terraform/ — "
            "provider binaries would be committed if this is not addressed",
        )

    def test_gitignore_excludes_terraform_state_files(self):
        """
        .gitignore must exclude *.tfstate to prevent infrastructure state (which
        may contain secrets) from leaking into version control.
        """
        content = self._read_gitignore()
        self.assertIn(
            ".tfstate",
            content,
            ".gitignore does not exclude *.tfstate — "
            "state files containing sensitive data would be committed",
        )


# ---------------------------------------------------------------------------
# Rendered .copier-answers.yaml content
# ---------------------------------------------------------------------------


@unittest.skipUnless(_copier_available(), "copier CLI not available — skipping answers file tests")
class TestTerraformModuleRenderedCopierAnswers(unittest.TestCase):
    """
    .copier-answers.yaml must be written by copier to the generated project root
    and must record the answers supplied at generation time.

    This file enables 'copier update' to replay the original answers when the
    template is updated, making module upgrades reliable.
    """

    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        cls.output_dir = cls._tmp.name
        _render_template(cls.output_dir, data=KNOWN_INPUTS)

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def _read_answers(self) -> str:
        with open(os.path.join(self.output_dir, ".copier-answers.yaml")) as f:
            return f.read()

    def test_copier_answers_yaml_is_parseable_yaml(self):
        """.copier-answers.yaml must be parseable YAML."""
        content = self._read_answers()
        doc = yaml.safe_load(content)
        self.assertIsNotNone(doc, ".copier-answers.yaml parsed to None — it may be empty")

    def test_copier_answers_yaml_records_module_name(self):
        """.copier-answers.yaml must record the module_name supplied at render time."""
        content = self._read_answers()
        self.assertIn(
            KNOWN_INPUTS["module_name"],
            content,
            f".copier-answers.yaml does not record module_name "
            f"'{KNOWN_INPUTS['module_name']}'",
        )

    def test_copier_answers_yaml_records_author(self):
        """.copier-answers.yaml must record the author supplied at render time."""
        content = self._read_answers()
        self.assertIn(
            KNOWN_INPUTS["author"],
            content,
            f".copier-answers.yaml does not record author '{KNOWN_INPUTS['author']}'",
        )


if __name__ == "__main__":
    unittest.main()
