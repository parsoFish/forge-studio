"""
Tests for the refactored gitweave-infra.yaml workflow that splits terraform
operations into two gated jobs: 'plan' (runs on PR) and 'apply' (runs on
merge to main, requires environment approval).

Acceptance criteria under test:
  - plan job triggers on pull_request with paths: infra/**
  - apply job triggers on push to main, has needs: [plan], uses environment: production
  - No -auto-approve flag in any terraform apply command
  - Plan artifact uploaded by plan job and downloaded by apply job
  - Minimal permissions: plan gets contents: read; apply gets id-token: write + contents: read
  - apply job does not run if plan job fails (enforced via needs:)

All tests in this file FAIL until .github/workflows/gitweave-infra.yaml is
refactored to satisfy the acceptance criteria (TDD red phase).
"""

import os
import unittest

import yaml


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORKFLOW_PATH = os.path.join(REPO_ROOT, ".github", "workflows", "gitweave-infra.yaml")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_workflow() -> dict:
    """Parse gitweave-infra.yaml and return the document dict."""
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


def _find_job_by_keyword(doc: dict, keyword: str) -> dict | None:
    """Return the first job whose id or name contains keyword (case-insensitive)."""
    kw = keyword.lower()
    for jid, job in doc.get("jobs", {}).items():
        if kw in jid.lower() or kw in str(job.get("name", "")).lower():
            return job
    return None


def _all_run_commands(doc: dict) -> str:
    """Return a single string with all 'run:' values across all jobs and steps."""
    return " ".join(str(s.get("run", "")) for s in _collect_all_steps(doc))


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------


class TestInfraWorkflowFileExists(unittest.TestCase):
    """Sanity checks that the file is present and parseable."""

    def test_workflow_yaml_exists_at_expected_path(self):
        """gitweave-infra.yaml must exist at .github/workflows/gitweave-infra.yaml."""
        self.assertTrue(
            os.path.isfile(WORKFLOW_PATH),
            ".github/workflows/gitweave-infra.yaml is missing",
        )

    def test_workflow_yaml_is_valid_yaml_mapping(self):
        """gitweave-infra.yaml must parse as a valid YAML mapping without syntax errors."""
        doc = _load_workflow()
        self.assertIsInstance(
            doc,
            dict,
            "gitweave-infra.yaml did not parse as a YAML mapping — possible syntax error",
        )

    def test_workflow_defines_exactly_two_jobs(self):
        """
        The refactored workflow must define exactly two jobs: 'plan' and 'apply'.
        A single monolithic job no longer satisfies the gating requirement.
        """
        doc = _load_workflow()
        jobs = doc.get("jobs", {})
        self.assertEqual(
            len(jobs),
            2,
            f"Expected exactly 2 jobs (plan, apply), found {len(jobs)}: {list(jobs.keys())}",
        )


class TestPlanJobTrigger(unittest.TestCase):
    """The plan job must only run on pull_request events targeting infra/."""

    def setUp(self):
        self.doc = _load_workflow()
        self.triggers = _get_triggers(self.doc)

    def test_workflow_triggers_on_pull_request(self):
        """Workflow must fire on pull_request so plan runs before any merge."""
        self.assertIn(
            "pull_request",
            self.triggers,
            "gitweave-infra.yaml is missing a 'pull_request' trigger — "
            "the plan job will not run on PRs",
        )

    def test_pull_request_trigger_scoped_to_infra_path(self):
        """
        The pull_request trigger must restrict to paths matching infra/**
        so the plan job only fires when infrastructure files are changed.
        """
        pr_trigger = self.triggers.get("pull_request") or {}
        if not isinstance(pr_trigger, dict):
            self.fail(
                "pull_request trigger is not a mapping — cannot verify path filter. "
                "Add 'paths: [\"infra/**\"]' to the trigger."
            )
        paths = pr_trigger.get("paths", [])
        has_infra_path = any("infra" in str(p) for p in paths)
        self.assertTrue(
            has_infra_path,
            f"pull_request trigger paths {paths!r} does not include an 'infra/**' filter. "
            "The plan job must only run when infra/ files are modified.",
        )

    def test_pull_request_path_filter_uses_glob_pattern(self):
        """
        The infra path filter must use a glob pattern (infra/**) to cover all
        files under infra/, not just infra/ root files.
        """
        pr_trigger = self.triggers.get("pull_request") or {}
        if not isinstance(pr_trigger, dict):
            return  # caught by previous test
        paths = pr_trigger.get("paths", [])
        deep_infra_filter = any(
            str(p).startswith("infra/") and "**" in str(p)
            for p in paths
        )
        self.assertTrue(
            deep_infra_filter,
            f"pull_request trigger paths {paths!r} should use 'infra/**' to cover "
            "subdirectories. A shallow filter risks missing nested terraform files.",
        )


class TestPlanJobStructure(unittest.TestCase):
    """Verify the plan job is correctly configured to run terraform plan."""

    def setUp(self):
        self.doc = _load_workflow()
        self.plan_job = _find_job(self.doc, "plan")

    def test_plan_job_exists_with_id_plan(self):
        """A job with id 'plan' must be defined in the workflow."""
        self.assertIsNotNone(
            self.plan_job,
            "No job with id 'plan' found in gitweave-infra.yaml. "
            "The refactored workflow must define a 'plan' job.",
        )

    def test_plan_job_runs_on_ubuntu_latest(self):
        """plan job must run on ubuntu-latest."""
        if self.plan_job is None:
            self.skipTest("plan job not found")
        runs_on = self.plan_job.get("runs-on", "")
        self.assertIn(
            "ubuntu",
            str(runs_on).lower(),
            f"plan job runs-on is {runs_on!r} — expected ubuntu-latest",
        )

    def test_plan_job_has_checkout_step(self):
        """plan job must check out the repository before running terraform."""
        if self.plan_job is None:
            self.skipTest("plan job not found")
        steps = self.plan_job.get("steps", [])
        checkout_steps = [s for s in steps if "checkout" in str(s.get("uses", "")).lower()]
        self.assertGreater(
            len(checkout_steps),
            0,
            "plan job has no checkout step — terraform will run against an empty workspace",
        )

    def test_plan_job_runs_terraform_init(self):
        """plan job must run 'terraform init' before plan."""
        if self.plan_job is None:
            self.skipTest("plan job not found")
        steps = self.plan_job.get("steps", [])
        init_steps = [
            s for s in steps if "terraform init" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(init_steps),
            0,
            "plan job has no 'terraform init' step — plan will fail without initializing providers",
        )

    def test_plan_job_runs_terraform_validate(self):
        """plan job must run 'terraform validate' to catch configuration errors early."""
        if self.plan_job is None:
            self.skipTest("plan job not found")
        steps = self.plan_job.get("steps", [])
        validate_steps = [
            s for s in steps if "terraform validate" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(validate_steps),
            0,
            "plan job has no 'terraform validate' step — configuration errors "
            "will not be caught before plan runs",
        )

    def test_plan_job_runs_terraform_plan(self):
        """plan job must execute 'terraform plan'."""
        if self.plan_job is None:
            self.skipTest("plan job not found")
        steps = self.plan_job.get("steps", [])
        plan_steps = [
            s for s in steps if "terraform plan" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(plan_steps),
            0,
            "plan job has no 'terraform plan' step",
        )

    def test_plan_job_saves_plan_file_as_artifact(self):
        """
        plan job must upload the plan file as an artifact so the apply job can
        download and use the exact plan that was reviewed.
        """
        if self.plan_job is None:
            self.skipTest("plan job not found")
        steps = self.plan_job.get("steps", [])
        upload_steps = [
            s for s in steps
            if "upload-artifact" in str(s.get("uses", ""))
            or "upload_artifact" in str(s.get("uses", ""))
        ]
        self.assertGreater(
            len(upload_steps),
            0,
            "plan job does not upload a plan artifact. Use 'actions/upload-artifact' "
            "to save the plan file so apply can reference it.",
        )

    def test_plan_artifact_upload_references_plan_file(self):
        """
        The artifact upload step must reference a terraform plan file
        (e.g., tfplan, plan.tfplan, or similar) — not just the working directory.
        """
        if self.plan_job is None:
            self.skipTest("plan job not found")
        steps = self.plan_job.get("steps", [])
        upload_steps = [
            s for s in steps
            if "upload-artifact" in str(s.get("uses", ""))
        ]
        for step in upload_steps:
            with_block = step.get("with", {}) or {}
            path_val = str(with_block.get("path", ""))
            name_val = str(with_block.get("name", ""))
            # The artifact must include a plan file reference
            has_plan_reference = (
                "plan" in path_val.lower()
                or "tfplan" in path_val.lower()
                or "plan" in name_val.lower()
            )
            self.assertTrue(
                has_plan_reference,
                f"Artifact upload step does not reference a plan file. "
                f"with.path={path_val!r}, with.name={name_val!r}. "
                "Save the plan output file (e.g. tfplan) as the artifact.",
            )


class TestPlanJobPermissions(unittest.TestCase):
    """plan job must use minimal permissions: contents: read only."""

    def setUp(self):
        self.doc = _load_workflow()
        self.plan_job = _find_job(self.doc, "plan")

    def _effective_permissions(self) -> dict:
        """Return merged permissions (workflow-level overridden by job-level)."""
        workflow_perms = self.doc.get("permissions") or {}
        if self.plan_job is None:
            return workflow_perms if isinstance(workflow_perms, dict) else {}
        job_perms = self.plan_job.get("permissions") or {}
        if isinstance(workflow_perms, dict) and isinstance(job_perms, dict):
            return {**workflow_perms, **job_perms}
        if isinstance(job_perms, dict):
            return job_perms
        return workflow_perms if isinstance(workflow_perms, dict) else {}

    def test_plan_job_has_explicit_permissions(self):
        """plan job (or the workflow) must declare explicit permissions."""
        if self.plan_job is None:
            self.skipTest("plan job not found")
        job_perms = self.plan_job.get("permissions")
        workflow_perms = self.doc.get("permissions")
        self.assertTrue(
            job_perms is not None or workflow_perms is not None,
            "plan job has no explicit permissions block. "
            "Add 'permissions: contents: read' to enforce least privilege.",
        )

    def test_plan_job_permissions_contents_is_read(self):
        """plan job must have contents: read permission."""
        if self.plan_job is None:
            self.skipTest("plan job not found")
        perms = self._effective_permissions()
        self.assertEqual(
            perms.get("contents"),
            "read",
            f"plan job permissions.contents is {perms.get('contents')!r}, expected 'read'",
        )

    def test_plan_job_does_not_have_id_token_write(self):
        """
        plan job must NOT have id-token: write — that permission is only needed
        by the apply job for OIDC authentication with the cloud provider.
        """
        if self.plan_job is None:
            self.skipTest("plan job not found")
        job_perms = self.plan_job.get("permissions") or {}
        if isinstance(job_perms, dict):
            self.assertNotEqual(
                job_perms.get("id-token"),
                "write",
                "plan job has 'id-token: write' — this permission is only needed by "
                "the apply job. Remove it from plan to enforce least privilege.",
            )


class TestApplyJobStructure(unittest.TestCase):
    """Verify the apply job is correctly configured as a gated deployment."""

    def setUp(self):
        self.doc = _load_workflow()
        self.apply_job = _find_job(self.doc, "apply")

    def test_apply_job_exists_with_id_apply(self):
        """A job with id 'apply' must be defined in the workflow."""
        self.assertIsNotNone(
            self.apply_job,
            "No job with id 'apply' found in gitweave-infra.yaml. "
            "The refactored workflow must define an 'apply' job.",
        )

    def test_apply_job_runs_on_ubuntu_latest(self):
        """apply job must run on ubuntu-latest."""
        if self.apply_job is None:
            self.skipTest("apply job not found")
        runs_on = self.apply_job.get("runs-on", "")
        self.assertIn(
            "ubuntu",
            str(runs_on).lower(),
            f"apply job runs-on is {runs_on!r} — expected ubuntu-latest",
        )

    def test_apply_job_has_checkout_step(self):
        """apply job must check out the repository before running terraform apply."""
        if self.apply_job is None:
            self.skipTest("apply job not found")
        steps = self.apply_job.get("steps", [])
        checkout_steps = [s for s in steps if "checkout" in str(s.get("uses", "")).lower()]
        self.assertGreater(
            len(checkout_steps),
            0,
            "apply job has no checkout step",
        )

    def test_apply_job_downloads_plan_artifact(self):
        """
        apply job must download the plan artifact produced by the plan job
        to ensure it applies the exact plan that was reviewed.
        """
        if self.apply_job is None:
            self.skipTest("apply job not found")
        steps = self.apply_job.get("steps", [])
        download_steps = [
            s for s in steps
            if "download-artifact" in str(s.get("uses", ""))
            or "download_artifact" in str(s.get("uses", ""))
        ]
        self.assertGreater(
            len(download_steps),
            0,
            "apply job does not download the plan artifact. Use 'actions/download-artifact' "
            "to retrieve the plan file saved by the plan job.",
        )

    def test_apply_job_runs_terraform_apply(self):
        """apply job must execute terraform apply."""
        if self.apply_job is None:
            self.skipTest("apply job not found")
        steps = self.apply_job.get("steps", [])
        apply_steps = [
            s for s in steps if "terraform apply" in str(s.get("run", ""))
        ]
        self.assertGreater(
            len(apply_steps),
            0,
            "apply job has no 'terraform apply' step",
        )


class TestApplyJobDependsOnPlan(unittest.TestCase):
    """apply job must depend on plan so it never runs if plan fails."""

    def setUp(self):
        self.doc = _load_workflow()
        self.apply_job = _find_job(self.doc, "apply")

    def test_apply_job_has_needs_plan(self):
        """
        apply job must declare 'needs: [plan]' (or equivalent) so GitHub Actions
        will block apply whenever plan fails or is skipped.
        """
        if self.apply_job is None:
            self.skipTest("apply job not found")
        needs = self.apply_job.get("needs", [])
        # needs can be a string or a list
        needs_list = [needs] if isinstance(needs, str) else list(needs)
        self.assertIn(
            "plan",
            needs_list,
            f"apply job 'needs' is {needs_list!r} — it must include 'plan' to block "
            "apply when plan fails. Add 'needs: [plan]' to the apply job.",
        )

    def test_apply_job_does_not_use_continue_on_error(self):
        """
        No step in the apply job may use continue-on-error: true — a failed
        apply must surface as a job failure, not be silently swallowed.
        """
        if self.apply_job is None:
            self.skipTest("apply job not found")
        for step in self.apply_job.get("steps", []):
            self.assertNotEqual(
                step.get("continue-on-error"),
                True,
                f"apply step '{step.get('name', '<unnamed>')}' has continue-on-error: true — "
                "apply failures must fail the job",
            )


class TestApplyJobTriggersOnMainOnly(unittest.TestCase):
    """apply job must only run on push to main, never on pull_request."""

    def setUp(self):
        self.doc = _load_workflow()
        self.triggers = _get_triggers(self.doc)

    def test_workflow_triggers_on_push_to_main(self):
        """Workflow must fire on push to main so apply can run after merge."""
        push_trigger = self.triggers.get("push", {})
        branches = push_trigger.get("branches", []) if isinstance(push_trigger, dict) else []
        self.assertIn(
            "main",
            branches,
            "gitweave-infra.yaml push trigger does not include 'main' — "
            "apply will not run after merging to main",
        )

    def test_push_trigger_scoped_to_infra_path(self):
        """
        The push trigger must also restrict to infra/** paths so apply only
        fires when infrastructure code is actually merged, not on every push.
        """
        push_trigger = self.triggers.get("push", {}) or {}
        if not isinstance(push_trigger, dict):
            self.fail("push trigger is not a mapping — cannot verify path filter")
        paths = push_trigger.get("paths", [])
        has_infra_path = any("infra" in str(p) for p in paths)
        self.assertTrue(
            has_infra_path,
            f"push trigger paths {paths!r} does not include 'infra/**'. "
            "Scope the push trigger to infra/ to avoid unnecessary apply runs.",
        )


class TestApplyJobUsesEnvironmentGate(unittest.TestCase):
    """apply job must reference the 'production' GitHub environment for approval gates."""

    def setUp(self):
        self.doc = _load_workflow()
        self.apply_job = _find_job(self.doc, "apply")

    def test_apply_job_declares_environment_production(self):
        """
        apply job must use 'environment: production' so GitHub enforces any
        required reviewers configured on the production environment before the
        job starts.  Without this, apply runs immediately without human approval.
        """
        if self.apply_job is None:
            self.skipTest("apply job not found")
        environment = self.apply_job.get("environment")
        # environment can be a string or a mapping with name/url keys
        env_name = (
            environment
            if isinstance(environment, str)
            else (environment or {}).get("name", "")
        )
        self.assertEqual(
            env_name,
            "production",
            f"apply job environment is {environment!r}, expected 'production'. "
            "Set 'environment: production' to require human approval before apply.",
        )


class TestApplyJobPermissions(unittest.TestCase):
    """apply job must have id-token: write + contents: read for OIDC cloud auth."""

    def setUp(self):
        self.doc = _load_workflow()
        self.apply_job = _find_job(self.doc, "apply")

    def _job_permissions(self) -> dict:
        """Return the apply job's own permissions block (not workflow-level)."""
        if self.apply_job is None:
            return {}
        return self.apply_job.get("permissions") or {}

    def test_apply_job_has_explicit_job_level_permissions(self):
        """
        apply job must declare its own permissions block, not rely solely on
        the workflow-level block — the permissions are intentionally broader
        than plan and must be scoped to just this job.
        """
        if self.apply_job is None:
            self.skipTest("apply job not found")
        job_perms = self.apply_job.get("permissions")
        self.assertIsNotNone(
            job_perms,
            "apply job has no job-level permissions block. "
            "Declare explicit permissions on the apply job: "
            "id-token: write, contents: read",
        )

    def test_apply_job_permissions_id_token_is_write(self):
        """apply job must have id-token: write for OIDC authentication."""
        if self.apply_job is None:
            self.skipTest("apply job not found")
        perms = self._job_permissions()
        self.assertEqual(
            perms.get("id-token"),
            "write",
            f"apply job permissions.id-token is {perms.get('id-token')!r}, expected 'write'. "
            "OIDC cloud authentication requires id-token: write.",
        )

    def test_apply_job_permissions_contents_is_read(self):
        """apply job must have contents: read in addition to id-token: write."""
        if self.apply_job is None:
            self.skipTest("apply job not found")
        perms = self._job_permissions()
        self.assertEqual(
            perms.get("contents"),
            "read",
            f"apply job permissions.contents is {perms.get('contents')!r}, expected 'read'",
        )

    def test_apply_job_permissions_grant_no_unnecessary_scopes(self):
        """
        apply job must not grant permissions beyond id-token: write and
        contents: read — any additional scope is a security over-grant.
        """
        if self.apply_job is None:
            self.skipTest("apply job not found")
        perms = self._job_permissions()
        if not isinstance(perms, dict):
            return
        allowed = {"id-token": "write", "contents": "read"}
        unexpected = {
            k: v for k, v in perms.items()
            if not (allowed.get(k) == v)
        }
        self.assertEqual(
            unexpected,
            {},
            f"apply job grants unexpected permissions: {unexpected!r}. "
            "Permitted scopes are id-token: write and contents: read only.",
        )


class TestNoAutoApproveFlag(unittest.TestCase):
    """
    The -auto-approve flag must never appear in any terraform command.
    Its presence would bypass the environment approval gate entirely.
    """

    def setUp(self):
        self.doc = _load_workflow()

    def test_no_auto_approve_in_any_run_command(self):
        """
        -auto-approve must not appear anywhere in the workflow — not in
        terraform apply, not as a variable, not in a comment embedded in
        a run: block.
        """
        all_runs = _all_run_commands(self.doc)
        self.assertNotIn(
            "-auto-approve",
            all_runs,
            "Found '-auto-approve' in a run command. This flag bypasses the environment "
            "approval gate and must be removed from all terraform commands.",
        )

    def test_no_auto_approve_in_plan_job(self):
        """plan job must not contain -auto-approve in any step."""
        plan_job = _find_job(self.doc, "plan")
        if plan_job is None:
            self.skipTest("plan job not found")
        run_text = " ".join(str(s.get("run", "")) for s in plan_job.get("steps", []))
        self.assertNotIn(
            "-auto-approve",
            run_text,
            "plan job contains '-auto-approve' in a run step — "
            "plan steps must never apply changes",
        )

    def test_no_auto_approve_in_apply_job(self):
        """apply job must not contain -auto-approve — approval comes from the environment gate."""
        apply_job = _find_job(self.doc, "apply")
        if apply_job is None:
            self.skipTest("apply job not found")
        run_text = " ".join(str(s.get("run", "")) for s in apply_job.get("steps", []))
        self.assertNotIn(
            "-auto-approve",
            run_text,
            "apply job contains '-auto-approve'. Remove this flag — the environment "
            "approval gate replaces the need for auto-approve.",
        )


class TestArtifactHandshake(unittest.TestCase):
    """
    Verify the plan file flows correctly from the plan job to the apply job
    via GitHub Actions artifacts, ensuring apply uses the reviewed plan.
    """

    def setUp(self):
        self.doc = _load_workflow()
        self.plan_job = _find_job(self.doc, "plan")
        self.apply_job = _find_job(self.doc, "apply")

    def _upload_step(self) -> dict | None:
        if self.plan_job is None:
            return None
        for step in self.plan_job.get("steps", []):
            if "upload-artifact" in str(step.get("uses", "")):
                return step
        return None

    def _download_step(self) -> dict | None:
        if self.apply_job is None:
            return None
        for step in self.apply_job.get("steps", []):
            if "download-artifact" in str(step.get("uses", "")):
                return step
        return None

    def test_artifact_name_matches_between_upload_and_download(self):
        """
        The artifact name used in the plan job upload must match the name
        used in the apply job download — a mismatch silently downloads nothing.
        """
        upload_step = self._upload_step()
        download_step = self._download_step()
        if upload_step is None or download_step is None:
            self.skipTest("upload or download artifact step not found")

        upload_name = (upload_step.get("with") or {}).get("name", "")
        download_name = (download_step.get("with") or {}).get("name", "")

        self.assertEqual(
            upload_name,
            download_name,
            f"Artifact name mismatch: upload uses {upload_name!r} but download uses "
            f"{download_name!r}. These must match exactly or the apply job will not "
            "receive the plan file.",
        )

    def test_plan_job_saves_plan_to_file_before_upload(self):
        """
        The plan step must write the plan to a file (e.g. -out=tfplan) so
        it can be uploaded as an artifact — an in-memory plan cannot be shared.
        """
        if self.plan_job is None:
            self.skipTest("plan job not found")
        steps = self.plan_job.get("steps", [])
        plan_steps = [s for s in steps if "terraform plan" in str(s.get("run", ""))]
        has_out_flag = any(
            "-out" in str(s.get("run", ""))
            for s in plan_steps
        )
        self.assertTrue(
            has_out_flag,
            "terraform plan step does not use '-out=<file>' to save the plan. "
            "Without this flag, the plan cannot be uploaded as an artifact.",
        )


class TestWorkflowLevelPermissions(unittest.TestCase):
    """
    The workflow-level permissions block must set a safe default so jobs
    that don't declare their own permissions don't inherit overly broad access.
    """

    def setUp(self):
        self.doc = _load_workflow()

    def test_workflow_has_top_level_permissions_block(self):
        """Workflow must declare a top-level permissions block."""
        self.assertIn(
            "permissions",
            self.doc,
            "gitweave-infra.yaml has no top-level permissions block. "
            "Declare permissions explicitly to avoid the broad default GITHUB_TOKEN access.",
        )

    def test_workflow_level_permissions_do_not_grant_id_token_write(self):
        """
        The workflow-level permissions must NOT grant id-token: write globally.
        That permission is only needed by the apply job and must be scoped there.
        Granting it at workflow level gives the plan job unnecessary cloud auth access.
        """
        workflow_perms = self.doc.get("permissions") or {}
        if isinstance(workflow_perms, dict):
            self.assertNotEqual(
                workflow_perms.get("id-token"),
                "write",
                "Workflow-level permissions grant 'id-token: write' globally. "
                "Move this to the apply job's own permissions block only.",
            )


class TestNoMonolithicTerraformJob(unittest.TestCase):
    """
    Guard against the old monolithic job being left in place or partially
    refactored with only superficial changes.
    """

    def setUp(self):
        self.doc = _load_workflow()

    def test_no_single_job_runs_both_plan_and_apply(self):
        """
        No single job must run both terraform plan AND terraform apply.
        That would defeat the purpose of the gated two-job split.
        """
        for job_id, job in self.doc.get("jobs", {}).items():
            steps = job.get("steps", [])
            runs_plan = any("terraform plan" in str(s.get("run", "")) for s in steps)
            runs_apply = any("terraform apply" in str(s.get("run", "")) for s in steps)
            self.assertFalse(
                runs_plan and runs_apply,
                f"Job '{job_id}' runs both terraform plan AND terraform apply. "
                "These must be split into separate jobs with the apply job gated "
                "behind environment approval.",
            )

    def test_old_monolithic_job_named_terraform_no_longer_exists(self):
        """
        The old single-job named 'terraform' (or 'Terraform') must not exist
        in the refactored workflow — it has been replaced by plan + apply.
        """
        jobs = self.doc.get("jobs", {})
        for job_id, job in jobs.items():
            is_old_terraform_job = (
                job_id.lower() == "terraform"
                and str(job.get("name", "")).lower() == "terraform"
            )
            self.assertFalse(
                is_old_terraform_job,
                f"The old monolithic 'terraform' job still exists as job id '{job_id}'. "
                "Replace it with the separate 'plan' and 'apply' jobs.",
            )


if __name__ == "__main__":
    unittest.main()


class TestApplyJobIfGuard(unittest.TestCase):
    """apply job must have an explicit if: guard restricting it to push events on main."""

    def setUp(self):
        self.doc = _load_workflow()
        self.apply_job = _find_job(self.doc, "apply")

    def test_apply_job_has_if_condition(self):
        """apply job must declare an if: condition to prevent running on PRs."""
        if self.apply_job is None:
            self.skipTest("apply job not found")
        self.assertIn(
            "if",
            self.apply_job,
            "apply job has no 'if:' condition. Without an if: guard the job runs "
            "on every trigger including pull_request, which forces every PR through "
            "the production environment approval gate.",
        )

    def test_apply_job_if_guard_restricts_to_push_event(self):
        """apply job if: guard must check for push event type."""
        if self.apply_job is None:
            self.skipTest("apply job not found")
        if_condition = str(self.apply_job.get("if", ""))
        self.assertIn(
            "push",
            if_condition,
            f"apply job if: guard is {if_condition!r} — it must check "
            "'github.event_name == \"push\"' to prevent running on pull_request events.",
        )

    def test_apply_job_if_guard_restricts_to_main_ref(self):
        """apply job if: guard must restrict to refs/heads/main to prevent apply on non-main branches."""
        if self.apply_job is None:
            self.skipTest("apply job not found")
        if_condition = str(self.apply_job.get("if", ""))
        self.assertIn(
            "main",
            if_condition,
            f"apply job if: guard is {if_condition!r} — it must check "
            "'github.ref == \"refs/heads/main\"' to prevent apply running on "
            "non-main branch pushes or workflow_dispatch on feature branches.",
        )
