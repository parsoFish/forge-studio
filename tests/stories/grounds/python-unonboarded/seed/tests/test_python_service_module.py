"""
Unit and integration tests for the modules/python-service Copier template module.

These tests verify that:
  - modules/python-service/copier.yaml exists and is valid against
    schemas/copier-module.schema.json
  - copier.yaml defines all four required questions: service_name, description,
    python_version, author_name
  - Every expected output file has a corresponding Jinja2 template in the module
  - Rendering each template with fixed inputs produces correct, parseable output:
      - pyproject.toml renders service_name, description, author_name, python_version
      - Rendered pyproject.toml is valid TOML with a [project] table
      - Rendered Dockerfile references python_version and uses a slim base image
      - Rendered .github/workflows/ci.yaml is valid YAML with an 'on' trigger
      - Rendered tests/test_main.py references the service package by name
  - Integration (skipped when copier binary is absent):
      - copier copy generates a structurally complete project under tmp/
      - Generated pyproject.toml is valid TOML and [project].name matches service_name
      - .copier-answers.yaml is written with all four inputs recorded
      - All acceptance-criteria files exist in the generated output

All tests fail until modules/python-service/ is implemented (TDD red phase).
"""

import json
import os
import shutil
import subprocess
import tempfile
import tomllib
import unittest

import jinja2
import jsonschema
import yaml
from jsonschema import ValidationError, validate

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCHEMA_PATH = os.path.join(REPO_ROOT, "schemas", "copier-module.schema.json")
MODULE_DIR = os.path.join(REPO_ROOT, "modules", "python-service")
MODULE_COPIER_YAML = os.path.join(MODULE_DIR, "copier.yaml")

# Fixed template inputs used across unit tests for deterministic rendering.
_FIXED_INPUTS = {
    "service_name": "my_service",
    "description": "A sample Python microservice for testing",
    "python_version": "3.12",
    "author_name": "Alice Example",
}


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_schema() -> dict:
    with open(SCHEMA_PATH) as f:
        return json.load(f)


def _load_module_copier_yaml() -> dict:
    with open(MODULE_COPIER_YAML) as f:
        return yaml.safe_load(f)


def _render_file(abs_path: str, variables: dict) -> str:
    """Render a Jinja2 template file from disk with the given variables."""
    with open(abs_path) as f:
        source = f.read()
    env = jinja2.Environment(
        keep_trailing_newline=True,
        undefined=jinja2.StrictUndefined,
    )
    return env.from_string(source).render(**variables)


def _find_template(name_pattern: str, subtree: str = "") -> str | None:
    """
    Walk MODULE_DIR (or a subtree of it) and return the first file path whose
    basename contains name_pattern.  Returns None if not found.
    """
    search_root = os.path.join(MODULE_DIR, subtree) if subtree else MODULE_DIR
    for root, _, files in os.walk(search_root):
        for fname in files:
            if name_pattern in fname:
                return os.path.join(root, fname)
    return None


def _find_template_in_subtree(name_pattern: str, subtree_segment: str) -> str | None:
    """
    Find a template file whose path contains subtree_segment as a directory
    component and whose basename contains name_pattern.
    """
    for root, _, files in os.walk(MODULE_DIR):
        parts = os.path.normpath(root).split(os.sep)
        if subtree_segment in parts:
            for fname in files:
                if name_pattern in fname:
                    return os.path.join(root, fname)
    return None


# ---------------------------------------------------------------------------
# Schema validation — modules/python-service/copier.yaml
# ---------------------------------------------------------------------------


class TestPythonServiceCopierYamlExists(unittest.TestCase):
    """modules/python-service/copier.yaml must exist and satisfy the GitWeave schema."""

    def test_python_service_module_directory_exists(self):
        """modules/python-service/ directory must be present."""
        self.assertTrue(
            os.path.isdir(MODULE_DIR),
            f"modules/python-service/ is missing — expected at {MODULE_DIR}",
        )

    def test_copier_yaml_exists_in_python_service_module(self):
        """modules/python-service/copier.yaml must be present."""
        self.assertTrue(
            os.path.isfile(MODULE_COPIER_YAML),
            f"modules/python-service/copier.yaml is missing — expected at {MODULE_COPIER_YAML}",
        )

    def test_copier_yaml_is_parseable_yaml(self):
        """modules/python-service/copier.yaml must parse as a YAML mapping."""
        with open(MODULE_COPIER_YAML) as f:
            doc = yaml.safe_load(f)
        self.assertIsInstance(
            doc,
            dict,
            "modules/python-service/copier.yaml did not parse as a YAML mapping",
        )

    def test_copier_yaml_passes_schema_validation(self):
        """modules/python-service/copier.yaml must satisfy schemas/copier-module.schema.json."""
        schema = _load_schema()
        doc = _load_module_copier_yaml()
        validate(instance=doc, schema=schema)  # must not raise

    def test_copier_yaml_metadata_name_is_python_service(self):
        """_metadata.name must be 'python_service' (snake_case of the module directory name)."""
        doc = _load_module_copier_yaml()
        name = doc.get("_metadata", {}).get("name", "")
        self.assertEqual(
            name,
            "python_service",
            f"_metadata.name is {name!r} — expected 'python_service'",
        )

    def test_copier_yaml_metadata_version_follows_calver(self):
        """_metadata.version must match the CalVer YYYYMMDD.Patch pattern."""
        doc = _load_module_copier_yaml()
        version = str(doc.get("_metadata", {}).get("version", ""))
        self.assertRegex(
            version,
            r"^\d{8}\.\d+$",
            f"_metadata.version {version!r} does not match CalVer YYYYMMDD.Patch",
        )

    def test_copier_yaml_metadata_description_is_non_empty(self):
        """_metadata.description must be a non-empty string."""
        doc = _load_module_copier_yaml()
        desc = doc.get("_metadata", {}).get("description", "")
        self.assertTrue(
            isinstance(desc, str) and desc.strip(),
            "_metadata.description must be a non-empty string",
        )


# ---------------------------------------------------------------------------
# Copier question definitions
# ---------------------------------------------------------------------------


class TestPythonServiceCopierQuestions(unittest.TestCase):
    """copier.yaml must define all four required template variables as Copier questions."""

    def setUp(self):
        self.doc = _load_module_copier_yaml()

    def test_service_name_question_is_defined(self):
        """copier.yaml must define a top-level 'service_name' question."""
        self.assertIn(
            "service_name",
            self.doc,
            "copier.yaml is missing the 'service_name' question — add a top-level entry",
        )

    def test_description_question_is_defined(self):
        """copier.yaml must define a top-level 'description' question."""
        self.assertIn(
            "description",
            self.doc,
            "copier.yaml is missing the 'description' question",
        )

    def test_python_version_question_is_defined(self):
        """copier.yaml must define a top-level 'python_version' question."""
        self.assertIn(
            "python_version",
            self.doc,
            "copier.yaml is missing the 'python_version' question",
        )

    def test_author_name_question_is_defined(self):
        """copier.yaml must define a top-level 'author_name' question."""
        self.assertIn(
            "author_name",
            self.doc,
            "copier.yaml is missing the 'author_name' question",
        )

    def test_service_name_question_type_is_str_when_present(self):
        """service_name type must be 'str' if an explicit type is declared."""
        q = self.doc.get("service_name", {})
        if isinstance(q, dict) and "type" in q:
            self.assertEqual(
                q["type"],
                "str",
                "service_name question type must be 'str'",
            )

    def test_python_version_question_has_a_default(self):
        """python_version must declare a default so non-interactive runs work in CI."""
        q = self.doc.get("python_version", {})
        self.assertIsInstance(
            q,
            dict,
            "python_version question must be a YAML mapping with a 'default' key",
        )
        self.assertIn(
            "default",
            q,
            "python_version question must declare a 'default' value "
            "so copier copy --defaults works in CI",
        )

    def test_python_version_default_is_a_valid_major_minor_string(self):
        """python_version default must look like a Python major.minor version, e.g. '3.12'."""
        q = self.doc.get("python_version", {})
        default = str(q.get("default", "")) if isinstance(q, dict) else ""
        self.assertRegex(
            default,
            r"^3\.\d+$",
            f"python_version default {default!r} does not look like a Python version (e.g. '3.12')",
        )

    def test_service_name_question_has_help_text(self):
        """service_name question should have a 'help' field to guide users."""
        q = self.doc.get("service_name", {})
        if isinstance(q, dict):
            self.assertIn(
                "help",
                q,
                "service_name question is missing 'help' text — add guidance for users",
            )

    def test_author_name_question_has_help_text(self):
        """author_name question should have a 'help' field."""
        q = self.doc.get("author_name", {})
        if isinstance(q, dict):
            self.assertIn(
                "help",
                q,
                "author_name question is missing 'help' text",
            )


# ---------------------------------------------------------------------------
# Template file presence
# ---------------------------------------------------------------------------


class TestPythonServiceTemplateFilesExist(unittest.TestCase):
    """
    The module directory must contain a Jinja2 template for every file that
    copier copy is expected to generate.  Templates use .jinja extension or are
    included verbatim.
    """

    def _template_exists(self, name_pattern: str) -> bool:
        return _find_template(name_pattern) is not None

    def _template_exists_in(self, name_pattern: str, subtree_segment: str) -> bool:
        return _find_template_in_subtree(name_pattern, subtree_segment) is not None

    def test_pyproject_toml_template_exists(self):
        """A pyproject.toml template must exist under modules/python-service/."""
        self.assertTrue(
            self._template_exists("pyproject.toml"),
            "No pyproject.toml template found under modules/python-service/",
        )

    def test_src_init_py_template_exists(self):
        """A __init__.py template under src/ must exist for the service package."""
        self.assertTrue(
            self._template_exists_in("__init__.py", "src"),
            "No src/__init__.py template found under modules/python-service/src/",
        )

    def test_src_main_py_template_exists(self):
        """A main.py template under src/ must exist as the service entry point."""
        self.assertTrue(
            self._template_exists_in("main.py", "src"),
            "No src/main.py template found under modules/python-service/src/",
        )

    def test_tests_init_py_template_exists(self):
        """A tests/__init__.py template must exist so tests/ is a Python package."""
        self.assertTrue(
            self._template_exists_in("__init__.py", "tests"),
            "No tests/__init__.py template found under modules/python-service/tests/",
        )

    def test_tests_test_main_py_template_exists(self):
        """A tests/test_main.py template must exist with at least one test."""
        self.assertTrue(
            self._template_exists_in("test_main", "tests"),
            "No tests/test_main.py template found under modules/python-service/tests/",
        )

    def test_dockerfile_template_exists(self):
        """A Dockerfile template must exist under modules/python-service/."""
        self.assertTrue(
            self._template_exists("Dockerfile"),
            "No Dockerfile template found under modules/python-service/",
        )

    def test_github_ci_workflow_template_exists(self):
        """A .github/workflows/ci.yaml template must exist."""
        found = False
        for root, _, files in os.walk(MODULE_DIR):
            parts = os.path.normpath(root).split(os.sep)
            if ".github" in parts or "workflows" in parts:
                for fname in files:
                    if "ci.yaml" in fname or "ci.yml" in fname:
                        found = True
        self.assertTrue(
            found,
            "No .github/workflows/ci.yaml template found under modules/python-service/",
        )

    def test_gitignore_template_exists(self):
        """A .gitignore template must exist."""
        self.assertTrue(
            self._template_exists(".gitignore") or self._template_exists("gitignore"),
            "No .gitignore template found under modules/python-service/",
        )


# ---------------------------------------------------------------------------
# Template rendering — unit tests with fixed inputs via Jinja2 directly
# ---------------------------------------------------------------------------


class TestPythonServiceTemplateRendering(unittest.TestCase):
    """
    Unit tests that render individual Jinja2 template files with _FIXED_INPUTS
    and assert the output contains expected strings or parses as valid TOML/YAML.

    These tests do NOT invoke copier — they render templates directly, which
    isolates template correctness from copier's file-copy machinery.
    """

    INPUTS = _FIXED_INPUTS

    def _render(self, name_pattern: str, subtree_segment: str = "") -> str:
        """Render the first template matching name_pattern and return the output string."""
        path = (
            _find_template_in_subtree(name_pattern, subtree_segment)
            if subtree_segment
            else _find_template(name_pattern)
        )
        self.assertIsNotNone(
            path,
            f"Template matching '{name_pattern}'"
            + (f" in subtree '{subtree_segment}'" if subtree_segment else "")
            + f" not found under {MODULE_DIR}",
        )
        return _render_file(path, self.INPUTS)

    def _render_ci_workflow(self) -> str:
        """Render the .github/workflows/ci.yaml template."""
        for root, _, files in os.walk(MODULE_DIR):
            parts = os.path.normpath(root).split(os.sep)
            if ".github" in parts or "workflows" in parts:
                for fname in files:
                    if "ci.yaml" in fname or "ci.yml" in fname:
                        return _render_file(os.path.join(root, fname), self.INPUTS)
        self.fail("No .github/workflows/ci.yaml template found")

    # --- pyproject.toml ---

    def test_pyproject_toml_renders_service_name(self):
        """Rendered pyproject.toml must contain the service_name value."""
        rendered = self._render("pyproject.toml")
        self.assertIn(
            self.INPUTS["service_name"],
            rendered,
            "Rendered pyproject.toml does not contain the service_name",
        )

    def test_pyproject_toml_renders_description(self):
        """Rendered pyproject.toml must contain the description value."""
        rendered = self._render("pyproject.toml")
        self.assertIn(
            self.INPUTS["description"],
            rendered,
            "Rendered pyproject.toml does not contain the description",
        )

    def test_pyproject_toml_renders_author_name(self):
        """Rendered pyproject.toml must contain the author_name value."""
        rendered = self._render("pyproject.toml")
        self.assertIn(
            self.INPUTS["author_name"],
            rendered,
            "Rendered pyproject.toml does not contain the author_name",
        )

    def test_pyproject_toml_renders_python_version(self):
        """Rendered pyproject.toml must reference python_version as a requires-python constraint."""
        rendered = self._render("pyproject.toml")
        self.assertIn(
            self.INPUTS["python_version"],
            rendered,
            "Rendered pyproject.toml does not reference python_version",
        )

    def test_rendered_pyproject_toml_is_valid_toml(self):
        """Rendered pyproject.toml must parse as valid TOML without errors."""
        rendered = self._render("pyproject.toml")
        try:
            doc = tomllib.loads(rendered)
        except tomllib.TOMLDecodeError as exc:
            self.fail(
                f"Rendered pyproject.toml is not valid TOML: {exc}\n---\n{rendered}"
            )
        self.assertIsInstance(doc, dict, "Rendered pyproject.toml did not parse as a dict")

    def test_rendered_pyproject_toml_has_project_section(self):
        """Rendered pyproject.toml must have a [project] table as required by PEP 517/518."""
        rendered = self._render("pyproject.toml")
        doc = tomllib.loads(rendered)
        self.assertIn(
            "project",
            doc,
            "Rendered pyproject.toml is missing the [project] table",
        )

    def test_rendered_pyproject_toml_project_name_matches_service_name(self):
        """[project].name in the rendered pyproject.toml must equal service_name."""
        rendered = self._render("pyproject.toml")
        doc = tomllib.loads(rendered)
        project_name = doc.get("project", {}).get("name", "")
        self.assertEqual(
            project_name,
            self.INPUTS["service_name"],
            f"[project].name is {project_name!r} — expected {self.INPUTS['service_name']!r}",
        )

    def test_rendered_pyproject_toml_has_requires_python_constraint(self):
        """[project].requires-python must be set so the version pin is enforced."""
        rendered = self._render("pyproject.toml")
        doc = tomllib.loads(rendered)
        project = doc.get("project", {})
        self.assertIn(
            "requires-python",
            project,
            "Rendered pyproject.toml [project] is missing 'requires-python'",
        )

    # --- Dockerfile ---

    def test_dockerfile_renders_python_version_in_from_instruction(self):
        """Rendered Dockerfile FROM instruction must reference python_version."""
        rendered = self._render("Dockerfile")
        self.assertIn(
            self.INPUTS["python_version"],
            rendered,
            "Rendered Dockerfile does not include python_version in the FROM instruction",
        )

    def test_dockerfile_uses_slim_or_alpine_base_image(self):
        """Dockerfile must use a slim or alpine Python base image to keep image size small."""
        rendered = self._render("Dockerfile")
        self.assertTrue(
            "slim" in rendered or "alpine" in rendered,
            "Rendered Dockerfile does not use a 'slim' or 'alpine' Python base image — "
            "prefer python:<version>-slim over the full image",
        )

    def test_dockerfile_has_workdir_instruction(self):
        """Rendered Dockerfile must include a WORKDIR instruction."""
        rendered = self._render("Dockerfile")
        self.assertIn(
            "WORKDIR",
            rendered,
            "Rendered Dockerfile is missing a WORKDIR instruction",
        )

    def test_dockerfile_has_copy_instruction(self):
        """Rendered Dockerfile must COPY source files into the image."""
        rendered = self._render("Dockerfile")
        self.assertIn(
            "COPY",
            rendered,
            "Rendered Dockerfile is missing a COPY instruction",
        )

    def test_dockerfile_exposes_a_port(self):
        """Rendered Dockerfile should EXPOSE a port (good practice for service images)."""
        rendered = self._render("Dockerfile")
        self.assertIn(
            "EXPOSE",
            rendered,
            "Rendered Dockerfile is missing an EXPOSE instruction — "
            "service images should declare the port they listen on",
        )

    # --- src/<service_name>/main.py ---

    def test_src_main_py_defines_a_main_entry_point(self):
        """Rendered src/main.py must define a main() function or __main__ guard."""
        path = _find_template_in_subtree("main.py", "src")
        self.assertIsNotNone(
            path,
            "No main.py template found under modules/python-service/src/",
        )
        rendered = _render_file(path, self.INPUTS)
        has_main = (
            "def main" in rendered
            or 'if __name__ == "__main__"' in rendered
            or "if __name__ == '__main__'" in rendered
        )
        self.assertTrue(
            has_main,
            "Rendered src/main.py does not define main() or a __main__ guard",
        )

    # --- tests/test_main.py ---

    def test_tests_test_main_references_service_package(self):
        """Rendered tests/test_main.py must import or reference the service package by name."""
        path = _find_template_in_subtree("test_main", "tests")
        self.assertIsNotNone(
            path,
            "No test_main.py template found under modules/python-service/tests/",
        )
        rendered = _render_file(path, self.INPUTS)
        self.assertIn(
            self.INPUTS["service_name"],
            rendered,
            f"Rendered tests/test_main.py does not reference service package "
            f"'{self.INPUTS['service_name']}'",
        )

    def test_tests_test_main_contains_at_least_one_test_function(self):
        """Rendered tests/test_main.py must contain at least one def test_ function."""
        path = _find_template_in_subtree("test_main", "tests")
        self.assertIsNotNone(
            path,
            "No test_main.py template found under modules/python-service/tests/",
        )
        rendered = _render_file(path, self.INPUTS)
        self.assertIn(
            "def test_",
            rendered,
            "Rendered tests/test_main.py does not contain any test_ functions",
        )

    # --- .github/workflows/ci.yaml ---

    def test_github_ci_workflow_renders_python_version(self):
        """Rendered .github/workflows/ci.yaml must reference python_version."""
        rendered = self._render_ci_workflow()
        self.assertIn(
            self.INPUTS["python_version"],
            rendered,
            "Rendered .github/workflows/ci.yaml does not reference python_version",
        )

    def test_rendered_github_ci_workflow_is_valid_yaml(self):
        """Rendered .github/workflows/ci.yaml must be valid YAML."""
        rendered = self._render_ci_workflow()
        try:
            doc = yaml.safe_load(rendered)
        except yaml.YAMLError as exc:
            self.fail(f"Rendered ci.yaml is not valid YAML: {exc}\n---\n{rendered}")
        self.assertIsInstance(doc, dict, "Rendered ci.yaml did not parse as a YAML mapping")

    def test_rendered_github_ci_workflow_has_on_trigger(self):
        """Rendered .github/workflows/ci.yaml must define at least one trigger via 'on'."""
        rendered = self._render_ci_workflow()
        doc = yaml.safe_load(rendered)
        self.assertIn(
            "on",
            doc,
            "Rendered ci.yaml is missing the 'on' triggers section",
        )

    def test_rendered_github_ci_workflow_has_jobs(self):
        """Rendered .github/workflows/ci.yaml must define at least one job."""
        rendered = self._render_ci_workflow()
        doc = yaml.safe_load(rendered)
        self.assertIn(
            "jobs",
            doc,
            "Rendered ci.yaml is missing a 'jobs' section",
        )
        self.assertGreater(
            len(doc.get("jobs", {})),
            0,
            "Rendered ci.yaml 'jobs' section is empty — at least one job required",
        )

    def test_rendered_github_ci_workflow_runs_pytest(self):
        """Rendered ci.yaml must run pytest so generated tests are actually exercised in CI."""
        rendered = self._render_ci_workflow()
        self.assertIn(
            "pytest",
            rendered,
            "Rendered .github/workflows/ci.yaml does not run pytest — "
            "the generated tests would never be executed in CI",
        )


# ---------------------------------------------------------------------------
# Integration tests — copier copy end-to-end (skipped if copier not installed)
# ---------------------------------------------------------------------------


@unittest.skipUnless(
    shutil.which("copier"),
    "copier binary not found — install copier to run end-to-end integration tests",
)
class TestPythonServiceCopierCopyIntegration(unittest.TestCase):
    """
    Integration tests that invoke 'copier copy modules/python-service <tmpdir>'
    with _FIXED_INPUTS and validate the generated project structure and file contents.

    Skipped when the copier binary is absent.  When the module is implemented and
    copier is available, all tests must pass without modification.
    """

    INPUTS = _FIXED_INPUTS

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp(prefix="gitweave_python_service_")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _run_copier(self) -> subprocess.CompletedProcess:
        """
        Invoke copier copy with _FIXED_INPUTS using --defaults and --data flags.
        Returns the completed subprocess result for the caller to assert on.
        """
        data_args = []
        for key, value in self.INPUTS.items():
            data_args += ["--data", f"{key}={value}"]
        return subprocess.run(
            ["copier", "copy", "--defaults", "--overwrite"]
            + data_args
            + [MODULE_DIR, self.tmpdir],
            capture_output=True,
            text=True,
        )

    # --- copier exits cleanly ---

    def test_copier_copy_exits_zero(self):
        """copier copy must complete without errors (exit code 0)."""
        result = self._run_copier()
        self.assertEqual(
            result.returncode,
            0,
            f"copier copy exited {result.returncode}:\n"
            f"STDOUT: {result.stdout}\nSTDERR: {result.stderr}",
        )

    # --- structural completeness (canonical acceptance criteria) ---

    def test_full_project_structure_is_complete(self):
        """
        All acceptance-criteria output files must exist after copier copy.
        This is the single canonical completeness check.
        """
        self._run_copier()
        sn = self.INPUTS["service_name"]
        expected = [
            "pyproject.toml",
            f"src/{sn}/__init__.py",
            f"src/{sn}/main.py",
            "tests/__init__.py",
            "tests/test_main.py",
            "Dockerfile",
            ".gitignore",
            ".copier-answers.yaml",
        ]
        missing = [
            p for p in expected if not os.path.isfile(os.path.join(self.tmpdir, p))
        ]
        self.assertEqual(
            missing,
            [],
            f"Generated project is missing these required files: {missing!r}",
        )

    def test_github_workflows_directory_is_generated(self):
        """Generated project must contain .github/workflows/ directory."""
        self._run_copier()
        path = os.path.join(self.tmpdir, ".github", "workflows")
        self.assertTrue(
            os.path.isdir(path),
            "Generated project is missing .github/workflows/ directory",
        )

    def test_github_ci_workflow_file_is_generated(self):
        """Generated project must contain .github/workflows/ci.yaml."""
        self._run_copier()
        yaml_path = os.path.join(self.tmpdir, ".github", "workflows", "ci.yaml")
        yml_path = os.path.join(self.tmpdir, ".github", "workflows", "ci.yml")
        self.assertTrue(
            os.path.isfile(yaml_path) or os.path.isfile(yml_path),
            "Generated project is missing .github/workflows/ci.yaml",
        )

    # --- pyproject.toml content ---

    def test_generated_pyproject_toml_is_valid_toml(self):
        """Generated pyproject.toml must be valid TOML."""
        self._run_copier()
        path = os.path.join(self.tmpdir, "pyproject.toml")
        self.assertTrue(os.path.isfile(path), "pyproject.toml not generated")
        with open(path, "rb") as f:
            try:
                doc = tomllib.load(f)
            except tomllib.TOMLDecodeError as exc:
                self.fail(f"Generated pyproject.toml is not valid TOML: {exc}")
        self.assertIsInstance(doc, dict)

    def test_generated_pyproject_toml_project_name_matches_service_name(self):
        """Generated [project].name must equal the service_name input."""
        self._run_copier()
        path = os.path.join(self.tmpdir, "pyproject.toml")
        self.assertTrue(os.path.isfile(path), "pyproject.toml not generated")
        with open(path, "rb") as f:
            doc = tomllib.load(f)
        project_name = doc.get("project", {}).get("name", "")
        self.assertEqual(
            project_name,
            self.INPUTS["service_name"],
            f"Generated [project].name is {project_name!r} — "
            f"expected {self.INPUTS['service_name']!r}",
        )

    def test_generated_pyproject_toml_description_matches_input(self):
        """Generated [project].description must match the description input."""
        self._run_copier()
        path = os.path.join(self.tmpdir, "pyproject.toml")
        with open(path, "rb") as f:
            doc = tomllib.load(f)
        desc = doc.get("project", {}).get("description", "")
        self.assertEqual(
            desc,
            self.INPUTS["description"],
            f"Generated [project].description is {desc!r} — "
            f"expected {self.INPUTS['description']!r}",
        )

    # --- Dockerfile content ---

    def test_generated_dockerfile_uses_correct_python_version(self):
        """Generated Dockerfile must reference the python_version input in FROM."""
        self._run_copier()
        path = os.path.join(self.tmpdir, "Dockerfile")
        self.assertTrue(os.path.isfile(path), "Dockerfile not generated")
        with open(path) as f:
            content = f.read()
        self.assertIn(
            self.INPUTS["python_version"],
            content,
            f"Generated Dockerfile does not reference python_version "
            f"{self.INPUTS['python_version']!r}",
        )

    # --- GitHub CI workflow content ---

    def test_generated_github_ci_workflow_is_valid_yaml(self):
        """Generated .github/workflows/ci.yaml must be valid YAML."""
        self._run_copier()
        for fname in ("ci.yaml", "ci.yml"):
            path = os.path.join(self.tmpdir, ".github", "workflows", fname)
            if os.path.isfile(path):
                with open(path) as f:
                    try:
                        doc = yaml.safe_load(f)
                    except yaml.YAMLError as exc:
                        self.fail(f"Generated ci.yaml is not valid YAML: {exc}")
                self.assertIsInstance(doc, dict)
                return
        self.fail("Generated project is missing .github/workflows/ci.yaml")

    # --- tests/test_main.py content ---

    def test_generated_tests_test_main_references_service_package(self):
        """Generated tests/test_main.py must import or reference the service package by name."""
        self._run_copier()
        path = os.path.join(self.tmpdir, "tests", "test_main.py")
        self.assertTrue(os.path.isfile(path), "tests/test_main.py not generated")
        with open(path) as f:
            content = f.read()
        self.assertIn(
            self.INPUTS["service_name"],
            content,
            f"Generated tests/test_main.py does not reference "
            f"service package '{self.INPUTS['service_name']}'",
        )

    # --- .copier-answers.yaml ---

    def test_copier_answers_yaml_is_written_to_project_root(self):
        """.copier-answers.yaml must be written to the generated project root."""
        self._run_copier()
        path = os.path.join(self.tmpdir, ".copier-answers.yaml")
        self.assertTrue(
            os.path.isfile(path),
            "copier copy did not write .copier-answers.yaml to the project root",
        )

    def test_copier_answers_yaml_records_all_four_inputs(self):
        """.copier-answers.yaml must record all four inputs: service_name, description, python_version, author_name."""
        self._run_copier()
        path = os.path.join(self.tmpdir, ".copier-answers.yaml")
        self.assertTrue(os.path.isfile(path), ".copier-answers.yaml not generated")
        with open(path) as f:
            answers = yaml.safe_load(f)
        self.assertIsInstance(answers, dict, ".copier-answers.yaml did not parse as a dict")
        for key in ("service_name", "description", "python_version", "author_name"):
            with self.subTest(key=key):
                self.assertIn(
                    key,
                    answers,
                    f".copier-answers.yaml is missing the '{key}' input",
                )

    def test_copier_answers_yaml_service_name_matches_input(self):
        """.copier-answers.yaml service_name must equal the value that was passed in."""
        self._run_copier()
        path = os.path.join(self.tmpdir, ".copier-answers.yaml")
        self.assertTrue(os.path.isfile(path), ".copier-answers.yaml not generated")
        with open(path) as f:
            answers = yaml.safe_load(f)
        self.assertEqual(
            answers.get("service_name"),
            self.INPUTS["service_name"],
            f".copier-answers.yaml service_name is {answers.get('service_name')!r} — "
            f"expected {self.INPUTS['service_name']!r}",
        )

    def test_copier_answers_yaml_python_version_matches_input(self):
        """.copier-answers.yaml python_version must equal the value that was passed in."""
        self._run_copier()
        path = os.path.join(self.tmpdir, ".copier-answers.yaml")
        self.assertTrue(os.path.isfile(path), ".copier-answers.yaml not generated")
        with open(path) as f:
            answers = yaml.safe_load(f)
        self.assertEqual(
            str(answers.get("python_version", "")),
            self.INPUTS["python_version"],
            f".copier-answers.yaml python_version is "
            f"{answers.get('python_version')!r} — expected {self.INPUTS['python_version']!r}",
        )


if __name__ == "__main__":
    unittest.main()
