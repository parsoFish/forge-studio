"""
Tests for the CalVer CI workflow that validates and creates module version tags.

These tests verify that .github/workflows/module-calver.yaml exists and is
correctly configured to:

  PR validation job (validate-version):
    - Triggers on pull_request events
    - Uses scripts/bump-module-version.py to compute the expected version
    - Checks out the repository
    - Validates that copier.yaml _metadata.version matches the expected CalVer
    - Fails the job when the version does not match (no continue-on-error)
    - Has at minimum contents: read permission (read-only gate)

  Tag creation job (tag-version):
    - Triggers on push to the main branch only
    - Creates git tags in the format modules/<name>@YYYYMMDD.Patch
    - Uses scripts/bump-module-version.py to determine the version
    - Has contents: write permission (required to push tags)
    - Checks out the repository (fetch-depth: 0 for full tag history)
    - Does not run on pull_request events (tags are only created on merge)

  Shared structure:
    - File exists at .github/workflows/module-calver.yaml
    - File is valid YAML
    - At least one job is defined
    - All jobs run on ubuntu-latest

All tests in this file fail until .github/workflows/module-calver.yaml is
created with the correct content (TDD red phase).
"""

import os
import unittest

import yaml


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORKFLOW_PATH = os.path.join(REPO_ROOT, ".github", "workflows", "module-calver.yaml")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_workflow() -> dict:
    """Parse module-calver.yaml and return the document dict."""
    with open(WORKFLOW_PATH) as f:
        return yaml.safe_load(f)


def _get_triggers(doc: dict) -> dict:
    """
    Return the workflow trigger mapping, handling PyYAML's YAML 1.1 quirk
    where the bare `on:` key is parsed as the boolean True rather than the
    string 'on'.  Both representations are checked for compatibility.
    """
    return doc.get("on") or doc.get(True) or {}


def _collect_all_steps(doc: dict) -> list:
    """Return a flat list of every step object across all jobs."""
    steps = []
    for job in doc.get("jobs", {}).values():
        steps.extend(job.get("steps", []))
    return steps


def _find_job_by_keyword(doc: dict, keyword: str) -> dict | None:
    """Return the first job whose id or name contains keyword (case-insensitive)."""
    kw = keyword.lower()
    for job_id, job in doc.get("jobs", {}).items():
        if kw in job_id.lower() or kw in str(job.get("name", "")).lower():
            return job
    return None


# ---------------------------------------------------------------------------
# TestCalVerWorkflowFileExists
# ---------------------------------------------------------------------------


class TestCalVerWorkflowFileExists(unittest.TestCase):
    """Sanity checks that the workflow file is present and parseable."""

    def test_module_calver_yaml_exists(self):
        """module-calver.yaml must exist at .github/workflows/module-calver.yaml."""
        self.assertTrue(
            os.path.isfile(WORKFLOW_PATH),
            f".github/workflows/module-calver.yaml is missing — "
            f"expected at {WORKFLOW_PATH}",
        )

    def test_module_calver_yaml_is_valid_yaml_mapping(self):
        """module-calver.yaml must parse as a valid YAML mapping without syntax errors."""
        doc = _load_workflow()
        self.assertIsInstance(
            doc,
            dict,
            "module-calver.yaml did not parse as a YAML mapping — "
            "the file may contain syntax errors",
        )

    def test_module_calver_yaml_has_at_least_one_job(self):
        """module-calver.yaml must define at least one job."""
        doc = _load_workflow()
        jobs = doc.get("jobs", {})
        self.assertGreater(
            len(jobs),
            0,
            "module-calver.yaml defines no jobs — the workflow would succeed vacuously",
        )


# ---------------------------------------------------------------------------
# TestCalVerWorkflowTriggers
# ---------------------------------------------------------------------------


class TestCalVerWorkflowTriggers(unittest.TestCase):
    """Verify the workflow fires at the right times for each job type."""

    def setUp(self):
        self.doc = _load_workflow()

    def test_triggers_on_pull_request(self):
        """
        The workflow must fire on pull_request so version mismatches are caught
        before any code reaches main.
        """
        triggers = _get_triggers(self.doc)
        self.assertIn(
            "pull_request",
            triggers,
            "module-calver.yaml is missing the 'pull_request' trigger — "
            "version validation will not run on PRs",
        )

    def test_triggers_on_push_to_main(self):
        """
        The workflow must fire on push to main so tags are created automatically
        after a merge without requiring manual intervention.
        """
        triggers = _get_triggers(self.doc)
        push_trigger = triggers.get("push", {})
        branches = push_trigger.get("branches", [])
        self.assertIn(
            "main",
            branches,
            "module-calver.yaml push trigger does not include 'main' — "
            "tags will not be created on merge",
        )


# ---------------------------------------------------------------------------
# TestCalVerWorkflowStructure
# ---------------------------------------------------------------------------


class TestCalVerWorkflowStructure(unittest.TestCase):
    """General structural checks shared across all jobs in the workflow."""

    def setUp(self):
        self.doc = _load_workflow()

    def test_all_jobs_run_on_ubuntu_latest(self):
        """All jobs must run on ubuntu-latest for consistency with other project workflows."""
        jobs = self.doc.get("jobs", {})
        for job_id, job in jobs.items():
            runs_on = job.get("runs-on", "")
            self.assertIn(
                "ubuntu",
                str(runs_on).lower(),
                f"Job '{job_id}' does not run on ubuntu-latest "
                f"(runs-on: {runs_on!r})",
            )

    def test_each_job_has_a_checkout_step(self):
        """Every job must check out the repository before running any script."""
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
                "scripts will run against an empty workspace",
            )

    def test_workflow_references_bump_module_version_script(self):
        """
        At least one step in the workflow must invoke scripts/bump-module-version.py
        so the script is actually used by CI and not just a dead artifact.
        """
        all_steps = _collect_all_steps(self.doc)
        bump_steps = [
            s
            for s in all_steps
            if "bump-module-version" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(bump_steps),
            0,
            "module-calver.yaml has no step that invokes 'bump-module-version' — "
            "the CalVer script would never be called by CI",
        )


# ---------------------------------------------------------------------------
# TestCalVerValidateVersionJob
# ---------------------------------------------------------------------------


class TestCalVerValidateVersionJob(unittest.TestCase):
    """
    Verify the PR-time validation job that checks whether the copier.yaml
    _metadata.version has been bumped to the expected CalVer before merge.
    """

    def setUp(self):
        self.doc = _load_workflow()
        # The validate job is identified by the keyword 'validate' in its id/name.
        self.validate_job = _find_job_by_keyword(self.doc, "validate")

    def test_validate_version_job_exists(self):
        """A job for validating module versions must exist in the workflow."""
        self.assertIsNotNone(
            self.validate_job,
            "module-calver.yaml has no job with 'validate' in its id or name — "
            "add a job that validates copier.yaml version on PRs",
        )

    def test_validate_job_uses_bump_script(self):
        """The validate job must invoke scripts/bump-module-version.py."""
        self.assertIsNotNone(self.validate_job, "validate job not found")
        steps = self.validate_job.get("steps", [])
        bump_steps = [
            s for s in steps if "bump-module-version" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(bump_steps),
            0,
            "The validate job has no step invoking 'bump-module-version' — "
            "it cannot determine the expected version without the script",
        )

    def test_validate_job_reads_copier_yaml(self):
        """
        The validate job must read or reference copier.yaml to extract the
        _metadata.version field so it can compare against the expected CalVer.
        """
        self.assertIsNotNone(self.validate_job, "validate job not found")
        steps = self.validate_job.get("steps", [])
        copier_refs = [
            s for s in steps if "copier.yaml" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(copier_refs),
            0,
            "The validate job has no step that references 'copier.yaml' — "
            "it cannot validate the version without reading the module metadata",
        )

    def test_validate_job_does_not_have_continue_on_error(self):
        """
        The validate job must NOT use continue-on-error: true — a version mismatch
        must block the PR, not be silently swallowed.
        """
        self.assertIsNotNone(self.validate_job, "validate job not found")
        steps = self.validate_job.get("steps", [])
        for step in steps:
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"Step '{step.get('name', '<unnamed>')}' in the validate job has "
                "continue-on-error: true — version failures must block the PR",
            )

    def test_validate_job_is_not_scoped_to_main_branch_only(self):
        """
        The validate job must not use an if-condition that restricts it to the
        main branch — it must run on every PR branch being merged.
        """
        self.assertIsNotNone(self.validate_job, "validate job not found")
        condition = self.validate_job.get("if", "")
        self.assertNotIn(
            "github.ref",
            str(condition),
            f"The validate job has a branch-scoped 'if' condition: {condition!r} — "
            "version validation must run on all PR branches, not just main",
        )

    def test_validate_job_does_not_require_contents_write(self):
        """
        The validate job only reads the repository — it must not request
        contents: write, which would grant unnecessary privileges.
        """
        self.assertIsNotNone(self.validate_job, "validate job not found")
        perms = self.validate_job.get("permissions", {})
        if isinstance(perms, dict):
            self.assertNotEqual(
                perms.get("contents"),
                "write",
                "The validate job should not request contents: write — "
                "validation is a read-only operation",
            )


# ---------------------------------------------------------------------------
# TestCalVerTagVersionJob
# ---------------------------------------------------------------------------


class TestCalVerTagVersionJob(unittest.TestCase):
    """
    Verify the merge-to-main job that creates git tags in the format
    modules/<name>@YYYYMMDD.Patch after a PR lands on main.
    """

    def setUp(self):
        self.doc = _load_workflow()
        # The tag job is identified by the keyword 'tag' in its id/name.
        self.tag_job = _find_job_by_keyword(self.doc, "tag")

    def test_tag_version_job_exists(self):
        """A job for creating module version tags must exist in the workflow."""
        self.assertIsNotNone(
            self.tag_job,
            "module-calver.yaml has no job with 'tag' in its id or name — "
            "add a job that creates git tags on merge to main",
        )

    def test_tag_job_uses_bump_script(self):
        """The tag job must invoke scripts/bump-module-version.py to compute the version."""
        self.assertIsNotNone(self.tag_job, "tag job not found")
        steps = self.tag_job.get("steps", [])
        bump_steps = [
            s for s in steps if "bump-module-version" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(bump_steps),
            0,
            "The tag job has no step invoking 'bump-module-version' — "
            "it cannot determine the version to tag without the script",
        )

    def test_tag_job_creates_a_git_tag(self):
        """
        The tag job must run a 'git tag' command so a tag is actually created.
        Without this the version information only lives in copier.yaml and is
        not recorded in the git object database.
        """
        self.assertIsNotNone(self.tag_job, "tag job not found")
        steps = self.tag_job.get("steps", [])
        git_tag_steps = [
            s
            for s in steps
            if "git tag" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(git_tag_steps),
            0,
            "The tag job has no step running 'git tag' — tags will never be created",
        )

    def test_tag_job_tag_format_includes_modules_prefix(self):
        """
        The git tag command must create tags under 'modules/' so all module
        version tags are clearly namespaced and easy to list with
        'git tag --list modules/*'.
        """
        self.assertIsNotNone(self.tag_job, "tag job not found")
        steps = self.tag_job.get("steps", [])
        git_tag_steps = [
            s
            for s in steps
            if "git tag" in str(s.get("run", ""))
        ]
        for step in git_tag_steps:
            run_cmd = str(step.get("run", ""))
            self.assertIn(
                "modules/",
                run_cmd,
                f"git tag command does not include 'modules/' namespace:\n{run_cmd}",
            )

    def test_tag_job_pushes_tag_to_remote(self):
        """
        The tag job must push the created tag to the remote repository with
        'git push' — locally created tags are invisible to other tools and
        consumers of the registry unless pushed.
        """
        self.assertIsNotNone(self.tag_job, "tag job not found")
        steps = self.tag_job.get("steps", [])
        push_steps = [
            s
            for s in steps
            if "git push" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(push_steps),
            0,
            "The tag job has no 'git push' step — created tags will not be visible remotely",
        )

    def test_tag_job_requires_contents_write_permission(self):
        """
        Pushing tags requires contents: write on the GITHUB_TOKEN.  The tag job
        must declare this permission explicitly; relying on a permissive default
        is fragile and violates least-privilege conventions.
        """
        self.assertIsNotNone(self.tag_job, "tag job not found")
        # Permission can be set at the workflow level or the job level.
        job_perms = self.tag_job.get("permissions", {})
        workflow_perms = self.doc.get("permissions", {})

        job_has_write = (
            isinstance(job_perms, dict) and job_perms.get("contents") == "write"
        )
        workflow_has_write = (
            isinstance(workflow_perms, dict) and workflow_perms.get("contents") == "write"
        )

        self.assertTrue(
            job_has_write or workflow_has_write,
            "Neither the tag job nor the workflow declares 'contents: write' — "
            "git push will fail without write permission on the GITHUB_TOKEN",
        )

    def test_tag_job_checkout_uses_full_history(self):
        """
        The tag job's checkout step must use fetch-depth: 0 (or a value > 1) so
        the full tag history is available when the bump script queries existing tags.
        A shallow clone (fetch-depth: 1) hides prior tags and would cause the
        patch counter to reset incorrectly on every run.
        """
        self.assertIsNotNone(self.tag_job, "tag job not found")
        steps = self.tag_job.get("steps", [])
        checkout_steps = [
            s for s in steps if "checkout" in str(s.get("uses", "")).lower()
        ]
        self.assertGreater(
            len(checkout_steps),
            0,
            "The tag job has no checkout step",
        )
        for co_step in checkout_steps:
            with_params = co_step.get("with", {})
            fetch_depth = with_params.get("fetch-depth", 1)
            self.assertEqual(
                fetch_depth,
                0,
                f"Tag job checkout step has fetch-depth: {fetch_depth} — "
                "use fetch-depth: 0 to ensure all prior version tags are visible",
            )

    def test_tag_job_only_runs_on_push_to_main(self):
        """
        The tag job must be restricted to push events on the main branch so tags
        are not created on every pull request.  An if condition on
        github.event_name == 'push' is the standard guard.
        """
        self.assertIsNotNone(self.tag_job, "tag job not found")
        condition = str(self.tag_job.get("if", ""))
        # Accept either a job-level if condition or verify the job only exists
        # in a workflow where the only trigger is push.  The latter is also fine.
        triggers = _get_triggers(self.doc)
        push_only_workflow = list(triggers.keys()) == ["push"]

        has_push_guard = (
            "push" in condition
            or "event_name" in condition
            or push_only_workflow
        )
        self.assertTrue(
            has_push_guard,
            "The tag job has no guard to prevent it running on pull_request events — "
            "tags would be created on every PR, not just on merge to main.  "
            "Add an 'if: github.event_name == \"push\"' condition or use separate workflows.",
        )

    def test_tag_job_does_not_have_continue_on_error(self):
        """
        Tag creation failures must not be silently swallowed — if a tag cannot
        be pushed, the job must fail visibly so the team can investigate.
        """
        self.assertIsNotNone(self.tag_job, "tag job not found")
        steps = self.tag_job.get("steps", [])
        for step in steps:
            if "git tag" in str(step.get("run", "")) or "git push" in str(step.get("run", "")):
                self.assertNotEqual(
                    step.get("continue-on-error"),
                    True,
                    f"Step '{step.get('name', '<unnamed>')}' in the tag job has "
                    "continue-on-error: true — tag creation failures must fail the job",
                )


# ---------------------------------------------------------------------------
# TestCalVerTagFormatContract
# ---------------------------------------------------------------------------


class TestCalVerTagFormatContract(unittest.TestCase):
    """
    Verify that the tag format used in the workflow matches the canonical
    spec: modules/<module-name>@YYYYMMDD.Patch
    (e.g. modules/python-service@20260304.0).

    These tests parse the workflow YAML looking for the tag-creation step
    and assert that its command embeds the correct format tokens.
    """

    def setUp(self):
        self.doc = _load_workflow()
        self.tag_job = _find_job_by_keyword(self.doc, "tag")

    def test_tag_format_uses_at_sign_separator(self):
        """
        The tag format must use '@' to separate module name from version
        (e.g. python-service@20260304.0), not '-' or '/' or '_'.
        """
        self.assertIsNotNone(self.tag_job, "tag job not found")
        steps = self.tag_job.get("steps", [])
        git_tag_steps = [
            s for s in steps if "git tag" in str(s.get("run", ""))
        ]
        for step in git_tag_steps:
            run_cmd = str(step.get("run", ""))
            self.assertIn(
                "@",
                run_cmd,
                f"git tag command does not use '@' as the name/version separator:\n{run_cmd}\n"
                "Expected format: modules/<name>@YYYYMMDD.Patch",
            )

    def test_tag_format_references_bump_script_output(self):
        """
        The version in the git tag command must come from the bump script's
        output (via a shell variable or interpolation), not be hardcoded.

        Hardcoding a version would cause every merge to create the same tag
        and git would reject it as a duplicate.
        """
        self.assertIsNotNone(self.tag_job, "tag job not found")
        steps = self.tag_job.get("steps", [])
        git_tag_steps = [
            s for s in steps if "git tag" in str(s.get("run", ""))
        ]
        for step in git_tag_steps:
            run_cmd = str(step.get("run", ""))
            # The version must be a shell variable reference ($VERSION, ${VERSION},
            # ${{ steps.xxx.outputs.version }}, etc.) — not a literal date.
            has_variable_ref = (
                "$VERSION" in run_cmd
                or "${VERSION}" in run_cmd
                or "${{ " in run_cmd
                or "$(python" in run_cmd
                or "$(cat" in run_cmd
            )
            self.assertTrue(
                has_variable_ref,
                f"git tag command appears to use a hardcoded version:\n{run_cmd}\n"
                "The version must come from the bump script's output via a variable",
            )


if __name__ == "__main__":
    unittest.main()
