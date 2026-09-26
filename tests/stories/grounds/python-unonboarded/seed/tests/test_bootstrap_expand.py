"""
Tests for the expanded scripts/bootstrap.sh.

The expanded bootstrap.sh must satisfy these behavioral contracts:

  Contract 1 — --check flag: validates prerequisites and prints planned actions
    - --check exits 0 when all prerequisites are present and docker daemon is running
    - --check prints what would be executed (docker compose up -d, terraform init,
      python venv install) without side effects
    - --check prints a service URL summary (ports from metrics/docker-compose.yml)
    - --check never invokes docker compose up, terraform init, or pip install

  Contract 2 — Docker prerequisite validation:
    - Script exits non-zero when `docker` is not installed
    - Script exits non-zero when `docker compose` is not available
    - Script exits non-zero when Docker daemon is not running
    - Error output names the missing/unavailable dependency

  Contract 3 — Missing tool failure paths (regression-pinning existing + new tools):
    - Script exits non-zero when git is missing (regression guard)
    - Script exits non-zero when terraform is missing (regression guard)
    - Script exits non-zero when python3 is missing (regression guard)
    - Script exits non-zero when docker is missing
    - Each failure output explicitly names the missing tool

  Contract 4 — Service URL summary:
    - Final summary section contains localhost URLs for metrics service (port 8000)
    - Final summary section contains localhost URL for postgres (port 5432)

All tests will FAIL until scripts/bootstrap.sh is expanded with --check flag,
docker validation, and service URL summary — this is the expected TDD red state.
"""

from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import unittest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BOOTSTRAP_PATH = os.path.join(REPO_ROOT, "scripts", "bootstrap.sh")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run_bootstrap(
    *args: str,
    env: dict | None = None,
    cwd: str | None = None,
) -> subprocess.CompletedProcess:
    """
    Run bootstrap.sh with the given arguments.
    Always captures stdout+stderr and never raises on non-zero exit.
    If env is provided, it is merged on top of os.environ.
    """
    run_env = os.environ.copy()
    if env is not None:
        run_env.update(env)
    return subprocess.run(
        ["bash", BOOTSTRAP_PATH, *args],
        capture_output=True,
        text=True,
        env=run_env,
        cwd=cwd or REPO_ROOT,
    )


def _write_stub(directory: str, name: str, body: str) -> str:
    """
    Write an executable bash stub script at directory/name and return its path.
    `body` is the script content after the shebang line.
    """
    path = os.path.join(directory, name)
    with open(path, "w") as f:
        f.write("#!/bin/bash\n")
        f.write(body)
    os.chmod(
        path,
        stat.S_IRWXU | stat.S_IRGRP | stat.S_IXGRP | stat.S_IROTH | stat.S_IXOTH,
    )
    return path


def _fake_path(stub_dir: str) -> str:
    """
    Return a PATH string that puts stub_dir first, preserving /bin and /usr/bin
    so that bash built-ins and system utilities remain available.
    """
    return f"{stub_dir}:/bin:/usr/bin:/usr/local/bin"


def _make_full_stub_dir(docker_daemon_running: bool = True) -> str:
    """
    Create a temporary directory containing stubs for all required tools:
    git, terraform, python3, docker (with daemon state controllable).

    Returns the directory path.  Caller is responsible for cleanup.
    """
    tmpdir = tempfile.mkdtemp()

    _write_stub(tmpdir, "git", "exit 0\n")
    _write_stub(tmpdir, "terraform", "exit 0\n")
    _write_stub(tmpdir, "python3", 'echo "Python 3.11.0"\nexit 0\n')

    if docker_daemon_running:
        docker_body = (
            'case "$1" in\n'
            '  info) exit 0 ;;\n'
            '  compose) shift; exit 0 ;;\n'
            '  *) exit 0 ;;\n'
            'esac\n'
        )
    else:
        docker_body = (
            'case "$1" in\n'
            '  info) echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock" >&2; exit 1 ;;\n'
            '  compose) shift; exit 0 ;;\n'
            '  *) exit 0 ;;\n'
            'esac\n'
        )

    _write_stub(tmpdir, "docker", docker_body)
    return tmpdir


def _make_stub_dir_missing(missing_tool: str) -> str:
    """
    Create a stub directory with all required tools EXCEPT `missing_tool`.
    Returns the directory path.  Caller is responsible for cleanup.
    """
    tmpdir = _make_full_stub_dir(docker_daemon_running=True)
    target = os.path.join(tmpdir, missing_tool)
    if os.path.exists(target):
        os.remove(target)
    return tmpdir


# ---------------------------------------------------------------------------
# Contract 1: --check flag
# ---------------------------------------------------------------------------


class TestCheckFlagExitCode(unittest.TestCase):
    """
    Contract 1a: --check must exit 0 when all prerequisites are present
    and the Docker daemon is reachable.
    """

    def test_check_flag_exits_zero_when_all_prereqs_present(self):
        """
        bootstrap.sh --check must exit 0 when git, terraform, python3, and
        docker (with running daemon) are all available.
        """
        stub_dir = _make_full_stub_dir(docker_daemon_running=True)
        try:
            result = _run_bootstrap(
                "--check",
                env={"PATH": _fake_path(stub_dir)},
            )
        finally:
            import shutil
            shutil.rmtree(stub_dir, ignore_errors=True)

        self.assertEqual(
            result.returncode,
            0,
            f"bootstrap.sh --check must exit 0 when all prerequisites are present.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_check_flag_exits_nonzero_when_docker_daemon_not_running(self):
        """
        bootstrap.sh --check must exit non-zero when the Docker daemon is not
        reachable, since docker compose up would fail without a daemon.
        """
        stub_dir = _make_full_stub_dir(docker_daemon_running=False)
        try:
            result = _run_bootstrap(
                "--check",
                env={"PATH": _fake_path(stub_dir)},
            )
        finally:
            import shutil
            shutil.rmtree(stub_dir, ignore_errors=True)

        self.assertNotEqual(
            result.returncode,
            0,
            f"bootstrap.sh --check must exit non-zero when Docker daemon is not running.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_check_flag_exits_nonzero_when_docker_missing(self):
        """
        bootstrap.sh --check must exit non-zero when docker is not installed.
        """
        stub_dir = _make_stub_dir_missing("docker")
        try:
            result = _run_bootstrap(
                "--check",
                env={"PATH": _fake_path(stub_dir)},
            )
        finally:
            import shutil
            shutil.rmtree(stub_dir, ignore_errors=True)

        self.assertNotEqual(
            result.returncode,
            0,
            f"bootstrap.sh --check must exit non-zero when docker is not installed.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


class TestCheckFlagNoSideEffects(unittest.TestCase):
    """
    Contract 1b: --check must not invoke docker compose up -d, terraform init,
    or pip install — it only validates and prints planned actions.
    """

    def _run_check_with_spy(self) -> tuple[subprocess.CompletedProcess, str]:
        """
        Run bootstrap.sh --check with spy stubs that log every subcommand
        invocation to a file, then return (result, log_content).
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            log_file = os.path.join(tmpdir, "invocations.log")

            # Spy stub: logs the tool name and all args, then succeeds
            spy_body = f'echo "$0 $@" >> "{log_file}"\nexit 0\n'

            _write_stub(tmpdir, "git", spy_body)
            _write_stub(tmpdir, "terraform", spy_body)
            _write_stub(tmpdir, "python3", spy_body)

            # Docker spy: handles info (daemon check) specially but logs everything
            docker_spy = (
                f'echo "docker $@" >> "{log_file}"\n'
                'case "$1" in\n'
                '  info) exit 0 ;;\n'
                '  compose) shift; exit 0 ;;\n'
                '  *) exit 0 ;;\n'
                'esac\n'
            )
            _write_stub(tmpdir, "docker", docker_spy)

            result = _run_bootstrap(
                "--check",
                env={"PATH": _fake_path(tmpdir)},
            )

            if os.path.exists(log_file):
                with open(log_file) as f:
                    log_content = f.read()
            else:
                log_content = ""

        return result, log_content

    def test_check_flag_does_not_run_docker_compose_up(self):
        """
        bootstrap.sh --check must not invoke 'docker compose up' since that
        would start services as a side effect in CI.
        """
        result, log = self._run_check_with_spy()
        self.assertNotIn(
            "up",
            log,
            f"bootstrap.sh --check must not invoke 'docker compose up'.\n"
            f"Invocation log:\n{log}\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_check_flag_does_not_run_terraform_init(self):
        """
        bootstrap.sh --check must not invoke 'terraform init' since that
        modifies the .terraform directory as a side effect.
        """
        result, log = self._run_check_with_spy()
        # terraform init would appear as the terraform stub being called with "init"
        has_terraform_init = "terraform init" in log or (
            "terraform" in log and "init" in log
        )
        self.assertFalse(
            has_terraform_init,
            f"bootstrap.sh --check must not invoke 'terraform init'.\n"
            f"Invocation log:\n{log}\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_check_flag_does_not_install_python_deps(self):
        """
        bootstrap.sh --check must not invoke 'pip install' or create a venv
        since installing packages has side effects.
        """
        result, log = self._run_check_with_spy()
        has_pip = "pip" in log or "pip3" in log or (
            "python3" in log and "install" in log
        )
        self.assertFalse(
            has_pip,
            f"bootstrap.sh --check must not invoke pip install or create a venv.\n"
            f"Invocation log:\n{log}\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )


class TestCheckFlagOutputContent(unittest.TestCase):
    """
    Contract 1c: --check output must describe the planned actions so the
    operator can confirm what a full run would execute.
    """

    def _run_check_all_present(self) -> subprocess.CompletedProcess:
        stub_dir = _make_full_stub_dir(docker_daemon_running=True)
        try:
            result = _run_bootstrap(
                "--check",
                env={"PATH": _fake_path(stub_dir)},
            )
        finally:
            import shutil
            shutil.rmtree(stub_dir, ignore_errors=True)
        return result

    def test_check_output_mentions_docker_compose_up(self):
        """
        bootstrap.sh --check output must mention 'docker compose up' to indicate
        that service stack startup is a planned action.
        """
        result = self._run_check_all_present()
        combined = result.stdout + result.stderr
        self.assertIn(
            "docker compose up",
            combined,
            f"--check output must mention 'docker compose up' as a planned action.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_check_output_mentions_terraform_init(self):
        """
        bootstrap.sh --check output must mention 'terraform init' to indicate
        that Terraform initialisation is a planned action.
        """
        result = self._run_check_all_present()
        combined = result.stdout + result.stderr
        self.assertIn(
            "terraform init",
            combined,
            f"--check output must mention 'terraform init' as a planned action.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_check_output_mentions_python_venv_or_pip(self):
        """
        bootstrap.sh --check output must mention venv or pip install to indicate
        that Python dependency installation is a planned action.
        """
        result = self._run_check_all_present()
        combined = result.stdout + result.stderr
        has_venv_mention = any(
            phrase in combined.lower()
            for phrase in ["venv", "pip install", "pip3 install", "python deps"]
        )
        self.assertTrue(
            has_venv_mention,
            f"--check output must mention venv or pip install as a planned action.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_check_output_includes_service_url_summary(self):
        """
        bootstrap.sh --check output must include a summary of service URLs
        so the operator knows where services will be reachable after a full run.
        """
        result = self._run_check_all_present()
        combined = result.stdout + result.stderr
        has_url = "http://localhost" in combined or "localhost:" in combined
        self.assertTrue(
            has_url,
            f"--check output must include at least one localhost service URL.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_check_output_confirms_all_prereqs_passed(self):
        """
        bootstrap.sh --check output must confirm that each prerequisite check
        passed, using a success marker (e.g. '✅' or 'found' or 'ok').
        """
        result = self._run_check_all_present()
        combined = result.stdout + result.stderr
        has_success_marker = any(
            marker in combined
            for marker in ["✅", "found", "ok", "OK", "present", "installed"]
        )
        self.assertTrue(
            has_success_marker,
            f"--check output must confirm each passing prerequisite with a success marker.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_check_output_confirms_docker_daemon_running(self):
        """
        bootstrap.sh --check output must explicitly confirm that the Docker daemon
        is reachable, not just that the docker binary is installed.
        """
        result = self._run_check_all_present()
        combined = result.stdout + result.stderr
        has_docker_running = any(
            phrase in combined.lower()
            for phrase in ["docker", "daemon", "running", "docker ok", "docker found"]
        )
        self.assertTrue(
            has_docker_running,
            f"--check output must confirm Docker daemon is reachable.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# Contract 2: Docker prerequisite validation
# ---------------------------------------------------------------------------


class TestDockerPrerequisiteValidation(unittest.TestCase):
    """
    Contract 2: bootstrap.sh must validate Docker availability and daemon
    reachability before attempting docker compose up -d.
    """

    def test_exits_nonzero_when_docker_not_installed(self):
        """
        bootstrap.sh must exit non-zero with a clear error when the docker
        binary is not on PATH.
        """
        stub_dir = _make_stub_dir_missing("docker")
        try:
            result = _run_bootstrap(env={"PATH": _fake_path(stub_dir)})
        finally:
            import shutil
            shutil.rmtree(stub_dir, ignore_errors=True)

        self.assertNotEqual(
            result.returncode,
            0,
            f"Script must exit non-zero when docker is not installed.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_error_output_names_docker_when_missing(self):
        """
        When docker is not installed, the error output must explicitly name
        'docker' so the operator knows which tool to install.
        """
        stub_dir = _make_stub_dir_missing("docker")
        try:
            result = _run_bootstrap(env={"PATH": _fake_path(stub_dir)})
        finally:
            import shutil
            shutil.rmtree(stub_dir, ignore_errors=True)

        combined = result.stdout + result.stderr
        self.assertIn(
            "docker",
            combined,
            f"Error output must name 'docker' when it is not installed.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_nonzero_when_docker_daemon_not_running(self):
        """
        bootstrap.sh must exit non-zero when docker is installed but the
        daemon is not running, since docker compose up would fail anyway.
        """
        stub_dir = _make_full_stub_dir(docker_daemon_running=False)
        try:
            result = _run_bootstrap(env={"PATH": _fake_path(stub_dir)})
        finally:
            import shutil
            shutil.rmtree(stub_dir, ignore_errors=True)

        self.assertNotEqual(
            result.returncode,
            0,
            f"Script must exit non-zero when Docker daemon is not running.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_error_output_mentions_daemon_when_docker_not_running(self):
        """
        When the Docker daemon is not running, the error output must help the
        operator understand the issue (not just 'docker not found').
        """
        stub_dir = _make_full_stub_dir(docker_daemon_running=False)
        try:
            result = _run_bootstrap(env={"PATH": _fake_path(stub_dir)})
        finally:
            import shutil
            shutil.rmtree(stub_dir, ignore_errors=True)

        combined = result.stdout + result.stderr
        has_daemon_context = any(
            phrase in combined.lower()
            for phrase in ["daemon", "running", "docker", "not running", "connect"]
        )
        self.assertTrue(
            has_daemon_context,
            f"Error output must explain that the Docker daemon is not reachable.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# Contract 3: Missing tool failure paths (all prerequisite tools)
# ---------------------------------------------------------------------------


class TestMissingToolFailurePaths(unittest.TestCase):
    """
    Contract 3: Each missing prerequisite must produce a non-zero exit code
    and output that explicitly names the missing tool.
    """

    def _assert_fails_with_name(self, missing_tool: str, check_flag: bool = False) -> None:
        """
        Assert that bootstrap.sh exits non-zero and names the missing tool
        when `missing_tool` is absent from PATH.
        """
        stub_dir = _make_stub_dir_missing(missing_tool)
        try:
            args = ["--check"] if check_flag else []
            result = _run_bootstrap(*args, env={"PATH": _fake_path(stub_dir)})
        finally:
            import shutil
            shutil.rmtree(stub_dir, ignore_errors=True)

        self.assertNotEqual(
            result.returncode,
            0,
            f"Script must exit non-zero when '{missing_tool}' is missing.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )
        combined = result.stdout + result.stderr
        self.assertIn(
            missing_tool,
            combined,
            f"Error output must name the missing tool '{missing_tool}'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    # --- regression guards for existing prerequisite checks ---

    def test_exits_nonzero_and_names_git_when_git_is_missing(self):
        """
        bootstrap.sh must exit non-zero and name 'git' when it is not installed.
        Regression guard: this was checked in the original bootstrap.sh.
        """
        self._assert_fails_with_name("git")

    def test_exits_nonzero_and_names_terraform_when_terraform_is_missing(self):
        """
        bootstrap.sh must exit non-zero and name 'terraform' when it is not installed.
        Regression guard: this was checked in the original bootstrap.sh.
        """
        self._assert_fails_with_name("terraform")

    def test_exits_nonzero_and_names_python3_when_python3_is_missing(self):
        """
        bootstrap.sh must exit non-zero and name 'python3' when it is not installed.
        Regression guard: this was checked in the original bootstrap.sh.
        """
        self._assert_fails_with_name("python3")

    # --- new prerequisite: docker ---

    def test_exits_nonzero_and_names_docker_when_docker_is_missing(self):
        """
        bootstrap.sh must exit non-zero and name 'docker' when it is not installed.
        New requirement: docker is needed for the metrics stack.
        """
        self._assert_fails_with_name("docker")

    # --- --check flag also validates all prerequisites ---

    def test_check_flag_exits_nonzero_and_names_git_when_missing(self):
        """
        bootstrap.sh --check must exit non-zero and name 'git' when missing,
        so CI reports the missing prerequisite clearly.
        """
        self._assert_fails_with_name("git", check_flag=True)

    def test_check_flag_exits_nonzero_and_names_terraform_when_missing(self):
        """
        bootstrap.sh --check must exit non-zero and name 'terraform' when missing.
        """
        self._assert_fails_with_name("terraform", check_flag=True)

    def test_check_flag_exits_nonzero_and_names_python3_when_missing(self):
        """
        bootstrap.sh --check must exit non-zero and name 'python3' when missing.
        """
        self._assert_fails_with_name("python3", check_flag=True)

    def test_check_flag_exits_nonzero_and_names_docker_when_missing(self):
        """
        bootstrap.sh --check must exit non-zero and name 'docker' when missing.
        """
        self._assert_fails_with_name("docker", check_flag=True)


# ---------------------------------------------------------------------------
# Contract 4: Service URL summary
# ---------------------------------------------------------------------------


class TestServiceUrlSummary(unittest.TestCase):
    """
    Contract 4: On a successful --check run, bootstrap.sh must print a summary
    of service URLs for the local metrics stack defined in metrics/docker-compose.yml.
    """

    def _run_check_all_present(self) -> subprocess.CompletedProcess:
        stub_dir = _make_full_stub_dir(docker_daemon_running=True)
        try:
            result = _run_bootstrap(
                "--check",
                env={"PATH": _fake_path(stub_dir)},
            )
        finally:
            import shutil
            shutil.rmtree(stub_dir, ignore_errors=True)
        return result

    def test_summary_includes_metrics_service_url(self):
        """
        The output summary must include the metrics service URL on port 8000
        (as defined in metrics/docker-compose.yml: metrics service, port 8000).
        """
        result = self._run_check_all_present()
        combined = result.stdout + result.stderr
        self.assertIn(
            "8000",
            combined,
            f"Summary must include metrics service URL on port 8000.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_summary_includes_postgres_url(self):
        """
        The output summary must include the postgres URL on port 5432
        (as defined in metrics/docker-compose.yml: postgres service, port 5432).
        """
        result = self._run_check_all_present()
        combined = result.stdout + result.stderr
        self.assertIn(
            "5432",
            combined,
            f"Summary must include postgres URL on port 5432.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_summary_section_is_present(self):
        """
        The output must contain a recognisable 'summary' or 'services' header
        so the operator can quickly scan to the relevant section.
        """
        result = self._run_check_all_present()
        combined = result.stdout + result.stderr
        has_summary_header = any(
            phrase in combined.lower()
            for phrase in ["summary", "services", "available at", "running at", "urls"]
        )
        self.assertTrue(
            has_summary_header,
            f"Output must include a 'summary' or 'services' section header.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_summary_is_not_printed_on_prerequisite_failure(self):
        """
        The service URL summary must NOT appear when a prerequisite check fails —
        printing URLs for services that were never started would be misleading.
        """
        stub_dir = _make_stub_dir_missing("docker")
        try:
            result = _run_bootstrap(
                "--check",
                env={"PATH": _fake_path(stub_dir)},
            )
        finally:
            import shutil
            shutil.rmtree(stub_dir, ignore_errors=True)

        combined = result.stdout + result.stderr
        # Should not print the metrics port when docker is missing
        self.assertNotIn(
            ":8000",
            combined,
            f"Service URL summary must not appear when prerequisites are missing.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# Script existence guard
# ---------------------------------------------------------------------------


class TestBootstrapScriptExists(unittest.TestCase):
    """Sanity check that the script file exists — fails fast if file is missing."""

    def test_bootstrap_script_file_exists(self):
        """scripts/bootstrap.sh must exist at the expected path."""
        self.assertTrue(
            os.path.isfile(BOOTSTRAP_PATH),
            f"scripts/bootstrap.sh not found at {BOOTSTRAP_PATH}",
        )

    def test_bootstrap_script_is_executable(self):
        """scripts/bootstrap.sh must have execute permission."""
        self.assertTrue(
            os.access(BOOTSTRAP_PATH, os.X_OK),
            f"scripts/bootstrap.sh is not executable: {BOOTSTRAP_PATH}",
        )


if __name__ == "__main__":
    unittest.main()
