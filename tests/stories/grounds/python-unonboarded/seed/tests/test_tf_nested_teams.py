"""
Tests for arbitrarily nested sub-teams in infra/main.tf.

The current implementation uses a hardcoded two-pass approach
(resource "github_team" "root_teams" and resource "github_team" "sub_teams")
which only supports a single level of parent-child nesting. A 3-level
hierarchy such as engineering → platform → backend breaks at plan/validate
time because the "backend" team's parent ("platform") is a sub_team, not a
root_team — so github_team.root_teams["platform"] does not exist.

These tests specify the refactored behaviour:
  - A single unified github_team resource block handles any depth of nesting.
  - The old root_teams / sub_teams locals and resource blocks are removed.
  - A 3-level hierarchy (engineering → platform → backend) passes validate
    and produces exactly 3 planned github_team resources.
  - A teams.yaml with a missing parent reference causes terraform plan to
    exit non-zero with a diagnostic that mentions the unknown key.

Test layers:
  - Structure tests (no terraform): assert the old two-resource pattern is
    absent from infra/main.tf — FAILS with the current implementation.
  - Validate tests (terraform CLI, no credentials): validate passes for the
    3-level fixture — FAILS with the current implementation because the
    cross-reference github_team.root_teams["platform"] is invalid.
  - Plan tests (terraform + dummy token): plan exits non-zero for a missing
    parent reference — detectable before any GitHub API calls.
  - Plan resource-count tests (terraform + real GITHUB_TOKEN): plan produces
    exactly 3 github_team resources for the 3-level fixture.
  - Topological sort unit tests (pure Python): specify the ordering algorithm
    the implementation must replicate — used as algorithm documentation.
"""

import json
import os
import re
import shutil
import subprocess
import tempfile
import textwrap
import unittest


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
INFRA_DIR = os.path.join(REPO_ROOT, "infra")

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_FIXTURE_3LEVEL = textwrap.dedent("""\
    # Test fixture: 3-level team hierarchy (engineering → platform → backend)
    #
    # Schema:
    #   teams:
    #     - name:          # required: GitHub team slug
    #       description:   # required
    #       privacy:       # required: 'closed' or 'secret'
    #       parent_team:   # optional: parent team slug
    #       members:       # optional
    #         - username:  # required
    #           role:      # required: 'maintainer' or 'member'
    teams:
      - name: engineering
        description: Top-level engineering organisation team
        privacy: closed
        members:
          - username: alice
            role: maintainer

      - name: platform
        description: Platform infrastructure sub-team (child of engineering)
        privacy: closed
        parent_team: engineering
        members:
          - username: bob
            role: maintainer

      - name: backend
        description: Backend services sub-team (grandchild of engineering via platform)
        privacy: closed
        parent_team: platform
        members:
          - username: charlie
            role: member
    """)

_FIXTURE_MISSING_PARENT = textwrap.dedent("""\
    # Test fixture: team with a dangling parent reference
    teams:
      - name: orphan-team
        description: Team whose parent does not exist in the teams list
        privacy: closed
        parent_team: does-not-exist
        members:
          - username: alice
            role: member
    """)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _read_main_tf() -> str:
    with open(os.path.join(INFRA_DIR, "main.tf")) as f:
        return f.read()


def _setup_fixture_infra(teams_yaml_content: str) -> str:
    """
    Create an isolated temporary infra directory containing all .tf files from
    infra/ plus a sibling config/teams.yaml with the supplied fixture content.

    Returns the path to the temporary infra directory.

    Directory layout:
        <tmpdir>/
          infra/
            main.tf, variables.tf, branch_protection.tf, ...  (copied)
            .terraform.lock.hcl                                (copied if present)
            .terraform/                                        (symlinked to reuse providers)
          config/
            teams.yaml                                         (the fixture content)
    """
    tmp_root = tempfile.mkdtemp(prefix="gitweave_test_")
    tmp_infra = os.path.join(tmp_root, "infra")
    tmp_config = os.path.join(tmp_root, "config")
    os.makedirs(tmp_infra)
    os.makedirs(tmp_config)

    # Copy all .tf source files
    for fname in os.listdir(INFRA_DIR):
        if fname.endswith(".tf"):
            shutil.copy2(os.path.join(INFRA_DIR, fname), os.path.join(tmp_infra, fname))

    # Copy the provider lock file so init doesn't need to re-resolve
    lock_src = os.path.join(INFRA_DIR, ".terraform.lock.hcl")
    if os.path.exists(lock_src):
        shutil.copy2(lock_src, os.path.join(tmp_infra, ".terraform.lock.hcl"))

    # Symlink the downloaded provider binaries to avoid re-downloading
    tf_providers = os.path.join(INFRA_DIR, ".terraform")
    tf_link = os.path.join(tmp_infra, ".terraform")
    if os.path.exists(tf_providers) and not os.path.exists(tf_link):
        os.symlink(tf_providers, tf_link)

    # Write the fixture teams.yaml at the relative path main.tf expects:
    # ${path.module}/../config/teams.yaml → <tmp_root>/config/teams.yaml
    with open(os.path.join(tmp_config, "teams.yaml"), "w") as f:
        f.write(teams_yaml_content)

    return tmp_infra


def _run(
    args: list,
    cwd: str,
    timeout: int = 120,
    extra_env: dict | None = None,
) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    # Ensure GITHUB_TOKEN is set so the provider does not abort immediately;
    # tests that need a real token skip themselves explicitly.
    if "GITHUB_TOKEN" not in env:
        env["GITHUB_TOKEN"] = "dummy_token_for_test"
    if "TF_VAR_github_org" not in env and "GITHUB_ORG" not in env:
        env["TF_VAR_github_org"] = "test-org"
    return subprocess.run(
        args,
        capture_output=True,
        text=True,
        cwd=cwd,
        env=env,
        timeout=timeout,
    )


def _terraform_init(infra_dir: str) -> subprocess.CompletedProcess:
    return _run(
        ["terraform", "init", "-backend=false", "-no-color"],
        cwd=infra_dir,
        timeout=180,
    )


_requires_terraform = unittest.skipUnless(
    _terraform_available(), "terraform CLI not available — skipping"
)


# ---------------------------------------------------------------------------
# Structure tests — no terraform required
# ---------------------------------------------------------------------------


class TestNestedTeamsHclStructure(unittest.TestCase):
    """
    infra/main.tf must NOT use the old hardcoded two-resource-block pattern.

    All tests in this class FAIL while the current two-pass implementation is
    in place and PASS only after the refactor introduces a single, topology-
    aware github_team resource block.
    """

    def test_main_tf_does_not_declare_root_teams_resource(self):
        """
        The refactored implementation must not have a 'resource "github_team"
        "root_teams"' block. That block was the first pass of the old pattern
        and only handled teams with no parent, making deeper nesting impossible.
        """
        content = _read_main_tf()
        self.assertNotRegex(
            content,
            r'resource\s+"github_team"\s+"root_teams"',
            "infra/main.tf still declares a 'root_teams' github_team resource — "
            "the old two-pass pattern must be replaced with a unified resource "
            "that handles teams at any depth of the hierarchy",
        )

    def test_main_tf_does_not_declare_sub_teams_resource(self):
        """
        The refactored implementation must not have a 'resource "github_team"
        "sub_teams"' block. That block assumed every team's parent was a root
        team — breaking as soon as any parent is itself a sub-team.
        """
        content = _read_main_tf()
        self.assertNotRegex(
            content,
            r'resource\s+"github_team"\s+"sub_teams"',
            "infra/main.tf still declares a 'sub_teams' github_team resource — "
            "the old two-pass pattern must be replaced with a single resource "
            "block whose dependency graph Terraform resolves automatically",
        )

    def test_main_tf_declares_exactly_one_github_team_resource(self):
        """
        The unified implementation must use exactly one 'resource "github_team"'
        block. With a single block, Terraform builds a per-instance dependency
        graph that can resolve parent → child relationships at any depth.
        """
        content = _read_main_tf()
        blocks = re.findall(r'resource\s+"github_team"\s+"[^"]+"\s*\{', content)
        self.assertEqual(
            len(blocks),
            1,
            f"Expected exactly 1 'resource \"github_team\"' block in infra/main.tf "
            f"(unified topology-aware resource), found {len(blocks)}: {blocks!r}",
        )

    def test_main_tf_does_not_reference_root_teams_local(self):
        """
        The 'root_teams' local was part of the old two-pass pattern. After the
        refactor it must be absent so there is no residual dependency on the
        old split-by-depth approach.
        """
        content = _read_main_tf()
        self.assertNotIn(
            "root_teams",
            content,
            "infra/main.tf still contains a 'root_teams' identifier — "
            "remove it as part of the two-pass → unified-resource refactor",
        )

    def test_main_tf_does_not_reference_sub_teams_local(self):
        """
        The 'sub_teams' local was part of the old two-pass pattern. After the
        refactor it must be absent.
        """
        content = _read_main_tf()
        self.assertNotIn(
            "sub_teams",
            content,
            "infra/main.tf still contains a 'sub_teams' identifier — "
            "remove it as part of the two-pass → unified-resource refactor",
        )

    def test_unified_github_team_resource_uses_for_each(self):
        """
        The single unified github_team resource block must still use for_each
        so that team provisioning remains data-driven from teams.yaml.
        """
        content = _read_main_tf()
        blocks = re.findall(
            r'resource\s+"github_team"\s+"[^"]+"\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}',
            content,
            re.DOTALL,
        )
        self.assertGreater(
            len(blocks),
            0,
            "No github_team resource block found in infra/main.tf",
        )
        for block in blocks:
            self.assertIn(
                "for_each",
                block,
                "The github_team resource block must use for_each to iterate over "
                "all teams from teams.yaml",
            )

    def test_github_team_membership_resource_still_exists(self):
        """
        The refactor must not remove the github_team_membership resource block —
        membership provisioning is orthogonal to the hierarchy refactor.
        """
        content = _read_main_tf()
        self.assertRegex(
            content,
            r'resource\s+"github_team_membership"\s+"[^"]+"\s*\{',
            "The github_team_membership resource block must still be present "
            "after the hierarchy refactor",
        )


# ---------------------------------------------------------------------------
# Validate tests — terraform CLI required, no GitHub credentials needed
# ---------------------------------------------------------------------------


@_requires_terraform
class TestTerraformValidateWithNestedFixtures(unittest.TestCase):
    """
    terraform validate must succeed for a valid 3-level hierarchy fixture.

    With the current two-pass implementation, the validate step FAILS for the
    3-level fixture because 'backend' references parent 'platform' via
    github_team.root_teams["platform"] — but 'platform' is a sub_team, not a
    root_team, so that index lookup is invalid.

    After the refactor to a single unified resource block, validate passes
    because Terraform resolves the per-instance dependency graph at plan time.
    """

    def setUp(self):
        self._tmp_roots: list[str] = []

    def tearDown(self):
        for root in self._tmp_roots:
            shutil.rmtree(root, ignore_errors=True)

    def _make_infra(self, teams_yaml: str) -> str:
        tmp_infra = _setup_fixture_infra(teams_yaml)
        # Track the parent temp dir for cleanup
        self._tmp_roots.append(os.path.dirname(tmp_infra))
        return tmp_infra

    def test_validate_exits_zero_for_3level_hierarchy(self):
        """
        terraform validate must exit 0 when teams.yaml defines the hierarchy:
          engineering (root) → platform (level 2) → backend (level 3).

        This FAILS with the current two-pass implementation because
        github_team.root_teams["platform"] does not exist (platform is a
        sub_team). The test passes only after the unified-resource refactor.
        """
        infra_dir = self._make_infra(_FIXTURE_3LEVEL)
        init = _terraform_init(infra_dir)
        if init.returncode != 0:
            self.skipTest(
                f"terraform init failed in fixture infra dir:\n{init.stderr}"
            )

        result = _run(["terraform", "validate", "-no-color"], cwd=infra_dir)
        self.assertEqual(
            result.returncode,
            0,
            "terraform validate must exit 0 for a valid 3-level team hierarchy "
            "(engineering → platform → backend). The old two-pass implementation "
            "fails here because it cannot reference a sub_team as a parent. "
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )

    def test_validate_reports_success_for_3level_hierarchy(self):
        """
        terraform validate output must contain 'Success' and not 'Error' when
        given the 3-level hierarchy fixture — confirming clean validation.
        """
        infra_dir = self._make_infra(_FIXTURE_3LEVEL)
        init = _terraform_init(infra_dir)
        if init.returncode != 0:
            self.skipTest(f"terraform init failed:\n{init.stderr}")

        result = _run(["terraform", "validate", "-no-color"], cwd=infra_dir)
        if result.returncode != 0:
            # Let the exit-code test report the primary failure
            return
        combined = result.stdout + result.stderr
        self.assertIn(
            "Success",
            combined,
            "terraform validate must report 'Success' for the 3-level fixture",
        )
        self.assertNotIn(
            "Error:",
            combined,
            "terraform validate must not report any errors for the 3-level fixture",
        )

    def test_validate_exits_zero_for_flat_hierarchy(self):
        """
        terraform validate must continue to work for the existing flat hierarchy
        (teams with at most one level of nesting) after the refactor.

        This is a regression guard ensuring the refactor does not break the
        existing config/teams.yaml structure.
        """
        infra_dir = self._make_infra(
            textwrap.dedent("""\
                # Test fixture: flat 2-level hierarchy (existing pattern)
                teams:
                  - name: engineering
                    description: Root engineering team
                    privacy: closed
                    members:
                      - username: alice
                        role: maintainer

                  - name: platform
                    description: Sub-team under engineering
                    privacy: closed
                    parent_team: engineering
                    members:
                      - username: bob
                        role: member
                """)
        )
        init = _terraform_init(infra_dir)
        if init.returncode != 0:
            self.skipTest(f"terraform init failed:\n{init.stderr}")

        result = _run(["terraform", "validate", "-no-color"], cwd=infra_dir)
        self.assertEqual(
            result.returncode,
            0,
            "terraform validate must still exit 0 for a flat 2-level hierarchy "
            "after the refactor (regression guard). "
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )


# ---------------------------------------------------------------------------
# Plan tests — terraform CLI + dummy token (missing-parent error detection)
# ---------------------------------------------------------------------------


@_requires_terraform
class TestTerraformPlanMissingParentDetection(unittest.TestCase):
    """
    A teams.yaml with a missing parent reference must cause terraform plan to
    exit non-zero with a diagnostic that helps operators identify the problem.

    These tests use a dummy GITHUB_TOKEN because the error is detected during
    local graph resolution — before any GitHub API calls are made.
    """

    def setUp(self):
        self._tmp_roots: list[str] = []

    def tearDown(self):
        for root in self._tmp_roots:
            shutil.rmtree(root, ignore_errors=True)

    def _make_infra(self, teams_yaml: str) -> str:
        tmp_infra = _setup_fixture_infra(teams_yaml)
        self._tmp_roots.append(os.path.dirname(tmp_infra))
        return tmp_infra

    def test_plan_exits_nonzero_for_missing_parent_reference(self):
        """
        terraform plan must exit non-zero when a team's parent_team slug does
        not match any team name in teams.yaml.

        The fixture defines 'orphan-team' with parent 'does-not-exist' — a team
        that is not in the teams list. The unified resource implementation must
        surface this as a plan-time error (invalid index into the for_each map).
        """
        infra_dir = self._make_infra(_FIXTURE_MISSING_PARENT)
        init = _terraform_init(infra_dir)
        if init.returncode != 0:
            self.skipTest(f"terraform init failed:\n{init.stderr}")

        result = _run(["terraform", "plan", "-no-color"], cwd=infra_dir)
        self.assertNotEqual(
            result.returncode,
            0,
            "terraform plan must exit non-zero when a team references a "
            "non-existent parent slug ('does-not-exist'). "
            "This validates that the implementation provides clear error feedback "
            "rather than silently creating an orphaned team. "
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )

    def test_plan_error_for_missing_parent_is_diagnostic(self):
        """
        The plan error output for a missing parent reference must contain a
        diagnostic that helps operators identify the problem — either the missing
        parent slug, the affected team name, or an index/key error message.

        An unintelligible panic or 'internal error' message would not be
        acceptable operator experience.
        """
        infra_dir = self._make_infra(_FIXTURE_MISSING_PARENT)
        init = _terraform_init(infra_dir)
        if init.returncode != 0:
            self.skipTest(f"terraform init failed:\n{init.stderr}")

        result = _run(["terraform", "plan", "-no-color"], cwd=infra_dir)
        combined = (result.stdout + result.stderr).lower()

        # The error must mention at least one of: the missing slug, the team
        # name, or a clear key/index lookup failure
        diagnostic_signals = [
            "does-not-exist",
            "orphan",
            "index",
            "key",
            "not found",
            "does not exist",
        ]
        has_diagnostic = any(sig in combined for sig in diagnostic_signals)
        self.assertTrue(
            has_diagnostic,
            "Plan error for a missing parent reference must produce a diagnostic "
            f"mentioning one of {diagnostic_signals!r} to guide the operator. "
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )


# ---------------------------------------------------------------------------
# Plan resource-count tests — terraform + real GITHUB_TOKEN required
# ---------------------------------------------------------------------------


@_requires_terraform
class TestTerraformPlan3LevelResourceCounts(unittest.TestCase):
    """
    terraform plan against the 3-level fixture must propose exactly 3
    github_team resources and 3 github_team_membership resources.

    These tests require a real GITHUB_TOKEN and TF_VAR_github_org and are
    skipped automatically when those are absent or set to placeholder values.
    """

    _REAL_TOKEN = os.environ.get("GITHUB_TOKEN", "")
    _GITHUB_ORG = os.environ.get("TF_VAR_github_org") or os.environ.get("GITHUB_ORG", "")

    _requires_real_token = unittest.skipUnless(
        _REAL_TOKEN and _REAL_TOKEN != "dummy_token_for_test",
        "Real GITHUB_TOKEN required — export GITHUB_TOKEN to run plan resource-count tests",
    )
    _requires_github_org = unittest.skipUnless(
        _REAL_TOKEN and _REAL_TOKEN != "dummy_token_for_test",
        "TF_VAR_github_org (or GITHUB_ORG) required — export it to run plan tests",
    )

    def setUp(self):
        self._tmp_roots: list[str] = []
        self._plan_json: dict | None = None

    def tearDown(self):
        for root in self._tmp_roots:
            shutil.rmtree(root, ignore_errors=True)

    def _make_infra(self, teams_yaml: str) -> str:
        tmp_infra = _setup_fixture_infra(teams_yaml)
        self._tmp_roots.append(os.path.dirname(tmp_infra))
        return tmp_infra

    @classmethod
    def _run_plan_and_show(cls, infra_dir: str) -> dict | None:
        """
        Run terraform plan -out=<file> then terraform show -json.
        Returns the parsed plan JSON, or None if plan failed.
        """
        plan_file = os.path.join(infra_dir, "nested_test.tfplan")
        plan_result = _run(
            ["terraform", "plan", f"-out={plan_file}", "-no-color"],
            cwd=infra_dir,
        )
        if plan_result.returncode != 0:
            return None
        show_result = subprocess.run(
            ["terraform", "show", "-json", plan_file],
            capture_output=True,
            text=True,
            cwd=infra_dir,
            timeout=60,
        )
        try:
            return json.loads(show_result.stdout)
        except json.JSONDecodeError:
            return None

    def _planned_creates(self, plan_json: dict, resource_type: str) -> list:
        return [
            c
            for c in plan_json.get("resource_changes", [])
            if c.get("type") == resource_type
            and "create" in c.get("change", {}).get("actions", [])
        ]

    @_requires_real_token
    def test_plan_exits_zero_for_3level_hierarchy_with_real_credentials(self):
        """
        terraform plan must exit 0 for the 3-level fixture (engineering →
        platform → backend) when valid GitHub credentials are available.
        """
        infra_dir = self._make_infra(_FIXTURE_3LEVEL)
        init = _terraform_init(infra_dir)
        if init.returncode != 0:
            self.skipTest(f"terraform init failed:\n{init.stderr}")

        result = _run(["terraform", "plan", "-no-color"], cwd=infra_dir)
        self.assertEqual(
            result.returncode,
            0,
            "terraform plan must exit 0 for a valid 3-level hierarchy fixture. "
            f"STDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}",
        )

    @_requires_real_token
    def test_plan_proposes_exactly_3_github_team_resources_for_3level_fixture(self):
        """
        The plan for the 3-level fixture must propose exactly 3 github_team
        create actions — one for each of engineering, platform, and backend.
        """
        infra_dir = self._make_infra(_FIXTURE_3LEVEL)
        init = _terraform_init(infra_dir)
        if init.returncode != 0:
            self.skipTest(f"terraform init failed:\n{init.stderr}")

        plan_json = self._run_plan_and_show(infra_dir)
        if plan_json is None:
            self.skipTest("terraform plan failed — cannot inspect resource counts")

        planned = self._planned_creates(plan_json, "github_team")
        self.assertEqual(
            len(planned),
            3,
            f"Expected 3 github_team resources for the 3-level fixture, "
            f"got {len(planned)}: {[c.get('address') for c in planned]!r}",
        )

    @_requires_real_token
    def test_plan_includes_engineering_platform_and_backend_teams(self):
        """
        The 3 planned github_team resources must be engineering, platform, and
        backend — confirming all 3 levels of the hierarchy are provisioned.
        """
        infra_dir = self._make_infra(_FIXTURE_3LEVEL)
        init = _terraform_init(infra_dir)
        if init.returncode != 0:
            self.skipTest(f"terraform init failed:\n{init.stderr}")

        plan_json = self._run_plan_and_show(infra_dir)
        if plan_json is None:
            self.skipTest("terraform plan failed — cannot inspect resource keys")

        planned = self._planned_creates(plan_json, "github_team")
        planned_keys = set()
        for change in planned:
            m = re.search(r'\["([^"]+)"\]', change.get("address", ""))
            if m:
                planned_keys.add(m.group(1))

        if planned_keys:  # Only assert when address keys are extractable
            self.assertEqual(
                planned_keys,
                {"engineering", "platform", "backend"},
                f"Planned github_team keys {planned_keys!r} do not match the "
                f"expected 3 teams from the 3-level fixture",
            )

    @_requires_real_token
    def test_plan_proposes_exactly_3_github_team_memberships_for_3level_fixture(self):
        """
        The plan for the 3-level fixture must propose exactly 3
        github_team_membership resources — one per member (alice, bob, charlie).
        """
        infra_dir = self._make_infra(_FIXTURE_3LEVEL)
        init = _terraform_init(infra_dir)
        if init.returncode != 0:
            self.skipTest(f"terraform init failed:\n{init.stderr}")

        plan_json = self._run_plan_and_show(infra_dir)
        if plan_json is None:
            self.skipTest("terraform plan failed — cannot inspect membership counts")

        planned = self._planned_creates(plan_json, "github_team_membership")
        self.assertEqual(
            len(planned),
            3,
            f"Expected 3 github_team_membership resources for the 3-level fixture "
            f"(alice/maintainer, bob/maintainer, charlie/member), "
            f"got {len(planned)}: {[c.get('address') for c in planned]!r}",
        )

    @_requires_real_token
    def test_plan_creates_only_expected_resource_types_for_3level_fixture(self):
        """
        The plan for the 3-level fixture must not introduce unexpected resource
        types beyond github_team and github_team_membership.
        """
        infra_dir = self._make_infra(_FIXTURE_3LEVEL)
        init = _terraform_init(infra_dir)
        if init.returncode != 0:
            self.skipTest(f"terraform init failed:\n{init.stderr}")

        plan_json = self._run_plan_and_show(infra_dir)
        if plan_json is None:
            self.skipTest("terraform plan failed — cannot inspect resource types")

        allowed_types = {"github_team", "github_team_membership"}
        planned_types = {
            c["type"]
            for c in plan_json.get("resource_changes", [])
            if "create" in c.get("change", {}).get("actions", [])
        }
        unexpected = planned_types - allowed_types
        self.assertEqual(
            unexpected,
            set(),
            f"Plan for 3-level fixture proposes unexpected resource type(s): "
            f"{unexpected!r} — only github_team and github_team_membership are expected",
        )


# ---------------------------------------------------------------------------
# Topological sort algorithm unit tests — pure Python, always run
# ---------------------------------------------------------------------------


class TestTopologicalSortAlgorithm(unittest.TestCase):
    """
    Unit tests for the topological ordering algorithm the Terraform
    implementation must replicate in HCL locals.

    Terraform's dependency graph engine processes github_team instances in an
    order that satisfies parent → child ordering, BUT only when the resource
    uses self-referential for_each (each instance depending on another
    instance in the same resource). These tests document the expected ordering
    behaviour in pure Python to serve as the canonical algorithm specification.

    These tests pass immediately — they test the algorithm contract, not the
    HCL implementation. The HCL implementation must produce equivalent
    resource creation ordering.
    """

    @staticmethod
    def _toposort(teams: list[dict]) -> list[str]:
        """
        Kahn's algorithm topological sort of team definitions by parent
        dependency. Returns team names in creation order (parents before
        children). Teams with missing parent references are excluded.
        """
        from collections import deque

        known_names = {t["name"] for t in teams}
        graph: dict[str, list[str]] = {t["name"]: [] for t in teams}
        in_degree: dict[str, int] = {t["name"]: 0 for t in teams}

        for team in teams:
            parent = team.get("parent_team")
            if parent and parent in known_names:
                graph[parent].append(team["name"])
                in_degree[team["name"]] += 1

        queue = deque(name for name, deg in in_degree.items() if deg == 0)
        result = []
        while queue:
            node = queue.popleft()
            result.append(node)
            for child in graph[node]:
                in_degree[child] -= 1
                if in_degree[child] == 0:
                    queue.append(child)

        return result

    def test_3level_sort_returns_all_3_teams(self):
        """
        Topological sort of engineering → platform → backend must return all
        3 team names.
        """
        teams = [
            {"name": "engineering", "description": "Top", "privacy": "closed"},
            {"name": "platform", "description": "L2", "privacy": "closed", "parent_team": "engineering"},
            {"name": "backend", "description": "L3", "privacy": "closed", "parent_team": "platform"},
        ]
        result = self._toposort(teams)
        self.assertEqual(set(result), {"engineering", "platform", "backend"})
        self.assertEqual(len(result), 3, "Sort must not duplicate teams")

    def test_3level_sort_places_parents_before_children(self):
        """
        Each parent must appear strictly before its children in the sorted order:
          engineering < platform < backend.
        """
        teams = [
            {"name": "engineering", "description": "Top", "privacy": "closed"},
            {"name": "platform", "description": "L2", "privacy": "closed", "parent_team": "engineering"},
            {"name": "backend", "description": "L3", "privacy": "closed", "parent_team": "platform"},
        ]
        result = self._toposort(teams)
        self.assertLess(result.index("engineering"), result.index("platform"))
        self.assertLess(result.index("platform"), result.index("backend"))

    def test_sort_is_correct_regardless_of_yaml_declaration_order(self):
        """
        The sort must produce a valid creation order even when teams.yaml
        declares children before parents (bottom-up ordering in the file).
        """
        teams_bottom_up = [
            {"name": "backend", "description": "L3", "privacy": "closed", "parent_team": "platform"},
            {"name": "platform", "description": "L2", "privacy": "closed", "parent_team": "engineering"},
            {"name": "engineering", "description": "Top", "privacy": "closed"},
        ]
        result = self._toposort(teams_bottom_up)
        self.assertLess(result.index("engineering"), result.index("platform"))
        self.assertLess(result.index("platform"), result.index("backend"))

    def test_team_with_missing_parent_is_excluded_from_sort(self):
        """
        A team that references a non-existent parent cannot be scheduled and
        must NOT appear in the topological sort result.

        In the Terraform implementation this manifests as an invalid index
        lookup error at plan time.
        """
        teams = [
            {"name": "orphan-team", "description": "Orphan", "privacy": "closed",
             "parent_team": "does-not-exist"},
        ]
        result = self._toposort(teams)
        self.assertNotIn(
            "orphan-team",
            result,
            "A team with a missing parent must not appear in the sort result — "
            "it has an unresolvable dependency",
        )

    def test_sort_handles_flat_list_of_root_teams(self):
        """
        Teams with no parent relationship must all appear in the sort result.
        Order among root teams is unspecified but all must be present.
        """
        teams = [
            {"name": "alpha", "description": "A", "privacy": "closed"},
            {"name": "beta", "description": "B", "privacy": "closed"},
            {"name": "gamma", "description": "C", "privacy": "closed"},
        ]
        result = self._toposort(teams)
        self.assertEqual(set(result), {"alpha", "beta", "gamma"})

    def test_sort_handles_wide_hierarchy_with_multiple_children(self):
        """
        Multiple sub-teams under the same parent must all appear after their
        common parent in the sorted result.
        """
        teams = [
            {"name": "engineering", "description": "Top", "privacy": "closed"},
            {"name": "frontend", "description": "FE", "privacy": "closed", "parent_team": "engineering"},
            {"name": "backend", "description": "BE", "privacy": "closed", "parent_team": "engineering"},
            {"name": "infra", "description": "Infra", "privacy": "closed", "parent_team": "engineering"},
        ]
        result = self._toposort(teams)
        self.assertEqual(set(result), {"engineering", "frontend", "backend", "infra"})
        eng_idx = result.index("engineering")
        for child in ("frontend", "backend", "infra"):
            self.assertLess(
                eng_idx,
                result.index(child),
                f"engineering must appear before {child} in the sorted order",
            )

    def test_sort_handles_4level_deep_chain(self):
        """
        A chain of 4 levels (org → engineering → platform → backend) must be
        sorted with each level appearing before its child.
        """
        teams = [
            {"name": "org", "description": "L1", "privacy": "closed"},
            {"name": "engineering", "description": "L2", "privacy": "closed", "parent_team": "org"},
            {"name": "platform", "description": "L3", "privacy": "closed", "parent_team": "engineering"},
            {"name": "backend", "description": "L4", "privacy": "closed", "parent_team": "platform"},
        ]
        result = self._toposort(teams)
        self.assertEqual(len(result), 4)
        self.assertLess(result.index("org"), result.index("engineering"))
        self.assertLess(result.index("engineering"), result.index("platform"))
        self.assertLess(result.index("platform"), result.index("backend"))


if __name__ == "__main__":
    unittest.main()
