"""Tests for the multi-stage Dockerfile for the metrics service.

Validates that metrics/Dockerfile:
  1. Exists and is non-empty
  2. Uses python:3.12-slim as the base image
  3. Implements a multi-stage build (named builder stage + production stage)
  4. Installs dependencies into a virtual environment in the builder stage
  5. Copies the venv from the builder into the production stage
  6. Includes a HEALTHCHECK directive pointing to /healthz
  7. (Docker required) Builds to an image under 200 MB
  8. (Docker required) Production image omits dev packages — pytest and httpx absent
  9. (Docker required) HEALTHCHECK is correctly configured in the built image

Fast/structural tests run without a Docker daemon.
Docker tests are automatically skipped when Docker is unavailable.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../src"))

METRICS_DIR = Path(__file__).parent.parent
DOCKERFILE_PATH = METRICS_DIR / "Dockerfile"

# Max allowed image size in bytes (200 MB)
MAX_IMAGE_SIZE_BYTES = 200 * 1024 * 1024

# Dev-only packages that must NOT appear in the production image
DEV_PACKAGES = ["pytest", "httpx"]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _read_dockerfile() -> str:
    """Return Dockerfile text, skipping the test if the file does not exist."""
    if not DOCKERFILE_PATH.exists():
        pytest.skip(f"Dockerfile not found at {DOCKERFILE_PATH}")
    return DOCKERFILE_PATH.read_text()


def _docker_available() -> bool:
    """Return True if the Docker daemon is accessible."""
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=10,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _require_docker() -> None:
    """Skip the calling test if Docker daemon is not available."""
    if not _docker_available():
        pytest.skip(
            "Docker daemon not available — skipping Docker integration tests. "
            "Start Docker to run image build, size, and package tests."
        )


# ---------------------------------------------------------------------------
# Session-scoped fixture: build the image once for all Docker tests
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def built_image() -> str:  # type: ignore[return]
    """Build metrics/Dockerfile and return the image tag.

    Skips the entire group when the Dockerfile is missing or Docker is
    unavailable.  Fails with a descriptive message when the build itself
    fails.  The image tag is deterministic to avoid accumulating stale layers.
    """
    _require_docker()
    if not DOCKERFILE_PATH.exists():
        pytest.skip(f"Dockerfile not found at {DOCKERFILE_PATH}")

    image_tag = "gitweave-metrics-test:latest"
    result = subprocess.run(
        ["docker", "build", "-t", image_tag, "."],
        cwd=str(METRICS_DIR),
        capture_output=True,
        text=True,
        timeout=300,  # 5-minute build budget
    )
    if result.returncode != 0:
        pytest.fail(
            f"docker build exited {result.returncode}.\n"
            f"STDOUT:\n{result.stdout}\n"
            f"STDERR:\n{result.stderr}"
        )
    return image_tag


# ---------------------------------------------------------------------------
# File existence
# ---------------------------------------------------------------------------


class TestDockerfileExists:
    """Dockerfile must be present in the metrics/ directory."""

    def test_dockerfile_exists(self):
        assert DOCKERFILE_PATH.exists(), (
            f"Dockerfile not found at {DOCKERFILE_PATH}. "
            "Create metrics/Dockerfile with a multi-stage python:3.12-slim build."
        )

    def test_dockerfile_is_not_empty(self):
        if not DOCKERFILE_PATH.exists():
            pytest.skip("Dockerfile not found")
        content = DOCKERFILE_PATH.read_text().strip()
        assert content, "Dockerfile must not be empty"


# ---------------------------------------------------------------------------
# Base image
# ---------------------------------------------------------------------------


class TestDockerfileBaseImage:
    """Dockerfile must use python:3.12-slim as the base image."""

    def test_uses_python_312_slim(self):
        """At least one FROM instruction must reference python:3.12-slim."""
        content = _read_dockerfile()
        from_lines = [
            line.strip()
            for line in content.splitlines()
            if re.match(r"^FROM\s", line, re.IGNORECASE)
        ]
        assert from_lines, "Dockerfile must contain at least one FROM instruction"

        python_slim_lines = [l for l in from_lines if "python:3.12-slim" in l]
        assert python_slim_lines, (
            f"At least one FROM instruction must use python:3.12-slim. "
            f"Found FROM lines: {from_lines}"
        )


# ---------------------------------------------------------------------------
# Multi-stage build structure
# ---------------------------------------------------------------------------


class TestDockerfileMultiStageBuild:
    """Dockerfile must implement a multi-stage build."""

    def test_has_at_least_two_from_instructions(self):
        """A multi-stage build requires two or more FROM instructions."""
        content = _read_dockerfile()
        from_lines = [
            line.strip()
            for line in content.splitlines()
            if re.match(r"^FROM\s", line, re.IGNORECASE)
        ]
        assert len(from_lines) >= 2, (
            f"Multi-stage build requires at least 2 FROM instructions; "
            f"found {len(from_lines)}: {from_lines}"
        )

    def test_has_named_builder_stage(self):
        """The builder stage must be named using AS so it can be referenced by COPY --from."""
        content = _read_dockerfile()
        from_lines = [
            line.strip()
            for line in content.splitlines()
            if re.match(r"^FROM\s", line, re.IGNORECASE)
        ]
        named_stages = [l for l in from_lines if re.search(r"\bAS\b", l, re.IGNORECASE)]
        assert named_stages, (
            "At least one FROM instruction must name its stage using AS "
            "(e.g., FROM python:3.12-slim AS builder). "
            "The production stage uses COPY --from=<name> to pull in only the venv."
        )

    def test_production_stage_copies_from_builder(self):
        """Production stage must use COPY --from=<builder> to import the venv."""
        content = _read_dockerfile()
        copy_from_lines = [
            line.strip()
            for line in content.splitlines()
            if re.match(r"^COPY\s+--from=", line, re.IGNORECASE)
        ]
        assert copy_from_lines, (
            "Production stage must contain at least one COPY --from=<builder-stage> "
            "instruction. This copies only the venv (not pip cache or build tools) "
            "from the builder into the final image."
        )


# ---------------------------------------------------------------------------
# Virtual environment
# ---------------------------------------------------------------------------


class TestDockerfileVirtualEnvironment:
    """Builder stage must install dependencies into a Python virtual environment."""

    def test_creates_virtual_environment(self):
        """Dockerfile must create a venv (python -m venv …)."""
        content = _read_dockerfile()
        has_venv = bool(
            re.search(r"python3?\s+-m\s+venv", content)
            or re.search(r"virtualenv\s+", content)
        )
        assert has_venv, (
            "Dockerfile must create a Python virtual environment in the builder stage, "
            "e.g.: RUN python -m venv /venv"
        )

    def test_installs_requirements_via_venv_pip(self):
        """pip install must use the venv's pip, not the system pip."""
        content = _read_dockerfile()
        # Accept any common venv pip path pattern
        has_venv_pip = bool(
            re.search(r"/venv/bin/pip\s+install", content)
            or re.search(r"\$(?:VIRTUAL_ENV|{VIRTUAL_ENV})/bin/pip\s+install", content)
            or re.search(r"/app/\.venv/bin/pip\s+install", content)
        )
        assert has_venv_pip, (
            "pip install must use the venv's pip executable, e.g.: "
            "RUN /venv/bin/pip install -r requirements.txt. "
            "Using the system pip would install packages outside the venv "
            "and they would not be available after the COPY --from step."
        )


# ---------------------------------------------------------------------------
# HEALTHCHECK directive
# ---------------------------------------------------------------------------


class TestDockerfileHealthcheck:
    """Dockerfile must contain a HEALTHCHECK directive pointing to /healthz."""

    def test_has_healthcheck_instruction(self):
        """Dockerfile must contain a HEALTHCHECK instruction."""
        content = _read_dockerfile()
        healthcheck_lines = [
            line.strip()
            for line in content.splitlines()
            if re.match(r"^HEALTHCHECK\b", line, re.IGNORECASE)
        ]
        assert healthcheck_lines, (
            "Dockerfile must contain a HEALTHCHECK instruction. "
            "Container orchestrators use it to determine container readiness."
        )

    def test_healthcheck_probes_healthz_endpoint(self):
        """HEALTHCHECK command must target the /healthz endpoint."""
        content = _read_dockerfile()
        healthcheck_lines = [
            line.strip()
            for line in content.splitlines()
            if re.match(r"^HEALTHCHECK\b", line, re.IGNORECASE)
        ]
        if not healthcheck_lines:
            pytest.skip("HEALTHCHECK instruction not found in Dockerfile")

        healthcheck_text = " ".join(healthcheck_lines)
        assert "/healthz" in healthcheck_text, (
            f"HEALTHCHECK must probe /healthz (the FastAPI liveness endpoint). "
            f"Found: {healthcheck_text!r}"
        )


# ---------------------------------------------------------------------------
# Docker image build (requires Docker daemon)
# ---------------------------------------------------------------------------


class TestDockerImageBuild:
    """The metrics Docker image must build without errors."""

    def test_image_builds_successfully(self, built_image: str):
        """docker build must succeed — the built_image fixture fails fast on error."""
        # Reaching this line means the build passed.
        assert built_image, "built_image fixture must return a non-empty image tag"


# ---------------------------------------------------------------------------
# Image size (requires Docker daemon)
# ---------------------------------------------------------------------------


class TestDockerImageSize:
    """Production image must be under 200 MB."""

    def test_image_size_is_under_200mb(self, built_image: str):
        """docker image inspect --format='{{.Size}}' must report fewer than 200 MB."""
        result = subprocess.run(
            ["docker", "image", "inspect", "--format={{.Size}}", built_image],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, (
            f"docker image inspect failed: {result.stderr}"
        )
        size_bytes = int(result.stdout.strip())
        size_mb = size_bytes / (1024 * 1024)
        assert size_bytes < MAX_IMAGE_SIZE_BYTES, (
            f"Image size is {size_mb:.1f} MB, which exceeds the 200 MB limit. "
            "Ensure the production stage copies only the venv and source, "
            "not pip caches, build tools, or test dependencies."
        )


# ---------------------------------------------------------------------------
# Dev packages absent from production image (requires Docker daemon)
# ---------------------------------------------------------------------------


class TestDockerImageDevPackages:
    """Development-only packages must not be present in the production image."""

    def _pip_list(self, built_image: str) -> str:
        """Return the lowercased output of `pip list` inside the image."""
        result = subprocess.run(
            ["docker", "run", "--rm", built_image, "pip", "list"],
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, (
            f"'docker run --rm {built_image} pip list' failed "
            f"(exit {result.returncode}): {result.stderr}"
        )
        return result.stdout.lower()

    def test_pytest_not_installed_in_production_image(self, built_image: str):
        """pytest must not appear in the production image's installed packages."""
        installed = self._pip_list(built_image)
        assert "pytest" not in installed, (
            "pytest must NOT be installed in the production image. "
            "Move it to a separate dev requirements file and exclude it from the "
            "production pip install in the Dockerfile."
        )

    def test_httpx_not_installed_in_production_image(self, built_image: str):
        """httpx must not appear in the production image's installed packages."""
        installed = self._pip_list(built_image)
        assert "httpx" not in installed, (
            "httpx must NOT be installed in the production image. "
            "Move it to a separate dev requirements file and exclude it from the "
            "production pip install in the Dockerfile."
        )

    def test_all_dev_packages_absent_from_production_image(self, built_image: str):
        """No dev package from DEV_PACKAGES may appear in `pip list` output."""
        installed = self._pip_list(built_image)
        found = [pkg for pkg in DEV_PACKAGES if pkg in installed]
        assert not found, (
            f"Dev packages found in production image: {found}. "
            f"These packages should only be installed in a dev/builder stage. "
            f"Full dev-package list checked: {DEV_PACKAGES}"
        )


# ---------------------------------------------------------------------------
# HEALTHCHECK configuration in built image (requires Docker daemon)
# ---------------------------------------------------------------------------


class TestDockerImageHealthcheckConfig:
    """Built image must expose a HEALTHCHECK that probes /healthz."""

    def test_image_has_healthcheck_configured(self, built_image: str):
        """docker image inspect must return a non-null Healthcheck config."""
        result = subprocess.run(
            [
                "docker",
                "image",
                "inspect",
                "--format={{json .Config.Healthcheck}}",
                built_image,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, (
            f"docker image inspect failed: {result.stderr}"
        )
        raw = result.stdout.strip()
        assert raw and raw != "null", (
            "Built image must have a HEALTHCHECK configured. "
            "Add HEALTHCHECK to the production stage of the Dockerfile."
        )

    def test_image_healthcheck_references_healthz(self, built_image: str):
        """The HEALTHCHECK Test command inside the image must reference /healthz."""
        result = subprocess.run(
            [
                "docker",
                "image",
                "inspect",
                "--format={{json .Config.Healthcheck}}",
                built_image,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, (
            f"docker image inspect failed: {result.stderr}"
        )
        raw = result.stdout.strip()
        assert raw and raw != "null", "No Healthcheck configured in image"

        healthcheck = json.loads(raw)
        # .Config.Healthcheck.Test is a list such as:
        #   ["CMD", "curl", "-f", "http://localhost:8000/healthz"]
        test_cmd = healthcheck.get("Test", [])
        test_str = " ".join(str(part) for part in test_cmd)
        assert "/healthz" in test_str, (
            f"HEALTHCHECK command must reference /healthz. "
            f"Found: {test_str!r}"
        )
