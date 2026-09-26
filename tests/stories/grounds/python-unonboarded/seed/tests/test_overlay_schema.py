"""
Unit tests for the overlay configuration JSON Schema contract.

These tests verify that schemas/overlay.schema.json:
  - exists at the declared path and is valid JSON Schema Draft 7
  - requires apiVersion, kind, metadata.name, and spec.repository at the top level
  - enforces apiVersion == 'gitweave.io/v1' and kind == 'RepositoryOverlay'
  - validates spec.repository matches the 'owner/repo' pattern
  - accepts spec.modules[] with required name and optional inputs/version
  - accepts spec.environments map with optional protection_rules, secrets, and variables
  - accepts spec.variables as a flat string-to-string map
  - rejects extra top-level properties (additionalProperties: false at top level)
  - is satisfied by config/example.yaml

All tests in this file will fail until:
  - schemas/overlay.schema.json is created with the correct content
  - config/example.yaml is updated to be a valid, complete overlay config
"""

import json
import os
import unittest

import yaml
import jsonschema
from jsonschema import validate, ValidationError

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCHEMA_PATH = os.path.join(REPO_ROOT, "schemas", "overlay.schema.json")
EXAMPLE_YAML_PATH = os.path.join(REPO_ROOT, "config", "example.yaml")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_schema() -> dict:
    """Load and return the overlay JSON Schema."""
    with open(SCHEMA_PATH) as f:
        return json.load(f)


def _minimal_valid_doc() -> dict:
    """Return the smallest document that should satisfy the schema."""
    return {
        "apiVersion": "gitweave.io/v1",
        "kind": "RepositoryOverlay",
        "metadata": {
            "name": "my-app",
        },
        "spec": {
            "repository": "my-org/my-app",
        },
    }


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------


class TestSchemaFileExists(unittest.TestCase):
    """Sanity checks: the schema file exists, is valid JSON, and declares Draft 7."""

    def test_schema_file_exists_at_schemas_slash_overlay_schema_json(self):
        """The schema must live at schemas/overlay.schema.json."""
        self.assertTrue(
            os.path.isfile(SCHEMA_PATH),
            f"schemas/overlay.schema.json is missing — expected it at {SCHEMA_PATH}",
        )

    def test_schema_file_is_valid_json(self):
        """The schema file must be parseable JSON and decode to a dict."""
        with open(SCHEMA_PATH) as f:
            schema = json.load(f)
        self.assertIsInstance(
            schema,
            dict,
            "schemas/overlay.schema.json did not parse as a JSON object",
        )

    def test_schema_declares_json_schema_draft_7(self):
        """The $schema URI must reference JSON Schema Draft 7."""
        schema = _load_schema()
        self.assertIn(
            "$schema",
            schema,
            "schemas/overlay.schema.json is missing the '$schema' key — "
            "set it to 'http://json-schema.org/draft-07/schema#'",
        )
        self.assertIn(
            "draft-07",
            schema["$schema"],
            f"'$schema' is {schema['$schema']!r} — must reference Draft 7 (draft-07)",
        )

    def test_schema_is_itself_a_valid_json_schema(self):
        """The schema must be internally consistent — Draft7Validator.check_schema must pass."""
        schema = _load_schema()
        jsonschema.Draft7Validator.check_schema(schema)


class TestRequiredTopLevelFields(unittest.TestCase):
    """Every required top-level field must be individually mandatory."""

    def setUp(self):
        self.schema = _load_schema()

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    def test_minimal_valid_document_passes_validation(self):
        """The minimal document with all required fields must pass without error."""
        self._validate(_minimal_valid_doc())

    def test_document_missing_apiVersion_is_rejected(self):
        """A document without apiVersion must be rejected — apiVersion is required."""
        doc = _minimal_valid_doc()
        del doc["apiVersion"]
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_document_missing_kind_is_rejected(self):
        """A document without kind must be rejected — kind is required."""
        doc = _minimal_valid_doc()
        del doc["kind"]
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_document_missing_metadata_is_rejected(self):
        """A document without metadata must be rejected — metadata is required."""
        doc = _minimal_valid_doc()
        del doc["metadata"]
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_document_missing_metadata_name_is_rejected(self):
        """A document without metadata.name must be rejected — metadata.name is required."""
        doc = _minimal_valid_doc()
        del doc["metadata"]["name"]
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_document_missing_spec_is_rejected(self):
        """A document without spec must be rejected — spec is required."""
        doc = _minimal_valid_doc()
        del doc["spec"]
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_document_missing_spec_repository_is_rejected(self):
        """A document without spec.repository must be rejected — spec.repository is required."""
        doc = _minimal_valid_doc()
        del doc["spec"]["repository"]
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_completely_empty_document_is_rejected(self):
        """An empty document {} must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate({})


class TestApiVersionAndKindConstraints(unittest.TestCase):
    """
    apiVersion must be exactly 'gitweave.io/v1'.
    kind must be exactly 'RepositoryOverlay'.
    Both are constrained via enum (or const).
    """

    def setUp(self):
        self.schema = _load_schema()

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    def test_correct_apiVersion_passes(self):
        """apiVersion 'gitweave.io/v1' must be accepted."""
        self._validate(_minimal_valid_doc())

    def test_wrong_apiVersion_is_rejected(self):
        """apiVersion 'v1' (wrong group) must be rejected."""
        doc = _minimal_valid_doc()
        doc["apiVersion"] = "v1"
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_apiVersion_with_wrong_version_suffix_is_rejected(self):
        """apiVersion 'gitweave.io/v2' must be rejected — only v1 is defined."""
        doc = _minimal_valid_doc()
        doc["apiVersion"] = "gitweave.io/v2"
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_empty_apiVersion_is_rejected(self):
        """An empty string apiVersion must be rejected."""
        doc = _minimal_valid_doc()
        doc["apiVersion"] = ""
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_correct_kind_passes(self):
        """kind 'RepositoryOverlay' must be accepted."""
        self._validate(_minimal_valid_doc())

    def test_wrong_kind_is_rejected(self):
        """kind 'RepositoryConfig' must be rejected — only RepositoryOverlay is valid."""
        doc = _minimal_valid_doc()
        doc["kind"] = "RepositoryConfig"
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_lowercase_kind_is_rejected(self):
        """kind 'repositoryoverlay' (lowercase) must be rejected — kind is case-sensitive."""
        doc = _minimal_valid_doc()
        doc["kind"] = "repositoryoverlay"
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_empty_kind_is_rejected(self):
        """An empty string kind must be rejected."""
        doc = _minimal_valid_doc()
        doc["kind"] = ""
        with self.assertRaises(ValidationError):
            self._validate(doc)


class TestRepositoryPatternValidation(unittest.TestCase):
    """
    spec.repository must match the pattern 'owner/repo' — exactly one slash,
    non-empty owner, non-empty repo.
    """

    def setUp(self):
        self.schema = _load_schema()

    def _doc(self, repository: str) -> dict:
        doc = _minimal_valid_doc()
        doc["spec"]["repository"] = repository
        return doc

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    # --- valid repositories ---

    def test_simple_owner_slash_repo_is_valid(self):
        """'my-org/my-repo' is the canonical format and must be accepted."""
        self._validate(self._doc("my-org/my-repo"))

    def test_owner_with_digits_is_valid(self):
        """'org123/repo456' — alphanumeric components must be accepted."""
        self._validate(self._doc("org123/repo456"))

    def test_owner_with_dots_is_valid(self):
        """'my.org/my.repo' — dots in components must be accepted."""
        self._validate(self._doc("my.org/my.repo"))

    def test_owner_with_underscores_is_valid(self):
        """'my_org/my_repo' — underscores in components must be accepted."""
        self._validate(self._doc("my_org/my_repo"))

    # --- invalid repositories ---

    def test_repository_without_slash_is_rejected(self):
        """'my-org-my-repo' with no slash must be rejected — owner/repo format required."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("my-org-my-repo"))

    def test_repository_with_two_slashes_is_rejected(self):
        """'org/owner/repo' with two slashes must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("org/owner/repo"))

    def test_repository_with_leading_slash_is_rejected(self):
        """'/my-repo' with empty owner must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("/my-repo"))

    def test_repository_with_trailing_slash_is_rejected(self):
        """'my-org/' with empty repo must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("my-org/"))

    def test_empty_repository_string_is_rejected(self):
        """An empty string repository must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc(""))

    def test_repository_with_spaces_is_rejected(self):
        """'my org/my repo' with spaces must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("my org/my repo"))


class TestSpecModulesValidation(unittest.TestCase):
    """
    spec.modules is an optional array. Each item requires 'name' and allows
    optional 'inputs' (object) and 'version' (string).
    """

    def setUp(self):
        self.schema = _load_schema()

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    def test_document_without_modules_is_valid(self):
        """spec.modules is optional — a document without it must be accepted."""
        self._validate(_minimal_valid_doc())

    def test_empty_modules_array_is_valid(self):
        """spec.modules: [] (empty array) must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["modules"] = []
        self._validate(doc)

    def test_single_module_with_name_only_is_valid(self):
        """A module entry with only 'name' must be accepted — inputs and version are optional."""
        doc = _minimal_valid_doc()
        doc["spec"]["modules"] = [{"name": "lang-node"}]
        self._validate(doc)

    def test_module_with_name_and_inputs_is_valid(self):
        """A module entry with name and inputs object must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["modules"] = [{"name": "lang-node", "inputs": {"node_version": "18"}}]
        self._validate(doc)

    def test_module_with_name_and_version_is_valid(self):
        """A module entry with name and version pin must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["modules"] = [{"name": "lang-node", "version": "v1.2.3"}]
        self._validate(doc)

    def test_module_with_name_inputs_and_version_is_valid(self):
        """A module entry with all three fields must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["modules"] = [
            {"name": "lang-node", "version": "main", "inputs": {"node_version": "20"}}
        ]
        self._validate(doc)

    def test_multiple_modules_are_valid(self):
        """Multiple module entries in the array must all be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["modules"] = [
            {"name": "lang-node", "inputs": {"node_version": "18"}},
            {"name": "ci-github-actions", "version": "v2.0.0"},
            {"name": "docker-image"},
        ]
        self._validate(doc)

    def test_module_missing_name_is_rejected(self):
        """A module entry without 'name' must be rejected — name is required."""
        doc = _minimal_valid_doc()
        doc["spec"]["modules"] = [{"inputs": {"node_version": "18"}}]
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_modules_as_non_array_is_rejected(self):
        """spec.modules must be an array — an object value must be rejected."""
        doc = _minimal_valid_doc()
        doc["spec"]["modules"] = {"name": "lang-node"}
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_module_inputs_as_non_object_is_rejected(self):
        """module inputs must be an object — a string value must be rejected."""
        doc = _minimal_valid_doc()
        doc["spec"]["modules"] = [{"name": "lang-node", "inputs": "node_version=18"}]
        with self.assertRaises(ValidationError):
            self._validate(doc)


class TestSpecEnvironmentsValidation(unittest.TestCase):
    """
    spec.environments is an optional map where:
      - keys are environment name strings
      - values are objects with optional 'protection_rules' (object),
        'secrets' (string array), and 'variables' (string-to-string map)
    """

    def setUp(self):
        self.schema = _load_schema()

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    def test_document_without_environments_is_valid(self):
        """spec.environments is optional — a document without it must be accepted."""
        self._validate(_minimal_valid_doc())

    def test_empty_environments_map_is_valid(self):
        """spec.environments: {} (empty object) must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["environments"] = {}
        self._validate(doc)

    def test_environment_with_no_fields_is_valid(self):
        """An environment entry with an empty object value must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["environments"] = {"dev": {}}
        self._validate(doc)

    def test_environment_with_protection_rules_is_valid(self):
        """An environment with protection_rules object must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["environments"] = {
            "prod": {"protection_rules": {"required_reviewers": 2, "required_checks": ["ci"]}}
        }
        self._validate(doc)

    def test_environment_with_secrets_array_is_valid(self):
        """An environment with secrets string array must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["environments"] = {
            "prod": {"secrets": ["DEPLOY_KEY", "AWS_ACCESS_KEY_ID"]}
        }
        self._validate(doc)

    def test_environment_with_variables_map_is_valid(self):
        """An environment with variables string-to-string map must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["environments"] = {
            "prod": {"variables": {"LOG_LEVEL": "warn", "REGION": "us-east-1"}}
        }
        self._validate(doc)

    def test_environment_with_all_optional_fields_is_valid(self):
        """An environment supplying all optional fields must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["environments"] = {
            "prod": {
                "protection_rules": {"required_reviewers": 1},
                "secrets": ["DEPLOY_KEY"],
                "variables": {"LOG_LEVEL": "warn"},
            }
        }
        self._validate(doc)

    def test_multiple_environments_are_valid(self):
        """Multiple named environments in the map must all be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["environments"] = {
            "dev": {},
            "staging": {"variables": {"LOG_LEVEL": "debug"}},
            "prod": {
                "protection_rules": {"required_reviewers": 2},
                "secrets": ["PROD_KEY"],
                "variables": {"LOG_LEVEL": "error"},
            },
        }
        self._validate(doc)

    def test_environment_secrets_as_non_array_is_rejected(self):
        """environment.secrets must be an array — a string value must be rejected."""
        doc = _minimal_valid_doc()
        doc["spec"]["environments"] = {"prod": {"secrets": "DEPLOY_KEY"}}
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_environment_secrets_containing_non_string_is_rejected(self):
        """environment.secrets must be a string array — numeric items must be rejected."""
        doc = _minimal_valid_doc()
        doc["spec"]["environments"] = {"prod": {"secrets": [42, "DEPLOY_KEY"]}}
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_environment_variables_with_non_string_value_is_rejected(self):
        """environment.variables values must be strings — numeric values must be rejected."""
        doc = _minimal_valid_doc()
        doc["spec"]["environments"] = {"prod": {"variables": {"PORT": 8080}}}
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_environments_as_non_object_is_rejected(self):
        """spec.environments must be an object — an array value must be rejected."""
        doc = _minimal_valid_doc()
        doc["spec"]["environments"] = ["prod", "dev"]
        with self.assertRaises(ValidationError):
            self._validate(doc)


class TestSpecVariablesValidation(unittest.TestCase):
    """
    spec.variables is an optional flat string-to-string map (object with
    string values only). Non-string values must be rejected.
    """

    def setUp(self):
        self.schema = _load_schema()

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    def test_document_without_variables_is_valid(self):
        """spec.variables is optional — a document without it must be accepted."""
        self._validate(_minimal_valid_doc())

    def test_empty_variables_map_is_valid(self):
        """spec.variables: {} (empty map) must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["variables"] = {}
        self._validate(doc)

    def test_variables_with_string_values_is_valid(self):
        """A variables map with string values must be accepted."""
        doc = _minimal_valid_doc()
        doc["spec"]["variables"] = {
            "team_name": "platform",
            "cost_centre": "infra-001",
        }
        self._validate(doc)

    def test_variables_with_numeric_value_is_rejected(self):
        """A variables entry with a numeric value must be rejected — values must be strings."""
        doc = _minimal_valid_doc()
        doc["spec"]["variables"] = {"port": 8080}
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_variables_with_boolean_value_is_rejected(self):
        """A variables entry with a boolean value must be rejected — values must be strings."""
        doc = _minimal_valid_doc()
        doc["spec"]["variables"] = {"enabled": True}
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_variables_with_null_value_is_rejected(self):
        """A variables entry with a null value must be rejected — values must be strings."""
        doc = _minimal_valid_doc()
        doc["spec"]["variables"] = {"key": None}
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_variables_as_array_is_rejected(self):
        """spec.variables must be an object — an array value must be rejected."""
        doc = _minimal_valid_doc()
        doc["spec"]["variables"] = ["team=platform"]
        with self.assertRaises(ValidationError):
            self._validate(doc)


class TestAdditionalPropertiesRejected(unittest.TestCase):
    """
    additionalProperties: false at the top level — unknown fields must be rejected.
    This prevents typos (e.g. 'metadata_name') from silently passing validation.
    """

    def setUp(self):
        self.schema = _load_schema()

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    def test_extra_top_level_property_is_rejected(self):
        """An unknown top-level key must be rejected."""
        doc = _minimal_valid_doc()
        doc["unknownTopLevelKey"] = "surprise"
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_typo_in_top_level_property_name_is_rejected(self):
        """A typo like 'matadata' instead of 'metadata' must be rejected."""
        doc = _minimal_valid_doc()
        doc["matadata"] = {"name": "my-app"}
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_extra_spec_property_does_not_bypass_validation(self):
        """An unknown key under spec must be rejected."""
        doc = _minimal_valid_doc()
        doc["spec"]["unknownSpecKey"] = "surprise"
        with self.assertRaises(ValidationError):
            self._validate(doc)


class TestFullyPopulatedDocumentIsValid(unittest.TestCase):
    """
    A realistic, fully populated overlay config using all optional fields
    must pass validation. This tests the composition of all sections together.
    """

    def setUp(self):
        self.schema = _load_schema()

    def test_fully_populated_overlay_config_passes_validation(self):
        """A complete overlay config with all optional sections must be accepted."""
        doc = {
            "apiVersion": "gitweave.io/v1",
            "kind": "RepositoryOverlay",
            "metadata": {
                "name": "my-platform-app",
            },
            "spec": {
                "repository": "my-org/my-platform-app",
                "modules": [
                    {"name": "lang-node", "inputs": {"node_version": "20"}},
                    {"name": "ci-github-actions", "version": "v2.1.0"},
                    {"name": "docker-image"},
                ],
                "environments": {
                    "dev": {
                        "variables": {"LOG_LEVEL": "debug"},
                    },
                    "staging": {
                        "secrets": ["STAGING_API_KEY"],
                        "variables": {"LOG_LEVEL": "info"},
                    },
                    "prod": {
                        "protection_rules": {
                            "required_reviewers": 2,
                            "required_status_checks": ["ci/build", "ci/test"],
                        },
                        "secrets": ["PROD_DEPLOY_KEY", "PROD_API_SECRET"],
                        "variables": {"LOG_LEVEL": "error", "REGION": "us-east-1"},
                    },
                },
                "variables": {
                    "team_name": "platform",
                    "cost_centre": "infra-001",
                    "service_tier": "critical",
                },
            },
        }
        validate(instance=doc, schema=self.schema)


class TestExampleYamlIntegration(unittest.TestCase):
    """
    Integration tests — config/example.yaml must exist, be valid YAML,
    and pass the overlay schema. This guards against regressions.
    """

    def setUp(self):
        self.schema = _load_schema()

    def test_example_yaml_exists(self):
        """config/example.yaml must be present."""
        self.assertTrue(
            os.path.isfile(EXAMPLE_YAML_PATH),
            f"config/example.yaml is missing — expected at {EXAMPLE_YAML_PATH}",
        )

    def test_example_yaml_is_parseable_yaml(self):
        """config/example.yaml must parse as a YAML mapping."""
        with open(EXAMPLE_YAML_PATH) as f:
            doc = yaml.safe_load(f)
        self.assertIsInstance(
            doc,
            dict,
            "config/example.yaml did not parse as a YAML mapping",
        )

    def test_example_yaml_passes_schema_validation(self):
        """config/example.yaml must satisfy the full overlay JSON Schema."""
        with open(EXAMPLE_YAML_PATH) as f:
            doc = yaml.safe_load(f)
        validate(instance=doc, schema=self.schema)

    def test_example_yaml_has_correct_apiVersion(self):
        """config/example.yaml must declare apiVersion: gitweave.io/v1."""
        with open(EXAMPLE_YAML_PATH) as f:
            doc = yaml.safe_load(f)
        self.assertEqual(
            doc.get("apiVersion"),
            "gitweave.io/v1",
            "config/example.yaml must have apiVersion: gitweave.io/v1",
        )

    def test_example_yaml_has_correct_kind(self):
        """config/example.yaml must declare kind: RepositoryOverlay."""
        with open(EXAMPLE_YAML_PATH) as f:
            doc = yaml.safe_load(f)
        self.assertEqual(
            doc.get("kind"),
            "RepositoryOverlay",
            "config/example.yaml must have kind: RepositoryOverlay",
        )

    def test_example_yaml_has_owner_slash_repo_repository(self):
        """config/example.yaml spec.repository must match owner/repo format."""
        with open(EXAMPLE_YAML_PATH) as f:
            doc = yaml.safe_load(f)
        repository = doc.get("spec", {}).get("repository", "")
        self.assertRegex(
            repository,
            r"^[^/\s]+/[^/\s]+$",
            f"config/example.yaml spec.repository '{repository}' does not match owner/repo format",
        )

    def test_example_yaml_includes_at_least_one_module(self):
        """config/example.yaml should demonstrate the modules section with at least one entry."""
        with open(EXAMPLE_YAML_PATH) as f:
            doc = yaml.safe_load(f)
        modules = doc.get("spec", {}).get("modules", [])
        self.assertGreater(
            len(modules),
            0,
            "config/example.yaml should include at least one module in spec.modules "
            "to serve as a meaningful example",
        )

    def test_example_yaml_includes_at_least_one_environment(self):
        """config/example.yaml should demonstrate the environments section."""
        with open(EXAMPLE_YAML_PATH) as f:
            doc = yaml.safe_load(f)
        environments = doc.get("spec", {}).get("environments", {})
        self.assertGreater(
            len(environments),
            0,
            "config/example.yaml should include at least one environment in spec.environments "
            "to serve as a meaningful example",
        )


if __name__ == "__main__":
    unittest.main()
