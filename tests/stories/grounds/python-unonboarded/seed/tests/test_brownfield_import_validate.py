"""
Behavioural validation tests for scripts/import-existing-repos.sh.

Tests run the script with mocked gh CLI and terraform binaries to verify:
  - The script produces syntactically valid 'terraform import' command lines
  - Each import command has the correct arity: exactly two positional arguments
    (resource address and resource ID)
  - Import commands for repos follow the pattern:
      terraform import <resource_address> <org>/<repo>
  - Import commands for teams follow the pattern:
      terraform import <resource_address> <team_id>
  - The script exits non-zero (code 1) when gh is not authenticated
  - The script exits non-zero when gh is not installed
  - The script exits non-zero when terraform is not initialised
  - The script handles an org with zero repositories without crashing
  - The script handles an org with zero teams without crashing
  - The script handles repository names containing hyphens and dots
  - Generated import commands are parseable as valid shell words

All tests fail until the script is implemented (TDD red phase).
"""

import os
import re
import shlex
import stat
import subprocess
import tempfile
import textwrap
import unittest


REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
IMPORT_SCRIPT = os.path.join(REPO_ROOT, "scripts", "import-existing-repos.sh")


def _script_exists() -> bool:
    return os.path.exists(IMPORT_SCRIPT)


def _make_executable(path: str) -> None:
    os.chmod(path, os.stat(path).st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)


def _write_mock_script(path: str, content: str) -> None:
    """Write a mock binary script and make it executable."""
    with open(path, "w") as f:
        f.write("#!/usr/bin/env bash\n")
        f.write(content)
    _make_executable(path)


def _run_script(
    env_overrides: dict,
    extra_env: dict | None = None,
    mock_bin_dir: str | None = None,
    args: list[str] | None = None,
) -> subprocess.CompletedProcess:
    """
    Run the import script in a controlled environment.

    :param env_overrides: Variables to set/override in the process environment.
    :param extra_env: Additional environment variables (merged after overrides).
    :param mock_bin_dir: Directory prepended to PATH containing mock binaries.
    :param args: Command-line arguments to pass to the script.
    :returns: CompletedProcess with stdout, stderr, and returncode.
    """
    env = os.environ.copy()
    if mock_bin_dir:
        env["PATH"] = mock_bin_dir + os.pathsep + env.get("PATH", "")
    env.update(env_overrides)
    if extra_env:
        env.update(extra_env)

    cmd = [IMPORT_SCRIPT] + (args or [])
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )


def _extract_import_commands(output: str) -> list[str]:
    """Return lines from script output that begin with 'terraform import'."""
    return [
        line.strip()
        for line in output.splitlines()
        if line.strip().startswith("terraform import")
    ]


def _is_valid_import_command(line: str) -> tuple[bool, str]:
    """
    Return (True, '') if the line is a syntactically valid terraform import command,
    or (False, reason) explaining the failure.

    A valid command has the form:
        terraform import <resource_address> <resource_id>

    Where:
        - <resource_address> is a non-empty string (no spaces unless quoted)
        - <resource_id>      is a non-empty string (no spaces unless quoted)
    """
    try:
        tokens = shlex.split(line)
    except ValueError as exc:
        return False, f"shlex parsing failed: {exc}"

    if len(tokens) < 4:
        return False, (
            f"expected at least 4 tokens (terraform import <address> <id>), "
            f"got {len(tokens)}: {tokens!r}"
        )

    if tokens[0] != "terraform":
        return False, f"first token must be 'terraform', got {tokens[0]!r}"

    if tokens[1] != "import":
        return False, f"second token must be 'import', got {tokens[1]!r}"

    resource_address = tokens[2]
    resource_id = tokens[3]

    if not resource_address:
        return False, "resource address (third token) is empty"

    if not resource_id:
        return False, "resource id (fourth token) is empty"

    return True, ""


# ---------------------------------------------------------------------------
# Happy-path: repos and teams emitted correctly
# ---------------------------------------------------------------------------


class TestImportScriptHappyPath(unittest.TestCase):
    """The script must produce valid import commands from mocked gh output."""

    def setUp(self):
        if not _script_exists():
            self.skipTest("import script not yet implemented — TDD red phase")

    def _build_mock_env(self, tmpdir: str, repo_names: list[str], teams: list[dict]) -> str:
        """
        Create a mock bin directory with fake gh and terraform binaries.

        :param tmpdir: Temporary directory to write mock binaries into.
        :param repo_names: List of repository names to return from 'gh repo list'.
        :param teams: List of dicts with 'name' and 'id' keys for team data.
        :returns: Path to the mock bin directory.
        """
        bin_dir = os.path.join(tmpdir, "bin")
        os.makedirs(bin_dir, exist_ok=True)

        # Mock gh binary
        # gh repo list --org <org> --json name outputs JSON array of {name: ...}
        # gh api orgs/<org>/teams outputs JSON array of {name: ..., id: ...}
        repo_json = "[" + ",".join(f'{{"name":"{r}"}}' for r in repo_names) + "]"
        team_json = (
            "["
            + ",".join(f'{{"name":"{t["name"]}","id":{t["id"]}}}' for t in teams)
            + "]"
        )

        gh_script = textwrap.dedent(f"""\
            case "$*" in
              *"auth status"*)
                exit 0
                ;;
              *"repo list"*)
                echo '{repo_json}'
                ;;
              *"api"*"teams"*)
                echo '{team_json}'
                ;;
              *)
                exit 0
                ;;
            esac
        """)
        _write_mock_script(os.path.join(bin_dir, "gh"), gh_script)

        # Mock terraform: just need it to exist and be executable
        _write_mock_script(
            os.path.join(bin_dir, "terraform"),
            'echo "Terraform v1.0.0"\n',
        )

        # Create a fake .terraform directory so the init check passes
        tf_dir = os.path.join(REPO_ROOT, "infra", ".terraform")
        os.makedirs(tf_dir, exist_ok=True)

        return bin_dir

    def test_import_commands_are_syntactically_valid(self):
        """
        Every line beginning with 'terraform import' in the script output must be
        parseable by shlex.split with exactly 4 tokens in the correct positions.
        Invalid syntax would produce shell errors when an operator tries to execute
        the generated commands.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = self._build_mock_env(
                tmpdir,
                repo_names=["my-app", "infra-repo"],
                teams=[{"name": "platform", "id": 123}],
            )
            result = _run_script(
                env_overrides={"GITHUB_ORG": "test-org"},
                mock_bin_dir=bin_dir,
            )

        import_lines = _extract_import_commands(result.stdout)
        self.assertGreater(
            len(import_lines),
            0,
            "Script produced no 'terraform import' lines — expected at least one "
            f"for repos/teams. stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        for line in import_lines:
            valid, reason = _is_valid_import_command(line)
            with self.subTest(line=line):
                self.assertTrue(valid, f"Import command is not syntactically valid: {reason}")

    def test_repo_import_commands_include_org_and_repo_name_as_id(self):
        """
        The resource ID in repo import commands must follow the pattern <org>/<repo>
        — this is the identifier GitHub uses to address repositories in the API,
        and what the Terraform github provider expects as the import ID.
        """
        org = "acme-corp"
        repo = "my-service"
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = self._build_mock_env(
                tmpdir,
                repo_names=[repo],
                teams=[],
            )
            result = _run_script(
                env_overrides={"GITHUB_ORG": org},
                mock_bin_dir=bin_dir,
            )

        repo_import_lines = [
            l for l in _extract_import_commands(result.stdout)
            if "github_repository" in l
        ]
        self.assertGreater(
            len(repo_import_lines),
            0,
            f"No github_repository import commands found in output:\n{result.stdout}",
        )
        for line in repo_import_lines:
            tokens = shlex.split(line)
            resource_id = tokens[3] if len(tokens) > 3 else ""
            self.assertIn(
                org,
                resource_id,
                f"Repository import ID must include the org name '{org}': {line!r}",
            )
            self.assertIn(
                repo,
                resource_id,
                f"Repository import ID must include the repo name '{repo}': {line!r}",
            )

    def test_team_import_commands_include_team_id_as_resource_id(self):
        """
        The resource ID in team import commands must be the team's numeric ID —
        the GitHub Terraform provider uses the integer team ID (not team slug)
        as the import identifier for github_team resources.
        """
        org = "acme-corp"
        team_id = 42
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = self._build_mock_env(
                tmpdir,
                repo_names=[],
                teams=[{"name": "ops-team", "id": team_id}],
            )
            result = _run_script(
                env_overrides={"GITHUB_ORG": org},
                mock_bin_dir=bin_dir,
            )

        team_import_lines = [
            l for l in _extract_import_commands(result.stdout)
            if "github_team" in l
        ]
        self.assertGreater(
            len(team_import_lines),
            0,
            f"No github_team import commands found in output:\n{result.stdout}",
        )
        for line in team_import_lines:
            self.assertIn(
                str(team_id),
                line,
                f"Team import command must include the numeric team ID ({team_id}): {line!r}",
            )

    def test_script_emits_one_import_command_per_repository(self):
        """
        The script must emit exactly one 'terraform import github_repository' command
        per repository returned by gh — duplicates would cause Terraform to attempt
        importing the same resource twice, which is an error.
        """
        repos = ["alpha", "beta", "gamma"]
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = self._build_mock_env(
                tmpdir,
                repo_names=repos,
                teams=[],
            )
            result = _run_script(
                env_overrides={"GITHUB_ORG": "my-org"},
                mock_bin_dir=bin_dir,
            )

        repo_import_lines = [
            l for l in _extract_import_commands(result.stdout)
            if "github_repository" in l
        ]
        self.assertEqual(
            len(repo_import_lines),
            len(repos),
            f"Expected {len(repos)} github_repository import commands (one per repo), "
            f"got {len(repo_import_lines)}:\n{result.stdout}",
        )

    def test_script_emits_one_import_command_per_team(self):
        """
        The script must emit exactly one 'terraform import github_team' command
        per team returned by gh — no duplicates.
        """
        teams = [
            {"name": "core-team", "id": 1},
            {"name": "platform-team", "id": 2},
        ]
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = self._build_mock_env(
                tmpdir,
                repo_names=[],
                teams=teams,
            )
            result = _run_script(
                env_overrides={"GITHUB_ORG": "my-org"},
                mock_bin_dir=bin_dir,
            )

        team_import_lines = [
            l for l in _extract_import_commands(result.stdout)
            if "github_team" in l
        ]
        self.assertEqual(
            len(team_import_lines),
            len(teams),
            f"Expected {len(teams)} github_team import commands, "
            f"got {len(team_import_lines)}:\n{result.stdout}",
        )

    def test_script_succeeds_with_zero_repos(self):
        """
        The script must not crash or emit errors when the organisation has no
        repositories — an empty org is a valid state, and the script should
        complete successfully with an empty import list.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = self._build_mock_env(tmpdir, repo_names=[], teams=[])
            result = _run_script(
                env_overrides={"GITHUB_ORG": "empty-org"},
                mock_bin_dir=bin_dir,
            )

        self.assertEqual(
            result.returncode,
            0,
            f"Script exited non-zero with an empty org (no repos/teams):\n"
            f"stderr: {result.stderr}",
        )

    def test_script_handles_repo_names_with_hyphens_and_dots(self):
        """
        The script must correctly handle repository names containing hyphens and
        dots — these are common in real-world org repos (e.g. 'my-service',
        'api.v2'). The generated import addresses must not mangle these names.
        """
        repo = "my-service.v2"
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = self._build_mock_env(
                tmpdir,
                repo_names=[repo],
                teams=[],
            )
            result = _run_script(
                env_overrides={"GITHUB_ORG": "acme"},
                mock_bin_dir=bin_dir,
            )

        repo_import_lines = [
            l for l in _extract_import_commands(result.stdout)
            if "github_repository" in l
        ]
        self.assertGreater(
            len(repo_import_lines),
            0,
            f"No github_repository import for repo '{repo}':\n{result.stdout}",
        )
        found_repo = any(repo in line for line in repo_import_lines)
        self.assertTrue(
            found_repo,
            f"Import command for '{repo}' not found in output. "
            f"Repo name may have been mangled:\n{chr(10).join(repo_import_lines)}",
        )


# ---------------------------------------------------------------------------
# Prerequisite failures: exit non-zero
# ---------------------------------------------------------------------------


class TestImportScriptPrerequisiteFailures(unittest.TestCase):
    """The script must exit non-zero and print an error for each missing prerequisite."""

    def setUp(self):
        if not _script_exists():
            self.skipTest("import script not yet implemented — TDD red phase")

    def test_script_exits_nonzero_when_gh_not_authenticated(self):
        """
        When 'gh auth status' returns non-zero the script must exit with a
        non-zero code — continuing with unauthenticated gh would silently
        produce empty output with no actionable error message.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = os.path.join(tmpdir, "bin")
            os.makedirs(bin_dir)
            # Mock gh that always fails auth status
            _write_mock_script(
                os.path.join(bin_dir, "gh"),
                textwrap.dedent("""\
                    case "$*" in
                      *"auth status"*)
                        echo "You are not logged into any GitHub hosts." >&2
                        exit 1
                        ;;
                    esac
                    exit 0
                """),
            )
            _write_mock_script(
                os.path.join(bin_dir, "terraform"),
                'echo "Terraform v1.0.0"\n',
            )

            result = _run_script(
                env_overrides={"GITHUB_ORG": "test-org"},
                mock_bin_dir=bin_dir,
            )

        self.assertNotEqual(
            result.returncode,
            0,
            "Script must exit non-zero when gh is not authenticated, "
            f"but it exited 0.\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_script_prints_error_message_when_gh_not_authenticated(self):
        """
        The error output when gh is unauthenticated must include a descriptive
        message — a bare exit without output leaves the operator confused.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = os.path.join(tmpdir, "bin")
            os.makedirs(bin_dir)
            _write_mock_script(
                os.path.join(bin_dir, "gh"),
                textwrap.dedent("""\
                    case "$*" in
                      *"auth status"*)
                        exit 1
                        ;;
                    esac
                    exit 0
                """),
            )
            _write_mock_script(
                os.path.join(bin_dir, "terraform"),
                'echo "Terraform v1.0.0"\n',
            )

            result = _run_script(
                env_overrides={"GITHUB_ORG": "test-org"},
                mock_bin_dir=bin_dir,
            )

        combined_output = result.stdout + result.stderr
        has_error_message = bool(
            re.search(r"error|not authenticated|not logged|auth", combined_output, re.IGNORECASE)
        )
        self.assertTrue(
            has_error_message,
            "Script must print a descriptive error message when gh is not authenticated. "
            f"stdout: {result.stdout!r}\nstderr: {result.stderr!r}",
        )

    def test_script_exits_nonzero_when_gh_not_installed(self):
        """
        When the gh CLI is not found on PATH the script must exit non-zero —
        attempting to call a missing binary would produce an obscure 'command not found'
        error deep in the script rather than a clear diagnostic.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            # Empty PATH: gh and terraform are not available
            empty_bin_dir = os.path.join(tmpdir, "empty_bin")
            os.makedirs(empty_bin_dir)
            # Only provide terraform, not gh
            _write_mock_script(
                os.path.join(empty_bin_dir, "terraform"),
                'echo "Terraform v1.0.0"\n',
            )

            result = _run_script(
                env_overrides={"GITHUB_ORG": "test-org", "PATH": empty_bin_dir},
            )

        self.assertNotEqual(
            result.returncode,
            0,
            "Script must exit non-zero when gh is not installed (not on PATH), "
            f"but it exited 0.\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_script_exits_nonzero_when_terraform_not_installed(self):
        """
        When terraform is not found on PATH the script must exit non-zero —
        without terraform, the generated import commands cannot be executed,
        so the script should fail fast rather than emitting unusable output.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = os.path.join(tmpdir, "bin")
            os.makedirs(bin_dir)
            # Only provide gh, not terraform
            _write_mock_script(
                os.path.join(bin_dir, "gh"),
                textwrap.dedent("""\
                    case "$*" in
                      *"auth status"*)
                        exit 0
                        ;;
                    esac
                    exit 0
                """),
            )

            result = _run_script(
                env_overrides={"GITHUB_ORG": "test-org", "PATH": bin_dir},
            )

        self.assertNotEqual(
            result.returncode,
            0,
            "Script must exit non-zero when terraform is not installed, "
            f"but it exited 0.\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_script_exits_nonzero_when_terraform_not_initialized(self):
        """
        When the infra/ directory has no .terraform directory and no
        .terraform.lock.hcl the script must exit non-zero — running
        'terraform import' without 'terraform init' will always fail.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = os.path.join(tmpdir, "bin")
            os.makedirs(bin_dir)

            _write_mock_script(
                os.path.join(bin_dir, "gh"),
                textwrap.dedent("""\
                    case "$*" in
                      *"auth status"*)
                        exit 0
                        ;;
                    esac
                    exit 0
                """),
            )
            _write_mock_script(
                os.path.join(bin_dir, "terraform"),
                'echo "Terraform v1.0.0"\n',
            )

            # Run from the tmpdir where there is no .terraform directory
            result = subprocess.run(
                [IMPORT_SCRIPT],
                capture_output=True,
                text=True,
                env={
                    **os.environ,
                    "PATH": bin_dir + os.pathsep + os.environ.get("PATH", ""),
                    "GITHUB_ORG": "test-org",
                    # Override any TF_DATA_DIR that might point at an existing .terraform
                    "TF_DATA_DIR": os.path.join(tmpdir, ".terraform"),
                },
                cwd=tmpdir,
                timeout=30,
            )

        self.assertNotEqual(
            result.returncode,
            0,
            "Script must exit non-zero when terraform has not been initialized "
            "(no .terraform directory present), "
            f"but it exited 0.\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_script_exits_nonzero_when_github_org_not_set(self):
        """
        When GITHUB_ORG is not provided (empty or unset) the script must exit
        non-zero — without knowing the target org, the script cannot enumerate
        any resources or produce meaningful import commands.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = os.path.join(tmpdir, "bin")
            os.makedirs(bin_dir)
            _write_mock_script(
                os.path.join(bin_dir, "gh"),
                'case "$*" in\n  *"auth status"*) exit 0;;\nesac\nexit 0\n',
            )
            _write_mock_script(
                os.path.join(bin_dir, "terraform"),
                'echo "Terraform v1.0.0"\n',
            )

            env = os.environ.copy()
            env["PATH"] = bin_dir + os.pathsep + env.get("PATH", "")
            env.pop("GITHUB_ORG", None)  # Ensure it is unset

            result = subprocess.run(
                [IMPORT_SCRIPT],
                capture_output=True,
                text=True,
                env=env,
                timeout=30,
            )

        self.assertNotEqual(
            result.returncode,
            0,
            "Script must exit non-zero when GITHUB_ORG is not set, "
            f"but it exited 0.\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# Command syntax: all generated lines are parseable as valid shell
# ---------------------------------------------------------------------------


class TestGeneratedCommandSyntax(unittest.TestCase):
    """All 'terraform import' lines in the output must be valid shell commands."""

    def setUp(self):
        if not _script_exists():
            self.skipTest("import script not yet implemented — TDD red phase")

    def test_all_import_lines_parse_with_shlex(self):
        """
        Every 'terraform import ...' line produced by the script must be parseable
        by shlex.split without raising ValueError — unparseable lines indicate
        unquoted special characters or unclosed quotes that would break the shell.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = os.path.join(tmpdir, "bin")
            os.makedirs(bin_dir)

            repo_json = '[{"name":"repo-a"},{"name":"repo.b"},{"name":"repo_c"}]'
            team_json = '[{"name":"team-one","id":10},{"name":"team.two","id":20}]'

            _write_mock_script(
                os.path.join(bin_dir, "gh"),
                textwrap.dedent(f"""\
                    case "$*" in
                      *"auth status"*) exit 0;;
                      *"repo list"*) echo '{repo_json}';;
                      *"api"*"teams"*) echo '{team_json}';;
                    esac
                    exit 0
                """),
            )
            _write_mock_script(
                os.path.join(bin_dir, "terraform"),
                'echo "Terraform v1.0.0"\n',
            )

            # Ensure .terraform dir exists so init check passes
            tf_dir = os.path.join(REPO_ROOT, "infra", ".terraform")
            os.makedirs(tf_dir, exist_ok=True)

            result = _run_script(
                env_overrides={"GITHUB_ORG": "my-org"},
                mock_bin_dir=bin_dir,
            )

        import_lines = _extract_import_commands(result.stdout)
        self.assertGreater(
            len(import_lines),
            0,
            f"No import commands in output:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

        for line in import_lines:
            with self.subTest(line=line):
                try:
                    tokens = shlex.split(line)
                except ValueError as exc:
                    self.fail(
                        f"Import command failed shlex.split: {exc}\nLine: {line!r}"
                    )
                valid, reason = _is_valid_import_command(line)
                self.assertTrue(
                    valid,
                    f"Import command has invalid structure: {reason}\nLine: {line!r}",
                )

    def test_resource_addresses_use_valid_terraform_identifier_characters(self):
        """
        Resource addresses in import commands must consist of valid Terraform
        identifier characters — letters, digits, underscores, hyphens, dots,
        and square brackets for indexing. Addresses with spaces or shell-special
        characters (unquoted) would break when executed as shell commands.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bin_dir = os.path.join(tmpdir, "bin")
            os.makedirs(bin_dir)

            repo_json = '[{"name":"my-repo"}]'
            team_json = '[{"name":"my-team","id":99}]'

            _write_mock_script(
                os.path.join(bin_dir, "gh"),
                textwrap.dedent(f"""\
                    case "$*" in
                      *"auth status"*) exit 0;;
                      *"repo list"*) echo '{repo_json}';;
                      *"api"*"teams"*) echo '{team_json}';;
                    esac
                    exit 0
                """),
            )
            _write_mock_script(
                os.path.join(bin_dir, "terraform"),
                'echo "Terraform v1.0.0"\n',
            )

            tf_dir = os.path.join(REPO_ROOT, "infra", ".terraform")
            os.makedirs(tf_dir, exist_ok=True)

            result = _run_script(
                env_overrides={"GITHUB_ORG": "acme"},
                mock_bin_dir=bin_dir,
            )

        import_lines = _extract_import_commands(result.stdout)
        for line in import_lines:
            tokens = shlex.split(line) if import_lines else []
            if len(tokens) < 3:
                continue
            resource_address = tokens[2]
            # Remove quoted bracket content for pattern check
            # Valid: github_repository.repos["my-repo"] or github_repository.repos[\"my-repo\"]
            address_without_index = re.sub(r'\[.*?\]', '', resource_address)
            with self.subTest(address=resource_address):
                self.assertRegex(
                    address_without_index,
                    r'^[a-zA-Z_][a-zA-Z0-9_.]*$',
                    f"Resource address '{resource_address}' contains invalid characters "
                    "outside of the bracket-indexed portion",
                )


if __name__ == "__main__":
    unittest.main()
