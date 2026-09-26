"""
Tests for the metrics-docker GitHub Actions CI workflow.

Validates that .github/workflows/metrics-docker.yaml:
  - Exists and is valid YAML
  - Triggers on pull_request scoped to metrics/** paths
  - Runs the metrics unit test suite (currently absent from CI)
  - Builds the Docker image
  - Runs the integration test suite against the compose stack
  - Enforces a 200 MB image size gate that actively fails the job
  - Declares explicit least-privilege permissions
  - Follows standard job hygiene (checkout step, ubuntu runner)

All tests in this file FAIL until .github/workflows/metrics-docker.yaml is
created with the correct content (TDD red phase).
"""

import os
import unittest

import yaml


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORKFLOW_PATH = os.path.join(
    REPO_ROOT, ".github", "workflows", "metrics-docker.yaml"
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_workflow() -> dict:
    """Parse metrics-docker.yaml and return the document dict."""
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


def _find_job(doc: dict, job_id: str) -> dict | None:
    """Return a job dict by exact job id, or None if not found."""
    return doc.get("jobs", {}).get(job_id)


def _all_run_commands(doc: dict) -> str:
    """Return a single string with all 'run:' values across all jobs and steps."""
    return " ".join(str(s.get("run", "")) for s in _collect_all_steps(doc))


def _steps_containing(doc: dict, *keywords: str) -> list:
    """Return steps where any keyword appears in the step's 'run' or 'name'."""
    result = []
    for step in _collect_all_steps(doc):
        text = str(step.get("run", "")) + " " + str(step.get("name", ""))
        if any(kw.lower() in text.lower() for kw in keywords):
            result.append(step)
    return result


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------


class TestMetricsDockerWorkflowFileExists(unittest.TestCase):
    """Sanity checks that the file is present and parseable."""

    def test_workflow_yaml_exists_at_expected_path(self):
        """metrics-docker.yaml must exist at .github/workflows/metrics-docker.yaml."""
        self.assertTrue(
            os.path.isfile(WORKFLOW_PATH),
            ".github/workflows/metrics-docker.yaml is missing — "
            "the metrics Docker CI workflow has not been created",
        )

    def test_workflow_yaml_is_valid_yaml_mapping(self):
        """metrics-docker.yaml must parse as a valid YAML mapping without syntax errors."""
        doc = _load_workflow()
        self.assertIsInstance(
            doc,
            dict,
            "metrics-docker.yaml did not parse as a YAML mapping — "
            "the file may contain syntax errors",
        )

    def test_workflow_has_a_name(self):
        """Workflow must declare a human-readable name for GitHub UI display."""
        doc = _load_workflow()
        name = doc.get("name", "")
        self.assertTrue(
            name,
            "metrics-docker.yaml has no 'name:' field — add a descriptive workflow name",
        )


class TestMetricsDockerWorkflowTriggers(unittest.TestCase):
    """Verify the workflow fires at the right times and only for metrics/ changes."""

    def setUp(self):
        self.doc = _load_workflow()
        self.triggers = _get_triggers(self.doc)

    def test_triggers_on_pull_request(self):
        """Workflow must fire on pull_request so Docker checks run before merge."""
        self.assertIn(
            "pull_request",
            self.triggers,
            "metrics-docker.yaml is missing the 'pull_request' trigger — "
            "the Docker CI checks will not run on PRs",
        )

    def test_pull_request_trigger_is_scoped_to_metrics_paths(self):
        """
        The pull_request trigger must restrict to paths matching metrics/**
        so the workflow only fires when metrics files are changed.
        """
        pr_trigger = self.triggers.get("pull_request") or {}
        if not isinstance(pr_trigger, dict):
            self.fail(
                "pull_request trigger is not a mapping — cannot verify path filter. "
                "Add 'paths: [\"metrics/**\"]' to the trigger."
            )
        paths = pr_trigger.get("paths", [])
        has_metrics_path = any("metrics" in str(p) for p in paths)
        self.assertTrue(
            has_metrics_path,
            f"pull_request trigger paths {paths!r} does not include a 'metrics/**' filter. "
            "The workflow must only run when metrics/ files are modified.",
        )

    def test_pull_request_path_filter_uses_glob_pattern(self):
        """
        The metrics path filter must use a glob pattern (metrics/**) to cover
        all files under metrics/, not just metrics/ root files.
        """
        pr_trigger = self.triggers.get("pull_request") or {}
        if not isinstance(pr_trigger, dict):
            return  # caught by previous test
        paths = pr_trigger.get("paths", [])
        deep_metrics_filter = any(
            str(p).startswith("metrics/") and "**" in str(p)
            for p in paths
        )
        self.assertTrue(
            deep_metrics_filter,
            f"pull_request trigger paths {paths!r} should use 'metrics/**' to cover "
            "subdirectories. A shallow filter risks missing nested file changes.",
        )


class TestMetricsDockerWorkflowPermissions(unittest.TestCase):
    """Workflow must declare explicit least-privilege permissions."""

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
            "metrics-docker.yaml is missing a top-level 'permissions' block — "
            "always declare permissions explicitly to enforce least privilege",
        )

    def test_permissions_contents_is_read(self):
        """permissions.contents must be 'read' — the job only reads code, never writes."""
        perms = self.doc.get("permissions", {})
        self.assertEqual(
            perms.get("contents"),
            "read",
            f"metrics-docker.yaml permissions.contents is {perms.get('contents')!r}, "
            "expected 'read'",
        )

    def test_permissions_grants_no_unexpected_write_access(self):
        """
        Only 'packages: write' (needed for docker push) is permitted as a write
        scope — no other write grants should exist.
        """
        perms = self.doc.get("permissions", {})
        if not isinstance(perms, dict):
            return
        disallowed_write = {
            k: v
            for k, v in perms.items()
            if v == "write" and k not in ("packages",)
        }
        self.assertEqual(
            disallowed_write,
            {},
            f"metrics-docker.yaml grants unexpected write permissions: {disallowed_write!r}",
        )


class TestMetricsDockerWorkflowJobStructure(unittest.TestCase):
    """Verify overall job configuration hygiene."""

    def setUp(self):
        self.doc = _load_workflow()

    def test_workflow_has_at_least_one_job(self):
        """metrics-docker.yaml must define at least one job."""
        jobs = self.doc.get("jobs", {})
        self.assertGreater(
            len(jobs),
            0,
            "metrics-docker.yaml defines no jobs — the workflow will succeed vacuously",
        )

    def test_all_jobs_run_on_ubuntu(self):
        """
        All jobs should run on ubuntu-latest for consistency with the rest
        of the project's workflows.
        """
        for job_id, job in self.doc.get("jobs", {}).items():
            runs_on = job.get("runs-on", "")
            self.assertIn(
                "ubuntu",
                str(runs_on).lower(),
                f"Job '{job_id}' does not run on ubuntu-latest "
                f"(runs-on: {runs_on!r})",
            )

    def test_each_job_has_a_checkout_step(self):
        """Every job must check out the repository before running any steps."""
        for job_id, job in self.doc.get("jobs", {}).items():
            steps = job.get("steps", [])
            checkout_steps = [
                s for s in steps if "checkout" in str(s.get("uses", "")).lower()
            ]
            self.assertGreater(
                len(checkout_steps),
                0,
                f"Job '{job_id}' has no checkout step — "
                "steps will run against an empty workspace",
            )


class TestMetricsUnitTestsInCI(unittest.TestCase):
    """
    The unit test suite under metrics/tests/ must be run in CI.
    Currently it is absent from all workflows — this job/step adds it.
    """

    def setUp(self):
        self.doc = _load_workflow()
        self.all_steps = _collect_all_steps(self.doc)

    def test_workflow_has_a_step_running_pytest(self):
        """A step must invoke pytest to run the metrics unit test suite."""
        pytest_steps = [
            s for s in self.all_steps
            if "pytest" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(pytest_steps),
            0,
            "metrics-docker.yaml has no step running pytest — "
            "the metrics unit test suite will not run in CI",
        )

    def test_pytest_step_targets_metrics_tests_directory(self):
        """
        The pytest invocation must target the metrics/tests/ directory (or a
        sub-path thereof) to run the metrics unit tests specifically.
        """
        pytest_steps = [
            s for s in self.all_steps
            if "pytest" in str(s.get("run", ""))
        ]
        metrics_test_steps = [
            s for s in pytest_steps
            if "metrics" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(metrics_test_steps),
            0,
            "No pytest step references the metrics/ directory. "
            "The step must run 'pytest metrics/tests/' (or equivalent) to target "
            "the metrics unit test suite.",
        )

    def test_pytest_step_does_not_have_continue_on_error(self):
        """
        The pytest step must NOT set continue-on-error: true — a test failure
        must block the PR, not be silently swallowed.
        """
        pytest_steps = [
            s for s in self.all_steps
            if "pytest" in str(s.get("run", ""))
            and "metrics" in str(s.get("run", ""))
        ]
        for step in pytest_steps:
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"pytest step '{step.get('name', '<unnamed>')}' has "
                "continue-on-error: true — test failures must fail the job",
            )

    def test_pytest_unit_test_step_does_not_require_database(self):
        """
        Unit tests must not require TEST_DATABASE_URL — they use InMemoryEventStore
        and must pass without a live database in the basic CI job.
        The integration tests (compose stack) may set it, but unit tests must not.
        """
        pytest_steps = [
            s for s in self.all_steps
            if "pytest" in str(s.get("run", ""))
            and "metrics" in str(s.get("run", ""))
        ]
        # If there are multiple pytest steps, at least one must omit TEST_DATABASE_URL
        # so unit tests run without a database dependency.
        steps_without_db = [
            s for s in pytest_steps
            if "TEST_DATABASE_URL" not in str(s.get("run", ""))
            and "TEST_DATABASE_URL" not in str(s.get("env", {}))
        ]
        self.assertGreater(
            len(steps_without_db),
            0,
            "All pytest steps set TEST_DATABASE_URL. "
            "At least one pytest step must run without it so unit tests "
            "(which use InMemoryEventStore) run in CI without a live database.",
        )


class TestDockerBuildStep(unittest.TestCase):
    """Workflow must build the Docker image from metrics/Dockerfile."""

    def setUp(self):
        self.doc = _load_workflow()
        self.all_steps = _collect_all_steps(self.doc)

    def test_workflow_has_a_docker_build_step(self):
        """A step must run 'docker build' (or equivalent) to build the metrics image."""
        build_steps = [
            s for s in self.all_steps
            if "docker build" in str(s.get("run", "")).lower()
            or "docker buildx build" in str(s.get("run", "")).lower()
        ]
        self.assertGreater(
            len(build_steps),
            0,
            "metrics-docker.yaml has no 'docker build' step — "
            "the Docker image will never be built",
        )

    def test_docker_build_targets_metrics_directory(self):
        """
        The docker build command must reference the metrics/ directory as the
        build context so it uses the metrics/Dockerfile.
        """
        build_steps = [
            s for s in self.all_steps
            if "docker build" in str(s.get("run", "")).lower()
        ]
        metrics_build_steps = [
            s for s in build_steps
            if "metrics" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(metrics_build_steps),
            0,
            "docker build step does not reference the metrics/ directory. "
            "Use 'docker build metrics/' or 'docker build -f metrics/Dockerfile metrics/' "
            "to build from the correct context.",
        )

    def test_docker_build_step_does_not_have_continue_on_error(self):
        """A failed build must fail the job — not be silently swallowed."""
        build_steps = [
            s for s in self.all_steps
            if "docker build" in str(s.get("run", "")).lower()
        ]
        for step in build_steps:
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"docker build step '{step.get('name', '<unnamed>')}' has "
                "continue-on-error: true — a build failure must fail the job",
            )


class TestIntegrationTestStep(unittest.TestCase):
    """
    Workflow must run the integration test suite against the compose stack
    so end-to-end behaviour (FastAPI + PostgreSQL) is verified in CI.
    """

    def setUp(self):
        self.doc = _load_workflow()
        self.all_steps = _collect_all_steps(self.doc)
        self.all_runs = _all_run_commands(self.doc)

    def test_workflow_starts_compose_stack(self):
        """
        A step must bring up the docker-compose stack so PostgreSQL is
        available for integration tests.
        """
        compose_steps = [
            s for s in self.all_steps
            if any(
                kw in str(s.get("run", "")).lower()
                for kw in ("docker-compose up", "docker compose up", "compose up")
            )
        ]
        self.assertGreater(
            len(compose_steps),
            0,
            "metrics-docker.yaml has no 'docker-compose up' step — "
            "the compose stack will not start and integration tests will fail",
        )

    def test_workflow_runs_integration_tests_with_database_url(self):
        """
        The integration test run must supply TEST_DATABASE_URL so pytest
        fixtures connect to the Postgres container in the compose stack.
        """
        pytest_steps = [
            s for s in self.all_steps
            if "pytest" in str(s.get("run", ""))
            and "metrics" in str(s.get("run", ""))
        ]
        db_test_steps = [
            s for s in pytest_steps
            if "TEST_DATABASE_URL" in str(s.get("run", ""))
            or "TEST_DATABASE_URL" in str(s.get("env", {}))
        ]
        self.assertGreater(
            len(db_test_steps),
            0,
            "No pytest step supplies TEST_DATABASE_URL for integration tests. "
            "At least one pytest run must pass TEST_DATABASE_URL so the "
            "PostgreSQL integration tests execute against the compose stack.",
        )

    def test_integration_test_step_does_not_have_continue_on_error(self):
        """Integration test failures must fail the job — not be silently swallowed."""
        pytest_steps = [
            s for s in self.all_steps
            if "pytest" in str(s.get("run", ""))
            and "TEST_DATABASE_URL" in str(s.get("run", ""))
            or "TEST_DATABASE_URL" in str(s.get("env", {}))
        ]
        for step in pytest_steps:
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"Integration test step '{step.get('name', '<unnamed>')}' has "
                "continue-on-error: true — integration test failures must fail the job",
            )


class TestImageSizeGate(unittest.TestCase):
    """
    The workflow must enforce a hard 200 MB limit on the built Docker image.
    The gate step must fail the job (not just warn) when the limit is exceeded.
    """

    def setUp(self):
        self.doc = _load_workflow()
        self.all_steps = _collect_all_steps(self.doc)
        self.all_runs = _all_run_commands(self.doc)

    def test_workflow_has_an_image_size_check_step(self):
        """
        A step must inspect the built image size and compare it against the
        200 MB threshold.
        """
        size_steps = _steps_containing(
            self.doc, "size", "200", "mb", "megabyte", "image inspect"
        )
        self.assertGreater(
            len(size_steps),
            0,
            "metrics-docker.yaml has no image size check step. "
            "Add a step that inspects the image size and fails if it exceeds 200 MB.",
        )

    def test_size_gate_references_200mb_limit(self):
        """
        The size gate must explicitly reference the 200 MB threshold — either
        as 200 (MB), 209715200 (bytes), or an equivalent expression.
        """
        has_200_reference = (
            "200" in self.all_runs
            or "209715200" in self.all_runs
            or "200mb" in self.all_runs.lower()
            or "200 mb" in self.all_runs.lower()
        )
        self.assertTrue(
            has_200_reference,
            "Image size gate does not reference the 200 MB limit anywhere in 'run:' steps. "
            "The gate must compare against 200 MB (200 * 1024 * 1024 bytes = 209715200).",
        )

    def test_size_gate_uses_docker_inspect_or_equivalent_to_measure_size(self):
        """
        The size gate must use 'docker image inspect', 'docker inspect', or
        'docker images' to programmatically read the image size — not a
        human-readable guess.
        """
        size_commands = (
            "docker image inspect" in self.all_runs
            or "docker inspect" in self.all_runs
            or "docker images" in self.all_runs
            or ".Size" in self.all_runs
        )
        self.assertTrue(
            size_commands,
            "Image size gate does not use docker inspect/images to measure size. "
            "Use 'docker image inspect <image> --format={{.Size}}' to get the "
            "exact byte count for comparison.",
        )

    def test_size_gate_fails_ci_explicitly_on_oversize_image(self):
        """
        The gate must use 'exit 1' (or equivalent) to fail the CI job when the
        image exceeds 200 MB.  A warning-only check silently lets bloated
        images through.
        """
        has_explicit_failure = (
            "exit 1" in self.all_runs
            or "exit(1)" in self.all_runs
        )
        self.assertTrue(
            has_explicit_failure,
            "Image size gate does not explicitly fail via 'exit 1'. "
            "A warning-only check is insufficient — the job must fail when "
            "the image exceeds 200 MB so the PR is blocked.",
        )

    def test_size_gate_step_does_not_have_continue_on_error(self):
        """
        The size gate step must NOT set continue-on-error: true — that would
        allow an oversized image to silently pass.
        """
        size_steps = _steps_containing(
            self.doc, "size", "200", "mb", "image inspect"
        )
        for step in size_steps:
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"Size gate step '{step.get('name', '<unnamed>')}' has "
                "continue-on-error: true — the gate must actually block the PR",
            )

    def test_size_gate_runs_after_docker_build(self):
        """
        The size gate must come after the docker build step in the same job
        (or in a downstream job) — measuring a non-existent image is meaningless.
        """
        for job in self.doc.get("jobs", {}).values():
            steps = job.get("steps", [])
            step_runs = [str(s.get("run", "")) for s in steps]

            build_idx = next(
                (i for i, r in enumerate(step_runs) if "docker build" in r.lower()),
                None,
            )
            size_idx = next(
                (
                    i for i, r in enumerate(step_runs)
                    if any(kw in r for kw in ("200", "docker inspect", ".Size", "exit 1"))
                ),
                None,
            )

            if build_idx is not None and size_idx is not None:
                self.assertGreater(
                    size_idx,
                    build_idx,
                    "Image size gate step appears BEFORE the docker build step in the same job. "
                    "The size check must come after the image is built.",
                )


class TestNoAutoApproveEquivalent(unittest.TestCase):
    """Guard against steps that bypass failures with unsafe flags."""

    def setUp(self):
        self.doc = _load_workflow()

    def test_no_step_ignores_docker_build_errors(self):
        """
        No step must pipe docker build through '|| true' or '|| :' which would
        swallow build failures and allow the workflow to succeed on a broken image.
        """
        all_runs = _all_run_commands(self.doc)
        swallowing_patterns = ("|| true", "|| :", "2>/dev/null")
        for pattern in swallowing_patterns:
            if "docker build" in all_runs and pattern in all_runs:
                # Only fail if the pattern appears on the same conceptual line as docker build
                for line in all_runs.splitlines():
                    if "docker build" in line and pattern in line:
                        self.fail(
                            f"docker build command contains error-swallowing pattern "
                            f"{pattern!r}: {line!r}. "
                            "Build failures must propagate as job failures.",
                        )


if __name__ == "__main__":
    unittest.main()
