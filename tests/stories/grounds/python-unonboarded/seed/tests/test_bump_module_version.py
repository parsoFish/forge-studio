"""
Unit and CLI tests for scripts/bump-module-version.py CalVer versioning script.

These tests verify that the script:

  Version computation (compute_next_version):
    - Returns YYYYMMDD.0 on first release when no tags exist for the module
    - Returns YYYYMMDD.0 when only tags for other modules exist
    - Increments patch by 1 when same-day tag(s) already exist
    - Takes the highest existing patch number, not the first gap
    - Resets patch to 0 when today's date differs from the most recent release date
    - Handles month and year boundary rollovers correctly

  Tag parsing (parse_module_tag_patch):
    - Extracts the correct integer patch from well-formed tags
    - Returns None for tags with the wrong module name
    - Returns None for tags with a mismatched date
    - Returns None for tags missing the '@' separator
    - Returns None for tags missing the 'modules/' prefix
    - Returns None for tags with a non-numeric patch component
    - Returns None for tags with a date that is too short (7 digits)
    - Returns None for the empty string
    - Returns None for tags missing the patch component entirely

  CLI behaviour:
    - Exits 0 and prints YYYYMMDD.Patch to stdout when called with a valid module name
    - The date portion of the output matches today's date
    - Prints exactly one non-blank line to stdout
    - Exits non-zero when called with no arguments

All tests in this file fail until scripts/bump-module-version.py is created
and implements the expected public functions (TDD red phase).
"""

import datetime
import importlib.util
import os
import subprocess
import sys
import unittest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPT_PATH = os.path.join(REPO_ROOT, "scripts", "bump-module-version.py")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_script():
    """
    Import bump-module-version.py as a Python module so its internal functions
    can be unit-tested directly without invoking a subprocess.

    Raises FileNotFoundError with a descriptive message when the script does
    not yet exist, so each test that calls this helper fails with a clear
    explanation rather than an AttributeError on a None spec.
    """
    if not os.path.isfile(SCRIPT_PATH):
        raise FileNotFoundError(
            f"scripts/bump-module-version.py not found at {SCRIPT_PATH} — "
            "the script must be implemented before these unit tests can pass"
        )
    spec = importlib.util.spec_from_file_location("bump_module_version", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------------------------------------------------------------------------
# TestBumpModuleVersionFirstRelease
# ---------------------------------------------------------------------------


class TestBumpModuleVersionFirstRelease(unittest.TestCase):
    """
    When no git tags exist for the target module, the script must produce
    YYYYMMDD.0 — patch zero — regardless of how many tags exist for other modules.
    """

    def setUp(self):
        self.script = _load_script()

    def test_first_release_with_no_tags_at_all_returns_patch_zero(self):
        """compute_next_version returns YYYYMMDD.0 when the tag list is empty."""
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260305",
            existing_tags=[],
        )
        self.assertEqual(
            version,
            "20260305.0",
            f"Expected '20260305.0' for first release with no tags, got {version!r}",
        )

    def test_first_release_with_only_other_module_tags_returns_patch_zero(self):
        """
        Tags for different modules must not affect the patch counter of the target
        module — each module version is completely independent.
        """
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260305",
            existing_tags=[
                "modules/terraform-module@20260305.0",
                "modules/terraform-module@20260305.1",
                "modules/example-template@20260305.0",
            ],
        )
        self.assertEqual(
            version,
            "20260305.0",
            "Tags for other modules must not affect the python-service patch counter",
        )

    def test_first_release_output_matches_calver_regex(self):
        """Version string must satisfy the YYYYMMDD.Patch format contract."""
        import re

        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260305",
            existing_tags=[],
        )
        self.assertRegex(
            version,
            r"^\d{8}\.\d+$",
            f"Version {version!r} does not match CalVer YYYYMMDD.Patch pattern",
        )

    def test_first_release_date_portion_matches_date_str_argument(self):
        """The date component of the returned version must equal the date_str argument."""
        date_str = "20260305"
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str=date_str,
            existing_tags=[],
        )
        date_part = version.split(".")[0]
        self.assertEqual(
            date_part,
            date_str,
            f"Version date component {date_part!r} does not match date_str {date_str!r}",
        )


# ---------------------------------------------------------------------------
# TestBumpModuleVersionSameDayPatch
# ---------------------------------------------------------------------------


class TestBumpModuleVersionSameDayPatch(unittest.TestCase):
    """
    When one or more tags already exist for the target module on today's date,
    the patch number must be incremented to the next integer above the current maximum.
    """

    def setUp(self):
        self.script = _load_script()

    def test_same_day_patch_zero_increments_to_one(self):
        """When patch .0 exists today, next version is YYYYMMDD.1."""
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260305",
            existing_tags=["modules/python-service@20260305.0"],
        )
        self.assertEqual(
            version,
            "20260305.1",
            f"Expected '20260305.1' after one same-day tag, got {version!r}",
        )

    def test_same_day_patch_one_increments_to_two(self):
        """When patches .0 and .1 exist today, next version is YYYYMMDD.2."""
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260305",
            existing_tags=[
                "modules/python-service@20260305.0",
                "modules/python-service@20260305.1",
            ],
        )
        self.assertEqual(
            version,
            "20260305.2",
            f"Expected '20260305.2' after two same-day tags, got {version!r}",
        )

    def test_same_day_uses_highest_patch_not_first_gap(self):
        """
        With patches 0, 1, 2 present (in any order), next patch must be 3.

        The script must scan for the maximum existing patch, not the first
        integer gap in the sequence, so that gaps created by deleted tags
        do not cause version collisions.
        """
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260305",
            existing_tags=[
                "modules/python-service@20260305.2",
                "modules/python-service@20260305.0",
                "modules/python-service@20260305.1",
            ],
        )
        self.assertEqual(
            version,
            "20260305.3",
            f"Expected '20260305.3' (highest patch + 1), got {version!r}",
        )

    def test_same_day_large_patch_increments_by_one(self):
        """A large existing patch (e.g. 9) must yield patch 10, not 2."""
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260305",
            existing_tags=["modules/python-service@20260305.9"],
        )
        self.assertEqual(
            version,
            "20260305.10",
            f"Expected '20260305.10' after patch 9, got {version!r}",
        )

    def test_same_day_ignores_other_module_tags_when_computing_patch(self):
        """
        A high patch from a different module must not inflate the target module's
        patch counter.  Each module's version sequence is independent.
        """
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260305",
            existing_tags=[
                "modules/python-service@20260305.0",
                "modules/terraform-module@20260305.5",
            ],
        )
        self.assertEqual(
            version,
            "20260305.1",
            "Patch 5 from terraform-module must not affect python-service's counter",
        )

    def test_same_day_with_only_gap_still_returns_max_plus_one(self):
        """
        If only patch 3 exists (with no 0, 1, 2), next version should be .4
        so that the version history remains strictly monotonic.
        """
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260305",
            existing_tags=["modules/python-service@20260305.3"],
        )
        self.assertEqual(
            version,
            "20260305.4",
            "Next patch must be max+1 even if lower patches are absent",
        )


# ---------------------------------------------------------------------------
# TestBumpModuleVersionDayRollover
# ---------------------------------------------------------------------------


class TestBumpModuleVersionDayRollover(unittest.TestCase):
    """
    When today's date differs from the date embedded in the most recent tag,
    the patch counter must reset to 0 — prior-day patches are not carried over.
    """

    def setUp(self):
        self.script = _load_script()

    def test_day_rollover_with_one_prior_tag_returns_patch_zero(self):
        """A single tag from the previous day must not prevent a fresh .0 today."""
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260306",
            existing_tags=["modules/python-service@20260305.0"],
        )
        self.assertEqual(
            version,
            "20260306.0",
            f"Expected '20260306.0' on day rollover (prior tag was yesterday), got {version!r}",
        )

    def test_day_rollover_with_many_prior_patches_resets_to_zero(self):
        """Many previous-day releases must still result in patch .0 the next day."""
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260306",
            existing_tags=[
                "modules/python-service@20260305.0",
                "modules/python-service@20260305.1",
                "modules/python-service@20260305.2",
            ],
        )
        self.assertEqual(
            version,
            "20260306.0",
            "Prior-day patches must not prevent patch reset on the new day",
        )

    def test_day_rollover_across_month_boundary_resets_patch_to_zero(self):
        """Patch resets correctly at month boundaries (e.g. March 31 → April 1)."""
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260401",
            existing_tags=["modules/python-service@20260331.0"],
        )
        self.assertEqual(
            version,
            "20260401.0",
            "Month boundary rollover must reset patch to 0",
        )

    def test_day_rollover_across_year_boundary_resets_patch_to_zero(self):
        """Patch resets correctly at year boundaries (e.g. Dec 31 → Jan 1)."""
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20270101",
            existing_tags=["modules/python-service@20261231.5"],
        )
        self.assertEqual(
            version,
            "20270101.0",
            "Year boundary rollover must reset patch to 0",
        )

    def test_day_rollover_only_looks_at_todays_date_not_yesterday(self):
        """
        Tags from multiple past days must all be ignored; only tags whose date
        component equals date_str are eligible for patch increment.
        """
        version = self.script.compute_next_version(
            module_name="python-service",
            date_str="20260307",
            existing_tags=[
                "modules/python-service@20260304.0",
                "modules/python-service@20260305.0",
                "modules/python-service@20260306.0",
            ],
        )
        self.assertEqual(
            version,
            "20260307.0",
            "All prior-day tags must be ignored; only today's tags affect the patch",
        )


# ---------------------------------------------------------------------------
# TestBumpModuleVersionTagParsing
# ---------------------------------------------------------------------------


class TestBumpModuleVersionTagParsing(unittest.TestCase):
    """
    parse_module_tag_patch() is the low-level parser that extracts the integer
    patch from a single tag string.  These edge-case tests guard against silent
    misparses that would corrupt the patch sequence and cause version collisions.
    """

    def setUp(self):
        self.script = _load_script()

    # --- happy path ---

    def test_parses_patch_zero_from_valid_tag(self):
        """Returns 0 for the canonical first-release tag format."""
        result = self.script.parse_module_tag_patch(
            tag="modules/python-service@20260305.0",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertEqual(result, 0, "Patch 0 must be parsed from a .0 tag")

    def test_parses_patch_one_from_valid_tag(self):
        """Returns 1 for the second-release tag format."""
        result = self.script.parse_module_tag_patch(
            tag="modules/python-service@20260305.1",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertEqual(result, 1, "Patch 1 must be parsed from a .1 tag")

    def test_parses_large_patch_number_from_valid_tag(self):
        """Returns 42 for a multi-digit patch number."""
        result = self.script.parse_module_tag_patch(
            tag="modules/python-service@20260305.42",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertEqual(result, 42, "Large patch number must be parsed correctly")

    def test_parses_tag_for_hyphenated_module_name(self):
        """Hyphenated module names (terraform-module) must parse correctly."""
        result = self.script.parse_module_tag_patch(
            tag="modules/terraform-module@20260305.3",
            module_name="terraform-module",
            date_str="20260305",
        )
        self.assertEqual(result, 3, "Hyphenated module name must parse the patch correctly")

    # --- wrong module name ---

    def test_returns_none_for_tag_with_wrong_module_name(self):
        """
        A tag for a different module must return None so it is not counted
        toward the target module's patch sequence.
        """
        result = self.script.parse_module_tag_patch(
            tag="modules/terraform-module@20260305.0",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertIsNone(
            result,
            "Tag for terraform-module must return None when module_name='python-service'",
        )

    def test_returns_none_for_tag_with_module_name_as_prefix_only(self):
        """
        'python-service-extra@20260305.0' must not match when module_name='python-service'
        — partial-prefix matching would silently include unrelated modules.
        """
        result = self.script.parse_module_tag_patch(
            tag="modules/python-service-extra@20260305.0",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertIsNone(
            result,
            "Module name 'python-service' must not match 'python-service-extra'",
        )

    # --- wrong date ---

    def test_returns_none_for_tag_with_yesterday_date(self):
        """Tag from a previous day must return None (date mismatch)."""
        result = self.script.parse_module_tag_patch(
            tag="modules/python-service@20260304.0",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertIsNone(
            result,
            "Tag from a different date must return None",
        )

    def test_returns_none_for_tag_with_future_date(self):
        """Tag from a future date must also return None (date mismatch)."""
        result = self.script.parse_module_tag_patch(
            tag="modules/python-service@20261231.0",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertIsNone(
            result,
            "Tag from a future date must return None",
        )

    # --- structural malformations ---

    def test_returns_none_for_tag_missing_at_sign(self):
        """'modules/python-service20260305.0' (no '@') must return None."""
        result = self.script.parse_module_tag_patch(
            tag="modules/python-service20260305.0",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertIsNone(result, "Tag without '@' separator must return None")

    def test_returns_none_for_tag_missing_modules_prefix(self):
        """'python-service@20260305.0' (no 'modules/') must return None."""
        result = self.script.parse_module_tag_patch(
            tag="python-service@20260305.0",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertIsNone(result, "Tag without 'modules/' prefix must return None")

    def test_returns_none_for_tag_missing_patch_component(self):
        """'modules/python-service@20260305' (no '.patch') must return None."""
        result = self.script.parse_module_tag_patch(
            tag="modules/python-service@20260305",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertIsNone(result, "Tag without a patch component must return None")

    def test_returns_none_for_tag_with_non_numeric_patch(self):
        """'modules/python-service@20260305.alpha' must return None."""
        result = self.script.parse_module_tag_patch(
            tag="modules/python-service@20260305.alpha",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertIsNone(result, "Non-numeric patch component must return None")

    def test_returns_none_for_tag_with_short_date(self):
        """'modules/python-service@2026035.0' (7-digit date) must return None."""
        result = self.script.parse_module_tag_patch(
            tag="modules/python-service@2026035.0",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertIsNone(result, "Tag with a 7-digit date must return None")

    def test_returns_none_for_empty_tag_string(self):
        """An empty string must return None without raising an exception."""
        result = self.script.parse_module_tag_patch(
            tag="",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertIsNone(result, "Empty tag string must return None, not raise")

    def test_returns_none_for_tag_with_negative_patch(self):
        """'modules/python-service@20260305.-1' must return None (negative patch is invalid)."""
        result = self.script.parse_module_tag_patch(
            tag="modules/python-service@20260305.-1",
            module_name="python-service",
            date_str="20260305",
        )
        self.assertIsNone(result, "Negative patch component must return None")


# ---------------------------------------------------------------------------
# TestBumpModuleVersionCLI
# ---------------------------------------------------------------------------


class TestBumpModuleVersionCLI(unittest.TestCase):
    """
    Subprocess tests that call scripts/bump-module-version.py as a CLI tool.

    These tests do NOT mock git.  In the test environment there are no module
    version tags so the script will always yield patch .0 for today — which is
    the correct behaviour for a first release.

    The tests validate stdout format, exit code, and basic usage-guard behaviour.
    """

    def setUp(self):
        if not os.path.isfile(SCRIPT_PATH):
            self.fail(
                f"scripts/bump-module-version.py not found at {SCRIPT_PATH} — "
                "the script must be implemented before CLI tests can pass"
            )

    def _run_script(self, args: list) -> subprocess.CompletedProcess:
        """Invoke the script via the current Python interpreter and return the result."""
        return subprocess.run(
            [sys.executable, SCRIPT_PATH] + args,
            capture_output=True,
            text=True,
            cwd=REPO_ROOT,
        )

    def test_script_exits_zero_with_valid_module_name(self):
        """Script must exit 0 when called with a valid module name."""
        result = self._run_script(["python-service"])
        self.assertEqual(
            result.returncode,
            0,
            f"Script exited {result.returncode} with a valid module name\n"
            f"STDOUT: {result.stdout!r}\nSTDERR: {result.stderr!r}",
        )

    def test_script_outputs_calver_format_string(self):
        """Script stdout must be a single YYYYMMDD.Patch CalVer string."""
        import re

        result = self._run_script(["python-service"])
        output = result.stdout.strip()
        self.assertRegex(
            output,
            r"^\d{8}\.\d+$",
            f"Script output {output!r} does not match CalVer YYYYMMDD.Patch pattern",
        )

    def test_script_output_date_matches_today(self):
        """The YYYYMMDD portion of the output must equal today's date."""
        today = datetime.date.today().strftime("%Y%m%d")
        result = self._run_script(["python-service"])
        output = result.stdout.strip()
        self.assertTrue(
            output.startswith(today),
            f"Script output {output!r} does not start with today's date {today!r}",
        )

    def test_script_output_has_exactly_one_non_blank_line(self):
        """Script stdout must contain exactly one non-blank line (the version)."""
        result = self._run_script(["python-service"])
        non_blank = [line for line in result.stdout.splitlines() if line.strip()]
        self.assertEqual(
            len(non_blank),
            1,
            f"Script produced {len(non_blank)} non-blank output lines — "
            f"expected exactly 1:\n{result.stdout!r}",
        )

    def test_script_exits_nonzero_without_arguments(self):
        """
        Script must exit non-zero and print an error or usage message when
        called with no arguments — silent failure would produce an empty version
        string that would silently corrupt downstream CI steps.
        """
        result = self._run_script([])
        self.assertNotEqual(
            result.returncode,
            0,
            "Script must exit non-zero when MODULE_NAME argument is omitted",
        )

    def test_script_error_output_mentions_module_name_when_missing_arg(self):
        """
        The error or usage output when no argument is supplied must hint at
        the expected MODULE_NAME argument so developers can quickly self-diagnose.
        """
        result = self._run_script([])
        combined = (result.stdout + result.stderr).lower()
        self.assertTrue(
            "module" in combined or "usage" in combined or "argument" in combined,
            f"Script error output does not mention 'module', 'usage', or 'argument':\n"
            f"STDOUT: {result.stdout!r}\nSTDERR: {result.stderr!r}",
        )


if __name__ == "__main__":
    unittest.main()
