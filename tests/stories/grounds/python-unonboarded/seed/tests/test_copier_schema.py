"""
Unit and integration tests for the copier.yaml metadata JSON Schema contract.

These tests verify that schemas/copier-module.schema.json:
  - exists at the declared path and is valid JSON Schema Draft 7
  - requires _metadata.name (snake_case), _metadata.version (CalVer YYYYMMDD.Patch),
    and _metadata.description
  - accepts optional _metadata.min_copier_version and _metadata.parent fields
  - rejects unknown _metadata properties (additionalProperties: false on _metadata)
  - validates Copier question 'type' values when a question definition is present
  - is satisfied by modules/example-template/copier.yaml
  - is satisfied by every modules/*/copier.yaml discovered in the repository

All tests in this file will fail until:
  - schemas/copier-module.schema.json is created with the correct content
  - modules/example-template/copier.yaml is created with valid metadata
"""

import json
import os
import re
import unittest

import yaml
import jsonschema
from jsonschema import validate, ValidationError

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCHEMA_PATH = os.path.join(REPO_ROOT, "schemas", "copier-module.schema.json")
EXAMPLE_MODULE_COPIER_YAML = os.path.join(
    REPO_ROOT, "modules", "example-template", "copier.yaml"
)
MODULES_DIR = os.path.join(REPO_ROOT, "modules")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_schema() -> dict:
    """Load and return the copier-module JSON Schema."""
    with open(SCHEMA_PATH) as f:
        return json.load(f)


def _minimal_valid_doc() -> dict:
    """Return the smallest document that should satisfy the schema."""
    return {
        "_metadata": {
            "name": "example_module",
            "version": "20240101.0",
            "description": "A minimal valid GitWeave template module",
        }
    }


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------


class TestSchemaFileExists(unittest.TestCase):
    """Sanity checks that the schema file exists, is valid JSON, and declares Draft 7."""

    def test_schema_file_exists_at_schemas_slash_copier_module_schema_json(self):
        """The schema must live at schemas/copier-module.schema.json (not a different path)."""
        self.assertTrue(
            os.path.isfile(SCHEMA_PATH),
            f"schemas/copier-module.schema.json is missing — expected it at {SCHEMA_PATH}",
        )

    def test_schema_file_is_valid_json(self):
        """The schema file must be parseable JSON and decode to a dict."""
        with open(SCHEMA_PATH) as f:
            schema = json.load(f)
        self.assertIsInstance(
            schema,
            dict,
            "schemas/copier-module.schema.json did not parse as a JSON object",
        )

    def test_schema_declares_json_schema_draft_7(self):
        """The $schema URI must reference JSON Schema Draft 7 as specified in the contract."""
        schema = _load_schema()
        self.assertIn(
            "$schema",
            schema,
            "schemas/copier-module.schema.json is missing the '$schema' key — "
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
        # Raises SchemaError if the schema itself is malformed
        jsonschema.Draft7Validator.check_schema(schema)


class TestRequiredFieldPresence(unittest.TestCase):
    """Verify that _metadata and its three required sub-fields are all mandatory."""

    def setUp(self):
        self.schema = _load_schema()

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    def test_document_with_all_required_fields_passes_validation(self):
        """The minimal valid document must pass without raising ValidationError."""
        self._validate(_minimal_valid_doc())  # must not raise

    def test_document_missing_metadata_block_entirely_is_rejected(self):
        """An empty document (no _metadata at all) must be rejected — _metadata is required."""
        with self.assertRaises(ValidationError):
            self._validate({})

    def test_document_with_empty_metadata_block_is_rejected(self):
        """_metadata: {} must be rejected because name, version, and description are all required."""
        with self.assertRaises(ValidationError):
            self._validate({"_metadata": {}})

    def test_document_missing_name_is_rejected(self):
        """_metadata without 'name' must be rejected."""
        doc = _minimal_valid_doc()
        del doc["_metadata"]["name"]
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_document_missing_version_is_rejected(self):
        """_metadata without 'version' must be rejected."""
        doc = _minimal_valid_doc()
        del doc["_metadata"]["version"]
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_document_missing_description_is_rejected(self):
        """_metadata without 'description' must be rejected."""
        doc = _minimal_valid_doc()
        del doc["_metadata"]["description"]
        with self.assertRaises(ValidationError):
            self._validate(doc)

    def test_metadata_with_null_values_is_rejected(self):
        """null values for required fields must be rejected — the fields must be strings."""
        with self.assertRaises(ValidationError):
            self._validate(
                {"_metadata": {"name": None, "version": None, "description": None}}
            )


class TestNamePatternValidation(unittest.TestCase):
    """
    _metadata.name must satisfy the snake_case pattern: starts with a lowercase
    letter followed by zero or more lowercase letters, digits, or underscores.
    """

    def setUp(self):
        self.schema = _load_schema()

    def _doc(self, name) -> dict:
        doc = _minimal_valid_doc()
        doc["_metadata"]["name"] = name
        return doc

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    # --- valid names ---

    def test_single_lowercase_word_is_valid(self):
        """A simple all-lowercase name like 'module' must be accepted."""
        self._validate(self._doc("module"))

    def test_snake_case_two_word_name_is_valid(self):
        """'my_module' is canonical snake_case and must be accepted."""
        self._validate(self._doc("my_module"))

    def test_snake_case_name_ending_in_digit_is_valid(self):
        """'module_v2' ends with a digit — must be accepted."""
        self._validate(self._doc("module_v2"))

    def test_snake_case_name_with_digits_embedded_is_valid(self):
        """'lang_node18' has a digit run — must be accepted."""
        self._validate(self._doc("lang_node18"))

    # --- invalid names ---

    def test_camelcase_name_is_rejected(self):
        """'myModule' uses camelCase — must be rejected (uppercase not allowed)."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("myModule"))

    def test_pascalcase_name_is_rejected(self):
        """'MyModule' starts with uppercase — must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("MyModule"))

    def test_kebabcase_name_is_rejected(self):
        """'my-module' contains a hyphen — must be rejected (only underscores allowed)."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("my-module"))

    def test_name_starting_with_underscore_is_rejected(self):
        """'_my_module' starts with an underscore — must be rejected (must start with [a-z])."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("_my_module"))

    def test_name_starting_with_digit_is_rejected(self):
        """'1module' starts with a digit — must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("1module"))

    def test_name_with_any_uppercase_letter_is_rejected(self):
        """'MY_MODULE' is all-uppercase — must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("MY_MODULE"))

    def test_name_containing_spaces_is_rejected(self):
        """'my module' contains a space — must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("my module"))

    def test_empty_name_string_is_rejected(self):
        """An empty string name must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc(""))


class TestVersionPatternValidation(unittest.TestCase):
    """
    _metadata.version must follow CalVer YYYYMMDD.Patch, e.g. '20240101.0'
    or '20261231.12'.  Semver, plain ISO dates, and other formats must be rejected.
    """

    def setUp(self):
        self.schema = _load_schema()

    def _doc(self, version) -> dict:
        doc = _minimal_valid_doc()
        doc["_metadata"]["version"] = version
        return doc

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    # --- valid versions ---

    def test_calver_patch_zero_is_valid(self):
        """'20240101.0' is a canonical CalVer release — must be accepted."""
        self._validate(self._doc("20240101.0"))

    def test_calver_nonzero_patch_is_valid(self):
        """'20240101.5' has a non-zero patch — must be accepted."""
        self._validate(self._doc("20240101.5"))

    def test_calver_end_of_year_date_is_valid(self):
        """'20261231.0' uses a December date — must be accepted."""
        self._validate(self._doc("20261231.0"))

    def test_calver_multi_digit_patch_is_valid(self):
        """'20240101.100' has a three-digit patch — must be accepted."""
        self._validate(self._doc("20240101.100"))

    # --- invalid versions ---

    def test_semver_three_parts_is_rejected(self):
        """'1.0.0' is SemVer, not CalVer — must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("1.0.0"))

    def test_plain_date_without_patch_is_rejected(self):
        """'20240101' has no patch component — must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("20240101"))

    def test_short_year_format_is_rejected(self):
        """'2024.0' has only a year, not YYYYMMDD — must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("2024.0"))

    def test_iso_date_with_hyphens_is_rejected(self):
        """'2024-01-01.0' uses ISO date separators — must be rejected (no hyphens)."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("2024-01-01.0"))

    def test_empty_version_string_is_rejected(self):
        """An empty string version must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc(""))

    def test_calver_with_trailing_dot_is_rejected(self):
        """'20240101.' has no patch digit after the dot — must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc("20240101."))


class TestOptionalMetadataFields(unittest.TestCase):
    """
    _metadata.min_copier_version and _metadata.parent are optional.
    No other _metadata properties should be allowed (additionalProperties: false).
    """

    def setUp(self):
        self.schema = _load_schema()

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    def test_document_with_min_copier_version_is_valid(self):
        """_metadata.min_copier_version is an optional field and must be accepted."""
        doc = _minimal_valid_doc()
        doc["_metadata"]["min_copier_version"] = "8.0.0"
        self._validate(doc)

    def test_document_with_parent_field_is_valid(self):
        """_metadata.parent (for composition) is optional and must be accepted."""
        doc = _minimal_valid_doc()
        doc["_metadata"]["parent"] = "base_module"
        self._validate(doc)

    def test_document_with_all_optional_fields_is_valid(self):
        """A document supplying all optional fields must be accepted."""
        doc = _minimal_valid_doc()
        doc["_metadata"]["min_copier_version"] = "8.0.0"
        doc["_metadata"]["parent"] = "base_module"
        self._validate(doc)

    def test_unknown_metadata_property_is_rejected(self):
        """
        An undocumented _metadata key must be rejected — the schema uses
        additionalProperties: false on _metadata to keep the contract strict.
        """
        doc = _minimal_valid_doc()
        doc["_metadata"]["undocumented_key"] = "surprise"
        with self.assertRaises(ValidationError):
            self._validate(doc)


class TestVariableQuestionTypeValidation(unittest.TestCase):
    """
    When a top-level question definition (i.e. a Copier variable) carries a
    'type' key, that type must be one of the five values Copier supports:
    str, bool, int, json, yaml.
    """

    def setUp(self):
        self.schema = _load_schema()

    def _doc_with_question(self, question_def: dict) -> dict:
        doc = _minimal_valid_doc()
        doc["my_variable"] = question_def
        return doc

    def _validate(self, doc: dict):
        validate(instance=doc, schema=self.schema)

    # --- valid question types ---

    def test_question_with_type_str_is_valid(self):
        """type: str is a valid Copier question type."""
        self._validate(self._doc_with_question({"type": "str", "help": "Enter text"}))

    def test_question_with_type_bool_is_valid(self):
        """type: bool is a valid Copier question type."""
        self._validate(
            self._doc_with_question(
                {"type": "bool", "help": "Enable feature?", "default": False}
            )
        )

    def test_question_with_type_int_is_valid(self):
        """type: int is a valid Copier question type."""
        self._validate(
            self._doc_with_question(
                {"type": "int", "help": "Port number", "default": 8080}
            )
        )

    def test_question_with_type_json_is_valid(self):
        """type: json is a valid Copier question type."""
        self._validate(self._doc_with_question({"type": "json", "help": "JSON config"}))

    def test_question_with_type_yaml_is_valid(self):
        """type: yaml is a valid Copier question type."""
        self._validate(self._doc_with_question({"type": "yaml", "help": "YAML config"}))

    def test_question_without_type_field_is_valid(self):
        """
        Questions without an explicit 'type' key are allowed — Copier defaults to str.
        The schema must not require 'type' to be present.
        """
        self._validate(
            self._doc_with_question({"help": "Enter something", "default": "hello"})
        )

    def test_document_with_multiple_questions_of_mixed_types_is_valid(self):
        """A realistic module with several typed questions must pass validation."""
        doc = _minimal_valid_doc()
        doc["project_name"] = {"type": "str", "help": "Project name"}
        doc["enable_ci"] = {"type": "bool", "help": "Enable CI workflow?", "default": True}
        doc["http_port"] = {"type": "int", "help": "HTTP port", "default": 3000}
        self._validate(doc)

    # --- invalid question types ---

    def test_question_with_type_float_is_rejected(self):
        """type: float is not a Copier type — must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc_with_question({"type": "float", "help": "A float"}))

    def test_question_with_type_list_is_rejected(self):
        """type: list is not a Copier type — must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc_with_question({"type": "list", "help": "A list"}))

    def test_question_with_type_dict_is_rejected(self):
        """type: dict is not a Copier type — must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(self._doc_with_question({"type": "dict", "help": "A dict"}))

    def test_question_with_arbitrary_unknown_type_is_rejected(self):
        """An arbitrary unknown type string must be rejected."""
        with self.assertRaises(ValidationError):
            self._validate(
                self._doc_with_question({"type": "multiline", "help": "Multiline"})
            )


class TestExampleTemplateModuleIntegration(unittest.TestCase):
    """
    Integration tests — modules/example-template/copier.yaml must exist and
    satisfy the schema.  These tests will fail until the file is created.
    """

    def setUp(self):
        self.schema = _load_schema()

    def test_example_template_copier_yaml_exists(self):
        """modules/example-template/copier.yaml must be present."""
        self.assertTrue(
            os.path.isfile(EXAMPLE_MODULE_COPIER_YAML),
            f"modules/example-template/copier.yaml is missing — expected at "
            f"{EXAMPLE_MODULE_COPIER_YAML}",
        )

    def test_example_template_copier_yaml_is_parseable_yaml(self):
        """modules/example-template/copier.yaml must parse as a YAML mapping."""
        with open(EXAMPLE_MODULE_COPIER_YAML) as f:
            doc = yaml.safe_load(f)
        self.assertIsInstance(
            doc,
            dict,
            "modules/example-template/copier.yaml did not parse as a YAML mapping",
        )

    def test_example_template_copier_yaml_passes_schema_validation(self):
        """modules/example-template/copier.yaml must satisfy the full JSON Schema."""
        with open(EXAMPLE_MODULE_COPIER_YAML) as f:
            doc = yaml.safe_load(f)
        validate(instance=doc, schema=self.schema)  # must not raise

    def test_example_template_name_follows_snake_case(self):
        """The name in the example module must match the snake_case pattern."""
        with open(EXAMPLE_MODULE_COPIER_YAML) as f:
            doc = yaml.safe_load(f)
        name = doc.get("_metadata", {}).get("name", "")
        self.assertRegex(
            name,
            r"^[a-z][a-z0-9_]*$",
            f"example-template name '{name}' does not match snake_case pattern",
        )

    def test_example_template_version_follows_calver(self):
        """The version in the example module must match the CalVer YYYYMMDD.Patch pattern."""
        with open(EXAMPLE_MODULE_COPIER_YAML) as f:
            doc = yaml.safe_load(f)
        version = str(doc.get("_metadata", {}).get("version", ""))
        self.assertRegex(
            version,
            r"^\d{8}\.\d+$",
            f"example-template version '{version}' does not match CalVer YYYYMMDD.Patch",
        )


class TestAllModuleCopierYamlFilesAreSchemaValid(unittest.TestCase):
    """
    Integration tests — every directory under modules/ (except hidden dirs)
    must contain a copier.yaml that passes schema validation.

    These tests guard against regressions when new modules are added.
    """

    def setUp(self):
        self.schema = _load_schema()

    def _non_hidden_module_dirs(self) -> list:
        return [
            d
            for d in os.listdir(MODULES_DIR)
            if os.path.isdir(os.path.join(MODULES_DIR, d)) and not d.startswith(".")
        ]

    def test_modules_directory_exists(self):
        """The modules/ directory must exist."""
        self.assertTrue(os.path.isdir(MODULES_DIR), "modules/ directory is missing")

    def test_each_module_directory_contains_a_copier_yaml(self):
        """
        Every non-hidden subdirectory of modules/ must contain copier.yaml.
        Fail with an informative message listing which modules are missing it.
        """
        missing = []
        for module in self._non_hidden_module_dirs():
            path = os.path.join(MODULES_DIR, module, "copier.yaml")
            if not os.path.isfile(path):
                missing.append(module)
        self.assertEqual(
            missing,
            [],
            f"These modules are missing copier.yaml: {missing!r}",
        )

    def test_each_module_copier_yaml_passes_schema_validation(self):
        """
        Every modules/*/copier.yaml must satisfy schemas/copier-module.schema.json.
        Uses subTest so all modules are validated and all failures are reported together.
        """
        for module in self._non_hidden_module_dirs():
            copier_yaml_path = os.path.join(MODULES_DIR, module, "copier.yaml")
            with self.subTest(module=module):
                self.assertTrue(
                    os.path.isfile(copier_yaml_path),
                    f"Module '{module}' is missing copier.yaml",
                )
                with open(copier_yaml_path) as f:
                    doc = yaml.safe_load(f)
                validate(instance=doc, schema=self.schema)


if __name__ == "__main__":
    unittest.main()
