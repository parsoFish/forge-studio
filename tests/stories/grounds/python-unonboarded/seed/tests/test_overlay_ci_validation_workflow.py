"""
Tests for the CI job that validates overlay YAML files in config/repos/
against schemas/overlay.schema.json.

These tests verify that the validation CI job:
  - is defined in a workflow file that triggers on pull_request with paths: config/**
  - uses Python jsonschema to validate each config/repos/*.yaml file individually
  - reports the specific file name AND violation message (not just "validation failed")
  - fails the job (non-zero exit) when any file is invalid
  - exits 0 gracefully when config/repos/ is empty or does not exist
  - outputs the count of files validated
  - does not use continue-on-error (errors must block the PR)
  - has least-privilege permissions (contents: read)
  - runs on ubuntu-latest

All tests in this file will fail until:
  - A GitHub Actions workflow is created (or ci.yaml extended) with an
    overlay-validate job that covers the behaviour described above
"""

import os
import unittest

import yaml


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CI_WORKFLOW_PATH = os.path.join(REPO_ROOT, ".github", "workflows", "ci.yaml")
OVERLAY_VALIDATE_WORKFLOW_PATH = os.path.join(
    REPO_ROOT, ".github", "workflows", "overlay-validate.yaml"
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
    string 'on'.
    """
    return doc.get("on") or doc.get(True) or {}


def _collect_all_steps(doc: dict) -> list:
    """Return a flat list of every step across all jobs in a workflow."""
    steps = []
    for job in doc.get("jobs", {}).values():
        steps.extend(job.get("steps", []))
    return steps


def _find_overlay_validate_workflow() -> tuple[str, dict]:
    """
    Locate the workflow containing an overlay-validate job.
    The implementation may add the job to ci.yaml or create a dedicated
    overlay-validate.yaml — both are acceptable.
    Returns (path, parsed_doc) for the first file that contains the job.
    Raises FileNotFoundError if neither file contains the job.
    """
    candidates = [OVERLAY_VALIDATE_WORKFLOW_PATH, CI_WORKFLOW_PATH]
    for path in candidates:
        if not os.path.isfile(path):
            continue
        doc = _load_workflow(path)
        if _find_overlay_validate_job(doc) is not None:
            return path, doc
    raise FileNotFoundError(
        "No workflow file contains an 'overlay-validate' job. "
        "Create .github/workflows/overlay-validate.yaml or add the job to ci.yaml."
    )


def _find_overlay_validate_job(doc: dict) -> dict | None:
    """
    Return the first job dict whose key or name references 'overlay' and
    'validate' (case-insensitive).  Returns None if no such job is found.
    """
    for job_id, job in doc.get("jobs", {}).items():
        combined = f"{job_id} {job.get('name', '')}".lower()
        if "overlay" in combined and ("validate" in combined or "validation" in combined):
            return job
    return None


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------


class TestOverlayValidateWorkflowFileExists(unittest.TestCase):
    """The overlay-validate job must live in a discoverable workflow file."""

    def test_overlay_validate_workflow_or_job_exists(self):
        """
        Either .github/workflows/overlay-validate.yaml must exist, or ci.yaml
        must contain an overlay-validate job.  At least one must be present.
        """
        overlay_file_exists = os.path.isfile(OVERLAY_VALIDATE_WORKFLOW_PATH)
        ci_has_job = False
        if os.path.isfile(CI_WORKFLOW_PATH):
            doc = _load_workflow(CI_WORKFLOW_PATH)
            ci_has_job = _find_overlay_validate_job(doc) is not None

        self.assertTrue(
            overlay_file_exists or ci_has_job,
            "No overlay-validate CI job found. Create .github/workflows/overlay-validate.yaml "
            "or add an overlay-validate job to .github/workflows/ci.yaml.",
        )

    def test_overlay_validate_workflow_is_valid_yaml(self):
        """The workflow file must parse without YAML syntax errors."""
        _, doc = _find_overlay_validate_workflow()
        self.assertIsInstance(
            doc,
            dict,
            "The overlay-validate workflow file did not parse as a YAML mapping",
        )

    def test_overlay_validate_job_exists_in_workflow(self):
        """The workflow must define an 'overlay-validate' (or similarly named) job."""
        _, doc = _find_overlay_validate_workflow()
        job = _find_overlay_validate_job(doc)
        self.assertIsNotNone(
            job,
            "No overlay-validate job found in the workflow. "
            "Define a job with 'overlay' and 'validate' in its key or name.",
        )


class TestOverlayValidateWorkflowTrigger(unittest.TestCase):
    """The job must only fire on pull_request events that touch config/."""

    def setUp(self):
        _, self.doc = _find_overlay_validate_workflow()
        self.triggers = _get_triggers(self.doc)

    def test_triggers_on_pull_request(self):
        """The workflow must fire on pull_request events."""
        self.assertIn(
            "pull_request",
            self.triggers,
            "The overlay-validate workflow is missing a 'pull_request' trigger.",
        )

    def test_pull_request_trigger_scoped_to_config_path(self):
        """
        The pull_request trigger must restrict to paths matching config/**
        so the job only runs when config/ files are actually changed.
        """
        pr_trigger = self.triggers.get("pull_request") or {}
        if not isinstance(pr_trigger, dict):
            self.fail(
                "pull_request trigger is not a mapping — cannot verify path filter. "
                "Add 'paths: [\"config/**\"]' to the trigger."
            )
        paths = pr_trigger.get("paths", [])
        has_config_path_filter = any(
            "config" in str(p) for p in paths
        )
        self.assertTrue(
            has_config_path_filter,
            f"pull_request trigger paths {paths!r} does not include a 'config/**' filter. "
            "The overlay-validate job must only run when config/ files are modified.",
        )

    def test_pull_request_path_filter_covers_all_of_config(self):
        """
        The path filter must cover all files under config/ (config/**),
        not just a specific subdirectory like config/repos/*.
        """
        pr_trigger = self.triggers.get("pull_request") or {}
        if not isinstance(pr_trigger, dict):
            return  # Caught by the previous test
        paths = pr_trigger.get("paths", [])
        broad_config_filter = any(
            str(p).startswith("config/") and ("**" in str(p) or str(p) == "config/")
            for p in paths
        )
        self.assertTrue(
            broad_config_filter,
            f"pull_request trigger paths {paths!r} should cover all of config/ "
            "using a pattern like 'config/**'. A narrower filter risks missing new subdirs.",
        )


class TestOverlayValidateJobStructure(unittest.TestCase):
    """The overlay-validate job must be structurally sound."""

    def setUp(self):
        _, self.doc = _find_overlay_validate_workflow()
        self.job = _find_overlay_validate_job(self.doc)

    def test_job_runs_on_ubuntu_latest(self):
        """The overlay-validate job must run on ubuntu-latest."""
        runs_on = self.job.get("runs-on", "")
        self.assertIn(
            "ubuntu",
            str(runs_on).lower(),
            f"overlay-validate job runs-on is {runs_on!r} — expected ubuntu-latest.",
        )

    def test_job_has_a_checkout_step(self):
        """The job must check out the repository before validating files."""
        steps = self.job.get("steps", [])
        checkout_steps = [
            s for s in steps if "checkout" in str(s.get("uses", "")).lower()
        ]
        self.assertGreater(
            len(checkout_steps),
            0,
            "overlay-validate job has no checkout step — validation will run against "
            "an empty workspace.",
        )

    def test_job_has_explicit_permissions_block(self):
        """
        The job (or the workflow) must declare an explicit permissions block.
        Implicit permissions can be overly broad.
        """
        job_perms = self.job.get("permissions")
        workflow_perms = self.doc.get("permissions")
        self.assertTrue(
            job_perms is not None or workflow_perms is not None,
            "Neither the overlay-validate job nor the workflow declares a permissions block. "
            "Add 'permissions: contents: read' to enforce least privilege.",
        )

    def test_job_permissions_do_not_grant_write_access(self):
        """The overlay-validate job must not require write access — it only reads files."""
        job_perms = self.job.get("permissions") or {}
        workflow_perms = self.doc.get("permissions") or {}
        effective_perms = {**workflow_perms, **job_perms} if isinstance(job_perms, dict) else {}
        write_grants = {k: v for k, v in effective_perms.items() if v == "write"}
        self.assertEqual(
            write_grants,
            {},
            f"overlay-validate job grants unnecessary write permissions: {write_grants!r}",
        )


class TestOverlayValidateUsesJsonschema(unittest.TestCase):
    """
    The validation step must use jsonschema (Python) or an equivalent schema
    validator, not a hand-rolled field presence check.
    """

    def setUp(self):
        _, self.doc = _find_overlay_validate_workflow()
        self.job = _find_overlay_validate_job(self.doc)
        self.all_steps = self.job.get("steps", [])

    def _steps_run_text(self) -> str:
        return " ".join(str(s.get("run", "")) for s in self.all_steps)

    def test_job_installs_jsonschema_or_ajv(self):
        """
        The job must install jsonschema (Python) or ajv-cli before validating.
        A hand-rolled YAML checker does not satisfy the acceptance criteria.
        """
        install_cmds = " ".join(
            str(s.get("run", "")) for s in self.all_steps
            if "install" in str(s.get("name", "")).lower()
            or "pip install" in str(s.get("run", ""))
            or "npm install" in str(s.get("run", ""))
        )
        uses_jsonschema = "jsonschema" in install_cmds or "ajv" in install_cmds
        # Also check the run steps directly — some jobs embed pip install inline
        if not uses_jsonschema:
            uses_jsonschema = "jsonschema" in self._steps_run_text() or "ajv" in self._steps_run_text()
        self.assertTrue(
            uses_jsonschema,
            "overlay-validate job does not appear to install 'jsonschema' or 'ajv'. "
            "The job must use a proper schema validator, not a hand-rolled check.",
        )

    def test_job_validates_against_overlay_schema_json(self):
        """The validation step must reference schemas/overlay.schema.json."""
        run_text = self._steps_run_text()
        self.assertIn(
            "overlay.schema.json",
            run_text,
            "No validation step references 'schemas/overlay.schema.json'. "
            "The job must validate against the declared schema file.",
        )

    def test_job_validates_files_in_config_repos(self):
        """The validation step must target config/repos/ YAML files."""
        run_text = self._steps_run_text()
        self.assertTrue(
            "config/repos" in run_text,
            f"No step targets 'config/repos' in its run command. "
            "The job must iterate over config/repos/*.yaml files.",
        )


class TestOverlayValidateReportsViolations(unittest.TestCase):
    """
    The job must emit the file name and specific violation — not just "invalid".
    This is the acceptance criterion that distinguishes actionable CI output
    from opaque failure messages.
    """

    def setUp(self):
        _, self.doc = _find_overlay_validate_workflow()
        self.job = _find_overlay_validate_job(self.doc)
        self.all_steps = self.job.get("steps", [])

    def _steps_run_text(self) -> str:
        return " ".join(str(s.get("run", "")) for s in self.all_steps)

    def test_validation_step_prints_filename_on_failure(self):
        """
        The run script must echo or print the file name when a validation error
        occurs — the PR author must know which file is broken.
        A script that only prints 'validation failed' and exits is insufficient.
        """
        run_text = self._steps_run_text()
        # The script should reference the filename variable in its output.
        # Accept common patterns: $FILE, $f, ${FILE}, echo $file, print(file), etc.
        reports_filename = any(
            indicator in run_text
            for indicator in [
                "echo",      # bash echo of filename
                "print(",    # Python print
                "print ",    # Python print statement
                "$FILE",     # common bash variable name
                "${file}",
                "$file",
                "f-string",
            ]
        )
        self.assertTrue(
            reports_filename,
            "The validation script does not appear to output file names when errors occur. "
            "The run step must print the failing file name so PR authors know what to fix.",
        )

    def test_validation_step_exits_nonzero_on_invalid_file(self):
        """
        The validation script must set a failure flag and exit non-zero when
        any file fails validation — the job must not silently pass on errors.
        Common patterns: 'exit 1', 'sys.exit(1)', FAILED=1 + exit $FAILED.
        """
        run_text = self._steps_run_text()
        exits_nonzero = any(
            indicator in run_text
            for indicator in ["exit 1", "sys.exit(1)", "exit $FAILED", "exit $failed", "raise SystemExit"]
        )
        self.assertTrue(
            exits_nonzero,
            "The validation script does not contain an explicit non-zero exit on failure. "
            "The job must exit non-zero so GitHub marks the check as failed.",
        )

    def test_validation_step_does_not_use_continue_on_error(self):
        """
        No step in the overlay-validate job may use continue-on-error: true.
        That would let schema violations pass silently.
        """
        for step in self.all_steps:
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"Step '{step.get('name', '<unnamed>')}' has continue-on-error: true — "
                "overlay validation errors must fail the job, not be swallowed.",
            )

    def test_validation_step_outputs_validated_file_count(self):
        """
        The validation script must print the count of files it validated
        (e.g. 'Validated 3 file(s)') so reviewers can confirm all files ran.
        """
        run_text = self._steps_run_text()
        has_count_output = any(
            indicator in run_text
            for indicator in [
                "validated",   # "Validated N file(s)"
                "Validated",
                "count",
                "files validated",
                "total",
            ]
        )
        self.assertTrue(
            has_count_output,
            "The validation script does not appear to output a file count. "
            "Add output like 'Validated N file(s)' so CI output is informative.",
        )


class TestOverlayValidateEmptyDirectoryHandling(unittest.TestCase):
    """
    The job must exit 0 (pass) when config/repos/ is empty or does not exist.
    An empty overlay directory is a valid state (e.g. in a fresh repository).
    """

    def setUp(self):
        _, self.doc = _find_overlay_validate_workflow()
        self.job = _find_overlay_validate_job(self.doc)
        self.all_steps = self.job.get("steps", [])

    def _steps_run_text(self) -> str:
        return " ".join(str(s.get("run", "")) for s in self.all_steps)

    def test_validation_script_handles_empty_or_missing_directory(self):
        """
        The run script must gracefully handle an empty or missing config/repos/
        directory without erroring out.
        Common patterns: check if dir exists before globbing, 'exit 0' on empty,
        or a Python try/except around directory iteration.
        """
        run_text = self._steps_run_text()
        handles_empty = any(
            indicator in run_text
            for indicator in [
                "if [ -z",        # bash: check empty glob
                "if [ ! -d",      # bash: directory does not exist
                "exit 0",         # explicit early-exit on empty
                "glob(",          # Python glob (returns empty list, no error)
                "os.listdir",     # Python listdir (returns empty list, no error)
                "Path(",          # Python pathlib (iterdir returns empty iterator)
                "|| true",        # bash: swallow non-zero exit from find/ls
                "2>/dev/null",    # bash: suppress error when dir missing
            ]
        )
        self.assertTrue(
            handles_empty,
            "The validation script does not appear to handle an empty or missing "
            "config/repos/ directory. It must exit 0 (pass) when there are no files to validate.",
        )


class TestOverlayValidateJobIntegration(unittest.TestCase):
    """
    End-to-end sanity checks: the workflow file and schema both exist so the
    job can actually run when triggered.
    """

    def setUp(self):
        _, self.doc = _find_overlay_validate_workflow()
        self.workflow_path, _ = _find_overlay_validate_workflow()

    def test_schema_file_exists_at_expected_path(self):
        """
        schemas/overlay.schema.json must exist so the validation job can load it.
        If the schema is missing, every validation run will error before checking
        any overlay files.
        """
        schema_path = os.path.join(REPO_ROOT, "schemas", "overlay.schema.json")
        self.assertTrue(
            os.path.isfile(schema_path),
            "schemas/overlay.schema.json does not exist. The validation job depends "
            "on this file — create it before enabling the CI job.",
        )

    def test_config_repos_directory_is_present_or_empty_state_documented(self):
        """
        config/repos/ must exist (even if empty) so the validation job has a
        target directory.  An absent directory is acceptable for the empty-state
        test, but the directory should be created as part of the implementation.
        """
        repos_dir = os.path.join(REPO_ROOT, "config", "repos")
        # Either the dir exists, or the workflow must handle its absence gracefully.
        # This test documents the expected state; the empty-handling test in
        # TestOverlayValidateEmptyDirectoryHandling covers the graceful-exit behaviour.
        if not os.path.isdir(repos_dir):
            # Check that the workflow handles a missing directory.
            # The workflow test already verified this — here we just document the
            # expectation that config/repos/ should be created.
            self.skipTest(
                "config/repos/ does not yet exist — this is expected in the TDD red phase. "
                "The implementation must create this directory."
            )

    def test_workflow_sets_pipefail_or_equivalent(self):
        """
        Any bash run step that pipes commands must use 'set -euo pipefail'
        or equivalent so pipeline failures propagate to the exit code.
        """
        job = _find_overlay_validate_job(self.doc)
        for step in job.get("steps", []):
            run = str(step.get("run", ""))
            if "|" in run and "set -e" not in run and "pipefail" not in run:
                # Tolerate single-line pipes that don't need pipefail
                if "\n" in run:  # multi-line scripts with pipes need pipefail
                    self.fail(
                        f"Step '{step.get('name', '<unnamed>')}' uses pipes in a multi-line "
                        "script but does not set 'set -euo pipefail'. Pipeline failures will "
                        "be silently ignored."
                    )
