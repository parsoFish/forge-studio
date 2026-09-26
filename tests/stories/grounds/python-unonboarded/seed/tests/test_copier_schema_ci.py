"""
CI workflow tests for copier.yaml schema validation gate.

These tests verify that .github/workflows/ci.yaml is updated to include:
  - the jsonschema package in the pip install step (or a dedicated install step)
  - a step that runs pytest against tests/test_copier_schema.py (or all tests/)
    so that the AllModules integration test runs on every PR
  - OR a dedicated step that invokes jsonschema/check-jsonschema against
    modules/*/copier.yaml directly
  - that any schema-validation step does NOT set continue-on-error: true
    (failures must block the PR)
  - that the schema validation step references schemas/copier-module.schema.json

All tests in this file will fail until ci.yaml is updated to incorporate the
jsonschema validation gate for template module copier.yaml files.
"""

import os
import re
import unittest

import yaml


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CI_WORKFLOW_PATH = os.path.join(REPO_ROOT, ".github", "workflows", "ci.yaml")


# ---------------------------------------------------------------------------
# Shared helpers (same conventions as test_ci_workflow.py)
# ---------------------------------------------------------------------------


def _load_workflow(path: str) -> dict:
    """Parse a GitHub Actions workflow YAML file and return the document dict."""
    with open(path) as f:
        return yaml.safe_load(f)


def _collect_all_steps(doc: dict) -> list:
    """Return a flat list of every step object across all jobs in a workflow."""
    steps = []
    for job in doc.get("jobs", {}).values():
        steps.extend(job.get("steps", []))
    return steps


def _step_run_text(step: dict) -> str:
    """Return the 'run' field of a step as a string (original case preserved)."""
    return str(step.get("run", ""))


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------


class TestCIInstallsJsonschema(unittest.TestCase):
    """
    The jsonschema Python package must be installed in CI before any validation
    step runs.  Acceptable patterns:
      - 'pip install ... jsonschema ...' in an existing install step
      - a dedicated 'pip install jsonschema' step
    """

    def setUp(self):
        self.doc = _load_workflow(CI_WORKFLOW_PATH)
        self.all_steps = _collect_all_steps(self.doc)

    def _pip_install_steps(self) -> list:
        return [s for s in self.all_steps if "pip install" in _step_run_text(s)]

    def test_ci_has_at_least_one_pip_install_step(self):
        """There must be at least one 'pip install' step in CI."""
        self.assertGreater(
            len(self._pip_install_steps()),
            0,
            "ci.yaml has no 'pip install' step — dependencies are not being installed",
        )

    def test_jsonschema_is_listed_in_pip_install(self):
        """
        The jsonschema package must appear in the pip install command(s) so that
        schema validation can run.  Without it, the validation step would error
        with an ImportError.
        """
        combined = " ".join(_step_run_text(s) for s in self._pip_install_steps())
        self.assertIn(
            "jsonschema",
            combined,
            "ci.yaml pip install step(s) do not include 'jsonschema' — "
            "add 'jsonschema' to the pip install command so schema validation works",
        )


class TestCIRunsCopierSchemaTests(unittest.TestCase):
    """
    The CI workflow must run the copier schema pytest tests on every PR.

    Acceptable patterns:
      - pytest invocation that explicitly names tests/test_copier_schema.py
      - pytest invocation targeting the entire tests/ directory
        (e.g. 'pytest tests/' or just 'pytest') — but NOT a single other file
      - a standalone schema validation step that exercises all modules/*/copier.yaml
    """

    def setUp(self):
        self.doc = _load_workflow(CI_WORKFLOW_PATH)
        self.all_steps = _collect_all_steps(self.doc)

    def _find_schema_test_steps(self) -> list:
        """
        Steps that run the copier schema tests, either via pytest or a direct
        jsonschema/check-jsonschema call targeting module files.

        Deliberately excludes steps that only run a single unrelated test file
        such as 'pytest tests/test_structure.py'.
        """
        results = []
        for step in self.all_steps:
            run = _step_run_text(step)

            # Explicit: step names the copier schema test file
            names_schema_file = "test_copier_schema" in run

            # Broad pytest: runs 'pytest tests/' (directory) or bare 'pytest'
            # but NOT 'pytest tests/test_structure.py' (a single other file)
            runs_all_tests = bool(
                re.search(r"\bpytest\s+tests/?(\s|$)", run)
                or re.search(r"\bpytest\s*$", run)
            )

            # Direct validation: calls jsonschema / check-jsonschema on modules/
            validates_modules_directly = (
                "jsonschema" in run.lower() and "modules" in run
            )

            if names_schema_file or runs_all_tests or validates_modules_directly:
                results.append(step)
        return results

    def test_ci_has_a_step_that_validates_module_copier_yaml_files(self):
        """
        At least one CI step must exercise schema validation against module
        copier.yaml files — either by running pytest tests/test_copier_schema.py
        (which includes the AllModules integration test) or by a dedicated
        jsonschema CLI invocation targeting modules/*/copier.yaml.
        """
        steps = self._find_schema_test_steps()
        self.assertGreater(
            len(steps),
            0,
            "ci.yaml has no step that validates module copier.yaml files against the schema — "
            "add a pytest step covering tests/test_copier_schema.py or a dedicated "
            "jsonschema validation step targeting modules/*/copier.yaml",
        )

    def test_schema_validation_step_does_not_have_continue_on_error(self):
        """
        The schema validation step(s) must NOT set continue-on-error: true —
        an invalid module copier.yaml must block the PR, not be silently ignored.
        """
        for step in self._find_schema_test_steps():
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"Step '{step.get('name', '<unnamed>')}' sets continue-on-error: true — "
                "copier.yaml schema violations must fail the CI job",
            )

    def test_schema_validation_step_is_not_branch_gated(self):
        """
        The schema validation step must not have an 'if' condition that restricts
        it to the main branch — it must run on every PR.
        """
        for step in self._find_schema_test_steps():
            condition = str(step.get("if", ""))
            self.assertNotIn(
                "github.ref",
                condition,
                f"Step '{step.get('name', '<unnamed>')}' is branch-gated with: {condition!r} — "
                "schema validation must run on every PR, not just pushes to main",
            )


class TestCISchemaValidationReferencesSchemaFile(unittest.TestCase):
    """
    When a dedicated jsonschema validation step is used (as opposed to running
    pytest), it must explicitly reference schemas/copier-module.schema.json so
    the correct schema contract is enforced.
    """

    def setUp(self):
        self.doc = _load_workflow(CI_WORKFLOW_PATH)
        self.all_steps = _collect_all_steps(self.doc)

    def _find_direct_jsonschema_steps(self) -> list:
        """Steps that call jsonschema/check-jsonschema directly (not via pytest)."""
        return [
            s
            for s in self.all_steps
            if "jsonschema" in _step_run_text(s).lower()
            and "pytest" not in _step_run_text(s)
        ]

    def test_direct_jsonschema_step_references_the_schema_file(self):
        """
        If a dedicated jsonschema step is used, it must reference
        schemas/copier-module.schema.json — not a hard-coded inline schema or a
        different file — so the canonical contract is always the source of truth.

        This test passes vacuously when pytest is used instead of a direct
        jsonschema invocation.
        """
        direct_steps = self._find_direct_jsonschema_steps()
        if not direct_steps:
            # pytest-based approach — no direct step to check
            return

        for step in direct_steps:
            run_cmd = _step_run_text(step)
            self.assertIn(
                "copier-module.schema.json",
                run_cmd,
                f"Dedicated jsonschema step '{step.get('name', '<unnamed>')}' does not "
                f"reference schemas/copier-module.schema.json — it may be validating "
                f"against the wrong schema: {run_cmd!r}",
            )

    def test_direct_jsonschema_step_targets_modules_directory(self):
        """
        If a dedicated jsonschema step is used, it must target modules/ so that
        all module copier.yaml files are validated, not just one specific file.

        This test passes vacuously when pytest is used instead.
        """
        direct_steps = self._find_direct_jsonschema_steps()
        if not direct_steps:
            return

        for step in direct_steps:
            run_cmd = _step_run_text(step)
            self.assertIn(
                "modules",
                run_cmd,
                f"Dedicated jsonschema step '{step.get('name', '<unnamed>')}' does not "
                f"target the modules/ directory — new modules would not be validated: "
                f"{run_cmd!r}",
            )


if __name__ == "__main__":
    unittest.main()
