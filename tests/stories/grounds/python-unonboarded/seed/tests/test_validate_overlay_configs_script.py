"""
Unit and integration tests for scripts/validate_overlay_configs.py —
the Python script that validates config/repos/*.yaml against
schemas/overlay.schema.json.

These tests drive the specification for the script that the CI job will invoke.
They verify:

  Happy path:
    - exit 0 and "Validated N file(s)" output when all files are valid
    - exit 0 and "Validated 0 file(s)" when config/repos/ is empty
    - exit 0 when config/repos/ directory does not exist

  Failure path:
    - exit non-zero when any file fails schema validation
    - output includes the file name of the invalid file
    - output includes the specific schema violation message (not just "invalid")
    - exit non-zero when a YAML file is not parseable

  Multiple files:
    - validates every .yaml file in the directory (not just the first)
    - reports all invalid files, not just the first one found
    - counts only .yaml files (ignores other extensions)

  Correctness:
    - a file missing 'apiVersion' triggers a violation about 'apiVersion'
    - a file missing 'kind' triggers a violation about 'kind'
    - a file missing 'spec.repository' triggers a violation about 'repository'
    - a file with wrong apiVersion ('v1') triggers a violation
    - a file with an extra top-level key triggers an 'additionalProperties' violation

All tests will fail until scripts/validate_overlay_configs.py is implemented.
"""

import json
import os
import subprocess
import sys
import tempfile
import textwrap
import unittest

import yaml

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPT_PATH = os.path.join(REPO_ROOT, "scripts", "validate_overlay_configs.py")
SCHEMA_PATH = os.path.join(REPO_ROOT, "schemas", "overlay.schema.json")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _run_script(*args: str, cwd: str | None = None) -> subprocess.CompletedProcess:
    """
    Invoke validate_overlay_configs.py with the given arguments.
    Always captures stdout+stderr and never raises on non-zero exit.
    """
    return subprocess.run(
        [sys.executable, SCRIPT_PATH, *args],
        capture_output=True,
        text=True,
        cwd=cwd or REPO_ROOT,
    )


def _write_yaml(directory: str, filename: str, doc: dict) -> str:
    """Write `doc` as YAML to `directory/filename` and return the full path."""
    path = os.path.join(directory, filename)
    with open(path, "w") as f:
        yaml.dump(doc, f, default_flow_style=False)
    return path


def _minimal_valid_overlay() -> dict:
    """Return the smallest document that satisfies schemas/overlay.schema.json."""
    return {
        "apiVersion": "gitweave.io/v1",
        "kind": "RepositoryOverlay",
        "metadata": {"name": "my-app"},
        "spec": {"repository": "my-org/my-app"},
    }


# ---------------------------------------------------------------------------
# Test classes
# ---------------------------------------------------------------------------


class TestScriptExists(unittest.TestCase):
    """Basic existence check before any functional tests run."""

    def test_validate_overlay_configs_script_exists(self):
        """scripts/validate_overlay_configs.py must exist."""
        self.assertTrue(
            os.path.isfile(SCRIPT_PATH),
            f"scripts/validate_overlay_configs.py is missing — expected at {SCRIPT_PATH}. "
            "Create the script before the CI job can use it.",
        )

    def test_script_is_executable_by_python(self):
        """The script must be runnable by Python without import errors."""
        result = _run_script("--help")
        self.assertNotIn(
            "SyntaxError",
            result.stderr,
            f"scripts/validate_overlay_configs.py contains a SyntaxError:\n{result.stderr}",
        )
        self.assertNotIn(
            "ModuleNotFoundError",
            result.stderr,
            f"scripts/validate_overlay_configs.py has an unresolvable import:\n{result.stderr}",
        )


class TestEmptyDirectoryHandling(unittest.TestCase):
    """The script must exit 0 when there are no YAML files to validate."""

    def test_exits_zero_when_config_repos_is_empty(self):
        """exit 0 when the target directory is empty."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = _run_script(tmpdir)
        self.assertEqual(
            result.returncode,
            0,
            f"Script exited {result.returncode} on an empty directory — expected 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_reports_zero_files_validated_when_directory_is_empty(self):
        """Output must mention '0 file' when there is nothing to validate."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = _run_script(tmpdir)
        combined = result.stdout + result.stderr
        self.assertRegex(
            combined,
            r"[Vv]alidated\s+0\s+file",
            f"Script output does not report '0 file(s)' for an empty directory.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_zero_when_target_directory_does_not_exist(self):
        """exit 0 when config/repos/ does not exist — treat as empty state."""
        result = _run_script("/nonexistent/path/config/repos")
        self.assertEqual(
            result.returncode,
            0,
            f"Script exited {result.returncode} when passed a non-existent directory — "
            f"expected 0 (graceful empty state).\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_ignores_non_yaml_files_in_directory(self):
        """Files without a .yaml extension must be silently ignored."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a non-YAML file that would fail schema validation if parsed
            with open(os.path.join(tmpdir, "README.md"), "w") as f:
                f.write("# Not a YAML overlay\n")
            with open(os.path.join(tmpdir, "notes.txt"), "w") as f:
                f.write("plain text\n")
            result = _run_script(tmpdir)
        self.assertEqual(
            result.returncode,
            0,
            f"Script failed when directory contained only non-YAML files — expected 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


class TestHappyPath(unittest.TestCase):
    """All-valid overlay files should result in a clean exit."""

    def test_exits_zero_with_single_valid_file(self):
        """exit 0 when the directory contains one valid overlay YAML."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "my-app.yaml", _minimal_valid_overlay())
            result = _run_script(tmpdir)
        self.assertEqual(
            result.returncode,
            0,
            f"Script exited {result.returncode} for a valid overlay file — expected 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_zero_with_multiple_valid_files(self):
        """exit 0 when the directory contains several valid overlay YAMLs."""
        with tempfile.TemporaryDirectory() as tmpdir:
            for name in ("app-a.yaml", "app-b.yaml", "app-c.yaml"):
                doc = _minimal_valid_overlay()
                doc["metadata"]["name"] = name.replace(".yaml", "")
                doc["spec"]["repository"] = f"my-org/{name.replace('.yaml', '')}"
                _write_yaml(tmpdir, name, doc)
            result = _run_script(tmpdir)
        self.assertEqual(
            result.returncode,
            0,
            f"Script exited {result.returncode} for three valid overlay files — expected 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_reports_correct_count_for_single_valid_file(self):
        """Output must report 'Validated 1 file' when one file is checked."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "my-app.yaml", _minimal_valid_overlay())
            result = _run_script(tmpdir)
        combined = result.stdout + result.stderr
        self.assertRegex(
            combined,
            r"[Vv]alidated\s+1\s+file",
            f"Script output does not report 'Validated 1 file' for a single valid overlay.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_reports_correct_count_for_multiple_valid_files(self):
        """Output must report 'Validated 3 file(s)' when three files are checked."""
        with tempfile.TemporaryDirectory() as tmpdir:
            for name in ("a.yaml", "b.yaml", "c.yaml"):
                doc = _minimal_valid_overlay()
                doc["metadata"]["name"] = name.replace(".yaml", "")
                doc["spec"]["repository"] = f"org/{name.replace('.yaml', '')}"
                _write_yaml(tmpdir, name, doc)
            result = _run_script(tmpdir)
        combined = result.stdout + result.stderr
        self.assertRegex(
            combined,
            r"[Vv]alidated\s+3\s+file",
            f"Script output does not report 'Validated 3 file(s)' for three overlays.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


class TestFailurePath(unittest.TestCase):
    """Invalid overlay files must cause a non-zero exit with descriptive output."""

    def test_exits_nonzero_when_file_missing_apiVersion(self):
        """exit non-zero when a file omits the required apiVersion field."""
        doc = _minimal_valid_overlay()
        del doc["apiVersion"]
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "bad.yaml", doc)
            result = _run_script(tmpdir)
        self.assertNotEqual(
            result.returncode,
            0,
            f"Script exited 0 for a file missing apiVersion — expected non-zero.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_output_includes_filename_when_file_missing_apiVersion(self):
        """The failing file name must appear in the output."""
        doc = _minimal_valid_overlay()
        del doc["apiVersion"]
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "bad-overlay.yaml", doc)
            result = _run_script(tmpdir)
        combined = result.stdout + result.stderr
        self.assertIn(
            "bad-overlay.yaml",
            combined,
            f"Output does not include the failing file name 'bad-overlay.yaml'.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_output_includes_apiVersion_violation_detail(self):
        """The output must mention 'apiVersion' when that field is missing."""
        doc = _minimal_valid_overlay()
        del doc["apiVersion"]
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "bad.yaml", doc)
            result = _run_script(tmpdir)
        combined = result.stdout + result.stderr
        self.assertIn(
            "apiVersion",
            combined,
            f"Output does not mention 'apiVersion' for a missing-apiVersion violation.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_nonzero_when_file_missing_kind(self):
        """exit non-zero when a file omits the required kind field."""
        doc = _minimal_valid_overlay()
        del doc["kind"]
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "bad.yaml", doc)
            result = _run_script(tmpdir)
        self.assertNotEqual(
            result.returncode,
            0,
            f"Script exited 0 for a file missing kind — expected non-zero.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_output_includes_kind_violation_detail(self):
        """The output must mention 'kind' when that field is missing."""
        doc = _minimal_valid_overlay()
        del doc["kind"]
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "bad.yaml", doc)
            result = _run_script(tmpdir)
        combined = result.stdout + result.stderr
        self.assertIn(
            "kind",
            combined,
            f"Output does not mention 'kind' for a missing-kind violation.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_nonzero_when_file_missing_spec_repository(self):
        """exit non-zero when a file omits the required spec.repository field."""
        doc = _minimal_valid_overlay()
        del doc["spec"]["repository"]
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "bad.yaml", doc)
            result = _run_script(tmpdir)
        self.assertNotEqual(
            result.returncode,
            0,
            f"Script exited 0 for a file missing spec.repository — expected non-zero.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_output_includes_repository_violation_detail(self):
        """The output must mention 'repository' when spec.repository is missing."""
        doc = _minimal_valid_overlay()
        del doc["spec"]["repository"]
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "bad.yaml", doc)
            result = _run_script(tmpdir)
        combined = result.stdout + result.stderr
        self.assertIn(
            "repository",
            combined,
            f"Output does not mention 'repository' for a missing spec.repository violation.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_nonzero_when_apiVersion_has_wrong_value(self):
        """exit non-zero when apiVersion is 'v1' instead of 'gitweave.io/v1'."""
        doc = _minimal_valid_overlay()
        doc["apiVersion"] = "v1"
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "bad.yaml", doc)
            result = _run_script(tmpdir)
        self.assertNotEqual(
            result.returncode,
            0,
            f"Script exited 0 for apiVersion='v1' — expected non-zero.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_nonzero_for_unknown_top_level_key(self):
        """exit non-zero when a file contains an unknown top-level key."""
        doc = _minimal_valid_overlay()
        doc["unknownTopLevelKey"] = "surprise"
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "bad.yaml", doc)
            result = _run_script(tmpdir)
        self.assertNotEqual(
            result.returncode,
            0,
            f"Script exited 0 for a file with an unknown top-level key — expected non-zero.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_nonzero_for_unparseable_yaml_file(self):
        """exit non-zero when a .yaml file contains invalid YAML syntax."""
        with tempfile.TemporaryDirectory() as tmpdir:
            bad_yaml_path = os.path.join(tmpdir, "broken.yaml")
            with open(bad_yaml_path, "w") as f:
                f.write("apiVersion: gitweave.io/v1\n  bad_indent: [\n")
            result = _run_script(tmpdir)
        self.assertNotEqual(
            result.returncode,
            0,
            f"Script exited 0 for a file with invalid YAML — expected non-zero.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_output_includes_filename_for_unparseable_yaml(self):
        """The failing file name must appear when YAML parsing fails."""
        with tempfile.TemporaryDirectory() as tmpdir:
            bad_yaml_path = os.path.join(tmpdir, "broken-syntax.yaml")
            with open(bad_yaml_path, "w") as f:
                f.write("apiVersion: gitweave.io/v1\n  bad_indent: [\n")
            result = _run_script(tmpdir)
        combined = result.stdout + result.stderr
        self.assertIn(
            "broken-syntax.yaml",
            combined,
            f"Output does not include 'broken-syntax.yaml' for a YAML parse error.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


class TestMultipleFilesValidation(unittest.TestCase):
    """All files must be checked, and all failures must be reported."""

    def test_reports_all_invalid_files_not_just_first(self):
        """
        When multiple files are invalid, every failing file name must appear
        in the output — the script must not stop after the first failure.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            for name in ("bad-a.yaml", "bad-b.yaml", "bad-c.yaml"):
                doc = _minimal_valid_overlay()
                del doc["apiVersion"]  # Make each file invalid
                doc["metadata"]["name"] = name.replace(".yaml", "")
                doc["spec"]["repository"] = f"org/{name.replace('.yaml', '')}"
                _write_yaml(tmpdir, name, doc)
            result = _run_script(tmpdir)
        combined = result.stdout + result.stderr
        for name in ("bad-a.yaml", "bad-b.yaml", "bad-c.yaml"):
            self.assertIn(
                name,
                combined,
                f"Output is missing '{name}' — the script must report all invalid files, "
                f"not just the first one.\nstdout: {result.stdout}\nstderr: {result.stderr}",
            )

    def test_exits_nonzero_when_one_of_many_files_is_invalid(self):
        """exit non-zero even when only one file in a mix is invalid."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Two valid files
            for name in ("good-a.yaml", "good-b.yaml"):
                doc = _minimal_valid_overlay()
                doc["metadata"]["name"] = name.replace(".yaml", "")
                doc["spec"]["repository"] = f"org/{name.replace('.yaml', '')}"
                _write_yaml(tmpdir, name, doc)
            # One invalid file
            bad_doc = _minimal_valid_overlay()
            del bad_doc["kind"]
            _write_yaml(tmpdir, "bad-one.yaml", bad_doc)
            result = _run_script(tmpdir)
        self.assertNotEqual(
            result.returncode,
            0,
            f"Script exited 0 when one of three files was invalid — expected non-zero.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_zero_when_mix_is_all_valid(self):
        """exit 0 when directory contains multiple valid overlay files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            for name in ("good-a.yaml", "good-b.yaml", "good-c.yaml"):
                doc = _minimal_valid_overlay()
                doc["metadata"]["name"] = name.replace(".yaml", "")
                doc["spec"]["repository"] = f"org/{name.replace('.yaml', '')}"
                _write_yaml(tmpdir, name, doc)
            result = _run_script(tmpdir)
        self.assertEqual(
            result.returncode,
            0,
            f"Script exited {result.returncode} for three valid files — expected 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_counts_only_yaml_extension_files(self):
        """Files with non-.yaml extensions must not be counted in the validated total."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "app.yaml", _minimal_valid_overlay())
            # This file should be ignored entirely
            with open(os.path.join(tmpdir, "app.yml"), "w") as f:
                f.write("apiVersion: gitweave.io/v1\n")  # Incomplete — would fail if parsed
            result = _run_script(tmpdir)
        combined = result.stdout + result.stderr
        # Only app.yaml should be counted — not app.yml
        self.assertRegex(
            combined,
            r"[Vv]alidated\s+1\s+file",
            f"Script counted more than 1 file — it should ignore non-.yaml extensions.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


class TestSchemaPathArgument(unittest.TestCase):
    """The script must load the schema from the project's schemas/ directory."""

    def test_script_accepts_directory_as_positional_argument(self):
        """
        The script must accept the target directory as a positional argument
        so the CI job can pass config/repos/ to it.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            result = _run_script(tmpdir)
        # Any exit code is acceptable here — we just verify the script did not
        # crash with "unexpected argument" or "too many arguments" errors.
        self.assertNotIn(
            "unrecognized argument",
            result.stderr,
            f"Script rejected a positional directory argument.\n"
            f"stderr: {result.stderr}",
        )
        self.assertNotIn(
            "error: argument",
            result.stderr.lower(),
            f"Script reported an argument error for the directory positional.\n"
            f"stderr: {result.stderr}",
        )

    def test_script_uses_overlay_schema_json_from_schemas_directory(self):
        """
        With a valid overlay file in a temp directory, the script must pass
        validation — proving it located and loaded schemas/overlay.schema.json.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "app.yaml", _minimal_valid_overlay())
            result = _run_script(tmpdir)
        self.assertEqual(
            result.returncode,
            0,
            f"Script failed to validate a known-good overlay file — it may not have "
            f"found schemas/overlay.schema.json.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


if __name__ == "__main__":
    unittest.main()
