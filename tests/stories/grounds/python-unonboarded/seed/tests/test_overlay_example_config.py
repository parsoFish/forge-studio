"""
Tests for config/repos/example.yaml — the canonical overlay config that
exercises the example-template module (the only module currently in modules/).

These tests pin the contract for the work item "Create config/repos/ directory
with example overlay config":

  Structural:
    - config/repos/ directory must exist
    - config/repos/example.yaml must exist and be parseable YAML
    - The file must pass jsonschema validation against schemas/overlay.schema.json
    - apiVersion must be gitweave.io/v1 and kind must be RepositoryOverlay
    - metadata.name must be a non-empty string
    - spec.repository must match owner/repo format

  Module reference:
    - spec.modules must reference the 'example-template' module
    - The example-template entry must include an 'inputs' object with 'project_name'
      (the only required input declared in modules/example-template/copier.yaml)

  Script integration:
    - scripts/validate_overlay_configs.py must exit 0 when run against config/repos/
    - scripts/validate_overlay_configs.py must exit 0 when run against config/repos/example.yaml

All tests will fail until:
  - config/repos/ directory is created
  - config/repos/example.yaml is present and valid
  - scripts/validate_overlay_configs.py is cherry-picked into this branch
"""

import json
import os
import subprocess
import sys
import unittest

import yaml
import jsonschema
from jsonschema import validate, ValidationError

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCHEMA_PATH = os.path.join(REPO_ROOT, "schemas", "overlay.schema.json")
REPOS_DIR = os.path.join(REPO_ROOT, "config", "repos")
EXAMPLE_CONFIG_PATH = os.path.join(REPOS_DIR, "example.yaml")
SCRIPT_PATH = os.path.join(REPO_ROOT, "scripts", "validate_overlay_configs.py")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_schema() -> dict:
    with open(SCHEMA_PATH) as f:
        return json.load(f)


def _load_example_config() -> dict:
    with open(EXAMPLE_CONFIG_PATH) as f:
        return yaml.safe_load(f)


def _run_validate_script(*args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, SCRIPT_PATH, *args],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------


class TestConfigReposDirectoryExists(unittest.TestCase):
    """The config/repos/ directory must exist as the home for overlay configs."""

    def test_config_repos_directory_exists(self):
        """config/repos/ directory must be present in the repository."""
        self.assertTrue(
            os.path.isdir(REPOS_DIR),
            f"config/repos/ directory is missing — expected it at {REPOS_DIR}. "
            "Create config/repos/ to unblock overlay tooling.",
        )

    def test_config_repos_example_yaml_exists(self):
        """config/repos/example.yaml must be present."""
        self.assertTrue(
            os.path.isfile(EXAMPLE_CONFIG_PATH),
            f"config/repos/example.yaml is missing — expected at {EXAMPLE_CONFIG_PATH}.",
        )

    def test_config_repos_contains_at_least_one_yaml_file(self):
        """config/repos/ must contain at least one .yaml file to serve as a target."""
        yaml_files = [
            f for f in os.listdir(REPOS_DIR) if f.endswith(".yaml")
        ] if os.path.isdir(REPOS_DIR) else []
        self.assertGreater(
            len(yaml_files),
            0,
            "config/repos/ exists but contains no .yaml files. "
            "Add config/repos/example.yaml.",
        )


class TestExampleConfigStructure(unittest.TestCase):
    """
    config/repos/example.yaml must be valid YAML and satisfy the
    overlay JSON Schema contract (following the test_overlay_schema.py pattern).
    """

    def setUp(self):
        self.schema = _load_schema()

    def test_example_config_is_parseable_yaml(self):
        """config/repos/example.yaml must parse as a YAML mapping."""
        with open(EXAMPLE_CONFIG_PATH) as f:
            doc = yaml.safe_load(f)
        self.assertIsInstance(
            doc,
            dict,
            "config/repos/example.yaml did not parse as a YAML mapping.",
        )

    def test_example_config_passes_overlay_schema_validation(self):
        """config/repos/example.yaml must satisfy schemas/overlay.schema.json."""
        doc = _load_example_config()
        try:
            validate(instance=doc, schema=self.schema)
        except ValidationError as exc:
            self.fail(
                f"config/repos/example.yaml failed schema validation:\n{exc.message}"
            )

    def test_example_config_has_correct_apiVersion(self):
        """apiVersion must be 'gitweave.io/v1'."""
        doc = _load_example_config()
        self.assertEqual(
            doc.get("apiVersion"),
            "gitweave.io/v1",
            "config/repos/example.yaml must declare apiVersion: gitweave.io/v1",
        )

    def test_example_config_has_correct_kind(self):
        """kind must be 'RepositoryOverlay'."""
        doc = _load_example_config()
        self.assertEqual(
            doc.get("kind"),
            "RepositoryOverlay",
            "config/repos/example.yaml must declare kind: RepositoryOverlay",
        )

    def test_example_config_has_non_empty_metadata_name(self):
        """metadata.name must be a non-empty string."""
        doc = _load_example_config()
        name = doc.get("metadata", {}).get("name", "")
        self.assertIsInstance(name, str, "metadata.name must be a string")
        self.assertGreater(
            len(name),
            0,
            "config/repos/example.yaml metadata.name must not be empty",
        )

    def test_example_config_repository_matches_owner_slash_repo_format(self):
        """spec.repository must match 'owner/repo' format (no spaces, exactly one slash)."""
        doc = _load_example_config()
        repository = doc.get("spec", {}).get("repository", "")
        self.assertRegex(
            repository,
            r"^[^/\s]+/[^/\s]+$",
            f"config/repos/example.yaml spec.repository '{repository}' does not match "
            "owner/repo format",
        )


class TestExampleConfigModuleReference(unittest.TestCase):
    """
    config/repos/example.yaml must reference the 'example-template' module —
    the only module currently available in modules/.
    """

    def test_example_config_spec_modules_is_present(self):
        """spec.modules must be present in the example config."""
        doc = _load_example_config()
        self.assertIn(
            "modules",
            doc.get("spec", {}),
            "config/repos/example.yaml must include a spec.modules section "
            "referencing at least one module.",
        )

    def test_example_config_references_example_template_module(self):
        """spec.modules must include an entry with name: example-template."""
        doc = _load_example_config()
        module_names = [
            m.get("name") for m in doc.get("spec", {}).get("modules", [])
        ]
        self.assertIn(
            "example-template",
            module_names,
            f"config/repos/example.yaml spec.modules does not reference 'example-template'. "
            f"Found: {module_names}. The example-template module is the only module in "
            "modules/ and must be referenced.",
        )

    def test_example_template_entry_includes_inputs(self):
        """
        The example-template module entry must include an 'inputs' object.
        example-template/copier.yaml requires 'project_name' as a string input.
        """
        doc = _load_example_config()
        modules = doc.get("spec", {}).get("modules", [])
        example_template_entry = next(
            (m for m in modules if m.get("name") == "example-template"), None
        )
        self.assertIsNotNone(
            example_template_entry,
            "No example-template entry found in spec.modules.",
        )
        inputs = example_template_entry.get("inputs", {})
        self.assertIsInstance(
            inputs,
            dict,
            "example-template module entry must have an 'inputs' object.",
        )
        self.assertGreater(
            len(inputs),
            0,
            "example-template 'inputs' must not be empty — "
            "at minimum, 'project_name' (required by copier.yaml) must be provided.",
        )

    def test_example_template_inputs_includes_project_name(self):
        """
        example-template/copier.yaml declares 'project_name' as a required str input.
        The overlay config must supply it.
        """
        doc = _load_example_config()
        modules = doc.get("spec", {}).get("modules", [])
        example_template_entry = next(
            (m for m in modules if m.get("name") == "example-template"), None
        )
        self.assertIsNotNone(
            example_template_entry,
            "No example-template entry found in spec.modules.",
        )
        inputs = example_template_entry.get("inputs", {})
        self.assertIn(
            "project_name",
            inputs,
            "example-template module entry must supply 'project_name' in inputs — "
            "it is a required field declared in modules/example-template/copier.yaml.",
        )
        self.assertIsInstance(
            inputs["project_name"],
            str,
            "example-template inputs.project_name must be a string.",
        )

    def test_example_template_inputs_project_name_is_non_empty(self):
        """inputs.project_name must be a non-empty string."""
        doc = _load_example_config()
        modules = doc.get("spec", {}).get("modules", [])
        example_template_entry = next(
            (m for m in modules if m.get("name") == "example-template"), None
        )
        self.assertIsNotNone(
            example_template_entry,
            "No example-template entry found in spec.modules.",
        )
        project_name = example_template_entry.get("inputs", {}).get("project_name", "")
        self.assertGreater(
            len(project_name),
            0,
            "example-template inputs.project_name must not be an empty string.",
        )


class TestValidateScriptAgainstConfigRepos(unittest.TestCase):
    """
    scripts/validate_overlay_configs.py must exit 0 when run against config/repos/.
    This is the integration gate that the CI overlay-validation job depends on.
    """

    def test_validate_script_exists(self):
        """scripts/validate_overlay_configs.py must exist (cherry-picked)."""
        self.assertTrue(
            os.path.isfile(SCRIPT_PATH),
            f"scripts/validate_overlay_configs.py is missing — expected at {SCRIPT_PATH}. "
            "Cherry-pick the script before this test can pass.",
        )

    def test_validate_script_exits_zero_against_config_repos(self):
        """
        Running validate_overlay_configs.py config/repos/ must exit 0.
        This verifies that every .yaml file in config/repos/ passes schema validation.
        """
        result = _run_validate_script(REPOS_DIR)
        self.assertEqual(
            result.returncode,
            0,
            f"scripts/validate_overlay_configs.py exited {result.returncode} "
            f"when run against config/repos/ — expected 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_validate_script_output_mentions_example_yaml(self):
        """
        The validation output must reference example.yaml, confirming the file
        was discovered and checked (not silently skipped).
        """
        result = _run_validate_script(REPOS_DIR)
        combined = result.stdout + result.stderr
        self.assertIn(
            "example.yaml",
            combined,
            f"validate_overlay_configs.py output does not mention 'example.yaml' — "
            f"the file may not have been discovered.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_validate_script_reports_at_least_one_file_validated(self):
        """
        The output must report that at least 1 file was validated, confirming
        config/repos/ is non-empty and the script scanned it correctly.
        """
        result = _run_validate_script(REPOS_DIR)
        combined = result.stdout + result.stderr
        self.assertRegex(
            combined,
            r"[Vv]alidated\s+[1-9]\d*\s+file",
            f"validate_overlay_configs.py did not report validating at least 1 file.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
