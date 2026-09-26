"""
Tests for the DORA metrics CI workflow that gates pytest and promtool checks on every PR.

These tests verify that .github/workflows/metrics-ci.yaml exists and is correctly
configured to:
  - trigger on pull_request targeting main
  - run all four DORA pytest suites in metrics/tests/
  - validate /metrics Prometheus output with promtool check metrics
  - block merge on test failure or invalid Prometheus output
  - enforce least-privilege permissions (contents: read only)

All tests in this file FAIL until .github/workflows/metrics-ci.yaml is created
with the correct content (TDD red phase).
"""

import os
import unittest

import yaml

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORKFLOW_PATH = os.path.join(REPO_ROOT, ".github", "workflows", "metrics-ci.yaml")


# ---------------------------------------------------------------------------
# Shared helpers (identical pattern to test_ci_workflow.py)
# ---------------------------------------------------------------------------


def _load_workflow() -> dict:
    """Parse metrics-ci.yaml and return the document dict."""
    with open(WORKFLOW_PATH) as f:
        return yaml.safe_load(f)


def _get_triggers(doc: dict) -> dict:
    """
    Return the workflow trigger mapping, handling PyYAML's YAML 1.1 quirk
    where the bare `on:` key is parsed as the boolean True rather than the
    string 'on'.
    """
    return doc.get("on") or doc.get(True) or {}


def _collect_all_steps(doc: dict) -> list:
    """Return a flat list of every step across all jobs."""
    steps = []
    for job in doc.get("jobs", {}).values():
        steps.extend(job.get("steps", []))
    return steps


def _all_run_commands(doc: dict) -> str:
    """Return a single string with all 'run:' values across all jobs and steps."""
    return " ".join(str(s.get("run", "")) for s in _collect_all_steps(doc))


# ---------------------------------------------------------------------------
# File presence and parseability
# ---------------------------------------------------------------------------


class TestMetricsCIWorkflowFileExists(unittest.TestCase):
    """Sanity checks that the file is present and parseable."""

    def test_metrics_ci_yaml_exists_at_expected_path(self):
        """metrics-ci.yaml must exist at .github/workflows/metrics-ci.yaml."""
        self.assertTrue(
            os.path.isfile(WORKFLOW_PATH),
            ".github/workflows/metrics-ci.yaml is missing — the DORA metrics CI workflow "
            "has not been created yet",
        )

    def test_metrics_ci_yaml_is_valid_yaml_mapping(self):
        """metrics-ci.yaml must parse as a valid YAML mapping without syntax errors."""
        doc = _load_workflow()
        self.assertIsInstance(
            doc,
            dict,
            "metrics-ci.yaml did not parse as a YAML mapping — "
            "the file may contain syntax errors",
        )


# ---------------------------------------------------------------------------
# Triggers — PR gate
# ---------------------------------------------------------------------------


class TestMetricsCIWorkflowTriggers(unittest.TestCase):
    """Verify the workflow fires on pull_request to serve as a merge gate."""

    def setUp(self):
        self.doc = _load_workflow()
        self.triggers = _get_triggers(self.doc)

    def test_triggers_on_pull_request(self):
        """CI must fire on every pull_request so DORA metric tests block PRs."""
        self.assertIn(
            "pull_request",
            self.triggers,
            "metrics-ci.yaml is missing the 'pull_request' trigger — "
            "the DORA metric tests will not block PRs without it",
        )

    def test_pull_request_trigger_targets_main_branch(self):
        """
        The pull_request trigger must target main so the job blocks merges into main.
        If branches is specified and main is absent the gate won't run on the
        most critical PRs.
        """
        pr_trigger = self.triggers.get("pull_request") or {}
        if isinstance(pr_trigger, dict) and pr_trigger:
            branches = pr_trigger.get("branches", [])
            if branches:  # If branches is scoped, main must be included
                self.assertIn(
                    "main",
                    branches,
                    f"pull_request trigger branches {branches!r} does not include 'main' — "
                    "the DORA CI gate must block merges targeting main",
                )
        # An empty dict {} or None means 'all target branches' — that's acceptable

    def test_pull_request_trigger_is_not_scoped_to_paths_that_miss_metrics(self):
        """
        If the pull_request trigger has a paths filter it must include metrics/**
        so test-suite changes always trigger a re-run of the gate.
        A paths filter that omits metrics/ would skip the gate when test files change.
        """
        pr_trigger = self.triggers.get("pull_request") or {}
        if not isinstance(pr_trigger, dict):
            return  # No filter — fires on all PRs, which is fine
        paths = pr_trigger.get("paths", [])
        if not paths:
            return  # No path filter — fires on all PRs, fine
        # If there IS a paths filter it must cover metrics/
        covers_metrics = any(
            "metrics" in str(p) for p in paths
        )
        self.assertTrue(
            covers_metrics,
            f"pull_request trigger paths {paths!r} does not include 'metrics/**'. "
            "Changes to metrics/ source or tests must trigger this CI gate.",
        )


# ---------------------------------------------------------------------------
# Permissions — least privilege
# ---------------------------------------------------------------------------


class TestMetricsCIWorkflowPermissions(unittest.TestCase):
    """Verify the principle of least privilege: only contents: read is needed."""

    def setUp(self):
        self.doc = _load_workflow()

    def test_has_explicit_top_level_permissions_block(self):
        """
        An explicit permissions block must be present so the default
        (often too broad) GITHUB_TOKEN permissions are overridden.
        """
        self.assertIn(
            "permissions",
            self.doc,
            "metrics-ci.yaml is missing a top-level 'permissions' block — "
            "always declare permissions explicitly to enforce least privilege",
        )

    def test_permissions_contents_is_read(self):
        """permissions.contents must be 'read' — the job only reads code, never writes."""
        perms = self.doc.get("permissions", {})
        self.assertEqual(
            perms.get("contents"),
            "read",
            f"metrics-ci.yaml permissions.contents is {perms.get('contents')!r}, "
            "expected 'read'",
        )

    def test_permissions_grants_no_write_access(self):
        """No permission scope should be set to 'write' — this job is read-only."""
        perms = self.doc.get("permissions", {})
        if isinstance(perms, dict):
            write_grants = {k: v for k, v in perms.items() if v == "write"}
            self.assertEqual(
                write_grants,
                {},
                f"metrics-ci.yaml grants unnecessary write permissions: {write_grants!r}",
            )

    def test_permissions_grants_no_admin_access(self):
        """No permission scope should be set to 'admin'."""
        perms = self.doc.get("permissions", {})
        if isinstance(perms, dict):
            admin_grants = {k: v for k, v in perms.items() if v == "admin"}
            self.assertEqual(
                admin_grants,
                {},
                f"metrics-ci.yaml grants unexpected admin permissions: {admin_grants!r}",
            )


# ---------------------------------------------------------------------------
# Job structure
# ---------------------------------------------------------------------------


class TestMetricsCIWorkflowJobStructure(unittest.TestCase):
    """Verify the overall job configuration is sane."""

    def setUp(self):
        self.doc = _load_workflow()

    def test_workflow_has_at_least_one_job(self):
        """metrics-ci.yaml must define at least one job."""
        jobs = self.doc.get("jobs", {})
        self.assertGreater(
            len(jobs),
            0,
            "metrics-ci.yaml defines no jobs — the workflow will succeed vacuously",
        )

    def test_all_jobs_run_on_ubuntu(self):
        """All jobs must run on ubuntu-latest for consistency with the rest of the project."""
        jobs = self.doc.get("jobs", {})
        for job_id, job in jobs.items():
            runs_on = job.get("runs-on", "")
            self.assertIn(
                "ubuntu",
                str(runs_on).lower(),
                f"Job '{job_id}' does not run on ubuntu-latest (runs-on: {runs_on!r})",
            )

    def test_each_job_has_a_checkout_step(self):
        """Every job must check out the repository before running tests."""
        jobs = self.doc.get("jobs", {})
        for job_id, job in jobs.items():
            steps = job.get("steps", [])
            checkout_steps = [
                s for s in steps if "checkout" in str(s.get("uses", "")).lower()
            ]
            self.assertGreater(
                len(checkout_steps),
                0,
                f"Job '{job_id}' has no checkout step — "
                "tests will run against an empty workspace",
            )

    def test_workflow_name_indicates_metrics_or_dora_purpose(self):
        """
        The workflow name must clearly indicate its purpose so it is identifiable
        in the GitHub Actions status check list and in required status check config.
        """
        name = str(self.doc.get("name", "")).lower()
        has_descriptive_name = (
            "metric" in name
            or "dora" in name
            or "prometheus" in name
        )
        self.assertTrue(
            has_descriptive_name,
            f"Workflow name {self.doc.get('name', '')!r} does not clearly indicate its purpose. "
            "Include 'metrics', 'DORA', or 'prometheus' in the name so it is "
            "identifiable in the required status checks configuration.",
        )


# ---------------------------------------------------------------------------
# Python and dependency setup
# ---------------------------------------------------------------------------


class TestMetricsCIWorkflowPythonSetup(unittest.TestCase):
    """Verify Python is correctly set up for running pytest and the metrics service."""

    def setUp(self):
        self.doc = _load_workflow()
        self.all_steps = _collect_all_steps(self.doc)

    def test_has_step_setting_up_python(self):
        """A step must configure Python before running the metrics tests."""
        python_steps = [
            s for s in self.all_steps
            if "setup-python" in str(s.get("uses", "")).lower()
        ]
        self.assertGreater(
            len(python_steps),
            0,
            "metrics-ci.yaml has no Python setup step (actions/setup-python) — "
            "pytest cannot run without a Python interpreter configured",
        )

    def test_python_version_is_specified(self):
        """
        The Python setup step must specify a version so the environment is reproducible.
        Omitting the version risks using the runner default, which can change without notice.
        """
        python_steps = [
            s for s in self.all_steps
            if "setup-python" in str(s.get("uses", "")).lower()
        ]
        for step in python_steps:
            with_block = step.get("with") or {}
            python_version = with_block.get("python-version", "")
            self.assertTrue(
                python_version,
                f"Python setup step '{step.get('name', '<unnamed>')}' does not specify "
                "a python-version — pin a version for reproducibility (e.g. '3.12')",
            )

    def test_has_step_installing_metrics_dependencies(self):
        """
        A step must install the metrics package dependencies so pytest and the
        FastAPI app can be imported. The metrics/requirements.txt lists all needed
        packages (prometheus_client, fastapi, httpx, pytest, etc.).
        """
        install_steps = [
            s for s in self.all_steps
            if "pip install" in str(s.get("run", "")).lower()
            or "requirements" in str(s.get("run", "")).lower()
        ]
        self.assertGreater(
            len(install_steps),
            0,
            "metrics-ci.yaml has no pip install step — "
            "metrics tests cannot run without their dependencies",
        )

    def test_requirements_install_references_metrics_requirements_txt(self):
        """
        The pip install step must reference metrics/requirements.txt to install
        the correct pinned dependencies for the metrics service tests.
        A generic 'pip install pytest' is insufficient — it misses fastapi, httpx,
        prometheus_client, and the other test dependencies.
        """
        install_steps = [
            s for s in self.all_steps
            if "pip install" in str(s.get("run", "")).lower()
            and "requirements" in str(s.get("run", "")).lower()
        ]
        if install_steps:
            for step in install_steps:
                run_cmd = str(step.get("run", ""))
                if "metrics/requirements" in run_cmd or "metrics/requirements.txt" in run_cmd:
                    return  # Found a step referencing metrics/requirements.txt
            self.fail(
                "No pip install step references metrics/requirements.txt. "
                "The metrics tests require the dependencies listed in that file. "
                "Use: pip install -r metrics/requirements.txt",
            )


# ---------------------------------------------------------------------------
# pytest step — DORA test suites
# ---------------------------------------------------------------------------


class TestMetricsCIWorkflowPytestStep(unittest.TestCase):
    """Verify all DORA pytest suites run and failures block the PR."""

    def setUp(self):
        self.doc = _load_workflow()
        self.all_steps = _collect_all_steps(self.doc)

    def _find_pytest_steps(self) -> list:
        return [
            s for s in self.all_steps
            if "pytest" in str(s.get("run", ""))
        ]

    def test_has_step_running_pytest(self):
        """A step must invoke pytest to run the DORA metric test suites."""
        pytest_steps = self._find_pytest_steps()
        self.assertGreater(
            len(pytest_steps),
            0,
            "metrics-ci.yaml has no step running pytest — "
            "DORA test failures will not block the PR",
        )

    def test_pytest_targets_metrics_tests_directory(self):
        """
        The pytest step must target metrics/tests/ (or a superset) to run
        all DORA metric test suites. Running a subset of files risks missing
        regressions in uncovered handlers.
        """
        pytest_steps = self._find_pytest_steps()
        targets_metrics_tests = any(
            "metrics/tests" in str(s.get("run", ""))
            for s in pytest_steps
        )
        self.assertTrue(
            targets_metrics_tests,
            "No pytest step targets metrics/tests/ — "
            "all four DORA metric test suites must be covered by the CI gate. "
            "Use: pytest metrics/tests/",
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
                "DORA test failures must fail the job and block merge",
            )

    def test_pytest_step_does_not_suppress_exit_code(self):
        """
        The pytest command must not suppress exit codes (e.g., via '|| true').
        GitHub Actions uses the exit code to determine job success/failure.
        """
        for step in self._find_pytest_steps():
            run_cmd = str(step.get("run", ""))
            self.assertNotIn(
                "|| true",
                run_cmd,
                f"pytest step '{step.get('name', '<unnamed>')}' uses '|| true' which suppresses "
                "the exit code — test failures will not block the PR",
            )

    def test_pytest_step_has_no_branch_scoped_if_condition(self):
        """
        The pytest step must not use an `if` condition that skips it on
        PRs targeting non-main branches or feature branches.
        """
        for step in self._find_pytest_steps():
            condition = step.get("if", "")
            self.assertNotIn(
                "github.ref",
                str(condition),
                f"pytest step has a branch-scoped 'if' condition: {condition!r} — "
                "the test gate must run on every qualifying PR regardless of branch",
            )

    def test_pytest_covers_event_handlers(self):
        """
        The pytest invocation must cover test_event_handlers.py which tests the
        core DORA event processing logic (push, pull_request, deployment_status handlers).
        These handlers are the heart of DORA metric collection.
        """
        pytest_steps = self._find_pytest_steps()
        covers_handlers = any(
            "metrics/tests" in str(s.get("run", ""))
            or "test_event_handlers" in str(s.get("run", ""))
            for s in pytest_steps
        )
        self.assertTrue(
            covers_handlers,
            "pytest step does not appear to cover test_event_handlers.py. "
            "Run 'pytest metrics/tests/' to include all DORA handler tests.",
        )

    def test_pytest_covers_fastapi_routes(self):
        """
        The pytest invocation must cover test_fastapi_routes.py which validates
        that the /webhook and /metrics and /healthz endpoints behave correctly.
        """
        pytest_steps = self._find_pytest_steps()
        covers_routes = any(
            "metrics/tests" in str(s.get("run", ""))
            or "test_fastapi_routes" in str(s.get("run", ""))
            or "test_fastapi_webhook" in str(s.get("run", ""))
            for s in pytest_steps
        )
        self.assertTrue(
            covers_routes,
            "pytest step does not appear to cover FastAPI route tests. "
            "Run 'pytest metrics/tests/' to include test_fastapi_routes.py and "
            "test_fastapi_webhook_dispatch.py.",
        )

    def test_pytest_covers_metrics_endpoint(self):
        """
        The pytest invocation must cover test_metrics_endpoint.py which validates
        the /metrics endpoint produces Prometheus exposition format output.
        This is complementary to the promtool check — it validates the endpoint
        responds correctly, while promtool validates the format.
        """
        pytest_steps = self._find_pytest_steps()
        covers_metrics_endpoint = any(
            "metrics/tests" in str(s.get("run", ""))
            or "test_metrics_endpoint" in str(s.get("run", ""))
            for s in pytest_steps
        )
        self.assertTrue(
            covers_metrics_endpoint,
            "pytest step does not appear to cover test_metrics_endpoint.py. "
            "Run 'pytest metrics/tests/' to include the metrics endpoint tests.",
        )


# ---------------------------------------------------------------------------
# promtool step — Prometheus format validation
# ---------------------------------------------------------------------------


class TestMetricsCIWorkflowPromtoolStep(unittest.TestCase):
    """Verify promtool check metrics validates /metrics output and blocks on failure."""

    def setUp(self):
        self.doc = _load_workflow()
        self.all_steps = _collect_all_steps(self.doc)

    def _find_promtool_check_steps(self) -> list:
        return [
            s for s in self.all_steps
            if "promtool" in str(s.get("run", "")).lower()
            and "check" in str(s.get("run", "")).lower()
            and "metrics" in str(s.get("run", "")).lower()
        ]

    def _find_all_promtool_steps(self) -> list:
        return [
            s for s in self.all_steps
            if "promtool" in str(s.get("run", "")).lower()
        ]

    def test_has_step_running_promtool_check_metrics(self):
        """
        A step must run 'promtool check metrics' to validate that the /metrics
        endpoint produces valid Prometheus exposition format output.
        Invalid metric names, help strings, or type annotations would cause this to fail.
        """
        check_steps = self._find_promtool_check_steps()
        self.assertGreater(
            len(check_steps),
            0,
            "metrics-ci.yaml has no step running 'promtool check metrics' — "
            "invalid Prometheus output will not be detected before merge",
        )

    def test_promtool_check_step_does_not_have_continue_on_error(self):
        """
        The promtool check step must NOT set continue-on-error: true — invalid
        Prometheus output must block the PR, not be silently ignored.
        """
        for step in self._find_promtool_check_steps():
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"promtool step '{step.get('name', '<unnamed>')}' has continue-on-error: true — "
                "Prometheus format violations must fail the job",
            )

    def test_promtool_check_metrics_receives_metrics_output(self):
        """
        The 'promtool check metrics' command must receive actual metrics output
        via stdin (pipe from curl/server) or a file redirect.
        Running 'promtool check metrics' with no input reads from stdin and
        blocks indefinitely — the command must have data to validate.
        """
        check_steps = self._find_promtool_check_steps()
        for step in check_steps:
            run_cmd = str(step.get("run", ""))
            has_input = (
                "|" in run_cmd       # piped from curl or server stdout
                or "<" in run_cmd    # redirected from file
                or "$(cat" in run_cmd  # command substitution from file
            )
            self.assertTrue(
                has_input,
                f"promtool check metrics step does not pipe or redirect metrics output. "
                f"Command: {run_cmd!r}. "
                "Feed the /metrics endpoint output to promtool via pipe: "
                "curl -sf http://localhost:8000/metrics | promtool check metrics",
            )

    def test_promtool_check_step_does_not_suppress_exit_code(self):
        """
        The promtool command must not suppress exit codes (e.g., via '|| true').
        A non-zero exit from promtool must propagate to fail the job.
        """
        for step in self._find_promtool_check_steps():
            run_cmd = str(step.get("run", ""))
            self.assertNotIn(
                "|| true",
                run_cmd,
                f"promtool step '{step.get('name', '<unnamed>')}' uses '|| true' which suppresses "
                "the exit code — invalid Prometheus output will not block the PR",
            )

    def test_promtool_is_installed_before_use(self):
        """
        promtool is not pre-installed on ubuntu-latest runners.
        The workflow must install prometheus (which ships promtool) before
        the validation step. Acceptable methods: apt, wget, curl, snap.
        """
        all_runs = _all_run_commands(self.doc)
        all_uses = " ".join(str(s.get("uses", "")) for s in self.all_steps)

        promtool_available = (
            # Installed via apt
            ("apt" in all_runs and "prometheus" in all_runs)
            # Downloaded from GitHub releases
            or ("wget" in all_runs and "prometheus" in all_runs)
            or ("curl" in all_runs and "prometheus" in all_runs.replace("promtool", ""))
            # Snap
            or ("snap" in all_runs and "prometheus" in all_runs)
            # Direct promtool binary fetch
            or ("promtool" in all_runs and any(
                kw in all_runs for kw in ("wget", "apt-get", "snap install", "brew")
            ))
        )
        self.assertTrue(
            promtool_available,
            "metrics-ci.yaml does not install promtool before using it. "
            "promtool is not pre-installed on ubuntu-latest. "
            "Add a step to install prometheus via apt-get, wget from GitHub releases, "
            "or snap before the 'promtool check metrics' step.",
        )

    def test_metrics_server_is_started_before_promtool_check(self):
        """
        The FastAPI metrics server must be running when promtool hits /metrics.
        A step starting the server (uvicorn or similar) must appear before the
        promtool check step in the job, or the check must use a pre-generated
        metrics output file rather than a live HTTP request.
        """
        all_runs = _all_run_commands(self.doc)
        has_server_start_or_file = (
            "uvicorn" in all_runs
            or "python" in all_runs  # python -m pytest may start fixtures
            or "curl" in all_runs    # curl hitting a running server
            or "<" in all_runs       # reading from a pre-generated file
        )
        self.assertTrue(
            has_server_start_or_file,
            "metrics-ci.yaml has no apparent mechanism to provide metrics output "
            "for promtool validation. Either start the metrics server "
            "(e.g., uvicorn metrics.src.main:app --port 8000 &) and curl its "
            "/metrics endpoint, or generate a metrics file and feed it via stdin.",
        )


# ---------------------------------------------------------------------------
# Holistic merge-blocking behaviour
# ---------------------------------------------------------------------------


class TestMetricsCIWorkflowBlocksMerge(unittest.TestCase):
    """
    Integration-level checks that the workflow can structurally block a PR merge.
    A workflow that fires but swallows failures still does not block a merge.
    """

    def setUp(self):
        self.doc = _load_workflow()
        self.triggers = _get_triggers(self.doc)
        self.all_steps = _collect_all_steps(self.doc)

    def test_pull_request_trigger_present_to_enable_merge_blocking(self):
        """
        Only jobs triggered by pull_request can block a merge via required status checks.
        Without this trigger the workflow cannot serve as a required check.
        """
        self.assertIn(
            "pull_request",
            self.triggers,
            "metrics-ci.yaml is missing the 'pull_request' trigger. "
            "Without it the workflow cannot be configured as a required status check "
            "and will not block PR merges.",
        )

    def test_workflow_has_both_pytest_and_promtool_coverage(self):
        """
        Both pytest AND promtool must be present in the workflow.
        pytest validates DORA test logic; promtool validates Prometheus format.
        Missing either leaves a gap in the acceptance criteria.
        """
        has_pytest = any(
            "pytest" in str(s.get("run", "")) for s in self.all_steps
        )
        has_promtool = any(
            "promtool" in str(s.get("run", "")).lower() for s in self.all_steps
        )
        self.assertTrue(
            has_pytest,
            "metrics-ci.yaml is missing a pytest step — "
            "DORA metric test suites will not run as part of the merge gate",
        )
        self.assertTrue(
            has_promtool,
            "metrics-ci.yaml is missing a promtool step — "
            "Prometheus metric format validation will not block invalid output",
        )

    def test_no_critical_step_has_continue_on_error(self):
        """
        Neither the pytest step nor the promtool step may use continue-on-error: true.
        These steps ARE the merge gate — swallowing their failures defeats the purpose.
        """
        critical_keywords = ["pytest", "promtool"]
        for step in self.all_steps:
            run_cmd = str(step.get("run", "")).lower()
            is_critical = any(kw in run_cmd for kw in critical_keywords)
            if is_critical and step.get("continue-on-error") is True:
                self.fail(
                    f"Critical step '{step.get('name', '<unnamed>')}' has "
                    "continue-on-error: true. "
                    "This step is part of the merge gate and must propagate failures.",
                )

    def test_workflow_does_not_use_workflow_dispatch_as_only_trigger(self):
        """
        The workflow must not rely on workflow_dispatch as its sole trigger.
        A manual-only workflow cannot block automated PR merges.
        """
        has_pull_request = "pull_request" in self.triggers
        self.assertTrue(
            has_pull_request,
            "metrics-ci.yaml appears to use only workflow_dispatch or push as triggers "
            "and lacks 'pull_request'. It cannot block PR merges without that trigger.",
        )


if __name__ == "__main__":
    unittest.main()
