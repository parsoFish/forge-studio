"""Parametrized pytest tests for edge cases in the terraform-module Copier template.

Each test renders the template via ``copier copy`` to pytest's ``tmp_path`` and
asserts that specific file content matches the expected rendered output.  No
network access is required — copier renders from the local
``modules/terraform-module/`` directory.

Edge cases covered
------------------
* Valid required variables — happy-path rendering
* Special characters in ``module_name``: hyphens, underscores, numbers
* Maximum-length values for ``module_name``, ``description``, and ``author``
* Various ``required_providers`` formats (provider source + version constraint)
* Specific structural content asserted for every rendered output file

All tests use the ``tmp_path`` fixture for full isolation.
Tests for files not yet present in the template (e.g. if .github/workflows/ci.yaml
template is missing) will FAIL until the implementation is complete (TDD red phase).
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest
import yaml

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).parents[2]
MODULE_DIR = REPO_ROOT / "modules" / "terraform-module"

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
    "module_name": "my_test_module",
    "description": "A reusable Terraform module for testing",
    "required_providers": "hashicorp/null:~> 3.0",
    "author": "Alice Example",
}


def _render(tmp_path: Path, data: dict[str, str]) -> subprocess.CompletedProcess:
    """Invoke ``copier copy`` with the given data into *tmp_path*."""
    cmd = ["copier", "copy", "--overwrite", "--defaults"]
    for key, value in data.items():
        cmd.extend(["--data", f"{key}={value}"])
    cmd.extend([str(MODULE_DIR), str(tmp_path)])
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60)


# ===========================================================================
# Valid required variables — happy path
# ===========================================================================


class TestTerraformModuleValidRequiredVariables:
    """Template renders without errors when all required variables are provided."""

    def test_copier_exits_zero_with_valid_required_variables(self, tmp_path):
        """copier copy must complete without error (exit 0) for a valid input set."""
        result = _render(tmp_path, BASE_DATA)
        assert result.returncode == 0, (
            f"copier copy failed with valid inputs.\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    def test_main_tf_contains_terraform_block(self, tmp_path):
        """Rendered main.tf must contain a ``terraform {`` block."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "main.tf").read_text()
        assert "terraform {" in content, (
            "main.tf does not contain a 'terraform {' block"
        )

    def test_main_tf_contains_required_providers_block(self, tmp_path):
        """Rendered main.tf must contain a ``required_providers`` block."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "main.tf").read_text()
        assert "required_providers" in content, (
            "main.tf does not contain a 'required_providers' block"
        )

    def test_main_tf_provider_source_derived_from_required_providers_input(self, tmp_path):
        """
        Rendered main.tf must reference the provider source extracted from required_providers.

        For ``required_providers = "hashicorp/null:~> 3.0"`` the source ``hashicorp/null``
        must appear in the required_providers block.
        """
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "main.tf").read_text()
        provider_source = BASE_DATA["required_providers"].split(":")[0].strip()
        assert provider_source in content, (
            f"main.tf does not reference provider source {provider_source!r} "
            f"derived from required_providers={BASE_DATA['required_providers']!r}"
        )

    def test_main_tf_provider_version_derived_from_required_providers_input(self, tmp_path):
        """
        Rendered main.tf must reference the provider version extracted from required_providers.

        For ``required_providers = "hashicorp/null:~> 3.0"`` the version ``~> 3.0``
        must appear in the required_providers block.
        """
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "main.tf").read_text()
        provider_version = BASE_DATA["required_providers"].split(":")[1].strip()
        assert provider_version in content, (
            f"main.tf does not reference provider version {provider_version!r} "
            f"derived from required_providers={BASE_DATA['required_providers']!r}"
        )

    def test_readme_md_contains_module_name_as_heading(self, tmp_path):
        """Rendered README.md must have the module_name as a top-level heading."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "README.md").read_text()
        assert f"# {BASE_DATA['module_name']}" in content, (
            f"README.md does not contain '# {BASE_DATA['module_name']}' as heading"
        )

    def test_readme_md_contains_description(self, tmp_path):
        """Rendered README.md must include the description string."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "README.md").read_text()
        assert BASE_DATA["description"] in content, (
            f"README.md does not contain description {BASE_DATA['description']!r}"
        )

    def test_readme_md_contains_author(self, tmp_path):
        """Rendered README.md must include the author string."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "README.md").read_text()
        assert BASE_DATA["author"] in content, (
            f"README.md does not contain author {BASE_DATA['author']!r}"
        )

    def test_readme_md_contains_terraform_docs_begin_marker(self, tmp_path):
        """README.md must include the ``<!-- BEGIN_TF_DOCS -->`` marker."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "README.md").read_text()
        assert "<!-- BEGIN_TF_DOCS -->" in content, (
            "README.md is missing the '<!-- BEGIN_TF_DOCS -->' terraform-docs marker"
        )

    def test_readme_md_contains_terraform_docs_end_marker(self, tmp_path):
        """README.md must include the ``<!-- END_TF_DOCS -->`` marker."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "README.md").read_text()
        assert "<!-- END_TF_DOCS -->" in content, (
            "README.md is missing the '<!-- END_TF_DOCS -->' terraform-docs marker"
        )

    def test_outputs_tf_contains_module_name_in_output_value(self, tmp_path):
        """
        Rendered outputs.tf must embed the module_name in the output value.

        The template generates ``value = "<module_name>"``, providing a stable
        identifier output that consumers can reference.
        """
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "outputs.tf").read_text()
        assert BASE_DATA["module_name"] in content, (
            f"outputs.tf does not contain module_name {BASE_DATA['module_name']!r}"
        )

    def test_examples_complete_main_tf_references_module_name(self, tmp_path):
        """Rendered examples/complete/main.tf must reference the module_name."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "examples" / "complete" / "main.tf").read_text()
        assert BASE_DATA["module_name"] in content, (
            f"examples/complete/main.tf does not reference module_name "
            f"{BASE_DATA['module_name']!r}"
        )

    def test_copier_answers_yaml_records_all_four_inputs(self, tmp_path):
        """copier must write .copier-answers.yaml recording all four variable values."""
        _render(tmp_path, BASE_DATA)
        answers_path = tmp_path / ".copier-answers.yaml"
        assert answers_path.exists(), ".copier-answers.yaml was not generated"
        answers = yaml.safe_load(answers_path.read_text())
        for key in ("module_name", "description", "required_providers", "author"):
            assert key in answers, (
                f".copier-answers.yaml is missing key '{key}' — "
                f"found keys: {list(answers.keys())}"
            )


# ===========================================================================
# Special characters in module_name: hyphens, underscores, numbers
# ===========================================================================


@pytest.mark.parametrize(
    "module_name",
    [
        "my_module",        # underscores (canonical snake_case)
        "my-module",        # hyphens
        "module123",        # trailing numbers
        "my_module_v2",     # underscores + numbers
        "vpc-peering-v3",   # hyphens + letters + numbers
        "a1b2c3d4",         # alphanumeric mix
    ],
    ids=[
        "underscores",
        "hyphens",
        "trailing-numbers",
        "underscores-and-numbers",
        "hyphens-letters-numbers",
        "alphanumeric-mix",
    ],
)
class TestTerraformModuleNameSpecialCharacters:
    """
    module_name values containing hyphens, underscores, and numbers must render
    without error and appear in README.md, outputs.tf, and examples/complete/main.tf.
    """

    def test_copier_exits_zero_for_module_name(self, tmp_path, module_name):
        """copier copy must exit 0 for the given module_name value."""
        data = {**BASE_DATA, "module_name": module_name}
        result = _render(tmp_path, data)
        assert result.returncode == 0, (
            f"copier copy failed for module_name={module_name!r}.\n"
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
        )

    def test_readme_heading_matches_module_name_exactly(self, tmp_path, module_name):
        """
        Rendered README.md must have ``# <module_name>`` as the top-level heading.

        The heading must use the exact string, preserving hyphens and underscores,
        so documentation tooling renders the correct module identifier.
        """
        data = {**BASE_DATA, "module_name": module_name}
        _render(tmp_path, data)
        content = (tmp_path / "README.md").read_text()
        expected_heading = f"# {module_name}"
        assert expected_heading in content, (
            f"README.md does not contain expected heading {expected_heading!r} for "
            f"module_name={module_name!r}.\nREADME.md content:\n{content}"
        )

    def test_outputs_tf_contains_module_name_value(self, tmp_path, module_name):
        """Rendered outputs.tf must embed module_name in the output value field."""
        data = {**BASE_DATA, "module_name": module_name}
        _render(tmp_path, data)
        content = (tmp_path / "outputs.tf").read_text()
        assert module_name in content, (
            f"outputs.tf does not contain module_name={module_name!r}.\n"
            f"outputs.tf content:\n{content}"
        )

    def test_examples_complete_main_tf_contains_module_name(self, tmp_path, module_name):
        """Rendered examples/complete/main.tf must reference the module_name."""
        data = {**BASE_DATA, "module_name": module_name}
        _render(tmp_path, data)
        content = (tmp_path / "examples" / "complete" / "main.tf").read_text()
        assert module_name in content, (
            f"examples/complete/main.tf does not reference module_name={module_name!r}.\n"
            f"Content:\n{content}"
        )


# ===========================================================================
# Various required_providers formats
# ===========================================================================


@pytest.mark.parametrize(
    "required_providers,expected_source,expected_version",
    [
        ("hashicorp/null:~> 3.0", "hashicorp/null", "~> 3.0"),
        ("hashicorp/aws:~> 5.0", "hashicorp/aws", "~> 5.0"),
        ("hashicorp/google:>= 4.0.0", "hashicorp/google", ">= 4.0.0"),
        ("hashicorp/azurerm:= 3.80.0", "hashicorp/azurerm", "= 3.80.0"),
        ("datadog/datadog:~> 3.27", "datadog/datadog", "~> 3.27"),
    ],
    ids=[
        "null-tilde-ge",
        "aws-tilde-ge",
        "google-ge",
        "azurerm-exact",
        "datadog-tilde-ge",
    ],
)
class TestTerraformModuleRequiredProvidersFormats:
    """
    The template must parse the ``required_providers`` string (``source:version``)
    and embed the extracted source and version correctly in main.tf.
    """

    def test_main_tf_embeds_provider_source(
        self, tmp_path, required_providers, expected_source, expected_version
    ):
        """main.tf must contain the provider source extracted from required_providers."""
        data = {**BASE_DATA, "required_providers": required_providers}
        result = _render(tmp_path, data)
        assert result.returncode == 0, (
            f"copier failed for required_providers={required_providers!r}: {result.stderr}"
        )
        content = (tmp_path / "main.tf").read_text()
        assert expected_source in content, (
            f"main.tf does not contain provider source {expected_source!r} "
            f"for required_providers={required_providers!r}.\nmain.tf:\n{content}"
        )

    def test_main_tf_embeds_provider_version(
        self, tmp_path, required_providers, expected_source, expected_version
    ):
        """main.tf must contain the version constraint extracted from required_providers."""
        data = {**BASE_DATA, "required_providers": required_providers}
        _render(tmp_path, data)
        content = (tmp_path / "main.tf").read_text()
        assert expected_version in content, (
            f"main.tf does not contain version constraint {expected_version!r} "
            f"for required_providers={required_providers!r}.\nmain.tf:\n{content}"
        )


# ===========================================================================
# Maximum-length values
# ===========================================================================


class TestTerraformModuleMaximumLengthValues:
    """
    Template must handle maximum-length input values without truncation or errors.
    """

    LONG_MODULE_NAME: str = "a" * 50      # 50-char module name
    LONG_DESCRIPTION: str = "D" * 200     # 200-char description
    LONG_AUTHOR: str = ("Author Longname " * 4).strip()  # ~64 chars

    def test_max_length_module_name_appears_in_readme_heading(self, tmp_path):
        """A 50-character module_name must appear as the README.md heading."""
        data = {**BASE_DATA, "module_name": self.LONG_MODULE_NAME}
        result = _render(tmp_path, data)
        assert result.returncode == 0, (
            f"copier failed for max-length module_name: {result.stderr}"
        )
        content = (tmp_path / "README.md").read_text()
        assert f"# {self.LONG_MODULE_NAME}" in content, (
            f"README.md heading does not contain the 50-char module_name.\n"
            f"README.md content:\n{content}"
        )

    def test_max_length_module_name_appears_in_outputs_tf(self, tmp_path):
        """A 50-character module_name must appear in outputs.tf."""
        data = {**BASE_DATA, "module_name": self.LONG_MODULE_NAME}
        _render(tmp_path, data)
        content = (tmp_path / "outputs.tf").read_text()
        assert self.LONG_MODULE_NAME in content, (
            f"outputs.tf does not contain the 50-char module_name.\n"
            f"outputs.tf content:\n{content}"
        )

    def test_max_length_description_appears_in_readme(self, tmp_path):
        """A 200-character description must appear verbatim in README.md."""
        data = {**BASE_DATA, "description": self.LONG_DESCRIPTION}
        result = _render(tmp_path, data)
        assert result.returncode == 0, (
            f"copier failed for max-length description: {result.stderr}"
        )
        content = (tmp_path / "README.md").read_text()
        assert self.LONG_DESCRIPTION in content, (
            f"README.md does not contain the 200-char description.\n"
            f"README.md content:\n{content}"
        )

    def test_max_length_author_appears_in_readme(self, tmp_path):
        """A long author name must appear verbatim in README.md."""
        data = {**BASE_DATA, "author": self.LONG_AUTHOR}
        result = _render(tmp_path, data)
        assert result.returncode == 0, (
            f"copier failed for long author: {result.stderr}"
        )
        content = (tmp_path / "README.md").read_text()
        assert self.LONG_AUTHOR in content, (
            f"README.md does not contain the long author name.\n"
            f"README.md content:\n{content}"
        )


# ===========================================================================
# Specific file-content integrity assertions
# ===========================================================================


class TestTerraformModuleRenderedFileContentIntegrity:
    """
    Assert that specific structural content appears in every rendered output file.

    These tests validate the precise strings and structures that downstream tooling
    (terraform, terraform-docs, GitHub Actions) depends on.
    """

    def test_variables_tf_contains_variable_block(self, tmp_path):
        """Rendered variables.tf must declare at least one ``variable`` block."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "variables.tf").read_text()
        assert "variable " in content, (
            "variables.tf does not contain any 'variable \"...\" {' block"
        )

    def test_outputs_tf_contains_output_block(self, tmp_path):
        """Rendered outputs.tf must declare at least one ``output`` block."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "outputs.tf").read_text()
        assert "output " in content, (
            "outputs.tf does not contain any 'output \"...\" {' block"
        )

    def test_examples_complete_main_tf_has_module_source_argument(self, tmp_path):
        """
        Rendered examples/complete/main.tf must include a ``source`` argument pointing
        to the generated module root (``../..``).
        """
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / "examples" / "complete" / "main.tf").read_text()
        assert "source" in content, (
            "examples/complete/main.tf does not contain a 'source' argument — "
            "the module call must reference the generated module"
        )
        assert "../.." in content, (
            "examples/complete/main.tf 'source' does not point to '../../' "
            "(the generated module root)"
        )

    def test_gitignore_excludes_terraform_provider_cache(self, tmp_path):
        """Rendered .gitignore must exclude ``.terraform`` provider cache."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / ".gitignore").read_text()
        assert ".terraform" in content, (
            ".gitignore does not exclude .terraform/ — provider binaries "
            "would be committed if absent"
        )

    def test_gitignore_excludes_tfstate_files(self, tmp_path):
        """Rendered .gitignore must exclude ``*.tfstate`` state files."""
        _render(tmp_path, BASE_DATA)
        content = (tmp_path / ".gitignore").read_text()
        assert ".tfstate" in content, (
            ".gitignore does not exclude *.tfstate — state files containing "
            "secrets would be committed if absent"
        )

    def test_github_ci_workflow_is_valid_yaml(self, tmp_path):
        """
        Rendered ``.github/workflows/ci.yaml`` must parse as a valid YAML mapping.
        """
        _render(tmp_path, BASE_DATA)
        ci_path = tmp_path / ".github" / "workflows" / "ci.yaml"
        assert ci_path.exists(), ".github/workflows/ci.yaml was not generated"
        doc = yaml.safe_load(ci_path.read_text())
        assert isinstance(doc, dict), (
            ".github/workflows/ci.yaml did not parse as a YAML mapping"
        )

    def test_github_ci_workflow_runs_terraform_validate(self, tmp_path):
        """
        Generated ``.github/workflows/ci.yaml`` must include a ``terraform validate`` step.
        """
        _render(tmp_path, BASE_DATA)
        ci_path = tmp_path / ".github" / "workflows" / "ci.yaml"
        assert ci_path.exists(), ".github/workflows/ci.yaml was not generated"
        content = ci_path.read_text()
        assert "terraform validate" in content, (
            ".github/workflows/ci.yaml does not include a 'terraform validate' step"
        )

    def test_github_ci_workflow_runs_terraform_fmt_check(self, tmp_path):
        """
        Generated ``.github/workflows/ci.yaml`` must include a ``terraform fmt`` step.
        """
        _render(tmp_path, BASE_DATA)
        ci_path = tmp_path / ".github" / "workflows" / "ci.yaml"
        assert ci_path.exists(), ".github/workflows/ci.yaml was not generated"
        content = ci_path.read_text()
        assert "terraform fmt" in content, (
            ".github/workflows/ci.yaml does not include a 'terraform fmt' step"
        )

    def test_copier_answers_yaml_records_module_name_value(self, tmp_path):
        """
        .copier-answers.yaml must record the module_name value supplied at render time.
        """
        _render(tmp_path, BASE_DATA)
        answers = yaml.safe_load((tmp_path / ".copier-answers.yaml").read_text())
        assert answers.get("module_name") == BASE_DATA["module_name"], (
            f".copier-answers.yaml module_name is {answers.get('module_name')!r} — "
            f"expected {BASE_DATA['module_name']!r}"
        )

    def test_copier_answers_yaml_records_author_value(self, tmp_path):
        """
        .copier-answers.yaml must record the author value supplied at render time.
        """
        _render(tmp_path, BASE_DATA)
        answers = yaml.safe_load((tmp_path / ".copier-answers.yaml").read_text())
        assert answers.get("author") == BASE_DATA["author"], (
            f".copier-answers.yaml author is {answers.get('author')!r} — "
            f"expected {BASE_DATA['author']!r}"
        )
