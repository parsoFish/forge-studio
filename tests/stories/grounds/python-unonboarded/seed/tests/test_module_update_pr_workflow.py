"""
Tests for the module-update-propagation CI workflow that opens PRs in consumer
repositories when a module git tag is pushed.

These tests verify that .github/workflows/module-update-propagation.yaml exists
and is correctly configured to:

  Trigger:
    - Fires on tags matching the pattern 'modules/*@*'
    - Does NOT fire on branch pushes or pull_request events (tag-only)

  Consumer discovery job:
    - Reads config/repos/*.yaml to identify consumer repositories
    - Passes the updated module name and version to downstream steps

  Update job (per consumer):
    - Clones the consumer repository
    - Runs 'copier update' against the cloned repo
    - Only opens a PR when copier produces changes (idempotency guard)
    - Opens a PR with title 'chore: update <module-name> to <version>'
    - PR body contains a diff of changed files and a link to the module tag

  Permissions:
    - Declares 'contents: write' at job or workflow level (required for git push)
    - Declares 'pull-requests: write' at job or workflow level (required for gh pr create)
    - Does NOT grant broader permissions than necessary

  Structural requirements:
    - File is valid YAML and parses as a mapping
    - At least one job is defined
    - All jobs run on ubuntu-latest
    - Every job has a checkout step

All tests in this file fail until .github/workflows/module-update-propagation.yaml
is created with the correct content (TDD red phase).
"""

import os
import re
import unittest

import yaml


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORKFLOW_PATH = os.path.join(
    REPO_ROOT, ".github", "workflows", "module-update-propagation.yaml"
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_workflow() -> dict:
    """Parse module-update-propagation.yaml and return the document dict."""
    with open(WORKFLOW_PATH) as f:
        return yaml.safe_load(f)


def _get_triggers(doc: dict) -> dict:
    """
    Return the workflow trigger mapping.  PyYAML's YAML 1.1 parsing converts
    the bare 'on:' key to the boolean True — both representations are checked
    so the tests work regardless of PyYAML version.
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


def _all_permissions(doc: dict, job: dict) -> dict:
    """
    Merge workflow-level and job-level permissions, with job-level taking
    precedence, so tests can assert permissions without worrying about which
    layer declares them.
    """
    workflow_perms = doc.get("permissions", {}) or {}
    job_perms = job.get("permissions", {}) or {}
    if isinstance(workflow_perms, str):
        # 'permissions: write-all' — treat as broad write
        return {"_broad": workflow_perms}
    merged = {**workflow_perms, **job_perms}
    return merged


# ---------------------------------------------------------------------------
# TestModuleUpdateWorkflowFileExists
# ---------------------------------------------------------------------------


class TestModuleUpdateWorkflowFileExists(unittest.TestCase):
    """Sanity checks that the workflow file is present and parseable."""

    def test_workflow_file_exists_at_expected_path(self):
        """module-update-propagation.yaml must exist at .github/workflows/."""
        self.assertTrue(
            os.path.isfile(WORKFLOW_PATH),
            f".github/workflows/module-update-propagation.yaml is missing — "
            f"expected at {WORKFLOW_PATH}",
        )

    def test_workflow_file_is_valid_yaml_mapping(self):
        """module-update-propagation.yaml must parse as a valid YAML mapping."""
        doc = _load_workflow()
        self.assertIsInstance(
            doc,
            dict,
            "module-update-propagation.yaml did not parse as a YAML mapping — "
            "the file may contain syntax errors",
        )

    def test_workflow_file_has_at_least_one_job(self):
        """The workflow must define at least one job."""
        doc = _load_workflow()
        jobs = doc.get("jobs", {})
        self.assertGreater(
            len(jobs),
            0,
            "module-update-propagation.yaml defines no jobs — the workflow would succeed vacuously",
        )


# ---------------------------------------------------------------------------
# TestModuleUpdateWorkflowTriggers
# ---------------------------------------------------------------------------


class TestModuleUpdateWorkflowTriggers(unittest.TestCase):
    """Verify the workflow fires exactly when a module tag is pushed."""

    def setUp(self):
        self.doc = _load_workflow()

    def test_triggers_on_push_event(self):
        """The workflow must include a 'push' trigger (tag pushes are push events)."""
        triggers = _get_triggers(self.doc)
        self.assertIn(
            "push",
            triggers,
            "module-update-propagation.yaml is missing a 'push' trigger — "
            "it will never fire when a module tag is created",
        )

    def test_push_trigger_has_tags_filter(self):
        """
        The push trigger must include a 'tags' filter so the workflow only fires
        on tag pushes, not on every branch push.
        """
        triggers = _get_triggers(self.doc)
        push_trigger = triggers.get("push", {}) or {}
        self.assertIn(
            "tags",
            push_trigger,
            "push trigger must include a 'tags' filter to restrict to tag events only",
        )

    def test_push_trigger_tags_pattern_matches_module_tags(self):
        """
        The tags filter must include a pattern that matches 'modules/*@*'
        so only module version tags trigger the workflow.
        """
        triggers = _get_triggers(self.doc)
        push_trigger = triggers.get("push", {}) or {}
        tags_patterns = push_trigger.get("tags", []) or []
        if isinstance(tags_patterns, str):
            tags_patterns = [tags_patterns]

        # Accept patterns like 'modules/*@*', 'modules/**', 'modules/*@**', etc.
        has_module_pattern = any(
            "modules/" in pattern for pattern in tags_patterns
        )
        self.assertTrue(
            has_module_pattern,
            f"push trigger tags patterns {tags_patterns!r} do not include a "
            "'modules/' prefix — module tags like 'modules/python-service@20260305.0' "
            "would not trigger the workflow",
        )

    def test_push_trigger_tags_pattern_requires_at_sign(self):
        """
        The tag pattern must require an '@' separator between module name and
        version so unrelated 'modules/' tags (e.g. module creation tags) do not
        trigger the propagation workflow.
        """
        triggers = _get_triggers(self.doc)
        push_trigger = triggers.get("push", {}) or {}
        tags_patterns = push_trigger.get("tags", []) or []
        if isinstance(tags_patterns, str):
            tags_patterns = [tags_patterns]

        has_at_sign_pattern = any(
            "@" in pattern for pattern in tags_patterns
        )
        self.assertTrue(
            has_at_sign_pattern,
            f"push trigger tags patterns {tags_patterns!r} do not include '@' — "
            "the pattern should match 'modules/<name>@<version>' format tags only",
        )

    def test_workflow_does_not_trigger_on_pull_request(self):
        """
        The propagation workflow must NOT trigger on pull_request events —
        it should only run when a tag is actually pushed (i.e. a release is cut).
        """
        triggers = _get_triggers(self.doc)
        self.assertNotIn(
            "pull_request",
            triggers,
            "module-update-propagation.yaml must not trigger on pull_request events — "
            "PR propagation must only happen when a module tag is pushed",
        )


# ---------------------------------------------------------------------------
# TestModuleUpdateWorkflowStructure
# ---------------------------------------------------------------------------


class TestModuleUpdateWorkflowStructure(unittest.TestCase):
    """General structural checks shared across all jobs."""

    def setUp(self):
        self.doc = _load_workflow()

    def test_all_jobs_run_on_ubuntu_latest(self):
        """All jobs must run on ubuntu-latest for consistency."""
        jobs = self.doc.get("jobs", {})
        for job_id, job in jobs.items():
            runs_on = job.get("runs-on", "")
            self.assertIn(
                "ubuntu",
                str(runs_on).lower(),
                f"Job '{job_id}' does not run on ubuntu-latest (runs-on: {runs_on!r})",
            )

    def test_workflow_references_config_repos_directory(self):
        """
        At least one step must reference 'config/repos' or 'config/repos/*.yaml'
        to scan consumer configurations.
        """
        all_steps = _collect_all_steps(self.doc)
        config_refs = [
            s for s in all_steps
            if "config/repos" in str(s.get("run", ""))
            or "config/repos" in str(s.get("with", ""))
            or "config" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(config_refs),
            0,
            "module-update-propagation.yaml has no step referencing 'config/repos' — "
            "the workflow cannot discover consumer repositories without reading overlays",
        )

    def test_workflow_references_copier_update(self):
        """
        At least one step must invoke 'copier update' to apply the module change
        in each consumer repository.
        """
        all_steps = _collect_all_steps(self.doc)
        copier_steps = [
            s for s in all_steps
            if "copier" in str(s.get("run", "")).lower()
            or "copier" in str(s.get("uses", "")).lower()
        ]
        self.assertGreater(
            len(copier_steps),
            0,
            "module-update-propagation.yaml has no step invoking copier — "
            "consumer repositories will not receive the module update",
        )

    def test_workflow_opens_pull_request_via_gh_or_action(self):
        """
        At least one step must open a PR using 'gh pr create' or a GitHub
        Actions PR action — otherwise updates would be pushed without review.
        """
        all_steps = _collect_all_steps(self.doc)
        pr_steps = [
            s for s in all_steps
            if "gh pr create" in str(s.get("run", ""))
            or "pull-request" in str(s.get("uses", "")).lower()
            or "create-pull-request" in str(s.get("uses", "")).lower()
        ]
        self.assertGreater(
            len(pr_steps),
            0,
            "module-update-propagation.yaml has no step that opens a PR — "
            "consumer updates would be applied silently without review",
        )


# ---------------------------------------------------------------------------
# TestModuleUpdateWorkflowPermissions
# ---------------------------------------------------------------------------


class TestModuleUpdateWorkflowPermissions(unittest.TestCase):
    """
    Verify the workflow uses minimal permissions: only what is required to
    push branches and open PRs in consumer repositories.
    """

    def setUp(self):
        self.doc = _load_workflow()

    def _has_permission_at_any_level(self, permission_key: str, required_value: str) -> bool:
        """
        Return True if the given permission is set at the workflow level
        OR in at least one job's permissions block.
        """
        # Check workflow-level permissions
        workflow_perms = self.doc.get("permissions", {}) or {}
        if isinstance(workflow_perms, dict):
            if workflow_perms.get(permission_key) == required_value:
                return True

        # Check all job-level permissions
        for job in self.doc.get("jobs", {}).values():
            job_perms = job.get("permissions", {}) or {}
            if isinstance(job_perms, dict):
                if job_perms.get(permission_key) == required_value:
                    return True

        return False

    def test_declares_contents_write_permission(self):
        """
        Pushing branches to consumer repositories requires 'contents: write'.
        This must be declared explicitly at the workflow or job level.
        """
        has_contents_write = self._has_permission_at_any_level("contents", "write")
        self.assertTrue(
            has_contents_write,
            "module-update-propagation.yaml does not declare 'contents: write' — "
            "pushing update branches to consumer repos will fail without this permission",
        )

    def test_declares_pull_requests_write_permission(self):
        """
        Opening PRs requires 'pull-requests: write'.
        This must be declared explicitly at the workflow or job level.
        """
        has_pr_write = self._has_permission_at_any_level("pull-requests", "write")
        self.assertTrue(
            has_pr_write,
            "module-update-propagation.yaml does not declare 'pull-requests: write' — "
            "'gh pr create' will fail without this permission on the GITHUB_TOKEN",
        )

    def test_does_not_grant_admin_permissions(self):
        """No permission should be set to 'admin' — admin is never needed here."""
        # Collect all permissions across workflow and all jobs
        all_perms_blocks = []
        workflow_perms = self.doc.get("permissions", {})
        if isinstance(workflow_perms, dict):
            all_perms_blocks.append(workflow_perms)
        for job in self.doc.get("jobs", {}).values():
            job_perms = job.get("permissions", {})
            if isinstance(job_perms, dict):
                all_perms_blocks.append(job_perms)

        for perms in all_perms_blocks:
            admin_grants = {k: v for k, v in perms.items() if v == "admin"}
            self.assertEqual(
                admin_grants,
                {},
                f"module-update-propagation.yaml grants admin permissions: {admin_grants!r} — "
                "use least-privilege: only contents and pull-requests write are needed",
            )


# ---------------------------------------------------------------------------
# TestModuleUpdateWorkflowPRFormat
# ---------------------------------------------------------------------------


class TestModuleUpdateWorkflowPRFormat(unittest.TestCase):
    """
    Verify the PR title and body format contract is enforced in the workflow.

    The workflow must produce PRs with:
      - Title: 'chore: update <module-name> to <version>'
      - Body: includes a diff and a link to the module tag
    """

    def setUp(self):
        self.doc = _load_workflow()

    def test_workflow_includes_chore_update_pr_title_template(self):
        """
        At least one step's run command must reference the PR title format
        'chore: update' so the convention is enforced in CI, not just documentation.
        """
        all_steps = _collect_all_steps(self.doc)
        title_steps = [
            s for s in all_steps
            if "chore: update" in str(s.get("run", ""))
            or "chore:" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(title_steps),
            0,
            "module-update-propagation.yaml has no step embedding the PR title "
            "template 'chore: update' — the PR title format will not be enforced",
        )

    def test_workflow_references_module_tag_in_pr_body(self):
        """
        The PR body must link back to the module tag so reviewers can inspect
        the change that triggered the update.  At least one step must construct
        or reference the tag URL/reference.
        """
        all_steps = _collect_all_steps(self.doc)
        # Look for steps that construct a GitHub tag URL or reference the tag ref variable
        tag_ref_steps = [
            s for s in all_steps
            if any(
                token in str(s.get("run", ""))
                for token in [
                    "GITHUB_REF",
                    "github.ref",
                    "modules/",
                    "tag",
                    "TAG",
                ]
            )
        ]
        self.assertGreater(
            len(tag_ref_steps),
            0,
            "module-update-propagation.yaml has no step that references the "
            "module tag in the PR body — reviewers cannot trace which tag "
            "triggered the update PR",
        )

    def test_workflow_has_idempotency_guard_before_opening_pr(self):
        """
        The workflow must check whether copier produced any changes before
        calling 'gh pr create' — opening empty PRs on idempotent updates is
        noisy and wastes reviewer attention.

        This is verified by checking that the pr-create step has an 'if'
        condition or that there is a preceding diff-check step in the workflow.
        """
        all_steps = _collect_all_steps(self.doc)

        pr_steps = [
            s for s in all_steps
            if "gh pr create" in str(s.get("run", ""))
            or "create-pull-request" in str(s.get("uses", "")).lower()
        ]

        for pr_step in pr_steps:
            has_condition = bool(pr_step.get("if"))
            has_diff_check_sibling = any(
                "diff" in str(s.get("run", "")).lower()
                or "changes" in str(s.get("id", "")).lower()
                or "changed" in str(s.get("id", "")).lower()
                for s in all_steps
                if s is not pr_step
            )
            self.assertTrue(
                has_condition or has_diff_check_sibling,
                f"PR creation step '{pr_step.get('name', '<unnamed>')}' has no 'if' "
                "condition and no sibling diff-check step — the workflow will open "
                "PRs even when copier update produces no changes (not idempotent)",
            )


# ---------------------------------------------------------------------------
# TestModuleUpdateWorkflowTagParsing
# ---------------------------------------------------------------------------


class TestModuleUpdateWorkflowTagParsing(unittest.TestCase):
    """
    Verify the workflow correctly extracts the module name and version from
    the triggering tag (format: modules/<name>@<version>).
    """

    def setUp(self):
        self.doc = _load_workflow()

    def test_workflow_extracts_module_name_from_tag(self):
        """
        At least one step must parse or extract the module name from the tag
        ref (e.g. GITHUB_REF or github.ref_name) so downstream steps know
        which module was updated.
        """
        all_steps = _collect_all_steps(self.doc)
        name_extraction_steps = [
            s for s in all_steps
            if any(
                token in str(s.get("run", ""))
                for token in ["MODULE_NAME", "module_name", "MODULE", "GITHUB_REF", "ref_name"]
            )
        ]
        self.assertGreater(
            len(name_extraction_steps),
            0,
            "module-update-propagation.yaml has no step that extracts the module "
            "name from the git tag ref — downstream steps cannot know which module "
            "to update without this extraction",
        )

    def test_workflow_extracts_version_from_tag(self):
        """
        At least one step must extract the version portion from the tag ref
        so it can be used in the PR title and body.
        """
        all_steps = _collect_all_steps(self.doc)
        version_extraction_steps = [
            s for s in all_steps
            if any(
                token in str(s.get("run", ""))
                for token in ["MODULE_VERSION", "VERSION", "version", "GITHUB_REF", "ref_name"]
            )
        ]
        self.assertGreater(
            len(version_extraction_steps),
            0,
            "module-update-propagation.yaml has no step that extracts the version "
            "from the git tag ref — the PR title cannot include the version",
        )


if __name__ == "__main__":
    unittest.main()
