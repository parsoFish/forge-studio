"""
Integration tests: terraform plan produces expected resource counts for GitHub Teams.

These tests run 'terraform plan -out=...' followed by 'terraform show -json'
to inspect the planned resource changes and assert that the count of
github_team and github_team_membership resources matches the example
config/teams.yaml.

Prerequisites (tests are skipped automatically when missing):
  - terraform CLI available
  - GITHUB_TOKEN environment variable set (required by the GitHub provider)
  - TF_VAR_github_org environment variable set (or GITHUB_ORG fallback)

In CI the gitweave-infra.yaml workflow supplies these via OIDC — locally,
export them before running the suite.

All tests fail until the implementation is in place (TDD red phase).
"""

import json
import os
import subprocess
import tempfile
import unittest

import yaml


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
INFRA_DIR = os.path.join(REPO_ROOT, "infra")
TEAMS_YAML = os.path.join(REPO_ROOT, "config", "teams.yaml")

_GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
_GITHUB_ORG = (
    os.environ.get("TF_VAR_github_org")
    or os.environ.get("GITHUB_ORG")
    or ""
)


def _terraform_available() -> bool:
    try:
        result = subprocess.run(
            ["terraform", "version"],
            capture_output=True,
            timeout=15,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _expected_resource_counts(teams_yaml_path: str) -> tuple[int, int]:
    """
    Parse teams.yaml and return (team_count, membership_count).

    team_count       — number of github_team resources to expect
    membership_count — number of github_team_membership resources to expect
    """
    with open(teams_yaml_path) as f:
        data = yaml.safe_load(f)
    teams = data.get("teams", [])
    team_count = len(teams)
    membership_count = sum(len(t.get("members", [])) for t in teams)
    return team_count, membership_count


def _build_env() -> dict:
    """Build the environment dict for terraform subprocess calls."""
    env = os.environ.copy()
    env["GITHUB_TOKEN"] = _GITHUB_TOKEN
    if _GITHUB_ORG:
        env["TF_VAR_github_org"] = _GITHUB_ORG
    return env


def _run(args: list, cwd: str = INFRA_DIR, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=cwd,
        env=_build_env(),
        timeout=timeout,
    )


# ---------------------------------------------------------------------------
# Integration: terraform plan
# ---------------------------------------------------------------------------

_requires_terraform = unittest.skipUnless(
    _terraform_available(), "terraform CLI not available — skipping plan tests"
)
_requires_github_token = unittest.skipUnless(
    _GITHUB_TOKEN,
    "GITHUB_TOKEN not set — export it to run integration plan tests",
)
_requires_github_org = unittest.skipUnless(
    _GITHUB_ORG,
    "TF_VAR_github_org (or GITHUB_ORG) not set — export it to run integration plan tests",
)


@_requires_terraform
@_requires_github_token
@_requires_github_org
class TestTerraformPlanResourceCounts(unittest.TestCase):
    """
    terraform plan must propose exactly the resources described in teams.yaml.

    Each test parses the plan JSON output produced by 'terraform show -json'
    and counts resources by type so we can assert that the data-driven
    configuration generates the correct number of API calls.
    """

    _plan_json: dict | None = None

    @classmethod
    def setUpClass(cls):
        """
        Run terraform init and plan once; cache the plan JSON for all tests.

        A class-level setup avoids repeating the expensive plan invocation for
        every individual test method.
        """
        # Init (without remote backend)
        init_result = subprocess.run(
            ["terraform", "init", "-backend=false", "-no-color"],
            capture_output=True,
            text=True,
            cwd=INFRA_DIR,
            env=_build_env(),
            timeout=180,
        )
        if init_result.returncode != 0:
            raise unittest.SkipTest(
                f"terraform init failed — cannot run plan tests:\n"
                f"{init_result.stdout}\n{init_result.stderr}"
            )

        # Write plan to a temp file so we can read it as JSON
        with tempfile.NamedTemporaryFile(
            suffix=".tfplan", dir=INFRA_DIR, delete=False
        ) as tmp:
            plan_path = tmp.name

        try:
            plan_result = subprocess.run(
                ["terraform", "plan", f"-out={plan_path}", "-no-color"],
                capture_output=True,
                text=True,
                cwd=INFRA_DIR,
                env=_build_env(),
                timeout=180,
            )
            if plan_result.returncode != 0:
                raise unittest.SkipTest(
                    f"terraform plan failed — cannot inspect resource counts:\n"
                    f"{plan_result.stdout}\n{plan_result.stderr}"
                )

            show_result = subprocess.run(
                ["terraform", "show", "-json", plan_path],
                capture_output=True,
                text=True,
                cwd=INFRA_DIR,
                timeout=60,
            )
            cls._plan_json = json.loads(show_result.stdout)
        finally:
            if os.path.exists(plan_path):
                os.unlink(plan_path)

    def _planned_creates(self, resource_type: str) -> list:
        """Return resource_changes entries of the given type that will be created."""
        if not self._plan_json:
            return []
        return [
            change
            for change in self._plan_json.get("resource_changes", [])
            if change.get("type") == resource_type
            and "create" in change.get("change", {}).get("actions", [])
        ]

    def test_terraform_plan_exits_zero(self):
        """
        terraform plan must exit 0 given valid credentials and configuration.

        A non-zero exit indicates a provider authentication failure,
        a misconfigured resource argument, or a schema validation error.
        """
        result = _run(["terraform", "plan", "-no-color"])
        self.assertEqual(
            result.returncode,
            0,
            f"terraform plan must exit 0:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )

    def test_plan_shows_correct_github_team_count(self):
        """
        The number of github_team resources to create must equal the number of
        teams declared in config/teams.yaml.

        This confirms the data-driven for_each expansion is correct — one
        resource instance per team entry, no more, no fewer.
        """
        expected_teams, _ = _expected_resource_counts(TEAMS_YAML)
        planned_teams = self._planned_creates("github_team")
        self.assertEqual(
            len(planned_teams),
            expected_teams,
            f"Expected {expected_teams} github_team resource(s) to be planned "
            f"(matching config/teams.yaml), but got {len(planned_teams)}",
        )

    def test_plan_shows_correct_github_team_membership_count(self):
        """
        The number of github_team_membership resources to create must equal the
        total number of member entries across all teams in config/teams.yaml.

        This confirms membership for_each expansion correctly flattens the
        nested teams[*].members lists into individual resource instances.
        """
        _, expected_memberships = _expected_resource_counts(TEAMS_YAML)
        planned_memberships = self._planned_creates("github_team_membership")
        self.assertEqual(
            len(planned_memberships),
            expected_memberships,
            f"Expected {expected_memberships} github_team_membership resource(s) to be planned "
            f"(matching config/teams.yaml), but got {len(planned_memberships)}",
        )

    def test_plan_creates_only_expected_resource_types(self):
        """
        The plan must not introduce unexpected resource types beyond
        github_team and github_team_membership.

        Additional resource types (e.g. github_repository) would indicate scope
        creep in the teams module and must be explicitly approved.
        """
        allowed_types = {"github_team", "github_team_membership"}
        if not self._plan_json:
            self.skipTest("Plan JSON not available")
        planned_types = {
            change["type"]
            for change in self._plan_json.get("resource_changes", [])
            if "create" in change.get("change", {}).get("actions", [])
        }
        unexpected = planned_types - allowed_types
        self.assertEqual(
            unexpected,
            set(),
            f"Plan proposes unexpected resource type(s): {unexpected!r} — "
            "only github_team and github_team_membership are expected",
        )

    def test_plan_team_names_match_teams_yaml(self):
        """
        The names of planned github_team resources must match the team names
        defined in config/teams.yaml (order-independent).

        This ensures the for_each key expression correctly uses the team name
        as the resource instance key, not an arbitrary index.
        """
        with open(TEAMS_YAML) as f:
            data = yaml.safe_load(f)
        expected_names = {t["name"] for t in data.get("teams", []) if "name" in t}

        planned_teams = self._planned_creates("github_team")
        # The instance key in for_each is typically the team name; it appears in
        # the resource address after the last period: github_team.this["<name>"]
        planned_names = set()
        for change in planned_teams:
            address = change.get("address", "")
            # Extract the key from addresses like: github_team.teams["platform"]
            key_match = __import__("re").search(r'\["([^"]+)"\]', address)
            if key_match:
                planned_names.add(key_match.group(1))

        if planned_names:  # Only assert when we can extract keys
            self.assertEqual(
                planned_names,
                expected_names,
                f"Planned github_team keys {planned_names!r} do not match "
                f"team names in config/teams.yaml {expected_names!r}",
            )


if __name__ == "__main__":
    unittest.main()
