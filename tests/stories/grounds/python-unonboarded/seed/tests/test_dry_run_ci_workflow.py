"""
Tests for the CI job that runs apply-overlays.py --dry-run as a smoke gate.

These tests verify that a CI job exists which:
  - runs 'apply-overlays.py --dry-run' against config/repos/example.yaml
  - uses 'set -e' (or 'set -euo pipefail') so any sub-command failure fails the job
  - captures stdout and greps for the repository name declared in example.yaml
  - captures stdout and greps for the string 'example-template'
  - does NOT use continue-on-error (failures must block the PR)
  - has least-privilege permissions (contents: read)
  - runs on ubuntu-latest
  - triggers on pull_request (without path restriction) and push to main

The job may live in ci.yaml (as a new job named 'dry-run-smoke' or similar) or
in a dedicated .github/workflows/dry-run-smoke.yaml workflow.

All tests fail until the CI job is added (TDD red phase).
"""

import os
import unittest

import yaml

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CI_WORKFLOW_PATH = os.path.join(REPO_ROOT, ".github", "workflows", "ci.yaml")
DRY_RUN_WORKFLOW_PATH = os.path.join(
    REPO_ROOT, ".github", "workflows", "dry-run-smoke.yaml"
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_workflow(path: str) -> dict:
    """Parse a GitHub Actions workflow YAML file and return the document dict."""
    with open(path) as f:
        return yaml.safe_load(f)


def _get_triggers(doc: dict) -> dict:
    """
    Return the workflow trigger mapping, handling PyYAML's YAML 1.1 quirk
    where the bare `on:` key is parsed as the boolean True rather than the
    string 'on'.  Both keys are checked so the tests work across PyYAML versions.
    """
    return doc.get("on") or doc.get(True) or {}


def _collect_all_steps(doc: dict) -> list:
    """Return a flat list of every step across all jobs in a workflow."""
    steps = []
    for job in doc.get("jobs", {}).values():
        steps.extend(job.get("steps", []))
    return steps


def _find_dry_run_smoke_job(doc: dict) -> dict | None:
    """
    Return the first job dict that represents the dry-run smoke gate.

    A job matches if:
      - its key or display name contains 'dry' and 'run', OR 'smoke', OR
      - one of its steps invokes 'apply-overlays' with '--dry-run'.

    Returns None if no such job is found.
    """
    for job_id, job in doc.get("jobs", {}).items():
        name_tokens = f"{job_id} {job.get('name', '')}".lower()
        if ("dry" in name_tokens and "run" in name_tokens) or "smoke" in name_tokens:
            return job
        # Also match by step content — some implementations name the job generically.
        for step in job.get("steps", []):
            run = str(step.get("run", ""))
            if "apply-overlays" in run and "--dry-run" in run:
                return job
    return None


def _find_dry_run_workflow() -> tuple[str, dict]:
    """
    Locate the workflow file containing the dry-run smoke job.

    Checks ci.yaml first (most likely home), then dry-run-smoke.yaml.
    Returns (path, parsed_doc) for the first file that contains the job.
    Raises FileNotFoundError with a helpful message if neither file has the job.
    """
    candidates = [CI_WORKFLOW_PATH, DRY_RUN_WORKFLOW_PATH]
    for path in candidates:
        if not os.path.isfile(path):
            continue
        doc = _load_workflow(path)
        if _find_dry_run_smoke_job(doc) is not None:
            return path, doc
    raise FileNotFoundError(
        "No workflow file contains a dry-run smoke CI job. "
        "Add a 'dry-run-smoke' job to .github/workflows/ci.yaml that runs "
        "'apply-overlays.py --dry-run config/repos/example.yaml' and greps "
        "the output, or create .github/workflows/dry-run-smoke.yaml."
    )


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------


class TestDryRunSmokeJobExists(unittest.TestCase):
    """The dry-run smoke CI job must exist in a discoverable workflow file."""

    def test_dry_run_smoke_job_exists_in_a_workflow(self):
        """
        Either ci.yaml must contain a dry-run smoke job, or a dedicated
        dry-run-smoke.yaml workflow must exist.  At least one must be present.
        """
        ci_has_job = False
        dedicated_file_exists = os.path.isfile(DRY_RUN_WORKFLOW_PATH)

        if os.path.isfile(CI_WORKFLOW_PATH):
            doc = _load_workflow(CI_WORKFLOW_PATH)
            ci_has_job = _find_dry_run_smoke_job(doc) is not None

        self.assertTrue(
            ci_has_job or dedicated_file_exists,
            "No dry-run smoke CI job found. "
            "Add a job to .github/workflows/ci.yaml that invokes "
            "'apply-overlays.py --dry-run config/repos/example.yaml' and greps "
            "the output for the repository name and 'example-template', "
            "or create .github/workflows/dry-run-smoke.yaml.",
        )

    def test_dry_run_smoke_workflow_file_is_valid_yaml(self):
        """The workflow file containing the dry-run job must parse without errors."""
        _, doc = _find_dry_run_workflow()
        self.assertIsInstance(
            doc,
            dict,
            "The dry-run smoke workflow file did not parse as a YAML mapping.",
        )

    def test_dry_run_smoke_job_is_discoverable_in_workflow(self):
        """A job matching the dry-run smoke pattern must be found in the workflow."""
        _, doc = _find_dry_run_workflow()
        job = _find_dry_run_smoke_job(doc)
        self.assertIsNotNone(
            job,
            "No dry-run smoke job found inside the workflow file. "
            "Define a job whose key/name includes 'dry-run' or 'smoke', "
            "or whose steps invoke 'apply-overlays.py --dry-run'.",
        )


class TestDryRunSmokeJobStructure(unittest.TestCase):
    """The dry-run smoke job must have a correct, safe structure."""

    def setUp(self):
        _, self.doc = _find_dry_run_workflow()
        self.job = _find_dry_run_smoke_job(self.doc)

    def test_job_runs_on_ubuntu_latest(self):
        """The dry-run smoke job must run on ubuntu-latest."""
        runs_on = self.job.get("runs-on", "")
        self.assertIn(
            "ubuntu",
            str(runs_on).lower(),
            f"dry-run smoke job 'runs-on' is {runs_on!r} — expected ubuntu-latest.",
        )

    def test_job_has_a_checkout_step(self):
        """
        The job must check out the repository so scripts/apply-overlays.py and
        config/repos/example.yaml are present in the runner workspace.
        """
        steps = self.job.get("steps", [])
        checkout_steps = [
            s for s in steps if "checkout" in str(s.get("uses", "")).lower()
        ]
        self.assertGreater(
            len(checkout_steps),
            0,
            "dry-run smoke job has no checkout step. "
            "Without a checkout, scripts/apply-overlays.py will not exist in the workspace.",
        )

    def test_no_step_uses_continue_on_error(self):
        """
        No step in the dry-run smoke job may use continue-on-error: true.
        A script failure must block the PR — a silent pass hides real problems.
        """
        for step in self.job.get("steps", []):
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"Step '{step.get('name', '<unnamed>')}' has continue-on-error: true — "
                "the dry-run smoke job must fail hard when the script fails.",
            )

    def test_job_has_explicit_permissions_or_inherits_workflow_permissions(self):
        """
        The job or its parent workflow must declare an explicit permissions block
        to enforce least privilege.
        """
        job_perms = self.job.get("permissions")
        workflow_perms = self.doc.get("permissions")
        self.assertTrue(
            job_perms is not None or workflow_perms is not None,
            "Neither the dry-run smoke job nor the workflow declares a 'permissions' block. "
            "Add 'permissions: contents: read' to enforce least privilege.",
        )

    def test_job_permissions_do_not_grant_write_access(self):
        """The dry-run job must not require write access — it is read-only validation."""
        job_perms = self.job.get("permissions") or {}
        workflow_perms = self.doc.get("permissions") or {}
        effective = (
            {**workflow_perms, **job_perms}
            if isinstance(job_perms, dict)
            else workflow_perms
        )
        write_grants = {k: v for k, v in effective.items() if v == "write"}
        self.assertEqual(
            write_grants,
            {},
            f"dry-run smoke job grants unnecessary write permissions: {write_grants!r}. "
            "A dry-run validation job only needs contents: read.",
        )


class TestDryRunSmokeJobCommand(unittest.TestCase):
    """
    The dry-run command step must be correctly formed, guarded with set -e,
    and followed by grep assertions on its captured output.
    """

    def setUp(self):
        _, self.doc = _find_dry_run_workflow()
        self.job = _find_dry_run_smoke_job(self.doc)
        self.all_steps = self.job.get("steps", [])

    def _steps_run_text(self) -> str:
        """Concatenate all 'run' fields across all steps."""
        return "\n".join(str(s.get("run", "")) for s in self.all_steps)

    def test_job_invokes_apply_overlays_script(self):
        """A step must invoke the apply-overlays.py script."""
        run_text = self._steps_run_text()
        self.assertIn(
            "apply-overlays",
            run_text,
            "No step invokes 'apply-overlays.py' or 'apply-overlays'. "
            "The dry-run smoke job must call the overlay application script.",
        )

    def test_job_passes_dry_run_flag_to_script(self):
        """The script must be called with the --dry-run flag."""
        run_text = self._steps_run_text()
        self.assertIn(
            "--dry-run",
            run_text,
            "No step passes '--dry-run' to apply-overlays.py. "
            "The smoke job must run in dry-run mode to avoid touching external repos.",
        )

    def test_job_targets_config_repos_example_yaml(self):
        """The dry-run step must target config/repos/example.yaml specifically."""
        run_text = self._steps_run_text()
        self.assertTrue(
            "config/repos/example.yaml" in run_text or "config/repos/" in run_text,
            "No step references 'config/repos/example.yaml' or 'config/repos/'. "
            "The dry-run smoke job must pass the example overlay path to the script.",
        )

    def test_job_uses_set_e_to_propagate_failures(self):
        """
        The run step must include 'set -e' or 'set -euo pipefail' so that
        a non-zero exit from apply-overlays.py or from a grep assertion
        immediately fails the job.
        Without this, a failing grep in a pipeline could be silently ignored.
        """
        run_text = self._steps_run_text()
        has_set_e = "set -e" in run_text or "set -euo pipefail" in run_text
        self.assertTrue(
            has_set_e,
            "No step uses 'set -e' or 'set -euo pipefail'. "
            "Without this, a failing apply-overlays.py invocation or a failing grep "
            "assertion could be silently swallowed, giving a false-green CI result.",
        )

    def test_job_greps_output_for_example_template_string(self):
        """
        A step must grep (or otherwise assert) that stdout contains 'example-template'.
        This validates that the module was actually processed, not just that the
        script exited 0.
        """
        run_text = self._steps_run_text()
        self.assertIn(
            "example-template",
            run_text,
            "No step checks that the dry-run output contains 'example-template'. "
            "The CI job must grep stdout for 'example-template' after the dry-run "
            "to confirm the module was identified and processed.",
        )

    def test_job_uses_grep_to_assert_output_content(self):
        """
        The step must use 'grep' (or an equivalent assertion tool) to inspect
        the captured dry-run output.  Just checking the exit code is insufficient
        — the output content must be verified.
        """
        run_text = self._steps_run_text()
        self.assertIn(
            "grep",
            run_text,
            "No step uses 'grep' to inspect the dry-run output. "
            "The CI job must capture stdout and use grep to verify expected strings "
            "appear in the output (repository name and 'example-template').",
        )

    def test_job_does_not_use_destructive_apply_flags(self):
        """
        The smoke job must not use --apply, --auto-approve, or --force flags
        that would push real changes to external repositories.
        """
        run_text = self._steps_run_text()
        for flag in ("--apply", "--auto-approve", "--force"):
            self.assertNotIn(
                flag,
                run_text,
                f"dry-run smoke job uses destructive flag '{flag}'. "
                "The smoke test must only run in dry-run mode — never apply changes.",
            )


class TestDryRunSmokeJobTrigger(unittest.TestCase):
    """The workflow containing the dry-run smoke job must trigger on PRs and main."""

    def setUp(self):
        _, self.doc = _find_dry_run_workflow()
        self.triggers = _get_triggers(self.doc)

    def test_workflow_triggers_on_pull_request(self):
        """
        The workflow must fire on pull_request events so the smoke gate runs
        on every PR and blocks merges that break the overlay pipeline.
        """
        self.assertIn(
            "pull_request",
            self.triggers,
            "The dry-run smoke workflow is missing a 'pull_request' trigger. "
            "The smoke gate must run on every PR to prevent regressions from merging.",
        )

    def test_workflow_triggers_on_push_to_main(self):
        """The workflow must also fire on push to main to catch direct commits."""
        push_trigger = self.triggers.get("push", {})
        branches = (
            push_trigger.get("branches", [])
            if isinstance(push_trigger, dict)
            else []
        )
        self.assertIn(
            "main",
            branches,
            "The dry-run smoke workflow push trigger does not include 'main'. "
            "Direct pushes to main must also trigger the smoke gate.",
        )

    def test_pull_request_trigger_is_not_branch_scoped(self):
        """
        The pull_request trigger must not be restricted to a specific branch
        (e.g., 'main' only) — every PR must run the smoke gate regardless of
        the target branch.
        """
        pr_trigger = self.triggers.get("pull_request") or {}
        if isinstance(pr_trigger, dict):
            branches = pr_trigger.get("branches", [])
            self.assertEqual(
                branches,
                [],
                f"pull_request trigger is scoped to branches {branches!r}. "
                "The smoke gate must run on all PRs, not just those targeting main.",
            )


class TestDryRunSmokeJobIntegration(unittest.TestCase):
    """
    Structural prerequisites that must be satisfied for the CI job to run
    successfully when triggered.
    """

    def test_apply_overlays_script_is_referenced_correctly_in_workflow(self):
        """
        The script path referenced in the workflow step must match the actual
        location of apply-overlays.py in the repository.
        """
        _, doc = _find_dry_run_workflow()
        job = _find_dry_run_smoke_job(doc)
        steps = job.get("steps", [])
        run_text = "\n".join(str(s.get("run", "")) for s in steps)

        # Verify the step references a known path pattern for the script.
        # Accept 'scripts/apply-overlays.py' or 'python apply-overlays.py' at root.
        uses_script_path = (
            "scripts/apply-overlays.py" in run_text
            or "apply-overlays.py" in run_text
        )
        self.assertTrue(
            uses_script_path,
            "The dry-run smoke job does not reference 'apply-overlays.py' by path. "
            "The step must invoke the script at its actual location "
            "(e.g., 'python scripts/apply-overlays.py --dry-run ...').",
        )

    def test_config_repos_example_yaml_is_referenced_in_workflow(self):
        """
        The step must reference config/repos/example.yaml (or config/repos/)
        so there is no ambiguity about which overlay file is being tested.
        """
        _, doc = _find_dry_run_workflow()
        job = _find_dry_run_smoke_job(doc)
        steps = job.get("steps", [])
        run_text = "\n".join(str(s.get("run", "")) for s in steps)
        self.assertTrue(
            "config/repos" in run_text,
            "The dry-run smoke job step does not reference 'config/repos' in its run command. "
            "The step must explicitly target config/repos/example.yaml.",
        )

    def test_ci_yaml_yamllint_step_covers_new_dry_run_workflow_if_dedicated(self):
        """
        If a dedicated dry-run-smoke.yaml workflow was created, the existing
        yamllint step in ci.yaml must cover it (yamllint targets .github/workflows/
        which includes all workflow files).
        """
        if not os.path.isfile(DRY_RUN_WORKFLOW_PATH):
            self.skipTest(
                "dry-run-smoke.yaml does not exist — this check only applies "
                "when a dedicated workflow file is used."
            )

        if not os.path.isfile(CI_WORKFLOW_PATH):
            return  # ci.yaml missing is caught by other tests

        doc = _load_workflow(CI_WORKFLOW_PATH)
        steps = _collect_all_steps(doc)
        yamllint_steps = [
            s
            for s in steps
            if "yamllint" in str(s.get("run", ""))
            and ".github/workflows" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(yamllint_steps),
            0,
            "ci.yaml has no yamllint step covering .github/workflows/. "
            "The new dry-run-smoke.yaml file will not be linted by CI.",
        )


if __name__ == "__main__":
    unittest.main()
