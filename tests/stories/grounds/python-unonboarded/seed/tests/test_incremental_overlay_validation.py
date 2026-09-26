"""
Tests for incremental overlay validation in the CI workflow.

These tests verify the new incremental validation behaviour where:
  - On pull_request events, only overlay files changed in the PR diff are validated,
    not the entire config/repos/ tree.
  - The workflow uses `git diff --name-only` against the base branch to identify
    which config/repos/*.yaml files were modified.
  - When zero overlay files are changed in a PR, the validation step is skipped
    with a clear log message — not a silent no-op.
  - On push to main, full-tree validation of all config/repos/*.yaml files runs
    as before (the full-run gate must not be weakened).
  - validate_overlay_configs.py must accept individual file paths (not just a
    directory) so the CI workflow can pass a subset of changed files.

All tests in this file will FAIL until the incremental validation is implemented:
  - The CI workflow (ci.yaml or overlay-validate.yaml) must be updated to detect
    changed files via git diff and dispatch selectively.
  - validate_overlay_configs.py must be extended to accept file paths as positional
    arguments in addition to the existing directory-mode.
"""

import os
import subprocess
import sys
import tempfile
import unittest

import yaml

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CI_WORKFLOW_PATH = os.path.join(REPO_ROOT, ".github", "workflows", "ci.yaml")
OVERLAY_VALIDATE_WORKFLOW_PATH = os.path.join(
    REPO_ROOT, ".github", "workflows", "overlay-validate.yaml"
)
SCRIPT_PATH = os.path.join(REPO_ROOT, "scripts", "validate_overlay_configs.py")


# ---------------------------------------------------------------------------
# Shared helpers  (mirror the patterns in test_overlay_ci_validation_workflow.py)
# ---------------------------------------------------------------------------


def _load_workflow(path: str) -> dict:
    """Parse a GitHub Actions workflow YAML file and return the document dict."""
    with open(path) as f:
        return yaml.safe_load(f)


def _get_triggers(doc: dict) -> dict:
    """
    Return the workflow trigger mapping, handling PyYAML's YAML 1.1 quirk
    where the bare `on:` key is parsed as the boolean True.
    """
    return doc.get("on") or doc.get(True) or {}


def _find_overlay_validate_job(doc: dict) -> dict | None:
    """
    Return the first job whose key or name references 'overlay' and
    'validate' (case-insensitive).  Returns None if not found.
    """
    for job_id, job in doc.get("jobs", {}).items():
        combined = f"{job_id} {job.get('name', '')}".lower()
        if "overlay" in combined and ("validate" in combined or "validation" in combined):
            return job
    return None


def _find_overlay_validate_workflow() -> tuple[str, dict]:
    """
    Locate the workflow that contains an overlay-validate job.
    Checks overlay-validate.yaml first, then ci.yaml.
    Raises FileNotFoundError if neither contains the job.
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


def _run_script(*args: str, cwd: str | None = None) -> subprocess.CompletedProcess:
    """
    Invoke validate_overlay_configs.py with the given arguments.
    Always captures stdout+stderr and never raises on non-zero exit.
    """
    return subprocess.run(
        [sys.executable, SCRIPT_PATH, *args],
        capture_output=True,
        text=True,
        cwd=cwd or REPO_ROOT,
    )


def _write_yaml(directory: str, filename: str, doc: dict) -> str:
    """Write `doc` as YAML to `directory/filename` and return the full path."""
    path = os.path.join(directory, filename)
    with open(path, "w") as f:
        yaml.dump(doc, f, default_flow_style=False)
    return path


def _minimal_valid_overlay(name: str = "my-app", repo: str = "my-org/my-app") -> dict:
    """Return the smallest document that satisfies schemas/overlay.schema.json."""
    return {
        "apiVersion": "gitweave.io/v1",
        "kind": "RepositoryOverlay",
        "metadata": {"name": name},
        "spec": {"repository": repo},
    }


# ---------------------------------------------------------------------------
# 1. Checkout depth — prerequisite for git diff
# ---------------------------------------------------------------------------


class TestIncrementalWorkflowCheckoutDepth(unittest.TestCase):
    """
    The checkout step in the overlay-validate job must fetch enough history
    to allow `git diff` against the PR base branch.

    A shallow clone (the Actions default of fetch-depth: 1) only retrieves
    the tip commit and cannot build a diff against `origin/<base>`.  Setting
    fetch-depth: 0 fetches the full history so git diff works correctly.
    """

    def setUp(self):
        _, self.doc = _find_overlay_validate_workflow()
        self.job = _find_overlay_validate_job(self.doc)

    def test_checkout_step_uses_fetch_depth_zero(self):
        """
        The checkout step must set `with: fetch-depth: 0` so that
        `git diff --name-only origin/${{ github.base_ref }}...HEAD` can
        compare the PR branch against the merge base.

        Without full history the diff produces an empty file list and
        the incremental validation silently skips every PR.
        """
        steps = self.job.get("steps", [])
        for step in steps:
            if "checkout" in str(step.get("uses", "")).lower():
                with_block = step.get("with") or {}
                fetch_depth = with_block.get("fetch-depth", 1)
                self.assertEqual(
                    fetch_depth,
                    0,
                    f"Checkout step has fetch-depth: {fetch_depth!r}. "
                    "Set fetch-depth: 0 so git can diff against the PR base branch.",
                )
                return
        self.fail(
            "No checkout step found in the overlay-validate job. "
            "Add 'uses: actions/checkout@v4' with 'fetch-depth: 0'."
        )


# ---------------------------------------------------------------------------
# 2. PR diff detection — the core incremental logic
# ---------------------------------------------------------------------------


class TestIncrementalWorkflowPRDiffDetection(unittest.TestCase):
    """
    On pull_request events the workflow must detect which config/repos/*.yaml
    files were actually changed in the PR, using git diff --name-only.
    """

    def setUp(self):
        _, self.doc = _find_overlay_validate_workflow()
        self.job = _find_overlay_validate_job(self.doc)
        self.all_steps = self.job.get("steps", [])

    def _all_run_text(self) -> str:
        return " ".join(str(s.get("run", "")) for s in self.all_steps)

    def test_pr_validation_uses_git_diff_name_only(self):
        """
        At least one step must run `git diff --name-only` to build the list
        of files changed in the PR.

        This is the only reliable mechanism to identify which overlay files
        a PR actually touches.  Alternatives like `git status` or manually
        inspecting the working tree do not capture the PR diff correctly.
        """
        run_text = self._all_run_text()
        self.assertIn(
            "git diff --name-only",
            run_text,
            "No step uses 'git diff --name-only' to detect changed overlay files. "
            "The incremental validation must compute a PR diff to select only the "
            "affected files.",
        )

    def test_pr_diff_references_base_branch(self):
        """
        The git diff command must compare against the PR base branch so that
        all commits in the PR are included in the diff, not just the last one.

        Acceptable patterns include:
          - `origin/${{ github.base_ref }}`
          - `$GITHUB_BASE_REF`
          - `${{ github.event.pull_request.base.sha }}`

        A bare `HEAD^` diff misses multi-commit PRs and does not work on the
        first commit of a branch.
        """
        run_text = self._all_run_text()
        has_base_ref = any(
            indicator in run_text
            for indicator in [
                "github.base_ref",
                "GITHUB_BASE_REF",
                "github.event.pull_request.base",
                "BASE_SHA",
                "base_ref",
            ]
        )
        self.assertTrue(
            has_base_ref,
            "git diff does not reference the PR base branch (e.g. github.base_ref). "
            "The diff must compare against the PR base, not just HEAD^, so that all "
            "commits in the PR are captured.",
        )

    def test_diff_output_is_filtered_to_config_repos_yaml_files(self):
        """
        The file list from git diff must be filtered so only paths matching
        `config/repos/*.yaml` (or `config/repos/**/*.yaml`) are kept.

        Without filtering, unrelated file changes (e.g. README edits, infra/
        Terraform files) would be passed to the overlay validator, which cannot
        handle them and would emit spurious errors.
        """
        run_text = self._all_run_text()
        # Accept grep, Python filtering, or shell glob patterns that restrict
        # the diff output to config/repos/ paths.
        has_filter = "config/repos" in run_text
        self.assertTrue(
            has_filter,
            "No step filters the git diff output to 'config/repos/*.yaml'. "
            "Without filtering, non-overlay file paths will be passed to the validator.",
        )

    def test_diff_filter_targets_yaml_extension_not_all_files(self):
        """
        The filter must restrict to `.yaml` files inside config/repos/, not
        every file under config/.

        Passing Terraform or JSON files to the YAML overlay validator would
        produce misleading errors.
        """
        run_text = self._all_run_text()
        # Accept patterns like: grep '\.yaml$', '*.yaml', '.yaml', grep config/repos
        # The combined requirement is that .yaml is part of the filter expression.
        has_yaml_filter = any(
            indicator in run_text
            for indicator in [
                ".yaml",
                r"\.yaml",
                "*.yaml",
            ]
        )
        self.assertTrue(
            has_yaml_filter,
            "The diff filter does not restrict to '.yaml' files. "
            "Add a filter like `grep '\\.yaml$'` or `*.yaml` to exclude non-overlay files.",
        )


# ---------------------------------------------------------------------------
# 3. Skip behaviour — zero changed overlay files
# ---------------------------------------------------------------------------


class TestIncrementalWorkflowSkipBehavior(unittest.TestCase):
    """
    When a PR touches zero overlay files the validation step must be skipped
    with a clear, human-readable log message.

    A silent pass is indistinguishable from a failed-to-detect-anything bug.
    A clear message like 'No overlay files changed — skipping validation'
    makes the CI result auditable.
    """

    def setUp(self):
        _, self.doc = _find_overlay_validate_workflow()
        self.job = _find_overlay_validate_job(self.doc)
        self.all_steps = self.job.get("steps", [])

    def test_workflow_has_conditional_skip_when_no_overlay_files_changed(self):
        """
        The workflow must include an explicit condition that short-circuits
        when the diff produces an empty overlay file list.

        Acceptable implementations:
          - An `if:` expression on the validation step that checks for an
            empty step output (e.g. `if: steps.changed.outputs.files != ''`)
          - A bash early-exit guarded by `[ -z "$CHANGED_FILES" ]`
          - A dedicated 'skip' step with a complementary `if:` condition

        Simply calling the validator with an empty list is NOT sufficient
        because it makes the skip invisible in the CI log.
        """
        run_text = " ".join(str(s.get("run", "")) for s in self.all_steps)
        conditions = " ".join(str(s.get("if", "")) for s in self.all_steps)

        has_empty_check = any(
            indicator in conditions or indicator in run_text
            for indicator in [
                "== ''",           # GitHub Actions: empty string check
                '== ""',
                "!= ''",           # negation variant (used on the validate step)
                '!= ""',
                "steps.",          # step output reference used in if condition
                "if [ -z",         # bash: empty string test
                '[ -z "$',
                "exit 0",          # explicit early-exit on empty list
            ]
        )
        self.assertTrue(
            has_empty_check,
            "The workflow has no conditional logic to handle an empty changed-files list. "
            "Add an 'if:' condition (e.g. `if: steps.changed.outputs.files != ''`) or a "
            "bash guard (`if [ -z \"$CHANGED\" ]; then exit 0; fi`) to skip validation "
            "when no overlay files changed.",
        )

    def test_workflow_emits_clear_skip_message_when_no_overlay_files_changed(self):
        """
        A dedicated step (or branch in the run script) must print a message
        that makes the skip reason visible in CI logs.

        Examples of acceptable messages:
          - 'No overlay files changed — skipping validation'
          - 'Skipping overlay validation: no config/repos/ files in diff'
          - 'No overlay files to validate'

        This allows PR reviewers to confirm the check passed intentionally,
        rather than wondering whether validation was accidentally bypassed.
        """
        run_text = " ".join(str(s.get("run", "")) for s in self.all_steps)
        has_skip_message = any(
            indicator in run_text
            for indicator in [
                "No overlay",
                "no overlay",
                "Skipping",
                "skipping",
                "No overlay files",
                "nothing to validate",
                "no files",
                "No files",
                "skip",
                "Skip",
            ]
        )
        self.assertTrue(
            has_skip_message,
            "No step emits a skip message when zero overlay files changed. "
            "Add a step or branch that logs something like "
            "'No overlay files changed — skipping validation'.",
        )


# ---------------------------------------------------------------------------
# 4. Main-branch full validation — the full-run gate must not be weakened
# ---------------------------------------------------------------------------


class TestIncrementalWorkflowMainPushFullValidation(unittest.TestCase):
    """
    Incremental validation is a PR optimisation only.  On push to main (after
    merge) the full config/repos/ tree must be validated to catch any overlay
    that was already broken before the PR was opened.
    """

    def setUp(self):
        self.workflow_path, self.doc = _find_overlay_validate_workflow()
        self.triggers = _get_triggers(self.doc)
        self.job = _find_overlay_validate_job(self.doc)

    def test_workflow_triggers_on_push_to_main(self):
        """
        The overlay-validate workflow must include a `push: branches: [main]`
        trigger so that a full validation pass runs after every merge to main.

        Without this trigger, a broken overlay that slips through review would
        not be caught until the next PR that happens to touch the same file.
        """
        push_trigger = self.triggers.get("push") or {}
        branches: list = []
        if isinstance(push_trigger, dict):
            branches = push_trigger.get("branches", [])
        has_main = any("main" in str(b) for b in branches)
        self.assertTrue(
            has_main,
            f"Workflow push trigger branches {branches!r} does not include 'main'. "
            "Add 'push: branches: [main]' so full validation runs after each merge.",
        )

    def test_main_push_path_validates_full_config_repos_directory(self):
        """
        On push to main, the validator must be invoked with the full
        config/repos/ directory (not an incremental file list) so that every
        overlay file is checked regardless of which files changed in the merge.

        The full directory path must appear in the run script for this code path.
        """
        steps = self.job.get("steps", [])
        all_run_text = " ".join(str(s.get("run", "")) for s in steps)
        self.assertIn(
            "config/repos",
            all_run_text,
            "No step references 'config/repos' for full-directory validation. "
            "The main-push path must call the validator with 'config/repos/' as "
            "the target directory.",
        )

    def test_pr_and_main_push_use_different_validation_targets(self):
        """
        The PR path (incremental) and the main push path (full) must use
        different validation targets:
          - PR  → individual file paths from git diff
          - main → the full config/repos/ directory

        Having only one command means either the PR never gets incremental
        validation, or main never gets full validation — both are wrong.

        This test confirms that at least two distinct validation-related run
        commands exist in the job.
        """
        steps = self.job.get("steps", [])
        validator_steps = [
            s for s in steps
            if s.get("run") and (
                "validate_overlay_configs" in str(s.get("run", ""))
                or ("config/repos" in str(s.get("run", "")) and "validate" in str(s.get("run", "")).lower())
                or "validate_overlay_configs" in str(s.get("run", ""))
            )
        ]
        # There must be at least two distinct steps that reference the validator
        # (one for PR incremental, one for main full-tree) OR a single step with
        # clearly conditional logic (github.event_name check or step-output if).
        run_commands = [str(s.get("run", "")) for s in steps if s.get("run")]
        has_event_conditional = any(
            "github.event_name" in str(s.get("if", "")) or
            "github.event_name" in str(s.get("run", ""))
            for s in steps
        )
        has_step_output_conditional = any(
            "steps." in str(s.get("if", ""))
            for s in steps
        )
        has_multiple_validator_invocations = len(validator_steps) >= 2

        self.assertTrue(
            has_multiple_validator_invocations
            or has_event_conditional
            or has_step_output_conditional,
            "The overlay-validate job does not appear to distinguish between PR "
            "(incremental) and main-push (full) validation paths. "
            "Use separate steps with 'if: github.event_name == ...' conditions, "
            "or a single step with conditional logic to select the right target.",
        )


# ---------------------------------------------------------------------------
# 5. Script file-path mode — the key new capability
# ---------------------------------------------------------------------------


class TestScriptIncrementalFilePathMode(unittest.TestCase):
    """
    validate_overlay_configs.py must accept individual file paths as positional
    arguments so the CI workflow can pass a subset of changed files:

      python scripts/validate_overlay_configs.py config/repos/a.yaml config/repos/b.yaml

    This is the critical enabling capability for incremental PR validation.
    The existing directory mode (python scripts/validate_overlay_configs.py config/repos/)
    must continue to work unchanged for the main-push full validation.
    """

    def test_script_accepts_single_file_path_argument(self):
        """
        When passed a single valid overlay file path the script must exit 0
        and validate that specific file.

        This verifies the script can distinguish a file path from a directory
        and handle it correctly.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = _write_yaml(tmpdir, "app.yaml", _minimal_valid_overlay())
            result = _run_script(file_path)
        self.assertEqual(
            result.returncode,
            0,
            f"Script exited {result.returncode} for a single valid file path — expected 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_script_reports_validated_1_file_for_single_file_path(self):
        """
        When given one file path the output must report 'Validated 1 file'
        so the CI log confirms exactly one file was checked.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = _write_yaml(tmpdir, "app.yaml", _minimal_valid_overlay())
            result = _run_script(file_path)
        combined = result.stdout + result.stderr
        self.assertRegex(
            combined,
            r"[Vv]alidated\s+1\s+file",
            f"Script output does not report 'Validated 1 file(s)' for a single file path.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_script_validates_only_two_specified_files_from_one_hundred(self):
        """
        INCREMENTAL VALIDATION CORE TEST:

        When 100 overlay files exist in a directory but only 2 are passed as
        file path arguments, the script must validate exactly those 2 files —
        not all 100.

        This simulates the primary acceptance criterion: a PR that touches 2
        of 100 overlay files must only run the validator against those 2 files.

        The validated count in the output must be 2 (not 100).
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create 100 valid overlay files in the directory
            all_file_paths = []
            for i in range(100):
                doc = _minimal_valid_overlay(
                    name=f"app-{i:03d}",
                    repo=f"my-org/app-{i:03d}",
                )
                path = _write_yaml(tmpdir, f"app-{i:03d}.yaml", doc)
                all_file_paths.append(path)

            # Simulate: PR only touched files at index 7 and 42
            changed_file_1 = all_file_paths[7]
            changed_file_2 = all_file_paths[42]
            result = _run_script(changed_file_1, changed_file_2)

        self.assertEqual(
            result.returncode,
            0,
            f"Script exited {result.returncode} for 2 valid file paths — expected 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )
        combined = result.stdout + result.stderr
        self.assertRegex(
            combined,
            r"[Vv]alidated\s+2\s+file",
            "Script does not report 'Validated 2 file(s)' when given exactly 2 file paths. "
            "The incremental mode must validate only the specified files, not the whole "
            f"directory.\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_script_exits_nonzero_when_one_of_two_specified_files_is_invalid(self):
        """
        When 2 file paths are given and 1 is invalid, the script must exit non-zero.

        The incremental mode must enforce exactly the same validation strictness
        as the full directory mode — being 'incremental' must not mean 'lenient'.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            good_path = _write_yaml(tmpdir, "good.yaml", _minimal_valid_overlay())
            bad_doc = _minimal_valid_overlay()
            del bad_doc["kind"]
            bad_path = _write_yaml(tmpdir, "bad.yaml", bad_doc)
            result = _run_script(good_path, bad_path)
        self.assertNotEqual(
            result.returncode,
            0,
            "Script exited 0 when one of two specified files was invalid — expected non-zero.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_script_reports_failing_file_name_in_file_path_mode(self):
        """
        When a specified file fails validation its name must appear in the output
        so the PR author knows exactly which file needs fixing.

        This mirrors the directory-mode requirement but must also hold in file-
        path mode.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bad_doc = _minimal_valid_overlay()
            del bad_doc["apiVersion"]
            bad_path = _write_yaml(tmpdir, "broken-overlay.yaml", bad_doc)
            result = _run_script(bad_path)
        combined = result.stdout + result.stderr
        self.assertIn(
            "broken-overlay.yaml",
            combined,
            "Output does not include 'broken-overlay.yaml' when that file fails validation "
            "in file-path mode.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_script_reports_all_failing_files_when_multiple_paths_given(self):
        """
        When 3 file paths are given and all 3 are invalid, every failing file
        name must appear in the output.

        The script must not stop after the first failure — all violations must
        be surfaced in a single CI run so the author can fix everything at once.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            paths = []
            for name in ("alpha.yaml", "beta.yaml", "gamma.yaml"):
                doc = _minimal_valid_overlay(
                    name=name.replace(".yaml", ""),
                    repo=f"org/{name.replace('.yaml', '')}",
                )
                del doc["kind"]   # Make each file invalid
                paths.append(_write_yaml(tmpdir, name, doc))
            result = _run_script(*paths)
        combined = result.stdout + result.stderr
        for name in ("alpha.yaml", "beta.yaml", "gamma.yaml"):
            self.assertIn(
                name,
                combined,
                f"Output is missing '{name}' — all failing files must be reported, "
                f"not just the first.\nstdout: {result.stdout}\nstderr: {result.stderr}",
            )


# ---------------------------------------------------------------------------
# 6. Script empty-invocation handling — zero changed overlay files edge case
# ---------------------------------------------------------------------------


class TestScriptEmptyInvocation(unittest.TestCase):
    """
    When the PR diff contains zero overlay files the workflow may skip calling
    the script entirely (handled by the workflow's skip condition), but the
    script must also behave sensibly when invoked with no file-path arguments.

    Calling the script with no arguments represents an empty incremental diff
    and must result in exit 0 with a clear 'nothing to validate' message.
    This prevents a misconfigured workflow from producing a false failure when
    the diff returns an empty list.
    """

    def _run_no_args(self) -> subprocess.CompletedProcess:
        """Run validate_overlay_configs.py with no positional arguments."""
        return subprocess.run(
            [sys.executable, SCRIPT_PATH],
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )

    def test_script_exits_zero_when_invoked_with_no_file_arguments(self):
        """
        Calling the script with no arguments (representing an empty file list
        from git diff) must exit 0 — there is nothing to validate, which is a
        valid and expected state for PRs that do not touch overlay files.
        """
        result = self._run_no_args()
        self.assertEqual(
            result.returncode,
            0,
            f"Script exited {result.returncode} when invoked with no arguments — expected 0.\n"
            "A PR with zero changed overlay files must produce a passing CI check.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_script_emits_clear_message_when_invoked_with_no_file_arguments(self):
        """
        When invoked with no arguments the script must emit a clear message
        such as 'No overlay files to validate', 'Validated 0 file(s)', or
        'Skipping — no files specified' so that CI logs are self-explanatory.

        A completely silent exit 0 makes it impossible to distinguish
        'no files changed' from 'script was never run'.
        """
        result = self._run_no_args()
        combined = result.stdout + result.stderr
        has_clear_message = any(
            indicator in combined
            for indicator in [
                "No overlay",
                "no overlay",
                "0 file",
                "Validated 0",
                "nothing to validate",
                "No files",
                "no files",
                "Skipping",
                "skipping",
            ]
        )
        self.assertTrue(
            has_clear_message,
            "Script emits no clear message when invoked with no arguments. "
            "Add output like 'No overlay files to validate' or 'Validated 0 file(s)'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
