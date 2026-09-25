"""
Structural tests for .github/workflows/gitweave-apply.yaml after replacing
the echo stub with a real apply-overlays.py invocation.

These tests verify (without executing the workflow) that:

  Stub removal:
    - The echo placeholder lines are no longer present
    - The step no longer uses 'ls -R config/'

  Script invocation:
    - A step calls 'python3 scripts/apply-overlays.py'
    - The script is invoked with 'config/repos/' as the directory argument

  Python setup:
    - A step sets up Python 3.12 (actions/setup-python@v5 or later)
    - A step runs 'pip install' including 'copier', 'pyyaml', and 'jsonschema'

  Permissions:
    - The workflow or apply job declares 'contents: write'
    - The workflow or apply job declares 'pull-requests: write'

  GITHUB_TOKEN:
    - GITHUB_TOKEN is passed as an env var to the apply-overlays step

  Trigger paths:
    - The push trigger includes a path filter covering 'config/**'
    - The workflow_dispatch trigger is present

  General:
    - The workflow file is valid YAML (parseable by PyYAML)
    - The workflow still targets 'ubuntu-latest'

All tests will fail until the stub is replaced with the real implementation.
"""

from __future__ import annotations

import os
import unittest

import yaml

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
WORKFLOW_FILE = os.path.join(REPO_ROOT, ".github", "workflows", "gitweave-apply.yaml")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_raw() -> str:
    if not os.path.exists(WORKFLOW_FILE):
        return ""
    with open(WORKFLOW_FILE) as f:
        return f.read()


def _load_yaml() -> dict:
    raw = _read_raw()
    if not raw:
        return {}
    return yaml.safe_load(raw) or {}


def _get_triggers(doc: dict) -> dict:
    """Handle PyYAML's YAML 1.1 quirk where bare `on:` parses as boolean True."""
    return doc.get("on") or doc.get(True) or {}


def _all_steps(doc: dict) -> list[dict]:
    """Return every step across all jobs."""
    steps: list[dict] = []
    for job in doc.get("jobs", {}).values():
        steps.extend(job.get("steps", []) or [])
    return steps


def _step_run_blocks(doc: dict) -> list[str]:
    """Return the 'run:' text from every step that has one."""
    return [str(s.get("run", "")) for s in _all_steps(doc) if s.get("run")]


def _permissions(doc: dict) -> dict:
    """
    Return the effective permissions mapping. Checks workflow-level first,
    then falls back to the 'apply' job permissions.
    """
    if "permissions" in doc:
        perms = doc["permissions"]
        if isinstance(perms, dict):
            return perms
    for job in doc.get("jobs", {}).values():
        if "permissions" in job and isinstance(job["permissions"], dict):
            return job["permissions"]
    return {}


# ---------------------------------------------------------------------------
# File existence and validity
# ---------------------------------------------------------------------------


class TestWorkflowFileExistsAndValid(unittest.TestCase):
    """The workflow file must exist and be valid YAML."""

    def test_workflow_file_exists(self):
        """gitweave-apply.yaml must exist at .github/workflows/."""
        self.assertTrue(
            os.path.isfile(WORKFLOW_FILE),
            f"Workflow file not found: {WORKFLOW_FILE}",
        )

    def test_workflow_file_is_valid_yaml(self):
        """The workflow file must be parseable by PyYAML without errors."""
        raw = _read_raw()
        self.assertTrue(raw, "Workflow file is empty.")
        try:
            doc = yaml.safe_load(raw)
        except yaml.YAMLError as exc:
            self.fail(f"gitweave-apply.yaml is not valid YAML: {exc}")
        self.assertIsInstance(doc, dict, "Parsed YAML should be a mapping.")


# ---------------------------------------------------------------------------
# Stub removal
# ---------------------------------------------------------------------------


class TestEchoStubRemoved(unittest.TestCase):
    """The original echo-placeholder step must no longer appear."""

    def test_no_applying_configuration_overlays_echo(self):
        """
        The echo 'Applying configuration overlays...' placeholder must be gone.
        """
        raw = _read_raw()
        self.assertNotIn(
            "Applying configuration overlays",
            raw,
            "Echo stub 'Applying configuration overlays' must be removed.",
        )

    def test_no_configuration_applied_successfully_echo(self):
        """The echo 'Configuration applied successfully.' placeholder must be gone."""
        raw = _read_raw()
        self.assertNotIn(
            "Configuration applied successfully",
            raw,
            "Echo stub 'Configuration applied successfully' must be removed.",
        )

    def test_no_ls_config_command(self):
        """The diagnostic 'ls -R config/' command from the stub must be gone."""
        raw = _read_raw()
        self.assertNotIn(
            "ls -R config/",
            raw,
            "Stub command 'ls -R config/' must be removed.",
        )


# ---------------------------------------------------------------------------
# Python setup
# ---------------------------------------------------------------------------


class TestPythonSetup(unittest.TestCase):
    """A step must set up Python 3.12 and install required packages."""

    def test_setup_python_action_present(self):
        """
        A step must use an actions/setup-python action (v5 or later is preferred
        but any version is accepted as long as the action name matches).
        """
        doc = _load_yaml()
        steps = _all_steps(doc)
        uses_values = [str(s.get("uses", "")) for s in steps]
        setup_python_steps = [u for u in uses_values if u.startswith("actions/setup-python@")]
        self.assertTrue(
            setup_python_steps,
            "No step uses actions/setup-python@* — Python setup step is required.",
        )

    def test_python_version_is_3_12(self):
        """The setup-python step must specify python-version: '3.12'."""
        doc = _load_yaml()
        steps = _all_steps(doc)
        for step in steps:
            if str(step.get("uses", "")).startswith("actions/setup-python@"):
                with_block = step.get("with") or {}
                version = str(with_block.get("python-version", ""))
                self.assertIn(
                    "3.12",
                    version,
                    f"setup-python step must specify python-version 3.12, got: {version!r}",
                )
                return
        self.fail("No actions/setup-python step found to check python-version.")

    def test_pip_install_copier(self):
        """A pip install step must include 'copier'."""
        runs = _step_run_blocks(_load_yaml())
        combined = "\n".join(runs)
        self.assertIn(
            "copier",
            combined,
            "No 'pip install' step mentions 'copier'.",
        )

    def test_pip_install_pyyaml(self):
        """A pip install step must include 'pyyaml' (case-insensitive)."""
        runs = _step_run_blocks(_load_yaml())
        combined = "\n".join(runs).lower()
        self.assertIn(
            "pyyaml",
            combined,
            "No 'pip install' step mentions 'pyyaml'.",
        )

    def test_pip_install_jsonschema(self):
        """A pip install step must include 'jsonschema'."""
        runs = _step_run_blocks(_load_yaml())
        combined = "\n".join(runs).lower()
        self.assertIn(
            "jsonschema",
            combined,
            "No 'pip install' step mentions 'jsonschema'.",
        )


# ---------------------------------------------------------------------------
# Script invocation
# ---------------------------------------------------------------------------


class TestScriptInvocation(unittest.TestCase):
    """A step must invoke apply-overlays.py with the correct arguments."""

    def test_apply_overlays_script_is_called(self):
        """A run step must reference 'apply-overlays.py'."""
        raw = _read_raw()
        self.assertIn(
            "apply-overlays.py",
            raw,
            "No reference to 'apply-overlays.py' found in the workflow.",
        )

    def test_script_invoked_with_python3(self):
        """The script must be invoked via 'python3 scripts/apply-overlays.py'."""
        runs = _step_run_blocks(_load_yaml())
        combined = "\n".join(runs)
        self.assertIn(
            "python3 scripts/apply-overlays.py",
            combined,
            "Script must be called as 'python3 scripts/apply-overlays.py'.",
        )

    def test_script_receives_config_repos_argument(self):
        """The script call must include 'config/repos/' as the directory argument."""
        runs = _step_run_blocks(_load_yaml())
        combined = "\n".join(runs)
        self.assertIn(
            "config/repos/",
            combined,
            "The apply-overlays.py invocation must pass 'config/repos/' as the argument.",
        )


# ---------------------------------------------------------------------------
# GITHUB_TOKEN
# ---------------------------------------------------------------------------


class TestGitHubToken(unittest.TestCase):
    """GITHUB_TOKEN must be available to the apply-overlays step."""

    def test_github_token_referenced_in_workflow(self):
        """
        The workflow must reference GITHUB_TOKEN (e.g. as an env var on the step
        or the job) so the script can authenticate with the GitHub API.
        """
        raw = _read_raw()
        self.assertIn(
            "GITHUB_TOKEN",
            raw,
            "GITHUB_TOKEN must be referenced in the workflow for the apply step.",
        )

    def test_github_token_uses_secrets_github_token(self):
        """GITHUB_TOKEN should be set from secrets.GITHUB_TOKEN or github.token."""
        raw = _read_raw()
        uses_secrets = "secrets.GITHUB_TOKEN" in raw or "github.token" in raw
        self.assertTrue(
            uses_secrets,
            "GITHUB_TOKEN must be sourced from secrets.GITHUB_TOKEN or github.token.",
        )


# ---------------------------------------------------------------------------
# Permissions
# ---------------------------------------------------------------------------


class TestWorkflowPermissions(unittest.TestCase):
    """The workflow (or apply job) must declare write permissions for contents and PRs."""

    def test_contents_write_permission_declared(self):
        """
        The workflow or apply job must declare 'contents: write' so the workflow
        can commit overlay changes back.
        """
        doc = _load_yaml()
        perms = _permissions(doc)
        self.assertEqual(
            perms.get("contents"),
            "write",
            f"Expected 'contents: write' permission, got: {perms.get('contents')!r}. "
            "Full permissions: {perms}",
        )

    def test_pull_requests_write_permission_declared(self):
        """
        The workflow or apply job must declare 'pull-requests: write' so the
        workflow can open or update pull requests.
        """
        doc = _load_yaml()
        perms = _permissions(doc)
        self.assertEqual(
            perms.get("pull-requests"),
            "write",
            f"Expected 'pull-requests: write' permission, got: {perms.get('pull-requests')!r}.",
        )


# ---------------------------------------------------------------------------
# Trigger configuration
# ---------------------------------------------------------------------------


class TestTriggerConfiguration(unittest.TestCase):
    """Workflow triggers must remain correct after the stub replacement."""

    def test_push_trigger_present(self):
        """The workflow must trigger on push to main."""
        doc = _load_yaml()
        triggers = _get_triggers(doc)
        self.assertIn("push", triggers, "Workflow must have a 'push' trigger.")

    def test_push_trigger_targets_main_branch(self):
        """The push trigger must target the 'main' branch."""
        doc = _load_yaml()
        triggers = _get_triggers(doc)
        push = triggers.get("push") or {}
        branches = push.get("branches") or []
        self.assertIn(
            "main",
            branches,
            f"Push trigger must list 'main' in branches, got: {branches}",
        )

    def test_push_trigger_has_config_path_filter(self):
        """The push trigger must filter on 'config/**' paths."""
        doc = _load_yaml()
        triggers = _get_triggers(doc)
        push = triggers.get("push") or {}
        paths = push.get("paths") or []
        self.assertTrue(
            any("config/" in p for p in paths),
            f"Push trigger must include a 'config/**' path filter, got: {paths}",
        )

    def test_workflow_dispatch_trigger_present(self):
        """The workflow must support manual dispatch via workflow_dispatch."""
        doc = _load_yaml()
        triggers = _get_triggers(doc)
        self.assertIn(
            "workflow_dispatch",
            triggers,
            "Workflow must declare a 'workflow_dispatch' trigger for manual runs.",
        )


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------


class TestRunnerConfiguration(unittest.TestCase):
    """The apply job must run on ubuntu-latest."""

    def test_apply_job_runs_on_ubuntu_latest(self):
        """The apply job's runs-on value must be 'ubuntu-latest'."""
        doc = _load_yaml()
        jobs = doc.get("jobs", {})
        self.assertTrue(jobs, "No jobs found in the workflow.")
        apply_job = jobs.get("apply") or next(iter(jobs.values()), {})
        runs_on = apply_job.get("runs-on", "")
        self.assertEqual(
            runs_on,
            "ubuntu-latest",
            f"apply job must run on ubuntu-latest, got: {runs_on!r}",
        )


if __name__ == "__main__":
    unittest.main()
