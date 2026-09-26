"""
Tests for GitHub Teams and Memberships Terraform configuration.

Verifies that:
  - config/teams.yaml exists with a valid schema and illustrative schema comments
  - Every team entry has required fields (name, description, privacy)
  - Team privacy values are restricted to 'closed' or 'secret'
  - The optional parent_team field is demonstrably optional in the example
  - Member entries carry username and a valid role (maintainer / member)
  - Terraform declares github_team and github_team_membership resource blocks
  - Resources are data-driven via yamldecode(file()) — no hardcoded team names
  - variables.tf documents every declared variable with a description

All tests in this file fail until the implementation is in place (TDD red phase).
"""

import os
import re
import unittest

import yaml


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
INFRA_DIR = os.path.join(REPO_ROOT, "infra")
CONFIG_DIR = os.path.join(REPO_ROOT, "config")
TEAMS_YAML = os.path.join(CONFIG_DIR, "teams.yaml")


def _find_tf_files():
    """Return all .tf file paths under infra/ (recursive)."""
    tf_files = []
    for root, _, files in os.walk(INFRA_DIR):
        for name in files:
            if name.endswith(".tf"):
                tf_files.append(os.path.join(root, name))
    return tf_files


def _read_all_tf_content():
    """Return the concatenated content of every .tf file under infra/."""
    content = ""
    for path in _find_tf_files():
        with open(path) as f:
            content += f.read() + "\n"
    return content


def _load_teams_yaml():
    with open(TEAMS_YAML) as f:
        return yaml.safe_load(f)


# ---------------------------------------------------------------------------
# config/teams.yaml — file presence and top-level structure
# ---------------------------------------------------------------------------


class TestTeamsYamlExists(unittest.TestCase):
    """config/teams.yaml must exist and be structurally valid YAML."""

    def test_teams_yaml_exists_at_expected_path(self):
        """config/teams.yaml must exist — it is the single source of truth for teams."""
        self.assertTrue(
            os.path.isfile(TEAMS_YAML),
            f"config/teams.yaml is missing at {TEAMS_YAML}",
        )

    def test_teams_yaml_is_valid_yaml(self):
        """config/teams.yaml must parse without YAML errors."""
        with open(TEAMS_YAML) as f:
            raw = f.read()
        try:
            data = yaml.safe_load(raw)
        except yaml.YAMLError as exc:
            self.fail(f"config/teams.yaml is not valid YAML: {exc}")
        self.assertIsInstance(
            data, dict, "config/teams.yaml must be a YAML mapping at the top level"
        )

    def test_teams_yaml_contains_schema_comments(self):
        """Schema comments must be present to guide operators adding teams."""
        with open(TEAMS_YAML) as f:
            raw = f.read()
        self.assertIn(
            "#",
            raw,
            "config/teams.yaml must include at least one schema comment (# ...) "
            "to document the expected structure",
        )

    def test_teams_yaml_has_top_level_teams_key(self):
        """The top-level key must be 'teams' — the list of team definitions."""
        data = _load_teams_yaml()
        self.assertIn(
            "teams",
            data,
            "config/teams.yaml must have a top-level 'teams' key",
        )

    def test_teams_yaml_teams_value_is_a_list(self):
        """'teams' must be a sequence so Terraform can iterate with for_each."""
        data = _load_teams_yaml()
        self.assertIsInstance(
            data["teams"],
            list,
            "config/teams.yaml 'teams' must be a YAML sequence (list)",
        )

    def test_teams_yaml_has_at_least_one_example_team(self):
        """The example file must contain at least one team to serve as documentation."""
        data = _load_teams_yaml()
        self.assertGreater(
            len(data["teams"]),
            0,
            "config/teams.yaml must include at least one example team entry",
        )


# ---------------------------------------------------------------------------
# config/teams.yaml — per-team schema validation
# ---------------------------------------------------------------------------


class TestTeamEntrySchema(unittest.TestCase):
    """Each team entry must conform to the documented schema."""

    def _teams(self):
        return _load_teams_yaml().get("teams", [])

    def test_each_team_has_name_field(self):
        """Every team must have a 'name' field (used as the GitHub team slug)."""
        for i, team in enumerate(self._teams()):
            with self.subTest(team_index=i):
                self.assertIn(
                    "name",
                    team,
                    f"Team at index {i} is missing the required 'name' field",
                )

    def test_each_team_has_description_field(self):
        """Every team must have a 'description' field (displayed in GitHub UI)."""
        for i, team in enumerate(self._teams()):
            with self.subTest(team_index=i, name=team.get("name")):
                self.assertIn(
                    "description",
                    team,
                    f"Team '{team.get('name', f'[index {i}]')}' is missing 'description'",
                )

    def test_each_team_has_privacy_field(self):
        """Every team must have a 'privacy' field (controls team visibility)."""
        for i, team in enumerate(self._teams()):
            with self.subTest(team_index=i, name=team.get("name")):
                self.assertIn(
                    "privacy",
                    team,
                    f"Team '{team.get('name', f'[index {i}]')}' is missing 'privacy'",
                )

    def test_team_privacy_values_are_valid(self):
        """privacy must be 'closed' or 'secret' — GitHub's only valid team privacy values."""
        valid = {"closed", "secret"}
        for i, team in enumerate(self._teams()):
            with self.subTest(team_index=i, name=team.get("name")):
                privacy = team.get("privacy")
                self.assertIn(
                    privacy,
                    valid,
                    f"Team '{team.get('name', f'[index {i}]')}' has invalid privacy "
                    f"'{privacy}' — must be 'closed' or 'secret'",
                )

    def test_parent_team_field_is_optional(self):
        """
        parent_team is optional — at least one team must omit it to prove
        the example doesn't mandate parent nesting.
        """
        teams_without_parent = [t for t in self._teams() if "parent_team" not in t]
        self.assertGreater(
            len(teams_without_parent),
            0,
            "Every team in the example has a 'parent_team' — "
            "at least one team must omit it to show it is optional",
        )

    def test_team_members_field_is_a_list_when_present(self):
        """When 'members' is provided it must be a list of membership objects."""
        for i, team in enumerate(self._teams()):
            with self.subTest(team_index=i, name=team.get("name")):
                if "members" in team:
                    self.assertIsInstance(
                        team["members"],
                        list,
                        f"Team '{team.get('name', f'[index {i}]')}' 'members' must be a list",
                    )


# ---------------------------------------------------------------------------
# config/teams.yaml — per-membership schema validation
# ---------------------------------------------------------------------------


class TestMemberEntrySchema(unittest.TestCase):
    """Each member entry within a team must conform to the documented schema."""

    def _all_members(self):
        """Yield (team_name, member_dict) for every member across all teams."""
        for team in _load_teams_yaml().get("teams", []):
            for member in team.get("members", []):
                yield team.get("name", "<unnamed>"), member

    def test_each_member_has_username_field(self):
        """Every membership entry must specify the GitHub username."""
        for team_name, member in self._all_members():
            with self.subTest(team=team_name):
                self.assertIn(
                    "username",
                    member,
                    f"Member in team '{team_name}' is missing the 'username' field",
                )

    def test_each_member_has_role_field(self):
        """Every membership entry must specify the team role."""
        for team_name, member in self._all_members():
            with self.subTest(team=team_name, username=member.get("username")):
                self.assertIn(
                    "role",
                    member,
                    f"Member '{member.get('username', '?')}' in team '{team_name}' "
                    "is missing the 'role' field",
                )

    def test_member_role_values_are_valid(self):
        """role must be 'maintainer' or 'member' — GitHub's only valid team role values."""
        valid = {"maintainer", "member"}
        for team_name, member in self._all_members():
            with self.subTest(team=team_name, username=member.get("username")):
                role = member.get("role")
                self.assertIn(
                    role,
                    valid,
                    f"Member '{member.get('username', '?')}' in team '{team_name}' "
                    f"has invalid role '{role}' — must be 'maintainer' or 'member'",
                )

    def test_example_demonstrates_both_maintainer_and_member_roles(self):
        """
        The example teams.yaml must include at least one maintainer and one member
        so that operators can see both role values in context.
        """
        roles = {m["role"] for _, m in self._all_members() if "role" in m}
        self.assertIn(
            "maintainer",
            roles,
            "config/teams.yaml example must include at least one 'maintainer' member",
        )
        self.assertIn(
            "member",
            roles,
            "config/teams.yaml example must include at least one 'member' member",
        )


# ---------------------------------------------------------------------------
# Terraform HCL — resource declarations
# ---------------------------------------------------------------------------


class TestTerraformResourceDeclarations(unittest.TestCase):
    """github_team and github_team_membership resource blocks must be declared."""

    def test_github_team_resource_block_is_declared(self):
        """Terraform must declare a resource block of type 'github_team'."""
        content = _read_all_tf_content()
        self.assertRegex(
            content,
            r'resource\s+"github_team"\s+"[^"]+"\s+\{',
            "No 'resource \"github_team\"' block found in infra/ — "
            "github_team resource has not been declared",
        )

    def test_github_team_membership_resource_block_is_declared(self):
        """Terraform must declare a resource block of type 'github_team_membership'."""
        content = _read_all_tf_content()
        self.assertRegex(
            content,
            r'resource\s+"github_team_membership"\s+"[^"]+"\s+\{',
            "No 'resource \"github_team_membership\"' block found in infra/ — "
            "github_team_membership resource has not been declared",
        )

    def test_github_team_resource_uses_for_each(self):
        """
        github_team resource must use for_each — a static resource block would
        hardcode team names rather than being data-driven.
        """
        content = _read_all_tf_content()
        # Locate the github_team resource block(s) and verify for_each is inside each
        blocks = re.findall(
            r'resource\s+"github_team"\s+"[^"]+"\s+\{([^}]*(?:\{[^}]*\}[^}]*)*)\}',
            content,
            re.DOTALL,
        )
        self.assertGreater(
            len(blocks),
            0,
            "No github_team resource block found to inspect for for_each",
        )
        for block in blocks:
            self.assertIn(
                "for_each",
                block,
                "github_team resource block must use for_each to iterate over teams.yaml data",
            )

    def test_github_team_membership_resource_uses_for_each(self):
        """
        github_team_membership resource must use for_each — memberships are
        data-driven from teams.yaml member lists.
        """
        content = _read_all_tf_content()
        blocks = re.findall(
            r'resource\s+"github_team_membership"\s+"[^"]+"\s+\{([^}]*(?:\{[^}]*\}[^}]*)*)\}',
            content,
            re.DOTALL,
        )
        self.assertGreater(
            len(blocks),
            0,
            "No github_team_membership resource block found to inspect for for_each",
        )
        for block in blocks:
            self.assertIn(
                "for_each",
                block,
                "github_team_membership resource block must use for_each to iterate members",
            )


# ---------------------------------------------------------------------------
# Terraform HCL — data-driven configuration via yamldecode
# ---------------------------------------------------------------------------


class TestTerraformDataDrivenConfiguration(unittest.TestCase):
    """Configuration must be read from config/teams.yaml via yamldecode(file())."""

    def test_yamldecode_is_used_to_parse_teams_yaml(self):
        """Terraform must call yamldecode() to parse the teams YAML file."""
        content = _read_all_tf_content()
        self.assertIn(
            "yamldecode",
            content,
            "Terraform must use yamldecode() to parse config/teams.yaml — "
            "hardcoded locals are not data-driven",
        )

    def test_teams_yaml_filename_is_referenced_in_terraform(self):
        """Terraform must reference 'teams.yaml' so the correct config file is loaded."""
        content = _read_all_tf_content()
        self.assertIn(
            "teams.yaml",
            content,
            "Terraform does not reference 'teams.yaml' — "
            "the teams configuration file is not being loaded",
        )

    def test_local_values_are_defined_for_teams_data(self):
        """A locals block must extract teams data from the parsed YAML."""
        content = _read_all_tf_content()
        self.assertRegex(
            content,
            r"\blocals\s*\{",
            "No 'locals' block found in infra/ — "
            "yamldecode output must be stored in a local value before use",
        )


# ---------------------------------------------------------------------------
# variables.tf — every input variable is documented
# ---------------------------------------------------------------------------


class TestVariableDocumentation(unittest.TestCase):
    """All Terraform input variables must have description fields."""

    def _variables_content(self):
        """Return concatenated content of all variables.tf files under infra/."""
        content = ""
        for path in _find_tf_files():
            if os.path.basename(path) == "variables.tf":
                with open(path) as f:
                    content += f.read() + "\n"
        return content

    def test_variables_tf_exists_in_infra(self):
        """infra/variables.tf must exist to document all module inputs."""
        variables_tf = os.path.join(INFRA_DIR, "variables.tf")
        self.assertTrue(
            os.path.isfile(variables_tf),
            f"infra/variables.tf is missing at {variables_tf}",
        )

    def test_every_variable_block_has_a_description(self):
        """Every variable block must include a 'description' so intent is self-documenting."""
        content = self._variables_content()
        # Extract (variable_name, block_body) pairs
        variable_blocks = re.findall(
            r'variable\s+"([^"]+)"\s+\{([^}]*(?:\{[^}]*\}[^}]*)*)\}',
            content,
            re.DOTALL,
        )
        self.assertGreater(
            len(variable_blocks),
            0,
            "No variable blocks found in variables.tf — at least one variable must be declared",
        )
        for name, body in variable_blocks:
            with self.subTest(variable=name):
                self.assertIn(
                    "description",
                    body,
                    f"Variable '{name}' in variables.tf is missing a 'description' field",
                )

    def test_github_org_variable_has_description(self):
        """The pre-existing github_org variable must retain its description."""
        content = self._variables_content()
        match = re.search(
            r'variable\s+"github_org"\s+\{([^}]*(?:\{[^}]*\}[^}]*)*)\}',
            content,
            re.DOTALL,
        )
        self.assertIsNotNone(
            match,
            "Variable 'github_org' not found in variables.tf",
        )
        self.assertIn(
            "description",
            match.group(1),
            "Variable 'github_org' is missing a 'description' field",
        )


if __name__ == "__main__":
    unittest.main()
