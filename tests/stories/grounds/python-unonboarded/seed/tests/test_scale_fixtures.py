"""
Tests for tests/fixtures/generate_scale_fixtures.py — the overlay YAML
fixture generator required by performance tests for validation and
recursive-discovery work items.

What is being tested
--------------------
generate_scale_fixtures.py must expose a public ``generate`` function that:

  - Accepts an output directory and an optional count (default ≥ 100)
  - Creates exactly ``count`` .yaml files under ``output_dir``
  - Organises them into subdirectories per the team/tier naming conventions:
      depth 1  — output_dir/<repo-name>.yaml
      depth 2  — output_dir/team-<name>/<repo-name>.yaml
      depth 3  — output_dir/tier-<name>/team-<name>/<repo-name>.yaml
  - Every generated file passes the overlay JSON Schema (schemas/overlay.schema.json)
  - Returns a list of pathlib.Path objects — one per generated file
  - Does NOT write anything to config/repos/ (files are temp-only)

Test layers
-----------
  Unit ─ generate() output count, return value, schema validity, file structure
  Performance ─ 100 files generated in < 2 s
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

import yaml
import jsonschema
from jsonschema import validate, ValidationError

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = REPO_ROOT / "schemas" / "overlay.schema.json"
GENERATOR_PATH = REPO_ROOT / "tests" / "fixtures" / "generate_scale_fixtures.py"
CONFIG_REPOS_PATH = REPO_ROOT / "config" / "repos"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _load_generator():
    """Import generate_scale_fixtures.py as a module."""
    if not GENERATOR_PATH.is_file():
        raise FileNotFoundError(
            f"tests/fixtures/generate_scale_fixtures.py not found at {GENERATOR_PATH}"
        )
    spec = importlib.util.spec_from_file_location("generate_scale_fixtures", GENERATOR_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_schema() -> dict:
    with open(SCHEMA_PATH) as fh:
        return json.load(fh)


# ---------------------------------------------------------------------------
# Unit tests: generator module exists and is importable
# ---------------------------------------------------------------------------


class TestGeneratorModuleExists(unittest.TestCase):
    """The generator script must exist at the declared path and be importable."""

    def test_generator_script_exists_at_tests_fixtures_generate_scale_fixtures_py(self):
        """tests/fixtures/generate_scale_fixtures.py must be present."""
        self.assertTrue(
            GENERATOR_PATH.is_file(),
            f"tests/fixtures/generate_scale_fixtures.py not found at {GENERATOR_PATH}",
        )

    def test_generator_module_is_importable_without_error(self):
        """Importing the generator must not raise any exception."""
        try:
            _load_generator()
        except FileNotFoundError as exc:
            self.fail(str(exc))

    def test_generator_module_exposes_generate_function(self):
        """The module must expose a callable named 'generate'."""
        mod = _load_generator()
        self.assertTrue(
            hasattr(mod, "generate") and callable(mod.generate),
            "generate_scale_fixtures.py must define a callable 'generate(output_dir, count=...)'",
        )


# ---------------------------------------------------------------------------
# Unit tests: generate() output count
# ---------------------------------------------------------------------------


class TestGenerateOutputCount(unittest.TestCase):
    """generate() must produce exactly the requested number of .yaml files."""

    def setUp(self):
        self.mod = _load_generator()

    def test_generate_default_produces_at_least_100_files(self):
        """Calling generate() with default count must produce ≥ 100 .yaml files."""
        with tempfile.TemporaryDirectory() as tmp:
            self.mod.generate(tmp)
            yaml_files = list(Path(tmp).rglob("*.yaml"))
        self.assertGreaterEqual(
            len(yaml_files),
            100,
            f"Default generate() must produce ≥ 100 .yaml files; got {len(yaml_files)}",
        )

    def test_generate_with_count_100_produces_exactly_100_files(self):
        """generate(output_dir, count=100) must produce exactly 100 .yaml files."""
        with tempfile.TemporaryDirectory() as tmp:
            self.mod.generate(tmp, count=100)
            yaml_files = list(Path(tmp).rglob("*.yaml"))
        self.assertEqual(
            len(yaml_files),
            100,
            f"generate(count=100) must produce exactly 100 files; got {len(yaml_files)}",
        )

    def test_generate_with_count_1_produces_exactly_1_file(self):
        """generate(output_dir, count=1) must produce exactly 1 .yaml file."""
        with tempfile.TemporaryDirectory() as tmp:
            self.mod.generate(tmp, count=1)
            yaml_files = list(Path(tmp).rglob("*.yaml"))
        self.assertEqual(
            len(yaml_files),
            1,
            f"generate(count=1) must produce exactly 1 file; got {len(yaml_files)}",
        )

    def test_generate_with_count_0_produces_zero_files(self):
        """generate(output_dir, count=0) must produce 0 .yaml files."""
        with tempfile.TemporaryDirectory() as tmp:
            self.mod.generate(tmp, count=0)
            yaml_files = list(Path(tmp).rglob("*.yaml"))
        self.assertEqual(
            len(yaml_files),
            0,
            f"generate(count=0) must produce 0 files; got {len(yaml_files)}",
        )

    def test_generate_with_count_200_produces_exactly_200_files(self):
        """generate(output_dir, count=200) must produce exactly 200 .yaml files."""
        with tempfile.TemporaryDirectory() as tmp:
            self.mod.generate(tmp, count=200)
            yaml_files = list(Path(tmp).rglob("*.yaml"))
        self.assertEqual(
            len(yaml_files),
            200,
            f"generate(count=200) must produce exactly 200 files; got {len(yaml_files)}",
        )

    def test_generate_produces_no_non_yaml_files(self):
        """generate() must not create files with extensions other than .yaml."""
        with tempfile.TemporaryDirectory() as tmp:
            self.mod.generate(tmp, count=20)
            all_files = [p for p in Path(tmp).rglob("*") if p.is_file()]
            non_yaml = [p for p in all_files if p.suffix != ".yaml"]
        self.assertEqual(
            non_yaml,
            [],
            f"generate() must only create .yaml files; found non-.yaml files: {non_yaml}",
        )


# ---------------------------------------------------------------------------
# Unit tests: generate() return value
# ---------------------------------------------------------------------------


class TestGenerateReturnValue(unittest.TestCase):
    """generate() must return a list of Path objects — one per created file."""

    def setUp(self):
        self.mod = _load_generator()

    def test_generate_returns_a_list(self):
        """generate() must return a list."""
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=5)
        self.assertIsInstance(
            result,
            list,
            f"generate() must return a list; got {type(result).__name__}",
        )

    def test_generate_returns_list_of_paths(self):
        """Every element in the returned list must be a pathlib.Path."""
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=5)
        for item in result:
            self.assertIsInstance(
                item,
                Path,
                f"Each returned item must be a pathlib.Path; got {type(item).__name__}: {item!r}",
            )

    def test_generate_returned_paths_match_created_files_count(self):
        """The length of the returned list must equal the requested count."""
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=10)
        self.assertEqual(
            len(result),
            10,
            f"generate(count=10) must return list of 10 paths; got {len(result)}",
        )

    def test_generate_returned_paths_all_exist_on_disk(self):
        """Every Path in the returned list must point to a file that exists."""
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=5)
            missing = [p for p in result if not p.is_file()]
        self.assertEqual(
            missing,
            [],
            f"All returned paths must exist on disk; missing: {missing}",
        )

    def test_generate_returned_paths_are_all_inside_output_dir(self):
        """Every returned Path must be a descendant of output_dir."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.mod.generate(tmp, count=5)
            outside = [p for p in result if not str(p).startswith(str(out))]
        self.assertEqual(
            outside,
            [],
            f"All returned paths must be inside output_dir; outside: {outside}",
        )

    def test_generate_returned_paths_are_unique(self):
        """No two returned paths should be the same file path."""
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=50)
        self.assertEqual(
            len(result),
            len(set(result)),
            "generate() must return unique paths — no duplicates",
        )

    def test_generate_with_count_0_returns_empty_list(self):
        """generate(count=0) must return an empty list."""
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=0)
        self.assertEqual(result, [], f"generate(count=0) must return []; got {result}")


# ---------------------------------------------------------------------------
# Unit tests: subdirectory structure and naming conventions
# ---------------------------------------------------------------------------


class TestGenerateSubdirectoryStructure(unittest.TestCase):
    """
    Files must be distributed across subdirectories following the
    team/tier naming conventions:
      depth 1 — output_dir/<repo>.yaml            (flat)
      depth 2 — output_dir/team-<name>/<repo>.yaml
      depth 3 — output_dir/tier-<name>/team-<name>/<repo>.yaml
    """

    def setUp(self):
        self.mod = _load_generator()

    def test_generate_creates_files_at_multiple_subdirectory_depths(self):
        """With count=100, files must appear at more than one directory depth."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.mod.generate(tmp, count=100)
            yaml_files = list(out.rglob("*.yaml"))

        depths = set()
        for f in yaml_files:
            # depth = number of path components relative to output_dir
            rel = f.relative_to(out)
            depths.add(len(rel.parts))

        self.assertGreater(
            len(depths),
            1,
            f"Files must appear at more than one depth; only found depths: {depths}",
        )

    def test_generate_creates_files_at_depth_1(self):
        """At least some files must sit directly in output_dir (depth 1)."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.mod.generate(tmp, count=100)
            depth_1_files = [f for f in out.rglob("*.yaml") if len(f.relative_to(out).parts) == 1]
        self.assertGreater(
            len(depth_1_files),
            0,
            "At least one .yaml file must be directly in output_dir (depth 1)",
        )

    def test_generate_creates_files_at_depth_2(self):
        """At least some files must be in a single-level subdirectory (depth 2)."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.mod.generate(tmp, count=100)
            depth_2_files = [f for f in out.rglob("*.yaml") if len(f.relative_to(out).parts) == 2]
        self.assertGreater(
            len(depth_2_files),
            0,
            "At least one .yaml file must be in a one-level subdirectory (depth 2)",
        )

    def test_generate_creates_files_at_depth_3(self):
        """At least some files must be in a two-level subdirectory (depth 3)."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.mod.generate(tmp, count=100)
            depth_3_files = [f for f in out.rglob("*.yaml") if len(f.relative_to(out).parts) == 3]
        self.assertGreater(
            len(depth_3_files),
            0,
            "At least one .yaml file must be in a two-level subdirectory (depth 3)",
        )

    def test_depth_2_subdirectory_names_follow_team_naming_convention(self):
        """Subdirectories at depth 2 must start with 'team-'."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.mod.generate(tmp, count=100)
            depth_2_dirs = {
                f.relative_to(out).parts[0]
                for f in out.rglob("*.yaml")
                if len(f.relative_to(out).parts) == 2
            }
        for dir_name in depth_2_dirs:
            self.assertTrue(
                dir_name.startswith("team-"),
                f"Depth-2 subdirectory '{dir_name}' must start with 'team-'",
            )

    def test_depth_3_tier_directory_names_follow_tier_naming_convention(self):
        """The top-level segment of depth-3 paths must start with 'tier-'."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.mod.generate(tmp, count=100)
            depth_3_tier_dirs = {
                f.relative_to(out).parts[0]
                for f in out.rglob("*.yaml")
                if len(f.relative_to(out).parts) == 3
            }
        for dir_name in depth_3_tier_dirs:
            self.assertTrue(
                dir_name.startswith("tier-"),
                f"Depth-3 top segment '{dir_name}' must start with 'tier-'",
            )

    def test_depth_3_team_directory_names_follow_team_naming_convention(self):
        """The middle segment of depth-3 paths must start with 'team-'."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            self.mod.generate(tmp, count=100)
            depth_3_team_dirs = {
                f.relative_to(out).parts[1]
                for f in out.rglob("*.yaml")
                if len(f.relative_to(out).parts) == 3
            }
        for dir_name in depth_3_team_dirs:
            self.assertTrue(
                dir_name.startswith("team-"),
                f"Depth-3 middle segment '{dir_name}' must start with 'team-'",
            )

    def test_generated_files_have_yaml_extension(self):
        """Every generated file must use the .yaml extension (not .yml)."""
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=20)
        for path in result:
            self.assertEqual(
                path.suffix,
                ".yaml",
                f"File '{path.name}' must use .yaml extension, not {path.suffix!r}",
            )


# ---------------------------------------------------------------------------
# Unit tests: schema validity of generated files
# ---------------------------------------------------------------------------


class TestGeneratedFilesPassSchemaValidation(unittest.TestCase):
    """
    Every YAML file produced by generate() must pass schemas/overlay.schema.json.
    Failures here indicate the generator is producing malformed fixtures that
    would corrupt downstream validation and discovery tests.
    """

    def setUp(self):
        self.mod = _load_generator()
        self.schema = _load_schema()

    def test_all_100_generated_files_pass_overlay_schema_validation(self):
        """All 100 generated overlay YAML files must satisfy the overlay schema."""
        failures: list[str] = []
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=100)
            for path in result:
                with open(path) as fh:
                    doc = yaml.safe_load(fh)
                try:
                    validate(instance=doc, schema=self.schema)
                except ValidationError as exc:
                    failures.append(f"{path}: {exc.message}")

        self.assertEqual(
            failures,
            [],
            f"{len(failures)} of 100 generated files failed schema validation.\n"
            + "\n".join(failures[:5]),
        )

    def test_each_generated_file_is_valid_yaml(self):
        """Every generated file must parse as a YAML mapping without error."""
        parse_errors: list[str] = []
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=20)
            for path in result:
                try:
                    with open(path) as fh:
                        doc = yaml.safe_load(fh)
                    if not isinstance(doc, dict):
                        parse_errors.append(f"{path}: parsed as {type(doc).__name__}, expected dict")
                except yaml.YAMLError as exc:
                    parse_errors.append(f"{path}: YAML parse error: {exc}")

        self.assertEqual(
            parse_errors,
            [],
            f"{len(parse_errors)} files failed YAML parsing:\n" + "\n".join(parse_errors[:5]),
        )

    def test_each_generated_file_has_correct_api_version(self):
        """Every generated file must have apiVersion: gitweave.io/v1."""
        wrong: list[str] = []
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=20)
            for path in result:
                with open(path) as fh:
                    doc = yaml.safe_load(fh)
                if doc.get("apiVersion") != "gitweave.io/v1":
                    wrong.append(f"{path}: apiVersion={doc.get('apiVersion')!r}")

        self.assertEqual(
            wrong,
            [],
            f"Files with wrong apiVersion:\n" + "\n".join(wrong),
        )

    def test_each_generated_file_has_correct_kind(self):
        """Every generated file must have kind: RepositoryOverlay."""
        wrong: list[str] = []
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=20)
            for path in result:
                with open(path) as fh:
                    doc = yaml.safe_load(fh)
                if doc.get("kind") != "RepositoryOverlay":
                    wrong.append(f"{path}: kind={doc.get('kind')!r}")

        self.assertEqual(
            wrong,
            [],
            f"Files with wrong kind:\n" + "\n".join(wrong),
        )

    def test_each_generated_file_has_valid_repository_slug(self):
        """spec.repository in every generated file must match owner/repo pattern."""
        import re
        pattern = re.compile(r"^[^/\s]+/[^/\s]+$")
        wrong: list[str] = []
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=20)
            for path in result:
                with open(path) as fh:
                    doc = yaml.safe_load(fh)
                repo = doc.get("spec", {}).get("repository", "")
                if not pattern.match(repo):
                    wrong.append(f"{path}: repository={repo!r}")

        self.assertEqual(
            wrong,
            [],
            f"Files with invalid repository slug:\n" + "\n".join(wrong),
        )

    def test_each_generated_file_has_metadata_name(self):
        """Every generated file must have a non-empty metadata.name."""
        wrong: list[str] = []
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=20)
            for path in result:
                with open(path) as fh:
                    doc = yaml.safe_load(fh)
                name = doc.get("metadata", {}).get("name", "")
                if not name:
                    wrong.append(str(path))

        self.assertEqual(
            wrong,
            [],
            f"Files missing metadata.name:\n" + "\n".join(wrong),
        )

    def test_repository_slugs_are_unique_across_all_generated_files(self):
        """
        Each generated file must target a distinct repository — duplicate
        slugs would make fixtures ambiguous for discovery tests.
        """
        slugs: list[str] = []
        with tempfile.TemporaryDirectory() as tmp:
            result = self.mod.generate(tmp, count=100)
            for path in result:
                with open(path) as fh:
                    doc = yaml.safe_load(fh)
                slugs.append(doc.get("spec", {}).get("repository", ""))

        self.assertEqual(
            len(slugs),
            len(set(slugs)),
            f"generate() produced duplicate repository slugs — "
            f"found {len(slugs) - len(set(slugs))} duplicates",
        )


# ---------------------------------------------------------------------------
# Unit tests: isolation — no writes outside output_dir
# ---------------------------------------------------------------------------


class TestGeneratorDoesNotWriteOutsideOutputDir(unittest.TestCase):
    """
    The generator must ONLY write to the caller-supplied output_dir.
    It must never write to config/repos/ or any other project directory.
    """

    def setUp(self):
        self.mod = _load_generator()
        # Snapshot config/repos/ before running
        if CONFIG_REPOS_PATH.is_dir():
            self._before = set(CONFIG_REPOS_PATH.rglob("*.yaml"))
        else:
            self._before = set()

    def test_generator_does_not_write_to_config_repos(self):
        """generate() must not create any new .yaml files in config/repos/."""
        with tempfile.TemporaryDirectory() as tmp:
            self.mod.generate(tmp, count=100)

        if CONFIG_REPOS_PATH.is_dir():
            after = set(CONFIG_REPOS_PATH.rglob("*.yaml"))
        else:
            after = set()

        new_files = after - self._before
        self.assertEqual(
            new_files,
            set(),
            f"generate() must not write to config/repos/; found new files: {new_files}",
        )

    def test_generator_output_dir_receives_all_generated_files(self):
        """All returned paths must reside inside the supplied output_dir."""
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            result = self.mod.generate(tmp, count=50)
            outside = [p for p in result if not str(p.resolve()).startswith(str(out.resolve()))]
        self.assertEqual(
            outside,
            [],
            f"generate() must not write outside output_dir; "
            f"files outside output_dir: {outside}",
        )

    def test_repeated_calls_with_same_output_dir_do_not_create_duplicates(self):
        """
        Calling generate() twice with the same output_dir and count=50 must
        not silently double the file count (either idempotent or raises).
        """
        with tempfile.TemporaryDirectory() as tmp:
            self.mod.generate(tmp, count=50)
            try:
                self.mod.generate(tmp, count=50)
            except Exception:
                # Raising is acceptable — generators may refuse to overwrite
                return
            # If it didn't raise, the final file count must still be 50
            yaml_files = list(Path(tmp).rglob("*.yaml"))
        self.assertEqual(
            len(yaml_files),
            50,
            f"After two generate(count=50) calls, expected 50 files; got {len(yaml_files)}",
        )


# ---------------------------------------------------------------------------
# Performance test: 100 files in < 2 s
# ---------------------------------------------------------------------------


class TestGeneratePerformanceBaseline(unittest.TestCase):
    """
    Performance contract: generating 100 overlay YAML files must complete
    in under 2 seconds on any developer laptop (warm filesystem).
    """

    def setUp(self):
        self.mod = _load_generator()

    def test_generate_100_files_completes_in_under_2_seconds(self):
        """Generating 100 overlay YAML files must take < 2 seconds wall-clock time."""
        with tempfile.TemporaryDirectory() as tmp:
            start = time.monotonic()
            result = self.mod.generate(tmp, count=100)
            elapsed = time.monotonic() - start

        self.assertEqual(
            len(result),
            100,
            f"Expected 100 files to be generated; got {len(result)}",
        )
        self.assertLess(
            elapsed,
            2.0,
            f"Generating 100 files took {elapsed:.3f}s — must complete in < 2.0s",
        )

    def test_generate_200_files_completes_in_under_4_seconds(self):
        """Generating 200 overlay YAML files must take < 4 seconds wall-clock time."""
        with tempfile.TemporaryDirectory() as tmp:
            start = time.monotonic()
            result = self.mod.generate(tmp, count=200)
            elapsed = time.monotonic() - start

        self.assertEqual(len(result), 200)
        self.assertLess(
            elapsed,
            4.0,
            f"Generating 200 files took {elapsed:.3f}s — must complete in < 4.0s",
        )


if __name__ == "__main__":
    unittest.main()
