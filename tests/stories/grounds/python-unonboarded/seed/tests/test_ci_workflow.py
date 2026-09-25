"""
Tests for the CI workflow that gates structural regressions on every PR.

These tests verify that .github/workflows/ci.yaml exists and is correctly
configured to:
  - trigger on pull_request and push to main
  - run pytest tests/test_structure.py (structural regression gate)
  - run yamllint on all .github/workflows/*.yaml files
  - enforce least-privilege permissions (contents: read only)
  - fail the job — not swallow errors — when either step fails

All tests in this file fail until .github/workflows/ci.yaml is created
with the correct content (TDD red phase).
"""

import os
import unittest

import yaml


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


def _get_triggers(doc: dict) -> dict:
    """
    Return the workflow trigger mapping, handling PyYAML's YAML 1.1 quirk
    where the bare `on:` key is parsed as the boolean True rather than the
    string 'on'.  Both cases are checked so the tests work regardless of
    the installed PyYAML version.
    """
    return doc.get("on") or doc.get(True) or {}


class TestCIWorkflowFileExists(unittest.TestCase):
    """Sanity checks that the file is present and parseable."""

    def setUp(self):
        self.repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.ci_path = os.path.join(self.repo_root, ".github", "workflows", "ci.yaml")

    def test_ci_yaml_exists_at_expected_path(self):
        """ci.yaml must exist at .github/workflows/ci.yaml (not ci.yml)."""
        self.assertTrue(
            os.path.isfile(self.ci_path),
            ".github/workflows/ci.yaml is missing — the CI gate workflow has not been created",
        )

    def test_ci_yaml_is_valid_yaml_mapping(self):
        """ci.yaml must parse as a valid YAML mapping without syntax errors."""
        doc = _load_workflow(self.ci_path)
        self.assertIsInstance(
            doc,
            dict,
            "ci.yaml did not parse as a YAML mapping — the file may contain syntax errors",
        )


class TestCIWorkflowTriggers(unittest.TestCase):
    """Verify the workflow fires at the right times."""

    def setUp(self):
        self.repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.ci_path = os.path.join(self.repo_root, ".github", "workflows", "ci.yaml")
        self.doc = _load_workflow(self.ci_path)

    def test_triggers_on_pull_request(self):
        """CI must fire on every pull_request so no unvalidated code can be merged."""
        triggers = _get_triggers(self.doc)
        self.assertIn(
            "pull_request",
            triggers,
            "ci.yaml is missing the 'pull_request' trigger — the gate will not run on PRs",
        )

    def test_triggers_on_push_to_main(self):
        """CI must fire on push to main to catch direct commits that bypass PRs."""
        triggers = _get_triggers(self.doc)
        push_trigger = triggers.get("push", {})
        branches = push_trigger.get("branches", [])
        self.assertIn(
            "main",
            branches,
            "ci.yaml push trigger does not include 'main' — direct pushes will not be validated",
        )

    def test_pull_request_trigger_is_not_scoped_to_specific_paths(self):
        """
        The pull_request trigger must not restrict to specific paths — every PR
        must run structural checks regardless of which files were changed.
        """
        triggers = _get_triggers(self.doc)
        pr_trigger = triggers.get("pull_request") or {}
        # If pull_request is mapped to None/True it means "all events" — that's fine.
        # A non-empty paths filter would silently skip unrelated PRs.
        if isinstance(pr_trigger, dict):
            paths = pr_trigger.get("paths", [])
            self.assertEqual(
                paths,
                [],
                f"ci.yaml pull_request trigger is scoped to specific paths {paths!r} — "
                "structural checks must run on every PR, not just path-filtered ones",
            )


class TestCIWorkflowPermissions(unittest.TestCase):
    """Verify the principle of least privilege: only contents: read is needed."""

    def setUp(self):
        self.repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.ci_path = os.path.join(self.repo_root, ".github", "workflows", "ci.yaml")
        self.doc = _load_workflow(self.ci_path)

    def test_has_explicit_top_level_permissions_block(self):
        """
        An explicit permissions block must be present so the intent is clear
        and the default (often too broad) GITHUB_TOKEN permissions are overridden.
        """
        self.assertIn(
            "permissions",
            self.doc,
            "ci.yaml is missing a top-level 'permissions' block — "
            "always declare permissions explicitly to enforce least privilege",
        )

    def test_permissions_contents_is_read(self):
        """permissions.contents must be 'read' — the job only reads code, never writes."""
        perms = self.doc.get("permissions", {})
        self.assertEqual(
            perms.get("contents"),
            "read",
            f"ci.yaml permissions.contents is {perms.get('contents')!r}, expected 'read'",
        )

    def test_permissions_grants_no_write_access(self):
        """No permission scope should be set to 'write' — this job is read-only."""
        perms = self.doc.get("permissions", {})
        if isinstance(perms, dict):
            write_grants = {k: v for k, v in perms.items() if v == "write"}
            self.assertEqual(
                write_grants,
                {},
                f"ci.yaml grants unnecessary write permissions: {write_grants!r}",
            )

    def test_permissions_grants_no_admin_access(self):
        """No permission scope should be set to 'admin'."""
        perms = self.doc.get("permissions", {})
        if isinstance(perms, dict):
            admin_grants = {k: v for k, v in perms.items() if v == "admin"}
            self.assertEqual(
                admin_grants,
                {},
                f"ci.yaml grants unexpected admin permissions: {admin_grants!r}",
            )


class TestCIWorkflowPytestStep(unittest.TestCase):
    """Verify the structural regression test step is correctly configured."""

    def setUp(self):
        self.repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.ci_path = os.path.join(self.repo_root, ".github", "workflows", "ci.yaml")
        self.doc = _load_workflow(self.ci_path)
        self.all_steps = _collect_all_steps(self.doc)

    def _find_pytest_steps(self):
        return [
            s
            for s in self.all_steps
            if "pytest" in str(s.get("run", ""))
            and "tests/test_structure.py" in str(s.get("run", ""))
        ]

    def test_has_step_running_pytest_on_test_structure(self):
        """A step must invoke pytest on tests/test_structure.py to gate structural regressions."""
        pytest_steps = self._find_pytest_steps()
        self.assertGreater(
            len(pytest_steps),
            0,
            "ci.yaml has no step running 'pytest tests/test_structure.py' — "
            "structural test failures will not block the PR",
        )

    def test_pytest_step_does_not_have_continue_on_error(self):
        """
        The pytest step must NOT set continue-on-error: true — a test failure
        must block the PR, not be silently swallowed.
        """
        for step in self._find_pytest_steps():
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"pytest step '{step.get('name', '<unnamed>')}' has continue-on-error: true — "
                "test failures must fail the job",
            )

    def test_pytest_step_is_not_conditional_on_success_only(self):
        """
        The pytest step must not use an `if` condition that could skip it
        on non-main branches or certain event types.
        """
        for step in self._find_pytest_steps():
            condition = step.get("if", "")
            # A condition of 'always()' is fine; absence is fine.
            # Blocking conditions like 'github.ref == refs/heads/main' would
            # prevent the step from running on PRs.
            self.assertNotIn(
                "github.ref",
                str(condition),
                f"pytest step has a branch-scoped 'if' condition: {condition!r} — "
                "the structural test must run on every PR, not just main",
            )


class TestCIWorkflowYamllintStep(unittest.TestCase):
    """Verify the YAML lint step is correctly configured."""

    def setUp(self):
        self.repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.ci_path = os.path.join(self.repo_root, ".github", "workflows", "ci.yaml")
        self.doc = _load_workflow(self.ci_path)
        self.all_steps = _collect_all_steps(self.doc)

    def _find_yamllint_steps(self):
        return [
            s
            for s in self.all_steps
            if "yamllint" in str(s.get("run", ""))
        ]

    def test_has_step_running_yamllint_on_workflows_directory(self):
        """
        A step must run yamllint against .github/workflows/ so malformed
        workflow YAML is caught before merge.
        """
        yamllint_steps = [
            s
            for s in self._find_yamllint_steps()
            if ".github/workflows" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(yamllint_steps),
            0,
            "ci.yaml has no step running yamllint on .github/workflows/ — "
            "invalid workflow YAML will not be caught by the CI gate",
        )

    def test_yamllint_step_does_not_have_continue_on_error(self):
        """
        The yamllint step must NOT set continue-on-error: true — a lint failure
        must block the PR, not be silently swallowed.
        """
        for step in self._find_yamllint_steps():
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"yamllint step '{step.get('name', '<unnamed>')}' has continue-on-error: true — "
                "lint failures must fail the job",
            )

    def test_yamllint_targets_yaml_extension_not_only_yml(self):
        """
        yamllint must cover .yaml files (the extension used by this project's
        workflows) — not only .yml files.
        """
        for step in self._find_yamllint_steps():
            run_cmd = str(step.get("run", ""))
            # Acceptable patterns: glob like *.yaml, directory glob, or the
            # directory itself (.github/workflows/ covers all files inside).
            # Reject patterns that only target *.yml and skip *.yaml.
            if "*.yml" in run_cmd and "*.yaml" not in run_cmd and ".github/workflows/" not in run_cmd:
                self.fail(
                    f"yamllint step targets only '*.yml' — project workflows use the "
                    f"'.yaml' extension and would be skipped: {run_cmd!r}"
                )


class TestCIWorkflowJobStructure(unittest.TestCase):
    """Verify the overall job configuration is sane."""

    def setUp(self):
        self.repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        self.ci_path = os.path.join(self.repo_root, ".github", "workflows", "ci.yaml")
        self.doc = _load_workflow(self.ci_path)

    def test_workflow_has_at_least_one_job(self):
        """ci.yaml must define at least one job."""
        jobs = self.doc.get("jobs", {})
        self.assertGreater(
            len(jobs),
            0,
            "ci.yaml defines no jobs — the workflow will succeed vacuously",
        )

    def test_all_jobs_run_on_ubuntu(self):
        """
        All jobs should run on ubuntu-latest for consistency with the rest
        of the project's workflows.
        """
        jobs = self.doc.get("jobs", {})
        for job_id, job in jobs.items():
            runs_on = job.get("runs-on", "")
            self.assertIn(
                "ubuntu",
                str(runs_on).lower(),
                f"Job '{job_id}' does not run on ubuntu-latest (runs-on: {runs_on!r})",
            )

    def test_each_job_has_a_checkout_step(self):
        """
        Every job must check out the repository before running tests or linters.
        """
        jobs = self.doc.get("jobs", {})
        for job_id, job in jobs.items():
            steps = job.get("steps", [])
            checkout_steps = [
                s for s in steps if "checkout" in str(s.get("uses", "")).lower()
            ]
            self.assertGreater(
                len(checkout_steps),
                0,
                f"Job '{job_id}' has no checkout step — tests will run against an empty workspace",
            )


if __name__ == "__main__":
    unittest.main()
