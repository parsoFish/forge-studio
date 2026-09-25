"""
Unit and integration tests for the --dry-run summary table feature in
apply-overlays.py.

These tests define expected behavior BEFORE implementation (TDD red phase).
All tests will FAIL until apply-overlays.py exposes:

  compute_dry_run_summary(configs)
    Aggregates repo count, total module references, and estimated action count
    from a list of RepositoryOverlay config dicts.  Returns a dict with at
    minimum:
      total_repos            — int, one per config
      total_modules          — int, sum of all module references across all repos
      total_estimated_actions — int, one copier action per module reference
      repos                  — list of per-repo dicts, each containing:
                                 repo (str), modules (int), estimated_actions (int)

  format_dry_run_table(summary)
    Accepts the dict returned by compute_dry_run_summary() and returns a
    formatted string suitable for printing to stdout.  The string must include:
      - a header row with recognisable column names
      - one data row per repo containing the slug, module count, action count
      - a footer / totals row summarising all repos

  --dry-run CLI mode
    After processing all repos, the script must print the formatted summary
    table to stdout showing repo count, total module references, and total
    estimated action count.

Test layers:

  Unit tests — compute_dry_run_summary:
    - Returns zero counts for an empty config list
    - Returns a dict (not None or a non-dict type)
    - Counts repos correctly (one entry per config)
    - Counts total module references across all configs
    - Computes estimated action count (one copier action per module reference)
    - Handles configs with no 'modules' key (treated as 0 modules)
    - Handles configs with an empty modules list (treated as 0 modules)
    - Returns correct per-repo breakdown in 'repos' list
    - Returns correct values for a known 3-repo fixture set

  Unit tests — format_dry_run_table:
    - Returns a non-empty string
    - Includes the repo slug for each configured repo
    - Includes per-repo module count
    - Includes per-repo estimated action count
    - Includes total repo count in footer/summary line
    - Includes total module count in footer/summary line
    - Includes total estimated action count in footer/summary line
    - Has a recognisable tabular structure (header separator or column alignment)

  Integration tests — CLI subprocess:
    - Summary table present in stdout for a 3-repo fixture set
    - Summary table shows correct repo count for a 3-repo fixture set
    - Summary table shows correct total module count for a 3-repo fixture set
    - Summary table shows correct estimated action count for a 3-repo fixture set
    - Script exits 0 after printing the summary table
    - Summary table still prints for an empty config directory (zero-row state)
    - Repo slugs appear as rows in the summary table output

  Integration tests — 100-file scale fixtures:
    - Summary table row count matches fixture count (100 repos)
    - Summary table total module count matches fixture module total
    - Summary table estimated action count matches fixture module total
    - Script exits 0 with scale fixtures in dry-run mode
"""

from __future__ import annotations

import importlib.util
import os
import re
import subprocess
import sys
import tempfile
import unittest

import yaml

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCRIPT_PATH = os.path.join(REPO_ROOT, "scripts", "apply-overlays.py")
FIXTURES_MODULE = os.path.join(REPO_ROOT, "tests", "fixtures", "generate_scale_fixtures.py")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


def _load_script():
    """
    Import apply-overlays.py as a Python module so its public functions can be
    unit-tested directly without invoking a subprocess.

    Raises FileNotFoundError when the script does not yet exist.
    """
    if not os.path.isfile(SCRIPT_PATH):
        raise FileNotFoundError(
            f"scripts/apply-overlays.py not found at {SCRIPT_PATH}"
        )
    spec = importlib.util.spec_from_file_location("apply_overlays", SCRIPT_PATH)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _load_fixtures_module():
    """Import tests/fixtures/generate_scale_fixtures.py for scale tests."""
    if not os.path.isfile(FIXTURES_MODULE):
        raise FileNotFoundError(
            f"Fixture generator not found at {FIXTURES_MODULE}"
        )
    spec = importlib.util.spec_from_file_location("generate_scale_fixtures", FIXTURES_MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run_script(*args: str, env: dict | None = None) -> subprocess.CompletedProcess:
    """
    Invoke apply-overlays.py with the given arguments.
    Captures stdout+stderr and never raises on non-zero exit.
    """
    run_env = os.environ.copy()
    if env is not None:
        run_env.update(env)
    return subprocess.run(
        [sys.executable, SCRIPT_PATH, *args],
        capture_output=True,
        text=True,
        env=run_env,
    )


def _overlay_doc(repo: str, modules: list[str] | None = None) -> dict:
    """Return a minimal valid RepositoryOverlay document."""
    doc: dict = {
        "apiVersion": "gitweave.io/v1",
        "kind": "RepositoryOverlay",
        "metadata": {"name": repo.split("/")[-1]},
        "spec": {"repository": repo},
    }
    if modules is not None:
        doc["spec"]["modules"] = [{"name": m} for m in modules]
    return doc


def _write_yaml(directory: str, filename: str, doc: dict) -> str:
    """Write doc as YAML to directory/filename and return the full path."""
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, filename)
    with open(path, "w") as f:
        yaml.dump(doc, f, default_flow_style=False)
    return path


# ---------------------------------------------------------------------------
# Unit tests: compute_dry_run_summary
# ---------------------------------------------------------------------------


class TestComputeDryRunSummary(unittest.TestCase):
    """
    Unit tests for compute_dry_run_summary(configs) — the pure function that
    aggregates metrics from a list of RepositoryOverlay config dicts.

    The function must exist on the apply_overlays module and be callable with
    a single argument: a list of config dicts as returned by load_overlay_configs.

    All tests FAIL until compute_dry_run_summary is implemented.
    """

    def setUp(self):
        self.mod = _load_script()
        self.fn = getattr(self.mod, "compute_dry_run_summary", None)

    def _call(self, configs: list) -> dict:
        """Call compute_dry_run_summary and assert it returns a dict."""
        if self.fn is None:
            self.fail(
                "apply-overlays.py does not expose a callable "
                "'compute_dry_run_summary'. Add the function before running "
                "these tests."
            )
        result = self.fn(configs)
        self.assertIsInstance(
            result,
            dict,
            f"compute_dry_run_summary must return a dict, got: {type(result)}",
        )
        return result

    # --- existence ---

    def test_function_is_callable(self):
        """compute_dry_run_summary must be a callable exposed on the module."""
        self.assertTrue(
            callable(self.fn),
            "apply-overlays.py must expose a callable 'compute_dry_run_summary'.",
        )

    # --- empty input ---

    def test_returns_dict_for_empty_list(self):
        """compute_dry_run_summary([]) must return a dict (not None)."""
        result = self._call([])
        self.assertIsNotNone(result, "Return value must not be None for empty input.")

    def test_zero_repos_for_empty_list(self):
        """total_repos must be 0 for an empty config list."""
        result = self._call([])
        self.assertEqual(
            result.get("total_repos"),
            0,
            f"Expected total_repos=0 for empty list, got: {result}",
        )

    def test_zero_modules_for_empty_list(self):
        """total_modules must be 0 for an empty config list."""
        result = self._call([])
        self.assertEqual(
            result.get("total_modules"),
            0,
            f"Expected total_modules=0 for empty list, got: {result}",
        )

    def test_zero_estimated_actions_for_empty_list(self):
        """total_estimated_actions must be 0 for an empty config list."""
        result = self._call([])
        self.assertEqual(
            result.get("total_estimated_actions"),
            0,
            f"Expected total_estimated_actions=0 for empty list, got: {result}",
        )

    def test_repos_list_is_empty_for_empty_input(self):
        """The 'repos' list in the summary must be empty for empty config input."""
        result = self._call([])
        repos = result.get("repos", [])
        self.assertIsInstance(repos, list, f"'repos' must be a list, got: {type(repos)}")
        self.assertEqual(
            len(repos),
            0,
            f"'repos' list must be empty for empty input, got: {repos}",
        )

    # --- repo counting ---

    def test_counts_one_repo_per_config(self):
        """total_repos must equal the number of configs passed in."""
        configs = [
            _overlay_doc("org/app-a", ["lang-node"]),
            _overlay_doc("org/app-b", ["lang-python"]),
            _overlay_doc("org/app-c"),
        ]
        result = self._call(configs)
        self.assertEqual(
            result.get("total_repos"),
            3,
            f"Expected total_repos=3 for 3 configs, got: {result}",
        )

    def test_repos_list_has_one_entry_per_config(self):
        """The 'repos' list must have one entry per config dict."""
        configs = [
            _overlay_doc("org/app-a", ["lang-node"]),
            _overlay_doc("org/app-b", ["lang-python"]),
        ]
        result = self._call(configs)
        repos = result.get("repos", [])
        self.assertEqual(
            len(repos),
            2,
            f"Expected 2 entries in 'repos', got {len(repos)}: {repos}",
        )

    def test_per_repo_entry_contains_repo_slug(self):
        """Each entry in 'repos' must contain the repository slug."""
        configs = [_overlay_doc("org/my-service", ["lang-node"])]
        result = self._call(configs)
        repos = result.get("repos", [])
        self.assertEqual(len(repos), 1, f"Expected 1 repo entry, got: {repos}")
        entry = repos[0]
        self.assertEqual(
            entry.get("repo"),
            "org/my-service",
            f"Per-repo entry must contain 'repo' slug: {entry}",
        )

    # --- module counting ---

    def test_counts_total_module_references_across_configs(self):
        """total_modules must be the sum of all module references across all repos."""
        configs = [
            _overlay_doc("org/app-a", ["lang-node", "ci-github-actions"]),  # 2
            _overlay_doc("org/app-b", ["lang-python"]),                      # 1
            _overlay_doc("org/app-c"),                                        # 0
        ]
        result = self._call(configs)
        self.assertEqual(
            result.get("total_modules"),
            3,  # 2 + 1 + 0
            f"Expected total_modules=3, got: {result}",
        )

    def test_per_repo_entry_contains_module_count(self):
        """Each per-repo entry must include the number of modules for that repo."""
        configs = [_overlay_doc("org/app", ["lang-node", "ci-github-actions"])]
        result = self._call(configs)
        repos = result.get("repos", [])
        self.assertEqual(len(repos), 1)
        entry = repos[0]
        self.assertEqual(
            entry.get("modules"),
            2,
            f"Per-repo entry must contain module count=2: {entry}",
        )

    def test_handles_config_with_no_modules_key(self):
        """A config without a 'modules' key must contribute 0 to module totals."""
        configs = [_overlay_doc("org/bare")]  # no modules key at all
        result = self._call(configs)
        self.assertEqual(
            result.get("total_modules"),
            0,
            f"Config with no 'modules' key must yield total_modules=0: {result}",
        )
        repos = result.get("repos", [])
        self.assertEqual(len(repos), 1)
        self.assertEqual(
            repos[0].get("modules"),
            0,
            f"Per-repo module count must be 0 when no 'modules' key: {repos[0]}",
        )

    def test_handles_config_with_empty_modules_list(self):
        """A config with modules=[] must contribute 0 to module totals."""
        configs = [_overlay_doc("org/empty", [])]
        result = self._call(configs)
        self.assertEqual(
            result.get("total_modules"),
            0,
            f"Config with empty modules list must yield total_modules=0: {result}",
        )

    # --- estimated action counting ---

    def test_estimated_actions_equals_total_module_references(self):
        """
        total_estimated_actions must equal total_modules.
        Each module reference results in exactly one copier action.
        """
        configs = [
            _overlay_doc("org/app-a", ["lang-node", "ci-github-actions"]),  # 2
            _overlay_doc("org/app-b", ["lang-python"]),                      # 1
        ]
        result = self._call(configs)
        self.assertEqual(
            result.get("total_estimated_actions"),
            3,  # 2 + 1
            f"Expected total_estimated_actions=3, got: {result}",
        )

    def test_per_repo_entry_contains_estimated_actions(self):
        """Each per-repo entry must include estimated_actions for that repo."""
        configs = [_overlay_doc("org/app", ["lang-node", "lang-python"])]
        result = self._call(configs)
        repos = result.get("repos", [])
        self.assertEqual(len(repos), 1)
        entry = repos[0]
        self.assertEqual(
            entry.get("estimated_actions"),
            2,
            f"Per-repo entry must contain estimated_actions=2: {entry}",
        )

    def test_zero_estimated_actions_for_repo_with_no_modules(self):
        """A repo with no modules must have estimated_actions=0."""
        configs = [_overlay_doc("org/empty")]
        result = self._call(configs)
        repos = result.get("repos", [])
        self.assertEqual(len(repos), 1)
        self.assertEqual(
            repos[0].get("estimated_actions"),
            0,
            f"estimated_actions must be 0 for a repo with no modules: {repos[0]}",
        )

    # --- known 3-repo fixture set ---

    def test_correct_values_for_known_3_repo_fixture_set(self):
        """
        Given a known 3-repo fixture set with module counts [2, 1, 0], the
        summary must report: total_repos=3, total_modules=3, total_estimated_actions=3.
        """
        configs = [
            _overlay_doc("org/app-a", ["lang-node", "ci-github-actions"]),  # 2 modules
            _overlay_doc("org/app-b", ["lang-python"]),                      # 1 module
            _overlay_doc("org/app-c"),                                        # 0 modules
        ]
        result = self._call(configs)
        self.assertEqual(result.get("total_repos"), 3,
                         f"total_repos should be 3: {result}")
        self.assertEqual(result.get("total_modules"), 3,
                         f"total_modules should be 3: {result}")
        self.assertEqual(result.get("total_estimated_actions"), 3,
                         f"total_estimated_actions should be 3: {result}")

    def test_per_repo_slugs_match_input_repos(self):
        """All repo slugs from input configs appear in the 'repos' list."""
        expected_repos = {"org/app-a", "org/app-b", "org/app-c"}
        configs = [_overlay_doc(r) for r in expected_repos]
        result = self._call(configs)
        actual_repos = {entry.get("repo") for entry in result.get("repos", [])}
        self.assertEqual(
            actual_repos,
            expected_repos,
            f"'repos' slugs do not match input repos.\n"
            f"Expected: {expected_repos}\nGot: {actual_repos}",
        )


# ---------------------------------------------------------------------------
# Unit tests: format_dry_run_table
# ---------------------------------------------------------------------------


class TestFormatDryRunTable(unittest.TestCase):
    """
    Unit tests for format_dry_run_table(summary) — the function that renders
    the summary dict from compute_dry_run_summary() as a human-readable table.

    The function must be callable with a single argument (the summary dict) and
    must return a non-empty string.

    All tests FAIL until format_dry_run_table is implemented.
    """

    def setUp(self):
        self.mod = _load_script()
        self.fn = getattr(self.mod, "format_dry_run_table", None)
        # Build a known summary to pass to format_dry_run_table
        compute_fn = getattr(self.mod, "compute_dry_run_summary", None)
        if callable(compute_fn):
            self._known_summary = compute_fn([
                _overlay_doc("org/app-a", ["lang-node", "ci-github-actions"]),
                _overlay_doc("org/app-b", ["lang-python"]),
                _overlay_doc("org/app-c"),
            ])
        else:
            # Manually construct a minimal summary dict so format tests can run
            # even if compute_dry_run_summary is not yet available.
            self._known_summary = {
                "total_repos": 3,
                "total_modules": 3,
                "total_estimated_actions": 3,
                "repos": [
                    {"repo": "org/app-a", "modules": 2, "estimated_actions": 2},
                    {"repo": "org/app-b", "modules": 1, "estimated_actions": 1},
                    {"repo": "org/app-c", "modules": 0, "estimated_actions": 0},
                ],
            }

    def _call(self, summary: dict) -> str:
        if not callable(self.fn):
            self.fail(
                "apply-overlays.py does not expose a callable 'format_dry_run_table'. "
                "Add the function before running these tests."
            )
        result = self.fn(summary)
        self.assertIsInstance(
            result, str,
            f"format_dry_run_table must return a str, got: {type(result)}",
        )
        return result

    # --- existence ---

    def test_function_is_callable(self):
        """format_dry_run_table must be a callable exposed on the module."""
        self.assertTrue(
            callable(self.fn),
            "apply-overlays.py must expose a callable 'format_dry_run_table'.",
        )

    # --- return type ---

    def test_returns_nonempty_string(self):
        """format_dry_run_table must return a non-empty string."""
        result = self._call(self._known_summary)
        self.assertTrue(
            result.strip(),
            "format_dry_run_table returned an empty or whitespace-only string.",
        )

    # --- per-repo content ---

    def test_includes_repo_slug_for_each_repo(self):
        """The table output must contain every repo slug from the summary."""
        result = self._call(self._known_summary)
        for expected_slug in ("org/app-a", "org/app-b", "org/app-c"):
            self.assertIn(
                expected_slug,
                result,
                f"Table output must include repo slug '{expected_slug}'.\nOutput:\n{result}",
            )

    def test_includes_per_repo_module_count(self):
        """
        Each repo row must show its module count.
        org/app-a has 2 modules, org/app-b has 1, org/app-c has 0.
        """
        result = self._call(self._known_summary)
        # The number 2 (app-a's module count) must appear somewhere alongside the repo slug.
        # We check broadly that '2' appears in the output.
        self.assertRegex(
            result,
            r"\b2\b",
            f"Table must include the module count '2' for org/app-a.\nOutput:\n{result}",
        )

    def test_includes_per_repo_estimated_actions(self):
        """
        Each repo row must show its estimated action count.
        org/app-a has 2 actions (2 modules × 1 copier call each).
        """
        result = self._call(self._known_summary)
        # Estimated actions equal module count; '2' must appear for org/app-a.
        self.assertIn(
            "2",
            result,
            f"Table must include estimated action count '2'.\nOutput:\n{result}",
        )

    # --- footer / totals row ---

    def test_includes_total_repo_count_in_output(self):
        """
        The table footer or summary line must include the total repo count (3).
        """
        result = self._call(self._known_summary)
        self.assertRegex(
            result,
            r"\b3\b",
            f"Table output must include total repo count '3'.\nOutput:\n{result}",
        )

    def test_includes_total_module_count_in_output(self):
        """
        The table footer or summary line must include the total module count (3).
        """
        result = self._call(self._known_summary)
        # The number 3 must appear as a total/footer value.
        self.assertRegex(
            result,
            r"\b3\b",
            f"Table must include total module count '3' in footer.\nOutput:\n{result}",
        )

    def test_includes_total_estimated_action_count_in_output(self):
        """
        The table footer or summary line must include the total estimated actions (3).
        """
        result = self._call(self._known_summary)
        self.assertRegex(
            result,
            r"\b3\b",
            f"Table must include total estimated action count '3'.\nOutput:\n{result}",
        )

    # --- tabular structure ---

    def test_output_contains_header_separator_or_column_alignment(self):
        """
        The table must have a recognisable tabular structure.  Acceptable forms
        include a separator line (dashes, equals signs, or box-drawing chars)
        or consistently aligned columns (detected by two or more adjacent spaces
        or tab characters in header/data lines).
        """
        result = self._call(self._known_summary)
        # A table MUST have some separator/alignment indicator.
        has_separator = bool(
            re.search(r"[-=+|─┼┬┴┐┘┌└]{3,}", result)  # ascii or box-drawing
            or re.search(r"\t| {2,}", result)           # tab or multiple spaces (column alignment)
            or re.search(r"[|│]", result)               # pipe characters
        )
        self.assertTrue(
            has_separator,
            f"Table output must have a recognisable tabular structure "
            f"(separator line, box chars, or column alignment).\nOutput:\n{result}",
        )

    def test_output_has_header_row_with_recognisable_column_labels(self):
        """
        The first non-empty line of the table must be a header row.  It must
        contain at least one recognisable column label (case-insensitive):
        'repo', 'module', 'action', 'estimated', 'count', 'total'.
        """
        result = self._call(self._known_summary)
        header_candidates = [
            line for line in result.splitlines() if line.strip()
        ]
        self.assertTrue(
            header_candidates,
            f"Table output produced no non-empty lines.\nOutput:\n{result}",
        )
        first_line = header_candidates[0].lower()
        recognisable = any(
            label in first_line
            for label in ("repo", "module", "action", "estimated", "count", "total")
        )
        self.assertTrue(
            recognisable,
            f"First non-empty line must look like a header row with a recognisable "
            f"column label.\nFirst line: {header_candidates[0]!r}\nFull output:\n{result}",
        )

    def test_returns_empty_table_structure_for_zero_repos(self):
        """
        When the summary has zero repos, format_dry_run_table must still return
        a string (possibly just headers + footer) — it must not raise.
        """
        empty_summary = {
            "total_repos": 0,
            "total_modules": 0,
            "total_estimated_actions": 0,
            "repos": [],
        }
        result = self._call(empty_summary)
        self.assertIsInstance(result, str, "Must return a string for zero-repo summary.")
        # At minimum the output should convey that there are 0 repos.
        self.assertRegex(
            result,
            r"\b0\b",
            f"Zero-repo table should contain '0' somewhere.\nOutput:\n{result}",
        )


# ---------------------------------------------------------------------------
# Integration tests: CLI subprocess (3-repo known fixture)
# ---------------------------------------------------------------------------


class TestDryRunSummaryTableCLI(unittest.TestCase):
    """
    Subprocess-level integration tests that invoke apply-overlays.py --dry-run
    against a controlled 3-repo fixture directory and assert that the printed
    summary table contains the correct values.

    All tests FAIL until the --dry-run mode prints a formatted summary table
    with per-repo rows and aggregate totals.
    """

    # Fixture layout:
    #   org/app-a — 2 modules (lang-node, ci-github-actions) → 2 actions
    #   org/app-b — 1 module  (lang-python)                  → 1 action
    #   org/app-c — 0 modules                                → 0 actions
    # Totals: 3 repos, 3 modules, 3 estimated actions

    _REPOS = {
        "app-a.yaml": ("org/app-a", ["lang-node", "ci-github-actions"]),
        "app-b.yaml": ("org/app-b", ["lang-python"]),
        "app-c.yaml": ("org/app-c", []),
    }

    def _build_fixture_dir(self, tmpdir: str) -> None:
        for filename, (repo, modules) in self._REPOS.items():
            _write_yaml(tmpdir, filename, _overlay_doc(repo, modules))

    def _run_dry_run(self, config_dir: str) -> subprocess.CompletedProcess:
        return _run_script("--dry-run", "--config-dir", config_dir)

    def test_script_exits_0_with_3_repo_fixture(self):
        """Script must exit 0 in --dry-run mode with the 3-repo fixture."""
        with tempfile.TemporaryDirectory() as tmpdir:
            self._build_fixture_dir(tmpdir)
            result = self._run_dry_run(tmpdir)
        self.assertEqual(
            result.returncode, 0,
            f"Script must exit 0.\nstdout: {result.stdout}\nstderr: {result.stderr}",
        )

    def test_summary_table_present_in_stdout(self):
        """
        Dry-run stdout must contain a section that looks like a summary table
        (keyword 'summary' or 'table', or a numeric count of repos present).
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            self._build_fixture_dir(tmpdir)
            result = self._run_dry_run(tmpdir)
        combined = result.stdout + result.stderr
        # A summary table must be present — identified by at least one of these signals.
        has_table = (
            "summary" in combined.lower()
            or "table" in combined.lower()
            or re.search(r"\b3\s*(repos?|repositories|total)\b", combined.lower())
            or re.search(r"\brepo\b.*\bmodule\b", combined.lower())
        )
        self.assertTrue(
            has_table,
            f"Dry-run output must include a summary table.\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    def test_summary_table_shows_all_repo_slugs(self):
        """Each repo slug must appear in the dry-run output as a table row."""
        with tempfile.TemporaryDirectory() as tmpdir:
            self._build_fixture_dir(tmpdir)
            result = self._run_dry_run(tmpdir)
        combined = result.stdout + result.stderr
        for slug in ("org/app-a", "org/app-b", "org/app-c"):
            self.assertIn(
                slug, combined,
                f"Repo slug '{slug}' must appear as a row in the summary table.\n"
                f"stdout:\n{result.stdout}",
            )

    def test_summary_table_shows_correct_repo_count(self):
        """
        The summary table footer must include the total repo count (3).
        The number '3' must appear in context with 'repo' or as a column total.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            self._build_fixture_dir(tmpdir)
            result = self._run_dry_run(tmpdir)
        combined = result.stdout + result.stderr
        # Match '3 repos', '3 repositories', 'total: 3', or bare '3' near a summary line.
        has_repo_count = bool(
            re.search(r"\b3\s*(repos?|repositories)\b", combined.lower())
            or re.search(r"(repos?|total)[^\n]*\b3\b", combined.lower())
            or re.search(r"\b3\b[^\n]*(repos?|total)", combined.lower())
        )
        self.assertTrue(
            has_repo_count,
            f"Summary table must show total repo count '3'.\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    def test_summary_table_shows_correct_total_module_count(self):
        """
        The summary table must show total module count = 3
        (2 from app-a + 1 from app-b + 0 from app-c).
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            self._build_fixture_dir(tmpdir)
            result = self._run_dry_run(tmpdir)
        combined = result.stdout + result.stderr
        # The number 3 must appear in context with 'module' references.
        has_module_total = bool(
            re.search(r"\b3\s*modules?\b", combined.lower())
            or re.search(r"modules?[^\n]*\b3\b", combined.lower())
            or re.search(r"\b3\b[^\n]*modules?", combined.lower())
        )
        self.assertTrue(
            has_module_total,
            f"Summary table must show total module count '3'.\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    def test_summary_table_shows_correct_estimated_action_count(self):
        """
        The summary table must show estimated action count = 3
        (one copier action per module reference).
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            self._build_fixture_dir(tmpdir)
            result = self._run_dry_run(tmpdir)
        combined = result.stdout + result.stderr
        # Estimated actions must be 3, shown near 'action' or 'estimated'.
        has_action_total = bool(
            re.search(r"\b3\s*(estimated\s+)?actions?\b", combined.lower())
            or re.search(r"(estimated\s+)?actions?[^\n]*\b3\b", combined.lower())
            or re.search(r"\b3\b[^\n]*(estimated|actions?)", combined.lower())
        )
        self.assertTrue(
            has_action_total,
            f"Summary table must show estimated action count '3'.\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    def test_summary_table_shows_per_repo_module_counts(self):
        """
        org/app-a has 2 modules, so the row for 'org/app-a' must show '2'
        in the module count column.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            self._build_fixture_dir(tmpdir)
            result = self._run_dry_run(tmpdir)
        combined = result.stdout + result.stderr
        # Find the line containing 'org/app-a' and check it also shows '2'.
        app_a_lines = [
            line for line in combined.splitlines() if "org/app-a" in line
        ]
        self.assertTrue(
            app_a_lines,
            f"No output line contains 'org/app-a'.\nstdout:\n{result.stdout}",
        )
        # At least one table row line should show '2' alongside org/app-a.
        has_module_count = any(re.search(r"\b2\b", line) for line in app_a_lines)
        self.assertTrue(
            has_module_count,
            f"Row for 'org/app-a' must show module count '2'.\n"
            f"Lines containing 'org/app-a': {app_a_lines}",
        )

    def test_summary_table_present_for_empty_config_dir(self):
        """
        Even with zero configs, --dry-run must still print a summary table
        (showing zeros) and exit 0.
        """
        result = _run_script("--dry-run", "--config-dir", "/nonexistent/path")
        combined = result.stdout + result.stderr
        self.assertEqual(
            result.returncode, 0,
            f"Script must exit 0 for empty config dir.\nstdout: {result.stdout}",
        )
        # Some form of summary must still be printed.
        has_summary = (
            "summary" in combined.lower()
            or "table" in combined.lower()
            or re.search(r"\b0\b", combined)
        )
        self.assertTrue(
            has_summary,
            f"Summary table must still appear for empty config dir.\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )


# ---------------------------------------------------------------------------
# Integration tests: 100-file scale fixtures
# ---------------------------------------------------------------------------


class TestScaleFixturesSummaryTable(unittest.TestCase):
    """
    Integration tests that run apply-overlays.py --dry-run against 100 overlay
    YAML files generated by tests/fixtures/generate_scale_fixtures.py.

    The scale fixture generator distributes files across three directory depths
    and assigns exactly ONE module per file.  Therefore:
      total_repos              = 100
      total_modules            = 100   (1 per repo)
      total_estimated_actions  = 100   (1 copier call per module)

    These tests FAIL until:
      1. load_overlay_configs uses recursive discovery (Path.rglob)
      2. --dry-run prints a formatted summary table with aggregate totals
         and one row per repo.
    """

    _FIXTURE_COUNT = 100

    def _generate_fixtures(self, output_dir: str) -> list:
        """Generate scale fixtures and return the list of created paths."""
        gen = _load_fixtures_module()
        return gen.generate(output_dir, count=self._FIXTURE_COUNT)

    def test_script_exits_0_with_scale_fixtures(self):
        """apply-overlays.py --dry-run must exit 0 with 100 scale fixtures."""
        with tempfile.TemporaryDirectory() as tmpdir:
            self._generate_fixtures(tmpdir)
            result = _run_script("--dry-run", "--config-dir", tmpdir)
        self.assertEqual(
            result.returncode, 0,
            f"Script must exit 0 with scale fixtures.\n"
            f"stdout (first 500): {result.stdout[:500]}\n"
            f"stderr (first 500): {result.stderr[:500]}",
        )

    def test_summary_table_repo_count_matches_fixture_count(self):
        """
        The summary table must show exactly 100 repos to match the fixture count.

        The number '100' must appear in the output in a context indicating it
        is the total repo count (adjacent to 'repo' keyword or in a totals row).
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            self._generate_fixtures(tmpdir)
            result = _run_script("--dry-run", "--config-dir", tmpdir)

        combined = result.stdout + result.stderr
        has_100_repos = bool(
            re.search(r"\b100\s*(repos?|repositories)\b", combined.lower())
            or re.search(r"(repos?|total)[^\n]*\b100\b", combined.lower())
            or re.search(r"\b100\b[^\n]*(repos?|total)", combined.lower())
        )
        self.assertTrue(
            has_100_repos,
            f"Summary table must show '100' as the total repo count.\n"
            f"stdout (first 1000 chars):\n{result.stdout[:1000]}",
        )

    def test_summary_table_row_count_matches_fixture_count(self):
        """
        The summary table must have exactly 100 data rows — one per repo.

        We measure this by counting how many lines in the output contain a
        'scale-org/repo-' pattern (the repo slug prefix used by the generator).
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            self._generate_fixtures(tmpdir)
            result = _run_script("--dry-run", "--config-dir", tmpdir)

        combined = result.stdout + result.stderr
        matching_lines = [
            line for line in combined.splitlines()
            if re.search(r"scale-org/repo-", line)
        ]
        self.assertEqual(
            len(matching_lines),
            self._FIXTURE_COUNT,
            f"Expected {self._FIXTURE_COUNT} table rows (one per repo), "
            f"found {len(matching_lines)}.\n"
            f"stdout (first 1000 chars):\n{result.stdout[:1000]}",
        )

    def test_summary_table_total_module_count_matches_fixture_total(self):
        """
        Each of the 100 scale fixtures has exactly 1 module, so the summary
        table must show total_modules = 100.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            self._generate_fixtures(tmpdir)
            result = _run_script("--dry-run", "--config-dir", tmpdir)

        combined = result.stdout + result.stderr
        has_100_modules = bool(
            re.search(r"\b100\s*modules?\b", combined.lower())
            or re.search(r"modules?[^\n]*\b100\b", combined.lower())
            or re.search(r"\b100\b[^\n]*modules?", combined.lower())
        )
        self.assertTrue(
            has_100_modules,
            f"Summary table must show total module count '100'.\n"
            f"stdout (first 1000 chars):\n{result.stdout[:1000]}",
        )

    def test_summary_table_estimated_action_count_matches_fixture_module_total(self):
        """
        With 100 modules across 100 repos, the summary must show
        total_estimated_actions = 100.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            self._generate_fixtures(tmpdir)
            result = _run_script("--dry-run", "--config-dir", tmpdir)

        combined = result.stdout + result.stderr
        has_100_actions = bool(
            re.search(r"\b100\s*(estimated\s+)?actions?\b", combined.lower())
            or re.search(r"(estimated\s+)?actions?[^\n]*\b100\b", combined.lower())
            or re.search(r"\b100\b[^\n]*(estimated|actions?)", combined.lower())
        )
        self.assertTrue(
            has_100_actions,
            f"Summary table must show estimated action count '100'.\n"
            f"stdout (first 1000 chars):\n{result.stdout[:1000]}",
        )

    def test_all_scale_fixture_repo_slugs_appear_in_output(self):
        """
        Every repo slug generated by the scale fixtures (scale-org/repo-NNNN)
        must appear somewhere in the dry-run output.  This verifies that
        recursive discovery finds all files at all three directory depths.
        """
        with tempfile.TemporaryDirectory() as tmpdir:
            paths = self._generate_fixtures(tmpdir)
            result = _run_script("--dry-run", "--config-dir", tmpdir)

        combined = result.stdout + result.stderr
        # Derive expected slugs from fixture index (matches _overlay_doc in generator).
        expected_slugs = [f"scale-org/repo-{i:04d}" for i in range(self._FIXTURE_COUNT)]
        missing = [slug for slug in expected_slugs if slug not in combined]
        self.assertEqual(
            missing,
            [],
            f"{len(missing)} of {self._FIXTURE_COUNT} repo slugs missing from output.\n"
            f"First 5 missing: {missing[:5]}\n"
            f"stdout (first 1000 chars):\n{result.stdout[:1000]}",
        )


if __name__ == "__main__":
    unittest.main()
