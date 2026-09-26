"""
Tests for parallel schema validation in scripts/validate_overlay_configs.py.

These tests specify the expected behavior AFTER the sequential validation loop
is replaced with concurrent.futures.ThreadPoolExecutor.

Test layers
-----------
  Structural (RED — will fail until parallel implementation exists):
    - The script imports ThreadPoolExecutor from concurrent.futures
    - validate_directory uses ThreadPoolExecutor internally

  Error reporting completeness (regression + parallel correctness):
    - All invalid files enumerated — not just the first — after parallelisation
    - No duplicate entries in failure list (thread-safe accumulation)
    - Mixed YAML-parse errors and schema errors are all captured
    - Failure summary count matches the actual number of failing files

  Output format preservation (regression against format regressions):
    - OK/FAIL per-file prefixes are preserved
    - "Validated N files" summary line is still emitted with correct count
    - Field-level violation detail is retained per failing file

  Exit code preservation (regression against exit-code regressions):
    - exit 0 when all 100 files are valid
    - exit non-zero when any file in a batch is invalid

  Performance (specification gate):
    - 100 files validated in < 10 seconds wall-clock time (CI hardware budget)
"""

import os
import re
import subprocess
import sys
import tempfile
import time
import unittest

import yaml

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPT_PATH = os.path.join(REPO_ROOT, "scripts", "validate_overlay_configs.py")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _run_script(*args: str) -> subprocess.CompletedProcess:
    """Invoke validate_overlay_configs.py; always captures output, never raises."""
    return subprocess.run(
        [sys.executable, SCRIPT_PATH, *args],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


def _minimal_valid_overlay(name: str = "app", repo: str = "org/app") -> dict:
    """Smallest document that satisfies schemas/overlay.schema.json."""
    return {
        "apiVersion": "gitweave.io/v1",
        "kind": "RepositoryOverlay",
        "metadata": {"name": name},
        "spec": {"repository": repo},
    }


def _write_yaml(directory: str, filename: str, doc: dict) -> str:
    """Write doc as YAML to directory/filename and return the full path."""
    path = os.path.join(directory, filename)
    with open(path, "w") as f:
        yaml.dump(doc, f, default_flow_style=False)
    return path


def _populate_flat_dir(directory: str, count: int, valid: bool = True) -> list[str]:
    """
    Create `count` YAML files in `directory`.  Returns the list of filenames.
    If valid=False every file is missing the required apiVersion field.
    """
    names = []
    for i in range(count):
        filename = f"repo-{i:04d}.yaml"
        doc = _minimal_valid_overlay(name=f"repo-{i}", repo=f"org/repo-{i}")
        if not valid:
            del doc["apiVersion"]
        _write_yaml(directory, filename, doc)
        names.append(filename)
    return names


# ---------------------------------------------------------------------------
# Structural tests — will FAIL until ThreadPoolExecutor is added
# ---------------------------------------------------------------------------


class TestThreadPoolExecutorIsUsed(unittest.TestCase):
    """
    The script MUST use concurrent.futures.ThreadPoolExecutor.
    These tests fail with the current sequential implementation.
    """

    def _read_source(self) -> str:
        with open(SCRIPT_PATH) as f:
            return f.read()

    def test_script_imports_concurrent_futures(self):
        """
        scripts/validate_overlay_configs.py must import from concurrent.futures.
        Fails until the parallel refactor introduces the import.
        """
        source = self._read_source()
        self.assertIn(
            "concurrent.futures",
            source,
            "scripts/validate_overlay_configs.py must import concurrent.futures — "
            "the sequential loop has not yet been replaced with ThreadPoolExecutor.",
        )

    def test_script_references_thread_pool_executor(self):
        """
        The source must reference ThreadPoolExecutor explicitly so that readers
        and static analysis tools can identify the concurrency primitive used.
        """
        source = self._read_source()
        self.assertIn(
            "ThreadPoolExecutor",
            source,
            "scripts/validate_overlay_configs.py must reference ThreadPoolExecutor — "
            "the parallel implementation has not been written yet.",
        )


# ---------------------------------------------------------------------------
# Error reporting completeness — parallel collection must enumerate all failures
# ---------------------------------------------------------------------------


class TestParallelErrorReportingCompleteness(unittest.TestCase):
    """
    After parallelisation, every failing file must still appear in output.
    A naive ThreadPoolExecutor implementation might lose results through a
    non-thread-safe accumulator; these tests guard against that.
    """

    def test_all_10_invalid_files_are_reported(self):
        """
        With 10 files all missing apiVersion, all 10 filenames must appear in
        the output — the parallel run must not short-circuit after the first.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            names = _populate_flat_dir(tmpdir, count=10, valid=False)
            result = _run_script(tmpdir)

        combined = result.stdout + result.stderr
        missing = [n for n in names if n not in combined]
        self.assertEqual(
            missing,
            [],
            f"Parallel run failed to report {len(missing)} of 10 invalid files.\n"
            f"Missing from output: {missing}\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_all_50_invalid_files_are_reported(self):
        """
        With 50 files all failing schema validation, every filename must appear
        in the combined output — concurrency must not drop any failure record.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            names = _populate_flat_dir(tmpdir, count=50, valid=False)
            result = _run_script(tmpdir)

        combined = result.stdout + result.stderr
        missing = [n for n in names if n not in combined]
        self.assertEqual(
            missing,
            [],
            f"Parallel run failed to report {len(missing)} of 50 invalid files.\n"
            f"Missing: {missing[:10]} (showing up to 10)\n"
            f"stdout snippet: {result.stdout[-500:]}",
        )

    def test_no_duplicate_failure_entries_for_any_file(self):
        """
        Each failing filename must appear at most once in the FAIL output lines.
        Thread-unsafe accumulation (e.g. list.append without a lock) can cause
        duplicates under parallel execution.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            names = _populate_flat_dir(tmpdir, count=20, valid=False)
            result = _run_script(tmpdir)

        combined = result.stdout + result.stderr
        duplicates = [
            n for n in names
            if combined.count(f"FAIL {n}") > 1
        ]
        self.assertEqual(
            duplicates,
            [],
            f"Duplicate FAIL entries found for files: {duplicates}\n"
            f"stdout: {result.stdout}",
        )

    def test_failure_summary_count_matches_number_of_invalid_files(self):
        """
        The "N file(s) failed validation" summary line must state the exact
        count of failing files — verifies that the parallel accumulator does
        not under-count or double-count results.
        """
        invalid_count = 15
        with tempfile.TemporaryDirectory() as tmpdir:
            _populate_flat_dir(tmpdir, count=invalid_count, valid=False)
            result = _run_script(tmpdir)

        combined = result.stdout + result.stderr
        match = re.search(r"(\d+)\s+file\(s\)\s+failed\s+validation", combined)
        self.assertIsNotNone(
            match,
            f"Could not find 'N file(s) failed validation' in output.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )
        reported = int(match.group(1))
        self.assertEqual(
            reported,
            invalid_count,
            f"Summary reported {reported} failures but expected {invalid_count}.\n"
            f"stdout: {result.stdout}",
        )

    def test_mixed_yaml_parse_errors_and_schema_errors_all_reported(self):
        """
        When a batch contains both unparseable YAML files and schema-invalid
        files, every failing file must appear in the output regardless of error
        type — the parallel workers must not suppress one error category.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            # 5 valid files
            for i in range(5):
                _write_yaml(tmpdir, f"valid-{i}.yaml", _minimal_valid_overlay(
                    name=f"app-{i}", repo=f"org/app-{i}"
                ))
            # 3 schema-invalid files (missing apiVersion)
            schema_bad = []
            for i in range(3):
                name = f"schema-bad-{i}.yaml"
                doc = _minimal_valid_overlay(name=f"bad-{i}", repo=f"org/bad-{i}")
                del doc["apiVersion"]
                _write_yaml(tmpdir, name, doc)
                schema_bad.append(name)
            # 3 YAML-parse-error files
            yaml_bad = []
            for i in range(3):
                name = f"yaml-bad-{i}.yaml"
                with open(os.path.join(tmpdir, name), "w") as f:
                    f.write("apiVersion: gitweave.io/v1\n  broken: [\n")
                yaml_bad.append(name)

            result = _run_script(tmpdir)

        combined = result.stdout + result.stderr
        all_bad = schema_bad + yaml_bad
        missing = [n for n in all_bad if n not in combined]
        self.assertEqual(
            missing,
            [],
            f"These failing files were missing from parallel output: {missing}\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_valid_files_from_mixed_batch_receive_ok_lines(self):
        """
        Valid files in a batch that also contains invalid files must still
        emit 'OK' lines — parallel workers must not suppress success output.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            valid_names = []
            for i in range(5):
                name = f"good-{i}.yaml"
                _write_yaml(tmpdir, name, _minimal_valid_overlay(
                    name=f"good-{i}", repo=f"org/good-{i}"
                ))
                valid_names.append(name)
            # One invalid to trigger non-zero exit path
            bad = _minimal_valid_overlay(name="bad", repo="org/bad")
            del bad["kind"]
            _write_yaml(tmpdir, "bad.yaml", bad)

            result = _run_script(tmpdir)

        combined = result.stdout + result.stderr
        missing_ok = [n for n in valid_names if f"OK   {n}" not in combined]
        self.assertEqual(
            missing_ok,
            [],
            f"Valid files did not receive 'OK' lines in parallel output: {missing_ok}\n"
            f"stdout: {result.stdout}",
        )


# ---------------------------------------------------------------------------
# Output format preservation
# ---------------------------------------------------------------------------


class TestParallelOutputFormatPreservation(unittest.TestCase):
    """
    The CLI output format must be unchanged after parallelisation.
    Callers depend on the FAIL/OK prefixes and the 'Validated N files' summary.
    """

    def test_validated_n_files_summary_still_emitted_for_100_valid_files(self):
        """'Validated 100 files' must appear in output after validating 100 files."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _populate_flat_dir(tmpdir, count=100, valid=True)
            result = _run_script(tmpdir)

        combined = result.stdout + result.stderr
        self.assertRegex(
            combined,
            r"[Vv]alidated\s+100\s+files?",
            f"'Validated 100 files' summary missing from output after parallel run.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_fail_prefix_preserved_for_schema_invalid_file(self):
        """
        Invalid files must still produce lines starting with 'FAIL <filename>:'.
        Parallel reformatting must not alter the per-file output prefix.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bad = _minimal_valid_overlay()
            del bad["apiVersion"]
            _write_yaml(tmpdir, "missing-api.yaml", bad)
            result = _run_script(tmpdir)

        combined = result.stdout + result.stderr
        self.assertRegex(
            combined,
            r"FAIL\s+missing-api\.yaml:",
            f"'FAIL missing-api.yaml:' prefix not found in output.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_ok_prefix_preserved_for_valid_file(self):
        """Valid files must still produce 'OK   <filename>' lines."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _write_yaml(tmpdir, "good.yaml", _minimal_valid_overlay())
            result = _run_script(tmpdir)

        combined = result.stdout + result.stderr
        self.assertIn(
            "OK   good.yaml",
            combined,
            f"'OK   good.yaml' line not found in output.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_field_level_violation_detail_preserved_in_parallel_output(self):
        """
        Per-file error messages must still include the violated field name.
        Parallel workers must not truncate or lose the ValidationError message.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            bad = _minimal_valid_overlay()
            del bad["kind"]
            _write_yaml(tmpdir, "no-kind.yaml", bad)
            result = _run_script(tmpdir)

        combined = result.stdout + result.stderr
        self.assertIn(
            "kind",
            combined,
            f"Field name 'kind' missing from violation detail in parallel output.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_total_validated_count_equals_file_count_in_directory(self):
        """
        "Validated N files" must accurately count every .yaml file processed —
        parallel execution must not double-count or skip files.
        """
        file_count = 30
        with tempfile.TemporaryDirectory() as tmpdir:
            _populate_flat_dir(tmpdir, count=file_count, valid=True)
            result = _run_script(tmpdir)

        combined = result.stdout + result.stderr
        match = re.search(r"[Vv]alidated\s+(\d+)\s+files?", combined)
        self.assertIsNotNone(
            match,
            f"Could not find 'Validated N files' in output.\n"
            f"stdout: {result.stdout}",
        )
        reported = int(match.group(1))
        self.assertEqual(
            reported,
            file_count,
            f"Reported file count {reported} does not match actual {file_count}.\n"
            f"stdout: {result.stdout}",
        )


# ---------------------------------------------------------------------------
# Exit code preservation
# ---------------------------------------------------------------------------


class TestParallelExitCodePreservation(unittest.TestCase):
    """
    Exit codes must be unchanged after the parallel refactor.
    All threads completing successfully → exit 0.
    Any thread reporting a failure → exit non-zero.
    """

    def test_exits_zero_when_all_100_files_are_valid(self):
        """exit 0 must be returned when 100 valid overlay files are all processed."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _populate_flat_dir(tmpdir, count=100, valid=True)
            result = _run_script(tmpdir)

        self.assertEqual(
            result.returncode,
            0,
            f"Script exited {result.returncode} for 100 valid files — expected 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_nonzero_when_one_of_100_files_is_invalid(self):
        """exit non-zero must be returned when even a single file fails validation."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _populate_flat_dir(tmpdir, count=99, valid=True)
            # One invalid file
            bad = _minimal_valid_overlay(name="bad", repo="org/bad")
            del bad["apiVersion"]
            _write_yaml(tmpdir, "repo-0099.yaml", bad)
            result = _run_script(tmpdir)

        self.assertNotEqual(
            result.returncode,
            0,
            f"Script exited 0 when 1 of 100 files was invalid — expected non-zero.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_nonzero_when_all_100_files_are_invalid(self):
        """exit non-zero must be returned when every file in the batch fails."""
        with tempfile.TemporaryDirectory() as tmpdir:
            _populate_flat_dir(tmpdir, count=100, valid=False)
            result = _run_script(tmpdir)

        self.assertNotEqual(
            result.returncode,
            0,
            f"Script exited 0 when all 100 files were invalid — expected non-zero.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_exits_zero_for_empty_directory_after_parallel_refactor(self):
        """Parallel refactor must not break the empty-directory exit-0 behaviour."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = _run_script(tmpdir)

        self.assertEqual(
            result.returncode,
            0,
            f"Script exited {result.returncode} for an empty directory — expected 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )


# ---------------------------------------------------------------------------
# Performance tests — 100 files must complete in < 10 seconds
# ---------------------------------------------------------------------------


class TestParallelValidationPerformance(unittest.TestCase):
    """
    Performance gate: 100 overlay YAML files validated in < 10 seconds.
    This budget accounts for CI hardware that may be 10x slower than a
    developer laptop.  The parallel implementation must comfortably fit within
    this budget; the sequential baseline (~0.2 s locally) also satisfies it,
    so this test acts as a guard against regressions introduced by poorly
    tuned thread pool configuration.
    """

    def test_100_valid_files_validated_in_under_10_seconds(self):
        """
        Validating 100 valid overlay YAML files end-to-end (subprocess) must
        complete in under 10 seconds wall-clock time.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            _populate_flat_dir(tmpdir, count=100, valid=True)
            start = time.monotonic()
            result = _run_script(tmpdir)
            elapsed = time.monotonic() - start

        self.assertEqual(
            result.returncode,
            0,
            f"Unexpected non-zero exit during performance run.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )
        self.assertLess(
            elapsed,
            10.0,
            f"Validating 100 files took {elapsed:.2f}s — must complete in < 10.0s.\n"
            f"This suggests the parallel refactor introduced unexpected overhead.",
        )

    def test_100_files_with_mixed_valid_and_invalid_validated_in_under_10_seconds(self):
        """
        A batch of 100 files where 50 are valid and 50 are invalid must complete
        in under 10 seconds — failure collection overhead must not stall the pool.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            _populate_flat_dir(tmpdir, count=50, valid=True)
            for i in range(50):
                name = f"bad-{i:04d}.yaml"
                doc = _minimal_valid_overlay(name=f"bad-{i}", repo=f"org/bad-{i}")
                del doc["apiVersion"]
                _write_yaml(tmpdir, name, doc)

            start = time.monotonic()
            result = _run_script(tmpdir)
            elapsed = time.monotonic() - start

        self.assertNotEqual(
            result.returncode,
            0,
            f"Expected non-zero exit for mixed batch — got 0.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )
        self.assertLess(
            elapsed,
            10.0,
            f"Mixed-batch 100-file validation took {elapsed:.2f}s — must be < 10.0s.",
        )

    def test_100_files_validated_in_under_10_seconds_using_scale_fixture_generator(self):
        """
        Using the scale fixture generator (tests/fixtures/generate_scale_fixtures.py)
        to produce 100 overlay files in a flat directory, the script must complete
        in under 10 seconds — validating the performance gate with the canonical
        fixture source referenced in the work item acceptance criteria.
        """
        import importlib.util

        generator_path = os.path.join(
            REPO_ROOT, "tests", "fixtures", "generate_scale_fixtures.py"
        )
        self.assertTrue(
            os.path.isfile(generator_path),
            f"Scale fixture generator not found at {generator_path}",
        )

        spec = importlib.util.spec_from_file_location("generate_scale_fixtures", generator_path)
        gen_mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen_mod)

        with tempfile.TemporaryDirectory() as tmpdir:
            # Generate into a flat sub-directory so all files are at depth 1
            flat_dir = os.path.join(tmpdir, "flat")
            os.makedirs(flat_dir)
            paths = gen_mod.generate(flat_dir, count=100)

            # Move all generated files to flat_dir root (generator uses subdirs)
            import shutil
            for p in paths:
                dest = os.path.join(flat_dir, os.path.basename(str(p)))
                if not os.path.exists(dest):
                    shutil.copy2(p, dest)
            # Remove subdirectories so script only sees the flat files
            for entry in os.scandir(flat_dir):
                if entry.is_dir():
                    shutil.rmtree(entry.path)

            start = time.monotonic()
            result = _run_script(flat_dir)
            elapsed = time.monotonic() - start

        self.assertEqual(
            result.returncode,
            0,
            f"Scale fixture validation failed unexpectedly.\n"
            f"stdout: {result.stdout}\nstderr: {result.stderr}",
        )
        self.assertLess(
            elapsed,
            10.0,
            f"Scale fixture 100-file validation took {elapsed:.2f}s — must be < 10.0s.",
        )


if __name__ == "__main__":
    unittest.main()
