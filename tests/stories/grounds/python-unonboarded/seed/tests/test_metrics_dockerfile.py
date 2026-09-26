"""
Tests for the metrics service Dockerfile.

Validates that metrics/Dockerfile:
  - Exists in the metrics/ directory
  - Uses a Python base image pinned to a specific version (not :latest)
  - Uses a slim or alpine variant to keep the image small (target: under 200 MB)
  - Copies requirements.txt and installs dependencies with pip
  - Copies the application source code
  - Exposes port 8000 (the uvicorn default)
  - Declares a CMD or ENTRYPOINT that starts the application with uvicorn

These tests are fast, filesystem-only checks — no Docker daemon is required.
They fail until metrics/Dockerfile is created as part of the implementation
(TDD red phase).
"""

import os
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).parent.parent
DOCKERFILE_PATH = REPO_ROOT / "metrics" / "Dockerfile"


def _read_dockerfile() -> str:
    """Return the Dockerfile content, or skip the test if the file is missing."""
    import pytest

    if not DOCKERFILE_PATH.exists():
        pytest.skip(
            f"metrics/Dockerfile not found at {DOCKERFILE_PATH}. "
            "Create the Dockerfile as part of the implementation."
        )
    return DOCKERFILE_PATH.read_text()


# ---------------------------------------------------------------------------
# File existence
# ---------------------------------------------------------------------------


class TestDockerfileExists(unittest.TestCase):
    """metrics/Dockerfile must exist for the docker-compose build to work."""

    def test_dockerfile_exists_in_metrics_directory(self):
        """
        metrics/Dockerfile must be present — docker-compose.yml references it
        as the build target for the metrics service.
        """
        self.assertTrue(
            DOCKERFILE_PATH.exists(),
            f"metrics/Dockerfile not found at {DOCKERFILE_PATH}. "
            "Create it so the metrics service can be built by docker-compose.",
        )

    def test_dockerfile_is_not_empty(self):
        """Dockerfile must not be an empty file."""
        if not DOCKERFILE_PATH.exists():
            self.skipTest("Dockerfile not found")
        content = DOCKERFILE_PATH.read_text().strip()
        self.assertTrue(
            content,
            "metrics/Dockerfile exists but is empty — it must contain valid instructions",
        )


# ---------------------------------------------------------------------------
# Base image
# ---------------------------------------------------------------------------


class TestDockerfileBaseImage(unittest.TestCase):
    """Dockerfile must use a pinned, minimal Python base image."""

    def _from_lines(self) -> list[str]:
        content = _read_dockerfile()
        return [
            line.strip()
            for line in content.splitlines()
            if line.strip().upper().startswith("FROM")
        ]

    def test_dockerfile_has_from_instruction(self):
        """Dockerfile must declare a FROM instruction."""
        from_lines = self._from_lines()
        self.assertGreater(
            len(from_lines),
            0,
            "Dockerfile has no FROM instruction — it cannot be built without a base image",
        )

    def test_base_image_is_python(self):
        """
        The base image must be a Python image so the application dependencies
        (FastAPI, uvicorn, SQLAlchemy, etc.) can be installed.
        """
        from_lines = self._from_lines()
        python_from = [l for l in from_lines if "python" in l.lower()]
        self.assertGreater(
            len(python_from),
            0,
            f"No Python base image found in FROM instructions: {from_lines!r}. "
            "Use a Python image such as 'python:3.12-slim'.",
        )

    def test_base_image_is_not_latest_tag(self):
        """
        The base image must not use the ':latest' tag — pinning to a specific
        version ensures reproducible builds and avoids surprise upgrades.
        """
        from_lines = self._from_lines()
        latest_lines = [l for l in from_lines if ":latest" in l]
        self.assertEqual(
            latest_lines,
            [],
            f"Dockerfile uses ':latest' tag: {latest_lines!r}. "
            "Pin to a specific Python version such as 'python:3.12-slim'.",
        )

    def test_base_image_uses_slim_or_alpine_variant(self):
        """
        The base image must use a slim or alpine variant to keep the Docker
        image small and help stay under the 200 MB CI size gate.
        A full Python image is typically 900 MB+.
        """
        from_lines = self._from_lines()
        # Multi-stage builds may use a full image for building and then switch
        # to slim/alpine for the final stage.  Accept either case.
        slim_or_alpine = [
            l for l in from_lines
            if "slim" in l.lower() or "alpine" in l.lower()
        ]
        self.assertGreater(
            len(slim_or_alpine),
            0,
            f"No slim or alpine Python image found in FROM instructions: {from_lines!r}. "
            "Use 'python:3.12-slim' or 'python:3.12-alpine' to keep the image "
            "under the 200 MB CI size gate.",
        )


# ---------------------------------------------------------------------------
# Dependency installation
# ---------------------------------------------------------------------------


class TestDockerfileDependencyInstallation(unittest.TestCase):
    """Dockerfile must copy requirements.txt and install dependencies with pip."""

    def setUp(self):
        self.content = _read_dockerfile()

    def test_copies_requirements_txt(self):
        """
        Dockerfile must COPY requirements.txt before installing so the
        dependency list is available inside the build context.
        """
        self.assertIn(
            "requirements.txt",
            self.content,
            "Dockerfile does not reference requirements.txt. "
            "Add 'COPY requirements.txt .' before the pip install step.",
        )

    def test_installs_requirements_with_pip(self):
        """Dockerfile must install Python dependencies using pip."""
        self.assertIn(
            "pip install",
            self.content,
            "Dockerfile has no 'pip install' command. "
            "Install dependencies with 'RUN pip install -r requirements.txt'.",
        )

    def test_pip_install_uses_requirements_file(self):
        """
        pip install must reference requirements.txt (via -r flag) rather than
        installing packages individually, so all pinned versions are respected.
        """
        has_requirements_flag = (
            "-r requirements.txt" in self.content
            or "-r /requirements.txt" in self.content
            or "-r ./requirements.txt" in self.content
            or "-r /app/requirements.txt" in self.content
        )
        self.assertTrue(
            has_requirements_flag,
            "pip install step does not use '-r requirements.txt'. "
            "Install from the requirements file to respect pinned versions.",
        )

    def test_pip_install_uses_no_cache_dir_or_equivalent(self):
        """
        pip install should use '--no-cache-dir' to avoid storing the pip cache
        in the image layer, which would unnecessarily inflate the image size.
        """
        self.assertIn(
            "--no-cache-dir",
            self.content,
            "pip install does not use '--no-cache-dir'. "
            "Add this flag to avoid inflating the image size with cached packages.",
        )


# ---------------------------------------------------------------------------
# Application setup
# ---------------------------------------------------------------------------


class TestDockerfileApplicationSetup(unittest.TestCase):
    """Dockerfile must copy source code and configure the application to run."""

    def setUp(self):
        self.content = _read_dockerfile()

    def test_copies_application_source_code(self):
        """
        Dockerfile must COPY the application source code into the image so
        the metrics service can be executed.
        """
        copy_lines = [
            line.strip()
            for line in self.content.splitlines()
            if line.strip().upper().startswith("COPY")
        ]
        self.assertGreater(
            len(copy_lines),
            0,
            "Dockerfile has no COPY instructions. "
            "Copy the application source (e.g., 'COPY src/ /app/src/').",
        )

    def test_exposes_port_8000(self):
        """
        Dockerfile must EXPOSE port 8000 — uvicorn binds to this port by default,
        and docker-compose.yml maps it to the host.
        """
        self.assertIn(
            "EXPOSE 8000",
            self.content,
            "Dockerfile does not EXPOSE port 8000. "
            "Add 'EXPOSE 8000' to document that uvicorn binds on this port.",
        )

    def test_has_cmd_or_entrypoint(self):
        """
        Dockerfile must declare a CMD or ENTRYPOINT so the container starts
        the application automatically without requiring a manual command.
        """
        has_cmd = any(
            line.strip().upper().startswith("CMD")
            for line in self.content.splitlines()
        )
        has_entrypoint = any(
            line.strip().upper().startswith("ENTRYPOINT")
            for line in self.content.splitlines()
        )
        self.assertTrue(
            has_cmd or has_entrypoint,
            "Dockerfile has neither CMD nor ENTRYPOINT. "
            "Add a CMD to start uvicorn automatically when the container launches.",
        )

    def test_starts_application_with_uvicorn(self):
        """
        The CMD/ENTRYPOINT must launch uvicorn — the ASGI server used by the
        metrics FastAPI application (see metrics/src/main.py).
        """
        self.assertIn(
            "uvicorn",
            self.content.lower(),
            "Dockerfile does not reference uvicorn in CMD or ENTRYPOINT. "
            "Start the application with: uvicorn main:app --host 0.0.0.0 --port 8000",
        )

    def test_application_listens_on_all_interfaces(self):
        """
        uvicorn must bind to '0.0.0.0' (not 127.0.0.1) so it is reachable
        from outside the container — binding to localhost would make it
        unreachable from docker-compose healthchecks or other containers.
        """
        self.assertIn(
            "0.0.0.0",
            self.content,
            "uvicorn is not configured to bind on '0.0.0.0'. "
            "Add '--host 0.0.0.0' to the uvicorn command so it is reachable "
            "from outside the container.",
        )


# ---------------------------------------------------------------------------
# Working directory
# ---------------------------------------------------------------------------


class TestDockerfileWorkdir(unittest.TestCase):
    """Dockerfile should establish a clean working directory."""

    def setUp(self):
        self.content = _read_dockerfile()

    def test_sets_a_workdir(self):
        """
        Dockerfile must declare a WORKDIR so all subsequent commands run in a
        predictable directory rather than the filesystem root.
        """
        has_workdir = any(
            line.strip().upper().startswith("WORKDIR")
            for line in self.content.splitlines()
        )
        self.assertTrue(
            has_workdir,
            "Dockerfile has no WORKDIR instruction. "
            "Add 'WORKDIR /app' (or equivalent) to set a predictable working directory.",
        )


if __name__ == "__main__":
    unittest.main()
