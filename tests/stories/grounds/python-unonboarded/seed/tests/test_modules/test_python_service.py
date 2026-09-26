"""Parametrized pytest tests for edge cases in the python-service Copier template.

Each test renders the template via ``copier copy`` to pytest's ``tmp_path`` and
asserts that specific file content matches the expected rendered output.  No
network access is required — copier renders from the local
``modules/python-service/`` directory.

Edge cases covered
------------------
* Valid required variables — happy-path rendering
* Special characters in ``service_name``: hyphens, underscores, numbers
* Maximum-length values for ``service_name``, ``description``, and ``author_name``
* Default values used when optional vars omitted (``python_version`` → ``"3.12"``)
* Specific structural content asserted for every rendered output file

All tests use the ``tmp_path`` fixture for full isolation.
Tests will FAIL until the template files missing from modules/python-service/
(src/ package tree, tests/ package, .github/workflows/ci.yaml) are implemented
(TDD red phase).
"""

from __future__ import annotations

import subprocess
import tomllib
from pathlib import Path

import pytest
import yaml

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).parents[2]
MODULE_DIR = REPO_ROOT / "modules" / "python-service"

# ---------------------------------------------------------------------------
# Copier availability guard
# ---------------------------------------------------------------------------


def _copier_available() -> bool:
    try:
        result = subprocess.run(
            ["copier", "--version"],
            capture_output=True,
            timeout=15,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


pytestmark = pytest.mark.skipif(
    not _copier_available(),
    reason="copier CLI not available — install copier to run template-rendering tests",
)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

#: Canonical valid inputs used as the baseline for most tests.
BASE_DATA: dict[str, str] = {
    "service_name": "my_service",
    "description": "A sample Python microservice for testing",
    "python_version": "3.12",
    "author_name": "Alice Example",
}


def _render(tmp_path: Path, data: dict[str, str]) -> subprocess.CompletedProcess:
    """Invoke ``copier copy`` with the given data into *tmp_path*."""
    cmd = ["copier", "copy", "--overwrite", "--defaults"]
    for key, value in data.items():
        cmd.extend(["--data", f"{key}={value}"])
    cmd.extend([str(MODULE_DIR), str(tmp_path)])
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60)


def _read_pyproject(tmp_path: Path) -> dict:
    with open(tmp_path / "pyproject.toml", "rb") as fh:
        return tomllib.load(fh)


# ===========================================================================
# Valid required variables — happy path
# ===========================================================================


class TestPythonServiceValidRequiredVariables:
    """Template renders without errors when all required variables are provided."""

    def test_copier_exits_zero_with_valid_required_variables(self, tmp_path):
        """copier copy must complete without error (exit 0) for a valid input set."""
        result = _render(tmp_path, BASE_DATA)
        assert result.returncode == 0, (
            f"copier copy failed with valid inputs.\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    def test_pyproject_toml_project_name_equals_service_name(self, tmp_path):
        """[project].name in rendered pyproject.toml must equal service_name."""
        _render(tmp_path, BASE_DATA)
        doc = _read_pyproject(tmp_path)
        assert doc["project"]["name"] == BASE_DATA["service_name"], (
            f"[project].name is {doc['project']['name']!r} — "
            f"expected {BASE_DATA['service_name']!r}"
        )

    def test_pyproject_toml_description_equals_input(self, tmp_path):
        """[project].description in rendered pyproject.toml must equal description."""
        _render(tmp_path, BASE_DATA)
        doc = _read_pyproject(tmp_path)
        assert doc["project"]["description"] == BASE_DATA["description"]

    def test_pyproject_toml_requires_python_contains_version(self, tmp_path):
        """[project].requires-python must embed the python_version string."""
        _render(tmp_path, BASE_DATA)
        doc = _read_pyproject(tmp_path)
        requires_python = doc["project"]["requires-python"]
        assert BASE_DATA["python_version"] in requires_python, (
            f"requires-python={requires_python!r} does not contain "
            f"python_version {BASE_DATA['python_version']!r}"
        )

    def test_pyproject_toml_authors_list_contains_author_name(self, tmp_path):
        """[project].authors must contain a record with the author_name value."""
        _render(tmp_path, BASE_DATA)
        doc = _read_pyproject(tmp_path)
        authors = doc["project"]["authors"]
        assert any(BASE_DATA["author_name"] in str(a) for a in authors), (
            f"author_name {BASE_DATA['author_name']!r} not found in authors: {authors}"
        )

    def test_dockerfile_from_instruction_references_correct_python_version(self, tmp_path):
        """Rendered Dockerfile FROM must reference the python_version slim image."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "Dockerfile").read_text()
        expected_from = f"FROM python:{BASE_DATA['python_version']}-slim"
        assert expected_from in content, (
            f"Dockerfile FROM instruction does not match expected '{expected_from}'.\n"
            f"Dockerfile content:\n{content}"
        )

    def test_dockerfile_cmd_references_service_name_package(self, tmp_path):
        """Rendered Dockerfile CMD must reference the service_name as a Python module."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "Dockerfile").read_text()
        assert BASE_DATA["service_name"] in content, (
            f"Dockerfile CMD does not reference service_name {BASE_DATA['service_name']!r}"
        )

    def test_copier_answers_yaml_records_all_four_inputs(self, tmp_path):
        """copier must write .copier-answers.yaml recording all four variable values."""
        _render(tmp_path, BASE_DATA)
        answers_path = tmp_path / ".copier-answers.yaml"
        assert answers_path.exists(), ".copier-answers.yaml was not generated"
        answers = yaml.safe_load(answers_path.read_text())
        for key in ("service_name", "description", "python_version", "author_name"):
            assert key in answers, (
                f".copier-answers.yaml is missing key '{key}' — "
                f"found keys: {list(answers.keys())}"
            )


# ===========================================================================
# Special characters in service_name: hyphens, underscores, numbers
# ===========================================================================


@pytest.mark.parametrize(
    "service_name",
    [
        "my_service",       # underscores (canonical snake_case)
        "my-service",       # hyphens (valid PyPI name, invalid Python identifier)
        "service123",       # trailing numbers
        "my_service_2",     # underscores + numbers
        "svc-v2-alpha",     # hyphens + numbers + letters
        "a1b2c3",           # alphanumeric mix
    ],
    ids=[
        "underscores",
        "hyphens",
        "trailing-numbers",
        "underscores-and-numbers",
        "hyphens-numbers-letters",
        "alphanumeric-mix",
    ],
)
class TestPythonServiceNameSpecialCharacters:
    """
    service_name values containing hyphens, underscores, and numbers must render
    without error and appear verbatim in pyproject.toml [project].name and Dockerfile CMD.
    """

    def test_copier_exits_zero_for_service_name(self, tmp_path, service_name):
        """copier copy must exit 0 for the given service_name value."""
        data = {**BASE_DATA, "service_name": service_name}
        result = _render(tmp_path, data)
        assert result.returncode == 0, (
            f"copier copy failed for service_name={service_name!r}.\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    def test_pyproject_toml_name_field_matches_service_name_exactly(self, tmp_path, service_name):
        """
        Rendered pyproject.toml must have [project].name equal to service_name.

        The exact string ``name = "<service_name>"`` must appear so that tools
        consuming pyproject.toml see the name exactly as supplied.
        """
        data = {**BASE_DATA, "service_name": service_name}
        _render(tmp_path, data)
        content = (tmp_path / "pyproject.toml").read_text()
        expected_line = f'name = "{service_name}"'
        assert expected_line in content, (
            f"pyproject.toml does not contain expected name field for "
            f"service_name={service_name!r}.\n"
            f"Expected line: {expected_line!r}\n"
            f"pyproject.toml content:\n{content}"
        )

    def test_dockerfile_references_service_name_in_cmd(self, tmp_path, service_name):
        """
        Rendered Dockerfile CMD must reference service_name as a Python module path.

        The CMD line must contain service_name so Docker runs the correct entry point.
        """
        data = {**BASE_DATA, "service_name": service_name}
        _render(tmp_path, data)
        content = (tmp_path / "Dockerfile").read_text()
        assert service_name in content, (
            f"Dockerfile does not reference service_name={service_name!r} in CMD.\n"
            f"Dockerfile content:\n{content}"
        )


# ===========================================================================
# Maximum-length values
# ===========================================================================


class TestPythonServiceMaximumLengthValues:
    """
    Template must handle maximum-length input values without truncation or errors.

    These tests ensure that no template imposes undocumented length constraints
    and that copier copy does not fail when inputs approach realistic upper bounds.
    """

    # 50-char name: valid PyPI package name at a realistic upper bound
    LONG_SERVICE_NAME: str = "a" * 50
    # 200-char description: tests TOML string embedding of long values
    LONG_DESCRIPTION: str = "B" * 200
    # 70-char author name: full name with multiple words at upper bound
    LONG_AUTHOR_NAME: str = ("Author Longname " * 4).strip()  # ~64 chars

    def test_max_length_service_name_appears_in_pyproject_name_field(self, tmp_path):
        """A 50-character service_name must appear verbatim in [project].name."""
        data = {**BASE_DATA, "service_name": self.LONG_SERVICE_NAME}
        result = _render(tmp_path, data)
        assert result.returncode == 0, (
            f"copier failed for max-length service_name: {result.stderr}"
        )
        doc = _read_pyproject(tmp_path)
        assert doc["project"]["name"] == self.LONG_SERVICE_NAME, (
            f"[project].name truncated: got {doc['project']['name']!r}, "
            f"expected {self.LONG_SERVICE_NAME!r}"
        )

    def test_max_length_service_name_appears_in_dockerfile(self, tmp_path):
        """A 50-character service_name must appear in Dockerfile CMD."""
        data = {**BASE_DATA, "service_name": self.LONG_SERVICE_NAME}
        _render(tmp_path, data)
        content = (tmp_path / "Dockerfile").read_text()
        assert self.LONG_SERVICE_NAME in content, (
            f"Dockerfile does not contain the 50-char service_name.\n"
            f"Dockerfile content:\n{content}"
        )

    def test_max_length_description_appears_in_pyproject_description_field(self, tmp_path):
        """A 200-character description must appear verbatim in [project].description."""
        data = {**BASE_DATA, "description": self.LONG_DESCRIPTION}
        result = _render(tmp_path, data)
        assert result.returncode == 0, (
            f"copier failed for max-length description: {result.stderr}"
        )
        doc = _read_pyproject(tmp_path)
        assert doc["project"]["description"] == self.LONG_DESCRIPTION, (
            f"[project].description was truncated. "
            f"Got {len(doc['project']['description'])} chars, "
            f"expected {len(self.LONG_DESCRIPTION)}"
        )

    def test_max_length_author_name_appears_in_pyproject_authors_field(self, tmp_path):
        """A long author_name must appear verbatim in [project].authors."""
        data = {**BASE_DATA, "author_name": self.LONG_AUTHOR_NAME}
        result = _render(tmp_path, data)
        assert result.returncode == 0, (
            f"copier failed for long author_name: {result.stderr}"
        )
        content = (tmp_path / "pyproject.toml").read_text()
        assert self.LONG_AUTHOR_NAME in content, (
            f"pyproject.toml does not contain the long author_name.\n"
            f"pyproject.toml content:\n{content}"
        )


# ===========================================================================
# Default values — python_version omitted
# ===========================================================================


class TestPythonServiceDefaultValues:
    """
    When optional variables are omitted, copier must substitute the declared default.

    ``python_version`` declares a default of ``"3.12"`` in copier.yaml.
    Rendering without an explicit ``python_version`` value must produce files
    that reference ``"3.12"`` in both pyproject.toml and Dockerfile.
    """

    DATA_WITHOUT_PYTHON_VERSION: dict[str, str] = {
        "service_name": "default_version_service",
        "description": "Service relying on the default python_version",
        "author_name": "Default Tester",
        # python_version intentionally omitted — copier should use default "3.12"
    }

    def test_copier_exits_zero_when_python_version_omitted(self, tmp_path):
        """copier copy must succeed when the optional python_version is not supplied."""
        result = _render(tmp_path, self.DATA_WITHOUT_PYTHON_VERSION)
        assert result.returncode == 0, (
            f"copier copy failed when python_version was omitted.\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    def test_pyproject_toml_uses_default_python_version_312(self, tmp_path):
        """
        Rendered pyproject.toml must contain ``>=3.12`` when python_version is omitted.

        This asserts that the template default (``3.12``) is substituted, not an
        empty string or literal ``{{ python_version }}``.
        """
        _render(tmp_path, self.DATA_WITHOUT_PYTHON_VERSION)
        doc = _read_pyproject(tmp_path)
        requires_python = doc["project"]["requires-python"]
        assert "3.12" in requires_python, (
            f"requires-python={requires_python!r} does not contain the default '3.12' — "
            f"python_version default was not applied"
        )

    def test_dockerfile_uses_default_python_version_312(self, tmp_path):
        """
        Rendered Dockerfile FROM must reference ``3.12`` when python_version is omitted.

        The FROM line must be ``FROM python:3.12-slim``, not an unresolved template tag.
        """
        _render(tmp_path, self.DATA_WITHOUT_PYTHON_VERSION)
        content = (tmp_path / "Dockerfile").read_text()
        assert "FROM python:3.12-slim" in content, (
            f"Dockerfile FROM does not reference the default python_version '3.12'.\n"
            f"Dockerfile content:\n{content}"
        )

    def test_copier_answers_yaml_records_default_python_version(self, tmp_path):
        """
        .copier-answers.yaml must record ``python_version: '3.12'`` when the default is used.

        This ensures that a future ``copier update`` replay uses the same version
        that was active at generation time.
        """
        _render(tmp_path, self.DATA_WITHOUT_PYTHON_VERSION)
        answers = yaml.safe_load((tmp_path / ".copier-answers.yaml").read_text())
        assert str(answers.get("python_version", "")) == "3.12", (
            f"Expected python_version='3.12' in .copier-answers.yaml, "
            f"got: {answers.get('python_version')!r}"
        )


# ===========================================================================
# Specific file-content integrity assertions
# ===========================================================================


class TestPythonServiceRenderedFileContentIntegrity:
    """
    Assert that specific structural content appears in every rendered output file.

    These tests go beyond existence checks and validate the precise strings and
    structures that downstream tooling (pip, Docker, GitHub Actions) depends on.
    """

    def test_pyproject_toml_is_valid_toml(self, tmp_path):
        """Rendered pyproject.toml must parse as valid TOML without errors."""
        _render(tmp_path, BASE_DATA)
        with open(tmp_path / "pyproject.toml", "rb") as fh:
            try:
                tomllib.load(fh)
            except tomllib.TOMLDecodeError as exc:
                pytest.fail(f"Rendered pyproject.toml is not valid TOML: {exc}")

    def test_pyproject_toml_has_build_system_section(self, tmp_path):
        """Rendered pyproject.toml must have a [build-system] table (PEP 517)."""
        _render(tmp_path, BASE_DATA)
        doc = _read_pyproject(tmp_path)
        assert "build-system" in doc, (
            "Rendered pyproject.toml is missing the [build-system] table"
        )

    def test_pyproject_toml_build_requires_setuptools(self, tmp_path):
        """[build-system].requires must include setuptools."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "pyproject.toml").read_text()
        assert "setuptools" in content, (
            "pyproject.toml [build-system].requires does not reference setuptools"
        )

    def test_pyproject_toml_dev_dependencies_include_pytest(self, tmp_path):
        """[project.optional-dependencies.dev] must include pytest so the template is testable."""
        _render(tmp_path, BASE_DATA)
        doc = _read_pyproject(tmp_path)
        dev_deps = (
            doc.get("project", {})
            .get("optional-dependencies", {})
            .get("dev", [])
        )
        assert any("pytest" in dep for dep in dev_deps), (
            f"[project.optional-dependencies.dev] does not include pytest. "
            f"Found: {dev_deps}"
        )

    def test_dockerfile_uses_slim_base_image(self, tmp_path):
        """Rendered Dockerfile must use a ``-slim`` Python base image."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "Dockerfile").read_text()
        assert "-slim" in content, (
            "Dockerfile does not use a '-slim' Python base image — "
            "prefer python:<version>-slim to minimise image size"
        )

    def test_dockerfile_exposes_port_8080(self, tmp_path):
        """Rendered Dockerfile must EXPOSE port 8080 as the service's listening port."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "Dockerfile").read_text()
        assert "EXPOSE 8080" in content, (
            "Dockerfile does not EXPOSE port 8080 — "
            "service images should declare the port they listen on"
        )

    def test_dockerfile_has_workdir_instruction(self, tmp_path):
        """Rendered Dockerfile must include a WORKDIR instruction."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "Dockerfile").read_text()
        assert "WORKDIR" in content, "Dockerfile is missing a WORKDIR instruction"

    def test_dockerfile_has_copy_instruction(self, tmp_path):
        """Rendered Dockerfile must COPY source files into the image."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "Dockerfile").read_text()
        assert "COPY" in content, "Dockerfile is missing a COPY instruction"

    def test_src_package_directory_is_generated(self, tmp_path):
        """
        A ``src/<service_name>/`` package directory must be generated.

        This is the standard src-layout for a Python service; without it,
        imports inside the container will fail.
        """
        _render(tmp_path, BASE_DATA)
        sn = BASE_DATA["service_name"]
        expected_dir = tmp_path / "src" / sn
        assert expected_dir.is_dir(), (
            f"src/{sn}/ directory was not generated — "
            f"the service package tree is required for imports to work"
        )

    def test_src_package_init_py_is_generated(self, tmp_path):
        """``src/<service_name>/__init__.py`` must be generated to make the directory a package."""
        _render(tmp_path, BASE_DATA)
        sn = BASE_DATA["service_name"]
        init_path = tmp_path / "src" / sn / "__init__.py"
        assert init_path.exists(), (
            f"src/{sn}/__init__.py was not generated — "
            f"the directory must be a Python package"
        )

    def test_src_package_main_py_is_generated(self, tmp_path):
        """``src/<service_name>/main.py`` must be generated as the service entry point."""
        _render(tmp_path, BASE_DATA)
        sn = BASE_DATA["service_name"]
        main_path = tmp_path / "src" / sn / "main.py"
        assert main_path.exists(), (
            f"src/{sn}/main.py was not generated — "
            f"Dockerfile CMD references this file as the entry point"
        )

    def test_tests_directory_is_generated(self, tmp_path):
        """A ``tests/`` directory must be generated so pytest can discover tests."""
        _render(tmp_path, BASE_DATA)
        assert (tmp_path / "tests").is_dir(), "tests/ directory was not generated"

    def test_tests_test_main_py_is_generated_and_references_service_name(self, tmp_path):
        """
        ``tests/test_main.py`` must be generated and must reference the service package.

        The test file must import or mention service_name so the generated tests
        actually exercise the correct package.
        """
        _render(tmp_path, BASE_DATA)
        test_file = tmp_path / "tests" / "test_main.py"
        assert test_file.exists(), "tests/test_main.py was not generated"
        content = test_file.read_text()
        assert BASE_DATA["service_name"] in content, (
            f"tests/test_main.py does not reference service_name "
            f"{BASE_DATA['service_name']!r} — "
            f"generated tests would not exercise the correct package"
        )

    def test_github_ci_workflow_is_generated_and_is_valid_yaml(self, tmp_path):
        """
        ``.github/workflows/ci.yaml`` must be generated and parse as a valid YAML mapping.
        """
        _render(tmp_path, BASE_DATA)
        ci_path = tmp_path / ".github" / "workflows" / "ci.yaml"
        assert ci_path.exists(), ".github/workflows/ci.yaml was not generated"
        doc = yaml.safe_load(ci_path.read_text())
        assert isinstance(doc, dict), (
            ".github/workflows/ci.yaml did not parse as a YAML mapping"
        )

    def test_github_ci_workflow_runs_pytest(self, tmp_path):
        """
        Generated ``.github/workflows/ci.yaml`` must invoke pytest so the generated
        tests/ are exercised in CI automatically.
        """
        _render(tmp_path, BASE_DATA)
        ci_path = tmp_path / ".github" / "workflows" / "ci.yaml"
        assert ci_path.exists(), ".github/workflows/ci.yaml was not generated"
        content = ci_path.read_text()
        assert "pytest" in content, (
            ".github/workflows/ci.yaml does not invoke pytest — "
            "the generated tests/ directory would never be run in CI"
        )
